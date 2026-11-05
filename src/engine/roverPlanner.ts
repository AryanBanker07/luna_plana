import {
  CISLUNAR_SATELLITES,
  MOON_RADIUS_KM,
} from '../data/lunarCatalog';
import {
  CandidateCorridorPath,
  CharacterizedCrater,
  CraterRouteStats,
  LandingSite,
  RangeBoundaryPoint,
  ReachablePredefinedTarget,
  ReadinessStatus,
  RoverCheckpoint,
  RoverCoords,
  RoverParams,
  RoverRangeEnvelope,
  RoverTraverseLeg,
  RoverTraversePlan,
  TraverseWaypoint,
} from '../types/lunar';
import {
  characterizeCraters,
  CRATER_NO_GO_SEVERITY,
  CraterField,
} from './craters';
import {
  angularDistanceDeg,
  cartesianToLatLon,
  computeHorizonProfileDeg,
  computeSunEarthSelenographic,
  computeTopocentricAzEl,
  getDemResolutionAt,
  interpolateHorizonAtAzimuth,
  latLonToCartesian,
  propagateSatellite,
  sampleRoverElevationKm,
} from './selenography';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const LUNAR_GRAVITY_MS2 = 1.625;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function vNorm(a: Vec3): Vec3 {
  const m = Math.hypot(a.x, a.y, a.z) || 1e-9;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
}

/**
 * Slerp along great circle between unit vectors pA and pB
 */
function slerpLatLon(
  start: RoverCoords,
  end: RoverCoords,
  steps: number
): { lat: number; lon: number }[] {
  const [ax, ay, az] = latLonToCartesian(start.lat, start.lon, 1);
  const [bx, by, bz] = latLonToCartesian(end.lat, end.lon, 1);
  const pA: Vec3 = { x: ax, y: ay, z: az };
  const pB: Vec3 = { x: bx, y: by, z: bz };
  const omega = Math.acos(Math.max(-1, Math.min(1, vDot(pA, pB))));
  const sinOmega = Math.sin(omega);

  const pts: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let p: Vec3;
    if (sinOmega < 1e-6) {
      p = vNorm(vAdd(vScale(pA, 1 - t), vScale(pB, t)));
    } else {
      const wA = Math.sin((1 - t) * omega) / sinOmega;
      const wB = Math.sin(t * omega) / sinOmega;
      p = vNorm(vAdd(vScale(pA, wA), vScale(pB, wB)));
    }
    const ll = cartesianToLatLon(p.x, p.y, p.z);
    pts.push({ lat: ll.lat, lon: ll.lon });
  }
  return pts;
}

/**
 * Local surface slope magnitude (degrees) at rover wheel-base / local corridor scale
 */
