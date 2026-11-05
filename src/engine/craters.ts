import type { CraterClass } from '../types/lunar';

/**
 * DEM-derived crater characterization on a uniform square grid (idx = ix * NY + iy).
 *
 * For each node and a ladder of candidate radii we compare the mean elevation of a
 * 16-sample rim ring against the bowl center. A node is a crater candidate when the
 * bowl is deep enough (absolute + depth/diameter), the ring is almost entirely higher
 * than the center and the half-radius ring sits between floor and rim (convex bowl).
 * Candidates are de-duplicated with non-maximum suppression (deepest first).
 *
 * Each crater paints a traversal cost multiplier: interior (strongly penalized,
 * quasi-blocked when fresh/deep) and a blocky ejecta rim band (moderate penalty).
 */

export interface RawCrater {
  ix: number;
  iy: number;
  rCells: number;
  depthKm: number;
  dToD: number;
  severity: number;
  cls: CraterClass;
  wallSlopeDeg: number;
  excluded: boolean;
}

export interface CraterField {
  craters: RawCrater[];
  costMult: Float32Array;
  interiorOwner: Int16Array; // crater index + 1, 0 = none
  rimOwner: Int16Array;
}

export interface CraterOptions {
  minRadiusKm?: number;
  maxCraters?: number;
  minDepthToDiameter?: number;
  minDepthKm?: number;
  /** Return true when this crater contains a mission endpoint and must not be avoided. */
  exclude?: (ix: number, iy: number, rCells: number) => boolean;
}

const RADII_CELLS = [2, 3, 4, 5, 7, 10, 14, 20, 28, 40, 56];
const RING = 16;
const RAD2DEG = 180 / Math.PI;

export const CRATER_NO_GO_SEVERITY = 0.55;

export function characterizeCraters(
  elev: Float64Array,
  NX: number,
  NY: number,
  cellKm: number,
  opts: CraterOptions = {}
): CraterField {
  const minRadiusKm = opts.minRadiusKm ?? 0.08;
  const maxCraters = opts.maxCraters ?? 220;
  const minDToD = opts.minDepthToDiameter ?? 0.035;
  const minDepthKm = opts.minDepthKm ?? 0.006;
  const total = NX * NY;

  const bestDepth = new Float32Array(total);
  const bestR = new Uint8Array(total);

  for (const r of RADII_CELLS) {
    if (r * cellKm < minRadiusKm) continue;
    if (2 * r + 4 > Math.min(NX, NY)) break;

    const rdx: number[] = [];
    const rdy: number[] = [];
    const idx2: number[] = [];
    const idy2: number[] = [];
    const half = Math.max(1, Math.round(r * 0.5));
    for (let k = 0; k < RING; k++) {
      const th = (k / RING) * Math.PI * 2;
      rdx.push(Math.round(r * Math.cos(th)));
      rdy.push(Math.round(r * Math.sin(th)));
      if (k % 2 === 0) {
        idx2.push(Math.round(half * Math.cos(th)));
        idy2.push(Math.round(half * Math.sin(th)));
      }
    }

    const diamKm = 2 * r * cellKm;
    for (let ix = r + 1; ix < NX - r - 1; ix++) {
      for (let iy = r + 1; iy < NY - r - 1; iy++) {
        const id = ix * NY + iy;
        const center =
          (elev[id] + elev[id + NY] + elev[id - NY] + elev[id + 1] + elev[id - 1]) / 5;

        let ringSum = 0;
        for (let k = 0; k < RING; k++) {
          ringSum += elev[(ix + rdx[k]) * NY + (iy + rdy[k])];
        }
        const ringMean = ringSum / RING;
        const depth = ringMean - center;
        if (depth < minDepthKm || depth / diamKm < minDToD) continue;

        let higher = 0;
        const thr = center + 0.35 * depth;
        for (let k = 0; k < RING; k++) {
          if (elev[(ix + rdx[k]) * NY + (iy + rdy[k])] > thr) higher++;
        }
        if (higher < 14) continue;

        let innerSum = 0;
        for (let k = 0; k < idx2.length; k++) {
          innerSum += elev[(ix + idx2[k]) * NY + (iy + idy2[k])];
        }
        const innerMean = innerSum / idx2.length;
        if (innerMean < center - 1e-6 || innerMean > ringMean + 0.25 * depth) continue;

        if (depth > bestDepth[id]) {
          bestDepth[id] = depth;
          bestR[id] = r;
        }
      }
    }
  }

  const cand: { id: number; depth: number }[] = [];
  for (let i = 0; i < total; i++) if (bestDepth[i] > 0) cand.push({ id: i, depth: bestDepth[i] });
  cand.sort((a, b) => b.depth - a.depth);

  const craters: RawCrater[] = [];
  for (const c of cand) {
    if (craters.length >= maxCraters) break;
    const ix = Math.floor(c.id / NY);
    const iy = c.id % NY;
    const r = bestR[c.id];
    let clash = false;
    for (const a of craters) {
      const d = Math.hypot(ix - a.ix, iy - a.iy);
      if (d < 0.7 * Math.max(r, a.rCells)) {
        clash = true;
        break;
      }
    }
    if (clash) continue;

    const dToD = c.depth / (2 * r * cellKm);
    const severity = Math.max(0, Math.min(1, (dToD - minDToD) / 0.11));
    const cls: CraterClass = dToD >= 0.12 ? 'fresh' : dToD >= 0.07 ? 'mature' : 'degraded';
    const wallSlopeDeg = Math.atan(c.depth / Math.max(1e-6, 0.55 * r * cellKm)) * RAD2DEG;
    craters.push({
      ix,
      iy,
      rCells: r,
      depthKm: c.depth,
      dToD,
      severity,
      cls,
      wallSlopeDeg,
      excluded: opts.exclude ? opts.exclude(ix, iy, r) : false,
    });
  }

  const costMult = new Float32Array(total).fill(1);
  const interiorOwner = new Int16Array(total);
  const rimOwner = new Int16Array(total);

  craters.forEach((c, ci) => {
    if (c.excluded) return;
    const interiorMult =
      c.severity >= CRATER_NO_GO_SEVERITY ? 40 : 1 + 8 * (0.35 + 0.65 * c.severity);
    const rimMult = 1 + 2.2 * (0.25 + 0.75 * c.severity);
    const reach = Math.ceil(c.rCells * 1.35) + 1;
    for (let ix = Math.max(0, c.ix - reach); ix <= Math.min(NX - 1, c.ix + reach); ix++) {
      for (let iy = Math.max(0, c.iy - reach); iy <= Math.min(NY - 1, c.iy + reach); iy++) {
        const d = Math.hypot(ix - c.ix, iy - c.iy);
        const id = ix * NY + iy;
        if (d <= c.rCells * 0.88) {
          if (interiorMult > costMult[id]) costMult[id] = interiorMult;
          interiorOwner[id] = ci + 1;
        } else if (d <= c.rCells * 1.35) {
          if (rimMult > costMult[id]) costMult[id] = rimMult;
          if (!rimOwner[id]) rimOwner[id] = ci + 1;
        }
      }
    }
  });

  return { craters, costMult, interiorOwner, rimOwner };
}