function sampleLocalHazardSlopeDeg(
  lat: number,
  lon: number,
  stepKm: number,
  includeSubGrid: boolean
): number {
  const bKm = Math.max(0.015, Math.min(0.6, stepKm * 0.55));
  const [px, py, pz] = latLonToCartesian(lat, lon, 1);
  const p: Vec3 = { x: px, y: py, z: pz };
  // Construct two arbitrary orthogonal unit tangent vectors on sphere (singularity-free even at -90°!)
  const ref: Vec3 = Math.abs(p.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const t1 = vNorm(vCross(ref, p));
  const t2 = vNorm(vCross(p, t1));
  const dRad = bKm / MOON_RADIUS_KM;

  const p1p = cartesianToLatLon(p.x + t1.x * dRad, p.y + t1.y * dRad, p.z + t1.z * dRad);
  const p1m = cartesianToLatLon(p.x - t1.x * dRad, p.y - t1.y * dRad, p.z - t1.z * dRad);
  const p2p = cartesianToLatLon(p.x + t2.x * dRad, p.y + t2.y * dRad, p.z + t2.z * dRad);
  const p2m = cartesianToLatLon(p.x - t2.x * dRad, p.y - t2.y * dRad, p.z - t2.z * dRad);

  const dz1 =
    (sampleRoverElevationKm(p1p.lat, p1p.lon, includeSubGrid) -
      sampleRoverElevationKm(p1m.lat, p1m.lon, includeSubGrid)) /
    (2 * bKm);
  const dz2 =
    (sampleRoverElevationKm(p2p.lat, p2p.lon, includeSubGrid) -
      sampleRoverElevationKm(p2m.lat, p2m.lon, includeSubGrid)) /
    (2 * bKm);

  return Math.atan(Math.hypot(dz1, dz2)) * RAD2DEG;
}

/**
 * Binary min-heap (lazy-deletion) — replaces the O(n) open-list scan in A*.
 */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(val: number, key: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

function toCharacterized(
  field: CraterField,
  nodeLat: Float64Array,
  nodeLon: Float64Array,
  NY: number,
  cellKm: number,
  prefix: string
): CharacterizedCrater[] {
  return field.craters.map((c, i) => {
    const id = c.ix * NY + c.iy;
    return {
      id: `${prefix}-${i}`,
      lat: Number(nodeLat[id].toFixed(4)),
      lon: Number(nodeLon[id].toFixed(4)),
      radiusKm: Number((c.rCells * cellKm).toFixed(3)),
      depthM: Math.round(c.depthKm * 1000),
      depthToDiameter: Number(c.dToD.toFixed(3)),
      wallSlopeDeg: Number(c.wallSlopeDeg.toFixed(1)),
      craterClass: c.cls,
      severity: Number(c.severity.toFixed(2)),
      status: c.excluded
        ? 'endpoint'
        : c.severity >= CRATER_NO_GO_SEVERITY
        ? 'no-go'
        : 'avoid',
    } as CharacterizedCrater;
  });
}

function vecToCoords(v: Vec3): RoverCoords {
  const ll = cartesianToLatLon(v.x, v.y, v.z);
  return { lat: ll.lat, lon: ll.lon };
}

function chaikin(pts: Vec3[], passes: number): Vec3[] {
  let cur = pts;
  for (let pass = 0; pass < passes; pass++) {
    if (cur.length < 3) break;
    const next: Vec3[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p0 = cur[i];
      const p1 = cur[i + 1];
      if (i > 0) next.push(vNorm(vAdd(vScale(p0, 0.75), vScale(p1, 0.25))));
      if (i < cur.length - 2) next.push(vNorm(vAdd(vScale(p0, 0.25), vScale(p1, 0.75))));
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

function resampleVecs(pts: Vec3[], count: number): Vec3[] {
  if (pts.length < 2) return pts;
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const ang = Math.acos(Math.max(-1, Math.min(1, vDot(pts[i - 1], pts[i]))));
    cum.push(cum[i - 1] + ang);
  }
  const total = cum[cum.length - 1] || 1e-9;
  const out: Vec3[] = [];
  let seg = 0;
  for (let s = 0; s <= count; s++) {
    const target = (s / count) * total;
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const span = Math.max(1e-12, cum[seg + 1] - cum[seg]);
    const frac = Math.max(0, Math.min(1, (target - cum[seg]) / span));
    out.push(vNorm(vAdd(vScale(pts[seg], 1 - frac), vScale(pts[seg + 1], frac))));
  }
  return out;
}

interface GridRouteResult {
  vecs: Vec3[];
  craters: CharacterizedCrater[];
  interiorCrossed: number;
  rimCrossed: number;
  directInterior: number;
  nodes: number;
}

/**
 * Crater- and slope-aware A* on a singularity-free tangent-plane grid centered on the A–B midpoint.
 */
function routeOnTangentGrid(
  start: RoverCoords,
  end: RoverCoords,
  params: RoverParams,
  opts: { NX: number; excludePts: RoverCoords[]; crossFrac?: number }
): GridRouteResult {
  const [ax, ay, az] = latLonToCartesian(start.lat, start.lon, 1);
  const [bx, by, bz] = latLonToCartesian(end.lat, end.lon, 1);
  const pA: Vec3 = { x: ax, y: ay, z: az };
  const pB: Vec3 = { x: bx, y: by, z: bz };
  const geoKm =
    angularDistanceDeg(start.lat, start.lon, end.lat, end.lon) * DEG2RAD * MOON_RADIUS_KM;

  const fallback = (): GridRouteResult => ({
    vecs: slerpLatLon(start, end, 24).map((p) => {
      const [x, y, z] = latLonToCartesian(p.lat, p.lon, 1);
      return { x, y, z };
    }),
    craters: [],
    interiorCrossed: 0,
    rimCrossed: 0,
    directInterior: 0,
    nodes: 1,
  });
  if (geoKm < 0.02) return fallback();

  const e0 = vNorm(vAdd(pA, pB));
  let diff = vSub(pB, pA);
  diff = vSub(diff, vScale(e0, vDot(diff, e0)));
  const eX = vNorm(diff);
  const eY = vNorm(vCross(e0, eX));

  const uA = vDot(pA, eX) / Math.max(0.2, vDot(pA, e0));
  const uB = vDot(pB, eX) / Math.max(0.2, vDot(pB, e0));
  const halfSpan = Math.max(1e-6, (uB - uA) * 0.5);

  const NX = opts.NX;
  const padAlong = halfSpan * 0.25;
  const halfCross = halfSpan * (opts.crossFrac ?? 0.72);
  const uMin = uA - padAlong;
  const uMax = uB + padAlong;
  const du = (uMax - uMin) / (NX - 1);
  const NY = Math.max(15, Math.min(121, 2 * Math.round(halfCross / du) + 1));
  const dv = (2 * halfCross) / (NY - 1);
  const cellKm = Math.max(0.01, du * MOON_RADIUS_KM);

  const totalNodes = NX * NY;
  const nodeLat = new Float64Array(totalNodes);
  const nodeLon = new Float64Array(totalNodes);
  const nodeElev = new Float64Array(totalNodes);
  const nodeHazardSlope = new Float64Array(totalNodes);

  for (let ix = 0; ix < NX; ix++) {
    const u = uMin + ix * du;
    for (let iy = 0; iy < NY; iy++) {
      const v = -halfCross + iy * dv;
      const idx = ix * NY + iy;
      const vec = vNorm(vAdd(e0, vAdd(vScale(eX, u), vScale(eY, v))));
      const ll = cartesianToLatLon(vec.x, vec.y, vec.z);
      nodeLat[idx] = ll.lat;
      nodeLon[idx] = ll.lon;
      nodeElev[idx] = sampleRoverElevationKm(ll.lat, ll.lon, params.includeSubGridRoughness);
    }
  }

  // Crater characterization BEFORE slope pass so we can reuse the elevation raster
  const field = characterizeCraters(nodeElev, NX, NY, cellKm, {
    exclude: (ix, iy, rc) => {
      const id = ix * NY + iy;
      const rKm = rc * cellKm * 1.15;
      return opts.excludePts.some(
        (p) =>
          angularDistanceDeg(nodeLat[id], nodeLon[id], p.lat, p.lon) * DEG2RAD * MOON_RADIUS_KM <
          rKm
      );
    },
  });

  for (let idx = 0; idx < totalNodes; idx++) {
    nodeHazardSlope[idx] = sampleLocalHazardSlopeDeg(
      nodeLat[idx],
      nodeLon[idx],
      cellKm,
      params.includeSubGridRoughness
    );
  }

  const startIx = Math.max(0, Math.min(NX - 1, Math.round((uA - uMin) / du)));
  const endIx = Math.max(0, Math.min(NX - 1, Math.round((uB - uMin) / du)));
  const midIy = Math.floor(NY / 2);
  const startIdx = startIx * NY + midIy;
  const goalIdx = endIx * NY + midIy;

  nodeLat[startIdx] = start.lat;
  nodeLon[startIdx] = start.lon;
  nodeLat[goalIdx] = end.lat;
  nodeLon[goalIdx] = end.lon;

  const gScore = new Float64Array(totalNodes).fill(Infinity);
  const cameFrom = new Int32Array(totalNodes).fill(-1);
  const closed = new Uint8Array(totalNodes);
  const heap = new MinHeap();

  gScore[startIdx] = 0;
  heap.push(startIdx, geoKm);

  const neighbors = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 1], [2, -1], [1, 2], [1, -2],
    [-1, 2], [-1, -2], [-2, 1], [-2, -1],
  ];

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current]) continue;
    if (current === goalIdx) break;
    closed[current] = 1;

    const cx = Math.floor(current / NY);
    const cy = current % NY;

    for (const [dx, dy] of neighbors) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= NX || ny < 0 || ny >= NY) continue;
      const nIdx = nx * NY + ny;
      if (closed[nIdx]) continue;

      const dDeg = angularDistanceDeg(
        nodeLat[current],
        nodeLon[current],
        nodeLat[nIdx],
        nodeLon[nIdx]
      );
      const dKm = Math.max(1e-4, dDeg * DEG2RAD * MOON_RADIUS_KM);
      const dhKm = nodeElev[nIdx] - nodeElev[current];
      const gradeDeg = Math.abs(Math.atan2(dhKm, dKm) * RAD2DEG);
      const effSlope = Math.max(
        gradeDeg,
        0.5 * (nodeHazardSlope[current] + nodeHazardSlope[nIdx]) * 0.85
      );

      const climbPenalty = dhKm > 0 ? (dhKm / dKm) * 8.5 : 0;
      const slopeRatio = effSlope / Math.max(4, params.maxInclineDeg);
      let hazardMultiplier = 1.0 + climbPenalty + slopeRatio * slopeRatio * 1.4;
      if (effSlope > params.maxInclineDeg) {
        const excess = effSlope - params.maxInclineDeg;
        hazardMultiplier += 250 + excess * excess * 45;
      } else if (effSlope > params.maxInclineDeg * 0.8) {
        hazardMultiplier += (effSlope - params.maxInclineDeg * 0.8) ** 2 * 3.5;
      }

      const craterMult = 0.5 * (field.costMult[current] + field.costMult[nIdx]);
      const tentativeG = gScore[current] + dKm * hazardMultiplier * craterMult;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        const hDeg = angularDistanceDeg(nodeLat[nIdx], nodeLon[nIdx], end.lat, end.lon);
        heap.push(nIdx, tentativeG + hDeg * DEG2RAD * MOON_RADIUS_KM * 0.98);
      }
    }
  }

  const chain: number[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    chain.push(cur);
    if (cur === startIdx) break;
    cur = cameFrom[cur];
  }
  chain.reverse();
  if (chain.length < 2 || chain[0] !== startIdx) {
    const fb = fallback();
    fb.nodes = totalNodes;
    return fb;
  }

  // Crossing statistics along the chosen chain and the straight A→B row
  const interiorSet = new Set<number>();
  const rimSet = new Set<number>();
  for (const id of chain) {
    if (field.interiorOwner[id]) interiorSet.add(field.interiorOwner[id]);
    else if (field.rimOwner[id]) rimSet.add(field.rimOwner[id]);
  }
  const directSet = new Set<number>();
  for (let ix = Math.min(startIx, endIx); ix <= Math.max(startIx, endIx); ix++) {
    const o = field.interiorOwner[ix * NY + midIy];
    if (o) directSet.add(o);
  }

  const vecs: Vec3[] = chain.map((id) => {
    const [x, y, z] = latLonToCartesian(nodeLat[id], nodeLon[id], 1);
    return { x, y, z };
  });

  return {
    vecs,
    craters: toCharacterized(field, nodeLat, nodeLon, NY, cellKm, 'crater'),
    interiorCrossed: interiorSet.size,
    rimCrossed: rimSet.size,
    directInterior: directSet.size,
    nodes: totalNodes,
  };
}

function dedupeCraters(list: CharacterizedCrater[], cap: number): CharacterizedCrater[] {
  const sorted = [...list].sort((a, b) => b.radiusKm - a.radiusKm);
  const kept: { c: CharacterizedCrater; v: Vec3 }[] = [];
  for (const c of sorted) {
    if (kept.length >= cap) break;
    const [x, y, z] = latLonToCartesian(c.lat, c.lon, 1);
    const v = { x, y, z };
    let dup = false;
    for (const k of kept) {
      const thr = (0.6 * Math.max(c.radiusKm, k.c.radiusKm)) / MOON_RADIUS_KM;
      if (vDot(v, k.v) > Math.cos(thr)) {
        dup = true;
        break;
      }
    }
    if (!dup) kept.push({ c, v });
  }
  return kept.map((k, i) => ({ ...k.c, id: `crater-${i}` }));
}

interface AStarRouteResult {
  coords: { lat: number; lon: number }[];
  craters: CharacterizedCrater[];
  interiorCrossed: number;
  rimCrossed: number;
  directInterior: number | null;
}

const ROUTE_BUDGET_MS = 12000; // keeps total planning comfortably under ~20 s

/**
 * Hierarchical crater-aware router.
 *  - ≤70 km: single fine grid (≈120 m cells).
 *  - >70 km: coarse global corridor, then fine per-chunk refinement along it with an
 *    adaptive resolution that respects a wall-clock budget.
 */
function computeAStarRoute(
  start: RoverCoords,
  end: RoverCoords,
  params: RoverParams
): AStarRouteResult {
  const t0 = performance.now();
  const geoKm =
    angularDistanceDeg(start.lat, start.lon, end.lat, end.lon) * DEG2RAD * MOON_RADIUS_KM;

  if (geoKm < 0.08) {
    return {
      coords: [
        { lat: start.lat, lon: start.lon },
        { lat: end.lat, lon: end.lon },
      ],
      craters: [],
      interiorCrossed: 0,
      rimCrossed: 0,
      directInterior: 0,
    };
  }

  const sampleCount = Math.max(80, Math.min(360, Math.round(geoKm / 0.6)));
  let vecs: Vec3[];
  let craters: CharacterizedCrater[] = [];
  let interior = 0;
  let rim = 0;
  let direct: number | null = null;

  if (geoKm <= 70) {
    const NX = Math.max(48, Math.min(190, Math.round((geoKm * 1.25) / 0.12)));
    const r = routeOnTangentGrid(start, end, params, { NX, excludePts: [start, end] });
    vecs = r.vecs;
    craters = r.craters;
    interior = r.interiorCrossed;
    rim = r.rimCrossed;
    direct = r.directInterior;
  } else {
    const coarse = routeOnTangentGrid(start, end, params, {
      NX: 110,
      excludePts: [start, end],
    });
    let pathKm = 0;
    for (let i = 1; i < coarse.vecs.length; i++) {
      pathKm +=
        Math.acos(Math.max(-1, Math.min(1, vDot(coarse.vecs[i - 1], coarse.vecs[i])))) *
        MOON_RADIUS_KM;
    }
    const chunkKm = Math.max(30, pathKm / 24);
    const nChunks = Math.max(2, Math.ceil(pathKm / chunkKm));
    const anchors = resampleVecs(coarse.vecs, nChunks);

    const all: Vec3[] = [];
    const allCraters: CharacterizedCrater[] = [...coarse.craters];
    let nodeCostMs = 0;

    for (let i = 0; i < nChunks; i++) {
      const a = i === 0 ? start : vecToCoords(anchors[i]);
      const b = i === nChunks - 1 ? end : vecToCoords(anchors[i + 1]);

      let NX = 100;
      if (nodeCostMs > 0) {
        const left = Math.max(0, ROUTE_BUDGET_MS - (performance.now() - t0));
        const nodesAllowed = left / nodeCostMs / (nChunks - i);
        NX = Math.max(32, Math.min(110, Math.floor(Math.sqrt(nodesAllowed / 0.576))));
      }

      const tc = performance.now();
      const r = routeOnTangentGrid(a, b, params, { NX, excludePts: [start, end] });
      nodeCostMs = (performance.now() - tc) / Math.max(1, r.nodes);

      for (let k = i === 0 ? 0 : 1; k < r.vecs.length; k++) all.push(r.vecs[k]);
      allCraters.push(...r.craters);
      interior += r.interiorCrossed;
      rim += r.rimCrossed;
    }

    vecs = all;
    craters = dedupeCraters(allCraters, 400);
  }

  const smoothed = resampleVecs(chaikin(vecs, 1), sampleCount);
  const coords = smoothed.map((v) => vecToCoords(v));
  coords[0] = { lat: start.lat, lon: start.lon };
  coords[coords.length - 1] = { lat: end.lat, lon: end.lon };

  return { coords, craters, interiorCrossed: interior, rimCrossed: rim, directInterior: direct };
}

/**
 * Evaluate full terramechanics, speed derating, battery SoC, solar recharge & comm links along a coordinate path
 */
function simulatePathPhysics(
  coords: { lat: number; lon: number }[],
  params: RoverParams,
  startTimeMs: number
): {
  waypoints: TraverseWaypoint[];
  totalDistanceKm: number;
  totalDriveHours: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  maxSlopeEncounteredDeg: number;
  grossEnergyUsedWh: number;
  solarEnergyHarvestedWh: number;
  netEnergyUsedWh: number;
  minBatterySocPct: number;
  finalBatterySocPct: number;
  sunlitFractionPct: number;
  commCoveragePct: number;
  inclineViolationsCount: number;
} {
  const waypoints: TraverseWaypoint[] = [];
  let cumDistKm = 0;
  let elapsedHours = 0;
  let elevGainM = 0;
  let elevLossM = 0;
  let maxSlope = 0;
  let grossWh = 0;
  let solarWh = 0;
  let batteryWh = params.batteryCapacityWh; // Start at 100% SoC
  let minSocPct = 100;
  let sunlitCount = 0;
  let commCount = 0;
  let violations = 0;

  // Cache local horizon masks sparsely (every ~8 waypoints) for fast 60fps reactivity
  let cachedHorizon: number[] = computeHorizonProfileDeg(
    coords[0].lat,
    coords[0].lon,
    1.8
  );

  const stepSampleKm = Math.max(
    0.02,
    (angularDistanceDeg(
      coords[0].lat,
      coords[0].lon,
      coords[coords.length - 1].lat,
      coords[coords.length - 1].lon
    ) *
      DEG2RAD *
      MOON_RADIUS_KM) /
      Math.max(1, coords.length)
  );

  for (let i = 0; i < coords.length; i++) {
    const pt = coords[i];
    if (i > 0 && i % 10 === 0) {
      cachedHorizon = computeHorizonProfileDeg(pt.lat, pt.lon, 1.8);
    }

    const elevKm = sampleRoverElevationKm(
      pt.lat,
      pt.lon,
      params.includeSubGridRoughness
    );
    const localSideSlope = sampleLocalHazardSlopeDeg(
      pt.lat,
      pt.lon,
      stepSampleKm,
      params.includeSubGridRoughness
    );

    let segDistKm = 0;
    let gradeDeg = 0;
    let slopeDeg = localSideSlope;
    let speedKmh = params.cruiseSpeedKmh;
    let tractionWh = 0;
    let avionicsWh = 0;
    let segSolarWh = 0;

    if (i > 0) {
      const prev = waypoints[i - 1];
      const dDeg = angularDistanceDeg(prev.lat, prev.lon, pt.lat, pt.lon);
      segDistKm = Math.max(1e-5, dDeg * DEG2RAD * MOON_RADIUS_KM);
      cumDistKm += segDistKm;

      const dhKm = elevKm - prev.elevationKm;
      const dhMeters = dhKm * 1000;
      if (dhMeters > 0) elevGainM += dhMeters;
      else elevLossM += Math.abs(dhMeters);

      gradeDeg = Math.atan2(dhKm, segDistKm) * RAD2DEG;
      slopeDeg = Math.max(Math.abs(gradeDeg), localSideSlope * 0.85);

      // Terramechanics speed derating on slopes & regolith slip
      const slopeFrac = Math.min(1.25, slopeDeg / Math.max(5, params.maxInclineDeg));
      const speedDerate = Math.max(0.22, 1.0 - 0.62 * slopeFrac * slopeFrac);
      speedKmh = Math.max(0.12, params.cruiseSpeedKmh * speedDerate);

      const dtHours = segDistKm / speedKmh;
      elapsedHours += dtHours;

      // Lunar Terramechanics Energy Model (J -> Wh, 1 Wh = 3600 J)
      const distMeters = segDistKm * 1000;
      const cosTheta = Math.cos(Math.min(60, slopeDeg) * DEG2RAD);
      // Wheel slip penalty increases rolling resistance steeply above 60% maxIncline
      const slipFactor = 1.0 + 0.85 * Math.pow(Math.max(0, slopeFrac - 0.4), 2);
      const rollingJoules =
        (params.massKg *
          LUNAR_GRAVITY_MS2 *
          params.rollingResistanceCoeff *
          slipFactor *
          distMeters *
          cosTheta) /
        Math.max(0.35, params.drivetrainEfficiency);

      let gravityJoules = 0;
      if (dhMeters > 0) {
        gravityJoules =
          (params.massKg * LUNAR_GRAVITY_MS2 * dhMeters) /
          Math.max(0.35, params.drivetrainEfficiency);
      } else if (dhMeters < 0 && params.regenEfficiency > 0) {
        gravityJoules =
          params.massKg * LUNAR_GRAVITY_MS2 * dhMeters * params.regenEfficiency;
      }

      tractionWh = Math.max(0, (rollingJoules + gravityJoules) / 3600);
      avionicsWh = params.avionicsLoadW * dtHours;
    }

    const wpTimeMs = startTimeMs + elapsedHours * 3600 * 1000;
    const ephem = computeSunEarthSelenographic(wpTimeMs);

    const sunTopo = computeTopocentricAzEl(
      pt.lat,
      pt.lon,
      elevKm,
      ephem.subSolarLat,
      ephem.subSolarLon,
      149597870
    );
    const sunHor = interpolateHorizonAtAzimuth(cachedHorizon, sunTopo.azimuthDeg);
    const sunVisible = sunTopo.elevationDeg > sunHor - 0.25;
    if (sunVisible) sunlitCount++;

    const earthTopo = computeTopocentricAzEl(
      pt.lat,
      pt.lon,
      elevKm,
      ephem.subEarthLat,
      ephem.subEarthLon,
      ephem.earthDistanceKm
    );
    const earthHor = interpolateHorizonAtAzimuth(cachedHorizon, earthTopo.azimuthDeg);
    let commLinked = earthTopo.elevationDeg > earthHor;

    if (!commLinked) {
      for (const sat of CISLUNAR_SATELLITES) {
        if (!sat.isRelay) continue;
        const st = propagateSatellite(
          sat,
          wpTimeMs,
          pt.lat,
          pt.lon,
          elevKm,
          cachedHorizon,
          false
        );
        if (st.isVisibleFromSite) {
          commLinked = true;
          break;
        }
      }
    }
    if (commLinked) commCount++;

    if (i > 0 && params.useSolarCharging && sunVisible) {
      const dtHours = segDistKm / speedKmh;
      // Polar vertical rover arrays capture cos(el), equatorial capture sin(el)
      const isPolar = Math.abs(pt.lat) > 70;
      const incidenceEff = isPolar
        ? Math.max(0.35, Math.cos(Math.max(0, sunTopo.elevationDeg) * DEG2RAD))
        : Math.max(0.15, Math.sin(Math.max(5, sunTopo.elevationDeg) * DEG2RAD));
      segSolarWh = params.solarPeakW * incidenceEff * 0.82 * dtHours;
    }

    grossWh += tractionWh + avionicsWh;
    solarWh += segSolarWh;
    batteryWh = Math.min(
      params.batteryCapacityWh,
      batteryWh - (tractionWh + avionicsWh) + segSolarWh
    );

    const socPct = Math.max(
      0,
      Math.min(100, (batteryWh / Math.max(1, params.batteryCapacityWh)) * 100)
    );
    if (socPct < minSocPct) minSocPct = socPct;
    if (slopeDeg > maxSlope) maxSlope = slopeDeg;

    const slopeStatus: ReadinessStatus =
      slopeDeg > params.maxInclineDeg
        ? 'NO-GO'
        : slopeDeg > params.maxInclineDeg * 0.8
        ? 'CAUTION'
        : 'GO';

    if (slopeStatus === 'NO-GO') violations++;

    waypoints.push({
      index: i,
      lat: Number(pt.lat.toFixed(4)),
      lon: Number(pt.lon.toFixed(4)),
      cumDistanceKm: Number(cumDistKm.toFixed(3)),
      segmentDistKm: Number(segDistKm.toFixed(3)),
      elevationKm: Number(elevKm.toFixed(4)),
      slopeDeg: Number(slopeDeg.toFixed(1)),
      gradeDeg: Number(gradeDeg.toFixed(1)),
      speedKmh: Number(speedKmh.toFixed(2)),
      elapsedHours: Number(elapsedHours.toFixed(2)),
      timestampMs: Math.round(wpTimeMs),
      tractionEnergyWh: Number(tractionWh.toFixed(1)),
      avionicsEnergyWh: Number(avionicsWh.toFixed(1)),
      solarHarvestWh: Number(segSolarWh.toFixed(1)),
      netEnergyUsedWh: Number(Math.max(0, grossWh - solarWh).toFixed(1)),
      batterySocPct: Number(socPct.toFixed(1)),
      sunVisible,
      commLinked,
      slopeStatus,
    });
  }

  const finalSocPct =
    waypoints.length > 0 ? waypoints[waypoints.length - 1].batterySocPct : 100;

  return {
    waypoints,
    totalDistanceKm: Number(cumDistKm.toFixed(2)),
    totalDriveHours: Number(elapsedHours.toFixed(2)),
    elevationGainMeters: Math.round(elevGainM),
    elevationLossMeters: Math.round(elevLossM),
    maxSlopeEncounteredDeg: Number(maxSlope.toFixed(1)),
    grossEnergyUsedWh: Math.round(grossWh),
    solarEnergyHarvestedWh: Math.round(solarWh),
    netEnergyUsedWh: Math.round(Math.max(0, grossWh - solarWh)),
    minBatterySocPct: Number(minSocPct.toFixed(1)),
    finalBatterySocPct: Number(finalSocPct.toFixed(1)),
    sunlitFractionPct: Math.round((sunlitCount / Math.max(1, waypoints.length)) * 100),
    commCoveragePct: Math.round((commCount / Math.max(1, waypoints.length)) * 100),
    inclineViolationsCount: violations,
  };
}

/**
 * Full Rover Traverse Mission Feasibility Planner (compares A* Optimal vs Direct Geodesic)
 * Supports multi-leg traverses with arbitrary intermediate checkpoints [Start -> CP1 -> CP2... -> End]
 */
export function planRoverTraverse(
  start: RoverCoords,
  end: RoverCoords,
  params: RoverParams,
  startTimeMs: number,
  routingMode: 'astar' | 'direct' = 'astar',
  checkpoints: RoverCoords[] = []
): RoverTraversePlan {
  const tRoute0 = performance.now();
  const allControlPoints: RoverCoords[] = [start, ...checkpoints, end];
  const totalLegs = allControlPoints.length - 1;

  // Compute total geodesic distance across all legs
  let geodesicDistanceKm = 0;
  for (let k = 0; k < totalLegs; k++) {
    const geoDeg = angularDistanceDeg(
      allControlPoints[k].lat,
      allControlPoints[k].lon,
      allControlPoints[k + 1].lat,
      allControlPoints[k + 1].lon
    );
    geodesicDistanceKm += geoDeg * DEG2RAD * MOON_RADIUS_KM;
  }
  geodesicDistanceKm = Number(geodesicDistanceKm.toFixed(2));

  // Compute Direct Geodesic across all legs for side-by-side comparison
  const directCoords: { lat: number; lon: number }[] = [];
  for (let k = 0; k < totalLegs; k++) {
    const stepsThisLeg = Math.max(16, Math.round(80 / totalLegs));
    const legPts = slerpLatLon(allControlPoints[k], allControlPoints[k + 1], stepsThisLeg);
    if (k === 0) {
      directCoords.push(...legPts);
    } else {
      directCoords.push(...legPts.slice(1));
    }
  }

  const directSim = simulatePathPhysics(directCoords, params, startTimeMs);
  const directStatus: ReadinessStatus =
    directSim.maxSlopeEncounteredDeg > params.maxInclineDeg ||
    directSim.minBatterySocPct <= 2
      ? 'NO-GO'
      : directSim.minBatterySocPct < params.minReserveSocPct ||
        directSim.maxSlopeEncounteredDeg > params.maxInclineDeg * 0.85
      ? 'CAUTION'
      : 'GO';

  let activeCoords = directCoords;
  let craters: CharacterizedCrater[] = [];
  let craterStats: CraterRouteStats = {
    detected: 0,
    noGo: 0,
    interiorCrossings: 0,
    rimCrossings: 0,
    directInteriorCrossings: null,
    computeMs: 0,
  };

  if (routingMode === 'astar') {
    const legCoords: { lat: number; lon: number }[] = [];
    const collectedCraters: CharacterizedCrater[] = [];
    let intCross = 0;
    let rimCross = 0;
    let dirIntCross = 0;

    for (let k = 0; k < totalLegs; k++) {
      const legRes = computeAStarRoute(allControlPoints[k], allControlPoints[k + 1], params);
      if (k === 0) {
        legCoords.push(...legRes.coords);
      } else {
        legCoords.push(...legRes.coords.slice(1));
      }
      collectedCraters.push(...legRes.craters);
      intCross += legRes.interiorCrossed;
      rimCross += legRes.rimCrossed;
      if (legRes.directInterior !== null) {
        dirIntCross += legRes.directInterior;
      }
    }

    activeCoords = legCoords;

    // Deduplicate craters across legs by id
    const seenCraters = new Set<string>();
    craters = [];
    for (const c of collectedCraters) {
      if (!seenCraters.has(c.id)) {
        seenCraters.add(c.id);
        craters.push(c);
      }
    }

    const noGoCount = craters.filter((c) => c.status === 'no-go').length;
    craterStats = {
      detected: craters.length,
      noGo: noGoCount,
      interiorCrossings: intCross,
      rimCrossings: rimCross,
      directInteriorCrossings: dirIntCross,
      computeMs: Math.round(performance.now() - tRoute0),
    };
  }

  const sim =
    routingMode === 'astar'
      ? simulatePathPhysics(activeCoords, params, startTimeMs)
      : directSim;

  const midWp = sim.waypoints[Math.floor(sim.waypoints.length / 2)] || {
    lat: start.lat,
    lon: start.lon,
  };
  const demInfo = getDemResolutionAt(
    midWp.lat,
    midWp.lon,
    params.includeSubGridRoughness
  );

  // Compute breakdown of individual mission legs when checkpoints exist
  const legs: RoverTraverseLeg[] = [];
  if (totalLegs > 1 && sim.waypoints.length >= 2) {
    let lastWpIdx = 0;
    for (let k = 0; k < totalLegs; k++) {
      const targetPt = allControlPoints[k + 1];
      let bestWpIdx = sim.waypoints.length - 1;
      if (k < totalLegs - 1) {
        let minD = Infinity;
        for (let w = lastWpIdx + 1; w < sim.waypoints.length; w++) {
          const wp = sim.waypoints[w];
          const dDeg = angularDistanceDeg(wp.lat, wp.lon, targetPt.lat, targetPt.lon);
          if (dDeg < minD) {
            minD = dDeg;
            bestWpIdx = w;
          }
        }
      }
      const startWp = sim.waypoints[lastWpIdx];
      const endWp = sim.waypoints[bestWpIdx];
      const legWps = sim.waypoints.slice(lastWpIdx, bestWpIdx + 1);
      const legDist = Math.max(0, endWp.cumDistanceKm - startWp.cumDistanceKm);
      const legHours = Math.max(0, endWp.elapsedHours - startWp.elapsedHours);
      const legMaxSlope = Math.max(...legWps.map((w) => w.slopeDeg), 0);
      let legGainM = 0;
      let legLossM = 0;
      for (let i = 1; i < legWps.length; i++) {
        const dh = (legWps[i].elevationKm - legWps[i - 1].elevationKm) * 1000;
        if (dh > 0) legGainM += dh;
        else legLossM += Math.abs(dh);
      }
      const fromLbl = allControlPoints[k].label || (k === 0 ? 'Start [A]' : `CP ${k}`);
      const toLbl =
        allControlPoints[k + 1].label ||
        (k + 1 === allControlPoints.length - 1 ? 'Goal [B]' : `CP ${k + 1}`);

      legs.push({
        legIndex: k + 1,
        fromLabel: fromLbl,
        toLabel: toLbl,
        distanceKm: Number(legDist.toFixed(2)),
        driveHours: Number(legHours.toFixed(2)),
        energyWh: Math.round(
          legWps.reduce((acc, w) => acc + w.tractionEnergyWh + w.avionicsEnergyWh, 0)
        ),
        maxSlopeDeg: Number(legMaxSlope.toFixed(1)),
        elevationGainM: Math.round(legGainM),
        elevationLossM: Math.round(legLossM),
        startWaypointIdx: lastWpIdx,
        endWaypointIdx: bestWpIdx,
      });
      lastWpIdx = bestWpIdx;
    }
  }

  const formattedCheckpoints: RoverCheckpoint[] = checkpoints.map((cp, idx) => ({
    id: `cp-${idx + 1}`,
    lat: cp.lat,
    lon: cp.lon,
    label: cp.label || `CP ${idx + 1}`,
    elevationKm: sampleRoverElevationKm(cp.lat, cp.lon, params.includeSubGridRoughness),
  }));

  // Build transparent engineering feasibility reasons
  const reasons: string[] = [];
  let status: ReadinessStatus = 'GO';

  if (checkpoints.length > 0) {
    reasons.push(
      `Multi-checkpoint traverse: routed through ${checkpoints.length} intermediate via-point(s) across ${totalLegs} mission leg(s).`
    );
  }

  if (sim.maxSlopeEncounteredDeg > params.maxInclineDeg) {
    status = 'NO-GO';
    reasons.push(
      `Peak terrain incline (${sim.maxSlopeEncounteredDeg}°) exceeds ${params.name} limit (${params.maxInclineDeg}°) across ${sim.inclineViolationsCount} segment(s).`
    );
  } else if (sim.maxSlopeEncounteredDeg > params.maxInclineDeg * 0.82) {
    status = 'CAUTION';
    reasons.push(
      `Peak slope (${sim.maxSlopeEncounteredDeg}°) approaches ${params.maxInclineDeg}° chassis slip threshold — engage hazard-lidar slow-crawl.`
    );
  } else {
    reasons.push(
      `All terrain slopes stay within safe envelope (max ${sim.maxSlopeEncounteredDeg}° vs ${params.maxInclineDeg}° limit).`
    );
  }

  if (sim.minBatterySocPct <= 1.0) {
    status = 'NO-GO';
    reasons.push(
      `Battery depletes to 0% before arrival (Gross load ${sim.grossEnergyUsedWh.toLocaleString()} Wh exceeds ${params.batteryCapacityWh.toLocaleString()} Wh + ${sim.solarEnergyHarvestedWh.toLocaleString()} Wh solar).`
    );
  } else if (sim.minBatterySocPct < params.minReserveSocPct) {
    if (status !== 'NO-GO') status = 'CAUTION';
    reasons.push(
      `Minimum battery SoC (${sim.minBatterySocPct}%) dips below ${params.minReserveSocPct}% flight-rule reserve floor.`
    );
  } else {
    reasons.push(
      `Energy budget positive: arrives with ${sim.finalBatterySocPct}% SoC (min ${sim.minBatterySocPct}% > ${params.minReserveSocPct}% reserve).`
    );
  }

  if (sim.commCoveragePct < 50) {
    if (status === 'GO') status = 'CAUTION';
    reasons.push(
      `Communications occulted along ${100 - sim.commCoveragePct}% of route — autonomous onboard obstacle avoidance required.`
    );
  } else {
    reasons.push(
      `${sim.commCoveragePct}% of traverse maintains live Direct-to-Earth or Cislunar Relay telemetry lock.`
    );
  }

  if (
    routingMode === 'astar' &&
    directSim.maxSlopeEncounteredDeg > sim.maxSlopeEncounteredDeg + 1.5
  ) {
    reasons.push(
      `A* terrain pathfinder reduced peak incline from ${directSim.maxSlopeEncounteredDeg}° (direct line) down to ${sim.maxSlopeEncounteredDeg}°.`
    );
  }

  if (craterStats.detected > 0) {
    if (craterStats.interiorCrossings === 0 && (craterStats.directInteriorCrossings ?? 0) > 0) {
      reasons.push(
        `Autonomous crater routing circumvented ${craterStats.directInteriorCrossings} hazardous crater interior(s) encountered along direct line.`
      );
    } else if (craterStats.interiorCrossings === 0) {
      reasons.push(
        `Crater characterization mapped ${craterStats.detected} bowls (${craterStats.noGo} steep/fresh) — path completely avoids hazardous interiors.`
      );
    } else {
      reasons.push(
        `Crater characterization mapped ${craterStats.detected} bowls; route skims ${craterStats.interiorCrossings} degraded low-relief margin(s).`
      );
    }
  }

  const slopeScore =
    sim.maxSlopeEncounteredDeg > params.maxInclineDeg
      ? 5
      : Math.round(35 * (1 - sim.maxSlopeEncounteredDeg / (params.maxInclineDeg * 1.25)));
  const energyScore =
    sim.minBatterySocPct <= 1
      ? 0
      : Math.min(35, Math.round((sim.minBatterySocPct / 100) * 42));
  const commScore = Math.round((sim.commCoveragePct / 100) * 20);
  const sunScore = Math.round((sim.sunlitFractionPct / 100) * 10);
  const feasibilityScore = Math.max(
    0,
    Math.min(100, slopeScore + energyScore + commScore + sunScore)
  );

  const detourPct =
    geodesicDistanceKm > 0.05
      ? Number(
          Math.max(
            0,
            ((sim.totalDistanceKm - geodesicDistanceKm) / geodesicDistanceKm) * 100
          ).toFixed(1)
        )
      : 0;

  const avgSpeedKmh =
    sim.totalDriveHours > 1e-4
      ? Number((sim.totalDistanceKm / sim.totalDriveHours).toFixed(2))
      : params.cruiseSpeedKmh;

  const specificEnergyWhPerKm =
    sim.totalDistanceKm > 0.01
      ? Number((sim.grossEnergyUsedWh / sim.totalDistanceKm).toFixed(1))
      : 0;

  return {
    mode: routingMode,
    craters,
    craterStats,
    start,
    end,
    checkpoints: formattedCheckpoints.length > 0 ? formattedCheckpoints : undefined,
    legs: legs.length > 0 ? legs : undefined,
    geodesicDistanceKm,
    totalDistanceKm: sim.totalDistanceKm,
    detourPct,
    totalDriveHours: sim.totalDriveHours,
    elevationGainMeters: sim.elevationGainMeters,
    elevationLossMeters: sim.elevationLossMeters,
    maxSlopeEncounteredDeg: sim.maxSlopeEncounteredDeg,
    avgSpeedKmh,
    grossEnergyUsedWh: sim.grossEnergyUsedWh,
    solarEnergyHarvestedWh: sim.solarEnergyHarvestedWh,
    netEnergyUsedWh: sim.netEnergyUsedWh,
    specificEnergyWhPerKm,
    minBatterySocPct: sim.minBatterySocPct,
    finalBatterySocPct: sim.finalBatterySocPct,
    sunlitFractionPct: sim.sunlitFractionPct,
    commCoveragePct: sim.commCoveragePct,
    inclineViolationsCount: sim.inclineViolationsCount,
    feasibilityStatus: status,
    feasibilityScore,
    reasons,
    demInfo,
    waypoints: sim.waypoints,
    directComparison: {
      distanceKm: directSim.totalDistanceKm,
      maxSlopeDeg: directSim.maxSlopeEncounteredDeg,
      netEnergyWh: directSim.netEnergyUsedWh,
      minSocPct: directSim.minBatterySocPct,
      status: directStatus,
    },
  };
}

/**
 * Fast analytical estimate of single-sortie flat-ground range & usable energy
 */
export function estimateFlatRangeKm(params: RoverParams): {
  usableBatteryWh: number;
  flatRangeKm: number;
  maxSortieHours: number;
  netPowerW: number;
} {
  const usableBatteryWh = Math.max(
    25,
    params.batteryCapacityWh * Math.max(0.05, 1 - params.minReserveSocPct / 100)
  );
  const vMs = Math.max(0.05, params.cruiseSpeedKmh / 3.6);
  const tractionW =
    (params.massKg * LUNAR_GRAVITY_MS2 * params.rollingResistanceCoeff * vMs) /
    Math.max(0.35, params.drivetrainEfficiency);
  const grossW = tractionW + params.avionicsLoadW;
  const solarOffsetW = params.useSolarCharging
    ? Math.min(grossW * 0.68, params.solarPeakW * 0.48)
    : 0;
  const netW = Math.max(grossW * 0.32, grossW - solarOffsetW);
  const maxSortieHours =
    params.cruiseSpeedKmh <= 2.5 ? 18 : params.batteryCapacityWh >= 15000 ? 12 : 5.5;
  const enduranceHours = Math.min(maxSortieHours, usableBatteryWh / Math.max(5, netW));
  const flatRangeKm = Number(
    Math.max(1.2, Math.min(85, enduranceHours * params.cruiseSpeedKmh)).toFixed(1)
  );

  return {
    usableBatteryWh: Math.round(usableBatteryWh),
    flatRangeKm,
    maxSortieHours,
    netPowerW: Math.round(netW),
  };
}

const COMPASS_12_NAMES = [
  'N',
  'NNE',
  'ENE',
  'E',
  'ESE',
  'SSE',
  'S',
  'SSW',
  'WSW',
  'W',
  'WNW',
  'NNW',
];

/**
 * Compute terrain-, incline-, and energy-constrained Operational Range Envelope
 * plus rough branching feasible paths from Start [A] using Single-Source Dijkstra.
 */
export function computeRoverRangeEnvelope(
  origin: RoverCoords,
  params: RoverParams,
  startTimeMs: number,
  curatedSites: LandingSite[]
): RoverRangeEnvelope {
  const { usableBatteryWh, flatRangeKm, maxSortieHours } = estimateFlatRangeKm(params);

  const [ox, oy, oz] = latLonToCartesian(origin.lat, origin.lon, 1);
  const e0: Vec3 = { x: ox, y: oy, z: oz };
  const northRef: Vec3 =
    Math.abs(origin.lat) < 88.5 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const eEast = vNorm(vCross(northRef, e0));
  const eNorth = vNorm(vCross(e0, eEast));

  const GRID_N = 41;
  const mid = Math.floor(GRID_N / 2);
  const halfSpanKm = flatRangeKm * 1.15;
  const halfSpanRad = halfSpanKm / MOON_RADIUS_KM;
  const stepRad = (2 * halfSpanRad) / (GRID_N - 1);
  const cellKm = Math.max(0.025, stepRad * MOON_RADIUS_KM);

  const totalNodes = GRID_N * GRID_N;
  const nodeLat = new Float64Array(totalNodes);
  const nodeLon = new Float64Array(totalNodes);
  const nodeElev = new Float64Array(totalNodes);
  const nodeSlope = new Float64Array(totalNodes);
  const nodeU = new Float64Array(totalNodes); // East tangent rad
  const nodeV = new Float64Array(totalNodes); // North tangent rad

  for (let ix = 0; ix < GRID_N; ix++) {
    const u = -halfSpanRad + ix * stepRad;
    for (let iy = 0; iy < GRID_N; iy++) {
      const v = -halfSpanRad + iy * stepRad;
      const idx = ix * GRID_N + iy;
      nodeU[idx] = u;
      nodeV[idx] = v;
      const vec = vNorm(vAdd(e0, vAdd(vScale(eEast, u), vScale(eNorth, v))));
      const ll = cartesianToLatLon(vec.x, vec.y, vec.z);
      nodeLat[idx] = ll.lat;
      nodeLon[idx] = ll.lon;
      nodeElev[idx] = sampleRoverElevationKm(
        ll.lat,
        ll.lon,
        params.includeSubGridRoughness
      );
      nodeSlope[idx] = sampleLocalHazardSlopeDeg(
        ll.lat,
        ll.lon,
        cellKm,
        params.includeSubGridRoughness
      );
    }
  }

  const centerIdx = mid * GRID_N + mid;
  nodeLat[centerIdx] = origin.lat;
  nodeLon[centerIdx] = origin.lon;
  nodeElev[centerIdx] = sampleRoverElevationKm(
    origin.lat,
    origin.lon,
    params.includeSubGridRoughness
  );

  // Characterize craters within local operational envelope
  const envelopeCraterField = characterizeCraters(nodeElev, GRID_N, GRID_N, cellKm, {
    exclude: (ix, iy, rc) => {
      const id = ix * GRID_N + iy;
      const rKm = rc * cellKm * 1.15;
      return (
        angularDistanceDeg(nodeLat[id], nodeLon[id], origin.lat, origin.lon) *
          DEG2RAD *
          MOON_RADIUS_KM <
        rKm
      );
    },
  });
  const localCraters = toCharacterized(
    envelopeCraterField,
    nodeLat,
    nodeLon,
    GRID_N,
    cellKm,
    'env-crater'
  );

  // Estimate ambient solar illumination at Start [A] for live solar harvest rate
  const ephem = computeSunEarthSelenographic(startTimeMs);
  const originHorizon = computeHorizonProfileDeg(origin.lat, origin.lon, 1.8);
  const sunTopo = computeTopocentricAzEl(
    origin.lat,
    origin.lon,
    nodeElev[centerIdx],
    ephem.subSolarLat,
    ephem.subSolarLon,
    149597870
  );
  const sunHor = interpolateHorizonAtAzimuth(originHorizon, sunTopo.azimuthDeg);
  const originSunlit = sunTopo.elevationDeg > sunHor - 0.25;
  const isPolar = Math.abs(origin.lat) > 70;
  const solarPowerW =
    params.useSolarCharging && originSunlit
      ? params.solarPeakW *
        0.78 *
        (isPolar
          ? Math.max(0.35, Math.cos(Math.max(0, sunTopo.elevationDeg) * DEG2RAD))
          : Math.max(0.15, Math.sin(Math.max(5, sunTopo.elevationDeg) * DEG2RAD)))
      : 0;

  // Single-Source Dijkstra over normalized sortie budget (0.0 -> 1.0)
  const resourceCost = new Float64Array(totalNodes).fill(Infinity);
  const netEnergyAt = new Float64Array(totalNodes).fill(0);
  const driveHoursAt = new Float64Array(totalNodes).fill(0);
  const distKmAt = new Float64Array(totalNodes).fill(0);
  const maxSlopeAt = new Float64Array(totalNodes).fill(0);
  const cameFrom = new Int32Array(totalNodes).fill(-1);
  const closed = new Uint8Array(totalNodes);
  const inOpen = new Uint8Array(totalNodes);

  resourceCost[centerIdx] = 0;
  inOpen[centerIdx] = 1;
  const openList: number[] = [centerIdx];

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
    [2, 1],
    [2, -1],
    [1, 2],
    [1, -2],
    [-1, 2],
    [-1, -2],
    [-2, 1],
    [-2, -1],
  ];

  while (openList.length > 0) {
    let bestPos = 0;
    let current = openList[0];
    let bestC = resourceCost[current];
    for (let i = 1; i < openList.length; i++) {
      const cand = openList[i];
      if (resourceCost[cand] < bestC) {
        bestC = resourceCost[cand];
        current = cand;
        bestPos = i;
      }
    }

    openList.splice(bestPos, 1);
    inOpen[current] = 0;
    if (bestC > 1.0) continue;
    closed[current] = 1;

    const cx = Math.floor(current / GRID_N);
    const cy = current % GRID_N;

    for (const [dx, dy] of neighbors) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= GRID_N || ny < 0 || ny >= GRID_N) continue;
      const nIdx = nx * GRID_N + ny;
      if (closed[nIdx]) continue;

      const dDeg = angularDistanceDeg(
        nodeLat[current],
        nodeLon[current],
        nodeLat[nIdx],
        nodeLon[nIdx]
      );
      const segKm = Math.max(1e-4, dDeg * DEG2RAD * MOON_RADIUS_KM);
      const dhKm = nodeElev[nIdx] - nodeElev[current];
      const gradeDeg = Math.abs(Math.atan2(dhKm, segKm) * RAD2DEG);
      const effSlope = Math.max(
        gradeDeg,
        0.5 * (nodeSlope[current] + nodeSlope[nIdx]) * 0.85
      );

      // Hard incline cutoff (grace margin on very first step if start pin is near a rim)
      const limitDeg =
        current === centerIdx ? params.maxInclineDeg + 6 : params.maxInclineDeg;
      if (effSlope > limitDeg) continue;

      const slopeFrac = Math.min(1.2, effSlope / Math.max(5, params.maxInclineDeg));
      const speedDerate = Math.max(0.24, 1.0 - 0.6 * slopeFrac * slopeFrac);
      const speedKmh = Math.max(0.12, params.cruiseSpeedKmh * speedDerate);
      const dtHours = segKm / speedKmh;

      const distMeters = segKm * 1000;
      const dhMeters = dhKm * 1000;
      const cosTheta = Math.cos(Math.min(60, effSlope) * DEG2RAD);
      const slipFactor = 1.0 + 0.85 * Math.pow(Math.max(0, slopeFrac - 0.4), 2);
      const rollingJ =
        (params.massKg *
          LUNAR_GRAVITY_MS2 *
          params.rollingResistanceCoeff *
          slipFactor *
          distMeters *
          cosTheta) /
        Math.max(0.35, params.drivetrainEfficiency);

      let gravJ = 0;
      if (dhMeters > 0) {
        gravJ =
          (params.massKg * LUNAR_GRAVITY_MS2 * dhMeters) /
          Math.max(0.35, params.drivetrainEfficiency);
      } else if (dhMeters < 0 && params.regenEfficiency > 0) {
        gravJ = params.massKg * LUNAR_GRAVITY_MS2 * dhMeters * params.regenEfficiency;
      }

      const tractionWh = Math.max(0, (rollingJ + gravJ) / 3600);
      const avionicsWh = params.avionicsLoadW * dtHours;
      const solarWh = solarPowerW * dtHours;
      const segNetWh = Math.max(
        (tractionWh + avionicsWh) * 0.28,
        tractionWh + avionicsWh - solarWh
      );

      const craterMult =
        0.5 *
        (envelopeCraterField.costMult[current] + envelopeCraterField.costMult[nIdx]);
      const stepResource = Math.max(
        (segNetWh * craterMult) / usableBatteryWh,
        dtHours / maxSortieHours
      );
      const tentativeCost = resourceCost[current] + stepResource;

      if (tentativeCost <= 1.0 && tentativeCost < resourceCost[nIdx]) {
        resourceCost[nIdx] = tentativeCost;
        cameFrom[nIdx] = current;
        netEnergyAt[nIdx] = netEnergyAt[current] + segNetWh;
        driveHoursAt[nIdx] = driveHoursAt[current] + dtHours;
        distKmAt[nIdx] = distKmAt[current] + segKm;
        maxSlopeAt[nIdx] = Math.max(maxSlopeAt[current], effSlope);
        if (!inOpen[nIdx]) {
          openList.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }

  // Extract 36-azimuth operational range boundary polygon (0° North clockwise)
  const NUM_BINS = 36;
  const sectorBestIdx = new Int32Array(NUM_BINS).fill(-1);
  const sectorBestRadKm = new Float64Array(NUM_BINS).fill(0);

  // Also track 12-sector farthest nodes for candidate path extraction
  const candBestIdx = new Int32Array(12).fill(-1);
  const candBestRadKm = new Float64Array(12).fill(0);

  let highestElevIdx = centerIdx;
  let flattestSafeIdx = -1;
  let flattestScore = Infinity;
  let maxFrontierIdx = centerIdx;
  let maxFrontierRadKm = 0;

  for (let i = 0; i < totalNodes; i++) {
    if (i === centerIdx || resourceCost[i] > 1.0) continue;
    const u = nodeU[i];
    const v = nodeV[i];
    const rKm = Math.hypot(u, v) * MOON_RADIUS_KM;
    if (rKm < 1e-4) continue;

    // Azimuth clockwise from North (+v is North, +u is East)
    let azDeg = Math.atan2(u, v) * RAD2DEG;
    if (azDeg < 0) azDeg += 360;

    const bin36 = Math.floor(azDeg / 10) % NUM_BINS;
    if (rKm > sectorBestRadKm[bin36]) {
      sectorBestRadKm[bin36] = rKm;
      sectorBestIdx[bin36] = i;
    }

    const bin12 = Math.floor(((azDeg + 15) % 360) / 30) % 12;
    if (rKm > candBestRadKm[bin12]) {
      candBestRadKm[bin12] = rKm;
      candBestIdx[bin12] = i;
    }

    if (rKm > maxFrontierRadKm) {
      maxFrontierRadKm = rKm;
      maxFrontierIdx = i;
    }
    if (rKm > flatRangeKm * 0.22 && nodeElev[i] > nodeElev[highestElevIdx]) {
      highestElevIdx = i;
    }
    if (
      rKm > flatRangeKm * 0.28 &&
      rKm < flatRangeKm * 0.85 &&
      nodeSlope[i] < flattestScore
    ) {
      flattestScore = nodeSlope[i];
      flattestSafeIdx = i;
    }
  }

  // Fill any empty 10° bins (e.g., blocked immediately by a steep wall) with minimal local fallback radius
  const rawRadiiKm = new Float64Array(NUM_BINS);
  for (let b = 0; b < NUM_BINS; b++) {
    if (sectorBestRadKm[b] > 0.05) {
      rawRadiiKm[b] = sectorBestRadKm[b];
    } else {
      const prev = sectorBestRadKm[(b + NUM_BINS - 1) % NUM_BINS];
      const next = sectorBestRadKm[(b + 1) % NUM_BINS];
      rawRadiiKm[b] =
        prev > 0.05 && next > 0.05
          ? 0.5 * (prev + next)
          : Math.max(0.25, flatRangeKm * 0.14);
    }
  }

  // Smooth boundary ring slightly to eliminate square grid stair-stepping
  const boundaryRing: RangeBoundaryPoint[] = [];
  const innerHalfRing: { lat: number; lon: number; elevKm: number }[] = [];
  let maxReachableRadiusKm = 0.3;
  let minReachableRadiusKm = Infinity;
  let reachableAreaKm2 = 0;

  const smoothedRadii: number[] = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const rPrev = rawRadiiKm[(b + NUM_BINS - 1) % NUM_BINS];
    const rCurr = rawRadiiKm[b];
    const rNext = rawRadiiKm[(b + 1) % NUM_BINS];
    const rSmooth = 0.2 * rPrev + 0.6 * rCurr + 0.2 * rNext;
    smoothedRadii.push(rSmooth);
    if (rSmooth > maxReachableRadiusKm) maxReachableRadiusKm = rSmooth;
    if (rSmooth < minReachableRadiusKm) minReachableRadiusKm = rSmooth;
  }

  for (let b = 0; b < NUM_BINS; b++) {
    const azRad = (b * 10 + 5) * DEG2RAD;
    const rKm = smoothedRadii[b];
    const rNextKm = smoothedRadii[(b + 1) % NUM_BINS];
    reachableAreaKm2 += 0.5 * rKm * rNextKm * Math.sin(10 * DEG2RAD);

    const rRad = rKm / MOON_RADIUS_KM;
    const u = Math.sin(azRad) * rRad;
    const v = Math.cos(azRad) * rRad;
    const vec = vNorm(vAdd(e0, vAdd(vScale(eEast, u), vScale(eNorth, v))));
    const ll = cartesianToLatLon(vec.x, vec.y, vec.z);
    const elevKm = sampleRoverElevationKm(
      ll.lat,
      ll.lon,
      params.includeSubGridRoughness
    );

    boundaryRing.push({
      lat: Number(ll.lat.toFixed(4)),
      lon: Number(ll.lon.toFixed(4)),
      elevKm: Number(elevKm.toFixed(4)),
      radiusKm: Number(rKm.toFixed(2)),
      blockedBySlope: rKm < flatRangeKm * 0.72,
    });

    // 50% range inner reference ring
    const halfVec = vNorm(
      vAdd(e0, vAdd(vScale(eEast, u * 0.5), vScale(eNorth, v * 0.5)))
    );
    const halfLl = cartesianToLatLon(halfVec.x, halfVec.y, halfVec.z);
    innerHalfRing.push({
      lat: Number(halfLl.lat.toFixed(4)),
      lon: Number(halfLl.lon.toFixed(4)),
      elevKm: Number(
        sampleRoverElevationKm(
          halfLl.lat,
          halfLl.lon,
          params.includeSubGridRoughness
        ).toFixed(4)
      ),
    });
  }

  if (!Number.isFinite(minReachableRadiusKm)) minReachableRadiusKm = 0.25;

  // Reconstruct up to 12 rough branching possible paths from Start [A]
  const candidatePaths: CandidateCorridorPath[] = [];
  for (let s = 0; s < 12; s++) {
    const leaf = candBestIdx[s];
    if (leaf === -1 || candBestRadKm[s] < 0.2) continue;

    const chain: number[] = [];
    let cur = leaf;
    while (cur !== -1) {
      chain.push(cur);
      if (cur === centerIdx) break;
      cur = cameFrom[cur];
    }
    chain.reverse();
    if (chain.length < 2 || chain[0] !== centerIdx) continue;

    // 1-pass Chaikin corner smoothing in 3D Cartesian space
    let vecs: Vec3[] = chain.map((id) => {
      const [x, y, z] = latLonToCartesian(nodeLat[id], nodeLon[id], 1);
      return { x, y, z };
    });
    if (vecs.length >= 3) {
      const sm: Vec3[] = [vecs[0]];
      for (let k = 0; k < vecs.length - 1; k++) {
        const p0 = vecs[k];
        const p1 = vecs[k + 1];
        if (k > 0) sm.push(vNorm(vAdd(vScale(p0, 0.75), vScale(p1, 0.25))));
        if (k < vecs.length - 2) sm.push(vNorm(vAdd(vScale(p0, 0.25), vScale(p1, 0.75))));
      }
      sm.push(vecs[vecs.length - 1]);
      vecs = sm;
    }

    const totalWh = netEnergyAt[leaf];
    const finalSoc = Math.max(
      params.minReserveSocPct,
      100 - (totalWh / Math.max(1, params.batteryCapacityWh)) * 100
    );

    const points = vecs.map((v, k) => {
      const frac = k / Math.max(1, vecs.length - 1);
      const ll =
        k === 0
          ? { lat: origin.lat, lon: origin.lon }
          : k === vecs.length - 1
          ? { lat: nodeLat[leaf], lon: nodeLon[leaf] }
          : cartesianToLatLon(v.x, v.y, v.z);
      const elevKm = sampleRoverElevationKm(
        ll.lat,
        ll.lon,
        params.includeSubGridRoughness
      );
      return {
        lat: Number(ll.lat.toFixed(4)),
        lon: Number(ll.lon.toFixed(4)),
        elevKm: Number(elevKm.toFixed(4)),
        socPct: Number((100 - frac * (100 - finalSoc)).toFixed(1)),
      };
    });

    let azDeg = Math.atan2(nodeU[leaf], nodeV[leaf]) * RAD2DEG;
    if (azDeg < 0) azDeg += 360;

    const sectorName = COMPASS_12_NAMES[s];
    candidatePaths.push({
      id: `corridor-${sectorName.toLowerCase()}`,
      label: `${sectorName} Corridor (${distKmAt[leaf].toFixed(1)} km)`,
      sectorName,
      azimuthDeg: Math.round(azDeg),
      distanceKm: Number(distKmAt[leaf].toFixed(2)),
      driveHours: Number(driveHoursAt[leaf].toFixed(2)),
      energyUsedWh: Math.round(totalWh),
      finalSocPct: Number(finalSoc.toFixed(1)),
      maxSlopeDeg: Number(maxSlopeAt[leaf].toFixed(1)),
      endCoords: {
        lat: Number(nodeLat[leaf].toFixed(4)),
        lon: Number(nodeLon[leaf].toFixed(4)),
        label: `${sectorName} Frontier (${distKmAt[leaf].toFixed(1)} km)`,
      },
      points,
    });
  }

  // Build list of Pre-Defined Sites + Auto-Discovered Reachable Local Targets for Step 5
  const nearbyTargets: ReachablePredefinedTarget[] = [];

  if (highestElevIdx !== centerIdx) {
    const dKm =
      angularDistanceDeg(
        origin.lat,
        origin.lon,
        nodeLat[highestElevIdx],
        nodeLon[highestElevIdx]
      ) *
      DEG2RAD *
      MOON_RADIUS_KM;
    nearbyTargets.push({
      id: 'local-high-ridge',
      name: `Local High Prominence (${(nodeElev[highestElevIdx] * 1000).toFixed(0)} m)`,
      tag: 'LOCAL PEAK',
      coords: {
        lat: Number(nodeLat[highestElevIdx].toFixed(4)),
        lon: Number(nodeLon[highestElevIdx].toFixed(4)),
        label: 'Local High Prominence',
      },
      distanceKm: Number(dKm.toFixed(2)),
      inRange: true,
    });
  }

  if (flattestSafeIdx !== -1 && flattestSafeIdx !== highestElevIdx) {
    const dKm =
      angularDistanceDeg(
        origin.lat,
        origin.lon,
        nodeLat[flattestSafeIdx],
        nodeLon[flattestSafeIdx]
      ) *
      DEG2RAD *
      MOON_RADIUS_KM;
    nearbyTargets.push({
      id: 'local-flat-haven',
      name: `Low-Slope Safe Flats (${nodeSlope[flattestSafeIdx].toFixed(1)}° slope)`,
      tag: 'SAFE HAVEN',
      coords: {
        lat: Number(nodeLat[flattestSafeIdx].toFixed(4)),
        lon: Number(nodeLon[flattestSafeIdx].toFixed(4)),
        label: 'Low-Slope Safe Flats',
      },
      distanceKm: Number(dKm.toFixed(2)),
      inRange: true,
    });
  }

  if (
    maxFrontierIdx !== centerIdx &&
    maxFrontierIdx !== highestElevIdx &&
    maxFrontierIdx !== flattestSafeIdx
  ) {
    const dKm =
      angularDistanceDeg(
        origin.lat,
        origin.lon,
        nodeLat[maxFrontierIdx],
        nodeLon[maxFrontierIdx]
      ) *
      DEG2RAD *
      MOON_RADIUS_KM;
    nearbyTargets.push({
      id: 'local-max-frontier',
      name: `Max-Range Sortie Frontier`,
      tag: 'MAX RANGE',
      coords: {
        lat: Number(nodeLat[maxFrontierIdx].toFixed(4)),
        lon: Number(nodeLon[maxFrontierIdx].toFixed(4)),
        label: 'Max-Range Frontier',
      },
      distanceKm: Number(dKm.toFixed(2)),
      inRange: true,
    });
  }

  const curatedMapped: ReachablePredefinedTarget[] = curatedSites
    .map((s) => {
      const dKm =
        angularDistanceDeg(origin.lat, origin.lon, s.lat, s.lon) *
        DEG2RAD *
        MOON_RADIUS_KM;
      return {
        id: s.id,
        name: s.name.split(' (')[0],
        tag: s.missionTag,
        coords: { lat: s.lat, lon: s.lon, label: s.name.split(' (')[0] },
        distanceKm: Number(dKm.toFixed(1)),
        inRange: dKm <= maxReachableRadiusKm * 1.05,
      };
    })
    .filter((t) => t.distanceKm > 0.15)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  nearbyTargets.push(...curatedMapped.slice(0, 6));

  return {
    origin,
    craters: localCraters,
    usableBatteryWh,
    nominalFlatRangeKm: flatRangeKm,
    maxReachableRadiusKm: Number(maxReachableRadiusKm.toFixed(2)),
    minReachableRadiusKm: Number(minReachableRadiusKm.toFixed(2)),
    reachableAreaKm2: Math.round(reachableAreaKm2),
    boundaryRing,
    innerHalfRing,
    candidatePaths,
    nearbyTargets,
  };
}

