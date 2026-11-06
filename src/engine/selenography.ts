import {
  CISLUNAR_SATELLITES,
  MOON_MU_KM3_S2,
  MOON_RADIUS_KM,
} from '../data/lunarCatalog';
import {
  DemResolutionInfo,
  FlightRuleCheck,
  LandingSite,
  LunarSatellite,
  OptimalWindowRecommendation,
  ReadinessStatus,
   SatelliteLiveState,
  SatellitePassWindow,
  SiteEvaluation,
  SkyBodyHorizontal,
  SunEarthSurfaceMode,
  SunEarthSurfaceSolution,
  TimelineSample,
  WarpTargetOption,
} from '../types/lunar';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

// Multi-Tier Progressive NASA LOLA DEM Pyramid:
// Tier 0: 2048x1024 8-bit fast boot
// Tier 1: 2880x1440 16-bit Global LOLA DEM (0.5m vertical precision)
// Tier 2: 5760x320  16-bit South Pole 80°S-90°S Strip (16 px/deg, 0.5m vertical precision)
// Tier 3A: 2048x2048 16-bit Polar Stereographic Artemis Cap (±155 km, ~151 m/px, 0.3m vertical)
// Tier 3B: 2048x2048 16-bit Polar Stereographic Shackleton Core (±36 km, ~35 m/px, 0.3m vertical)
// Tier 4: 1600x1600 16-bit NASA PGDA Artemis III Site 01 Patch (10 m/px, 0.1m vertical precision!)
let lolaDemBuffer: Float32Array | null = null;
let lolaWidth = 1024;
let lolaHeight = 512;
let lolaIs16Bit = false;

let southPole16Buffer: Float32Array | null = null; // 5760x320 covering lat [-80, -90]
let spWidth = 5760;
let spHeight = 320;

let spArtemisBuffer: Float32Array | null = null; // 2048x2048 stereographic ±155 km
let spArtemisSize = 2048;
const SP_ARTEMIS_HALF_M = 155000.0;

let spInnerBuffer: Float32Array | null = null; // 2048x2048 stereographic ±36 km
let spInnerSize = 2048;
const SP_INNER_HALF_M = 36000.0;

let site01PatchBuffer: Float32Array | null = null; // 1600x1600 stereographic 10m/px
let site01Size = 1600;
const SITE01_X_UL = -19000.0; // meters
const SITE01_Y_UL = -4000.0; // meters
const SITE01_PX_M = 10.0; // meters/pixel

let initStarted = false;
const demListeners = new Set<() => void>();

function loadRgbaImageData(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No 2d ctx'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ data: ctx.getImageData(0, 0, width, height).data, width, height });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function initLolaDemSampler(url = '/textures/lola_dem.jpg'): void {
  if (typeof window === 'undefined' || initStarted) return;
  initStarted = true;

  // 1. Instant 8-bit global load
  loadRgbaImageData(url)
    .then(({ data, width, height }) => {
      if (lolaIs16Bit) return; // 16-bit already beat it
      const buf = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        buf[i] = -8.98 + (data[i * 4] / 255.0) * 19.67;
      }
      lolaWidth = width;
      lolaHeight = height;
      lolaDemBuffer = buf;
      demListeners.forEach((cb) => cb());
    })
    .catch(() => {});

  // 2. High-precision 16-bit South Pole 80°S–90°S 16-ppd strip (0.5m vertical)
  loadRgbaImageData('/textures/lola_southpole_16bit.png')
    .then(({ data, width, height }) => {
      const buf = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const dn = (data[i * 4] << 8) | data[i * 4 + 1];
        buf[i] = dn * 0.0005 - 10.0;
      }
      spWidth = width;
      spHeight = height;
      southPole16Buffer = buf;
      demListeners.forEach((cb) => cb());
    })
    .catch(() => {});

  // 2B. High-Res 2048x2048 Polar Stereographic Artemis Zone (±155 km, ~151 m/px, 0.3m vertical)
  loadRgbaImageData('/textures/lola_sp_artemis_16bit.png')
    .then(({ data, width }) => {
      const buf = new Float32Array(width * width);
      for (let i = 0; i < width * width; i++) {
        const dn = (data[i * 4] << 8) | data[i * 4 + 1];
        buf[i] = (dn / 65535.0) * 19.67 - 8.98;
      }
      spArtemisSize = width;
      spArtemisBuffer = buf;
      demListeners.forEach((cb) => cb());
    })
    .catch(() => {});

  // 2C. Ultra-High-Res 2048x2048 Polar Stereographic Shackleton Core (±36 km, ~35 m/px, 0.3m vertical)
  loadRgbaImageData('/textures/lola_sp_inner_16bit.png')
    .then(({ data, width }) => {
      const buf = new Float32Array(width * width);
      for (let i = 0; i < width * width; i++) {
        const dn = (data[i * 4] << 8) | data[i * 4 + 1];
        buf[i] = (dn / 65535.0) * 19.67 - 8.98;
      }
      spInnerSize = width;
      spInnerBuffer = buf;
      demListeners.forEach((cb) => cb());
    })
    .catch(() => {});

  // 3. Ultra-High-Res 10 m/px 16-bit NASA PGDA Artemis III Site 01 (Shackleton Ridge, 0.1m vertical!)
  loadRgbaImageData('/textures/lola_site01_10mpp_16bit.png')
    .then(({ data, width }) => {
      const buf = new Float32Array(width * width);
      for (let i = 0; i < width * width; i++) {
        const dn = (data[i * 4] << 8) | data[i * 4 + 1];
        const meters = dn * 0.1 - 2000.0;
        buf[i] = meters / 1000.0;
      }
      site01Size = width;
      site01PatchBuffer = buf;
      demListeners.forEach((cb) => cb());
    })
    .catch(() => {});

  // 4. Global 2880x1440 16-bit LOLA DEM (0.5m vertical globally)
  loadRgbaImageData('/textures/lola_dem_16bit.png')
    .then(({ data, width, height }) => {
      const buf = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const dn = (data[i * 4] << 8) | data[i * 4 + 1];
        buf[i] = dn * 0.0005 - 10.0;
      }
      lolaWidth = width;
      lolaHeight = height;
      lolaDemBuffer = buf;
      lolaIs16Bit = true;
      demListeners.forEach((cb) => cb());
    })
    .catch(() => {});
}

export function onLolaDemLoaded(cb: () => void): () => void {
  demListeners.add(cb);
  return () => {
    demListeners.delete(cb);
  };
}

export function normalizeLon(lonDeg: number): number {
  let l = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  if (l === -180) l = 180;
  return l;
}

/**
 * Convert selenographic (latDeg, lonDeg, radiusUnits) into Three.js SphereGeometry coordinates:
 * Prime Meridian (lon = 0°) -> +X (towards Earth)
 * East (+90°E) -> -Z
 * Far Side (±180°) -> -X
 * North Pole (+90°N) -> +Y
 */
export function latLonToCartesian(
  latDeg: number,
  lonDeg: number,
  radius = 1.0
): [number, number, number] {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);
  const x = radius * cosLat * Math.cos(lon);
  const y = radius * Math.sin(lat);
  const z = -radius * cosLat * Math.sin(lon);
  return [x, y, z];
}

export function cartesianToLatLon(
  x: number,
  y: number,
  z: number
): { lat: number; lon: number; radius: number } {
  const r = Math.hypot(x, y, z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, y / r))) * RAD2DEG;
  const lon = Math.atan2(-z, x) * RAD2DEG;
  return { lat, lon, radius: r };
}

/**
 * Angular great-circle distance in degrees between two selenographic coordinates
 */
export function angularDistanceDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) * RAD2DEG;
}

// High-resolution South Pole & Major Crater features for sub-pixel rim precision
interface PolarFeature {
  lat: number;
  lon: number;
  radiusDeg: number;
  depthKm: number;
  rimHeightKm: number;
  isColdTrap?: boolean;
}

const POLAR_CRATERS: PolarFeature[] = [
  { lat: -89.54, lon: 129.8, radiusDeg: 0.7, depthKm: -4.15, rimHeightKm: 1.95, isColdTrap: true }, // Shackleton
  { lat: -88.1, lon: 45.0, radiusDeg: 1.68, depthKm: -4.2, rimHeightKm: 1.45, isColdTrap: true }, // Shoemaker
  { lat: -87.3, lon: 84.3, radiusDeg: 1.4, depthKm: -3.9, rimHeightKm: 1.35, isColdTrap: true }, // Faustini
  { lat: -87.45, lon: -4.8, radiusDeg: 1.7, depthKm: -4.0, rimHeightKm: 1.55, isColdTrap: true }, // Haworth
  { lat: -88.5, lon: -68.0, radiusDeg: 1.08, depthKm: -3.5, rimHeightKm: 1.5, isColdTrap: true }, // de Gerlache
  { lat: -84.9, lon: -35.5, radiusDeg: 2.8, depthKm: -3.6, rimHeightKm: 1.25, isColdTrap: true }, // Cabeus
  { lat: -85.2, lon: 53.5, radiusDeg: 2.3, depthKm: -3.2, rimHeightKm: 1.55, isColdTrap: true }, // Nobile
  { lat: -85.97, lon: 0.0, radiusDeg: 0.95, depthKm: 4.95, rimHeightKm: 0.0, isColdTrap: false }, // Malapert Massif peak
  { lat: -84.6, lon: 31.0, radiusDeg: 1.25, depthKm: 4.35, rimHeightKm: 0.0, isColdTrap: false }, // Mons Mouton mesa
];

function latLonToSouthPolarStereoMeters(latDeg: number, lonDeg: number): { X: number; Y: number } {
  const R = 1737400.0;
  const rho = 2 * R * Math.tan(((90.0 + latDeg) * 0.5) * DEG2RAD);
  const lonR = lonDeg * DEG2RAD;
  return {
    X: rho * Math.sin(lonR),
    Y: rho * Math.cos(lonR),
  };
}

function isInsideSite01Patch(latDeg: number, lonDeg: number): { inside: boolean; ix: number; iy: number } {
  if (!site01PatchBuffer || latDeg > -88.7) return { inside: false, ix: 0, iy: 0 };
  const { X, Y } = latLonToSouthPolarStereoMeters(latDeg, lonDeg);
  const ix = (X - SITE01_X_UL) / SITE01_PX_M;
  const iy = (SITE01_Y_UL - Y) / SITE01_PX_M;
  const inside = ix >= 2 && ix < site01Size - 3 && iy >= 2 && iy < site01Size - 3;
  return { inside, ix, iy };
}

function samplePolarStereoBuffer(
  buf: Float32Array,
  size: number,
  halfExtentM: number,
  X: number,
  Y: number
): number | null {
  const margin = halfExtentM * 0.985;
  if (Math.abs(X) >= margin || Math.abs(Y) >= margin) return null;
  const px = (2.0 * halfExtentM) / size;
  const ix = (X + halfExtentM) / px - 0.5;
  const iy = (halfExtentM - Y) / px - 0.5;
  if (ix < 1 || ix >= size - 2 || iy < 1 || iy >= size - 2) return null;
  const x0 = Math.floor(ix);
  const y0 = Math.floor(iy);
  const fx = ix - x0;
  const fy = iy - y0;
  const e00 = buf[y0 * size + x0];
  const e10 = buf[y0 * size + (x0 + 1)];
  const e01 = buf[(y0 + 1) * size + x0];
  const e11 = buf[(y0 + 1) * size + (x0 + 1)];
  return (1 - fx) * (1 - fy) * e00 + fx * (1 - fy) * e10 + (1 - fx) * fy * e01 + fx * fy * e11;
}

/**
 * Sample NASA LOLA Elevation (km relative to 1737.4 km mean radius) at any (lat, lon)
 * Automatically selects the highest-resolution loaded DEM tier at the queried coordinate!
 */
export function sampleElevationKm(latDeg: number, lonDeg: number): number {
  const clampedLat = Math.max(-89.9995, Math.min(89.9995, latDeg));
  const normLon = normalizeLon(lonDeg);

  // TIER 4: 10 m/px 16-bit NASA GSFC PGDA Artemis III Site 01 Patch (Shackleton Connecting Ridge)
  const patchCheck = isInsideSite01Patch(clampedLat, normLon);
  if (patchCheck.inside && site01PatchBuffer) {
    const { ix, iy } = patchCheck;
    const x0 = Math.floor(ix);
    const y0 = Math.floor(iy);
    const fx = ix - x0;
    const fy = iy - y0;
    const e00 = site01PatchBuffer[y0 * site01Size + x0];
    const e10 = site01PatchBuffer[y0 * site01Size + (x0 + 1)];
    const e01 = site01PatchBuffer[(y0 + 1) * site01Size + x0];
    const e11 = site01PatchBuffer[(y0 + 1) * site01Size + (x0 + 1)];
    return (
      (1 - fx) * (1 - fy) * e00 +
      fx * (1 - fy) * e10 +
      (1 - fx) * fy * e01 +
      fx * fy * e11
    );
  }

  // TIER 3B & 3A: High-Res Polar Stereographic LOLA Clipmaps (±36 km at 35 m/px & ±155 km at 151 m/px)
  if (clampedLat <= -84.2 && (spInnerBuffer || spArtemisBuffer)) {
    const { X, Y } = latLonToSouthPolarStereoMeters(clampedLat, normLon);
    if (spInnerBuffer) {
      const innerVal = samplePolarStereoBuffer(spInnerBuffer, spInnerSize, SP_INNER_HALF_M, X, Y);
      if (innerVal !== null) return innerVal;
    }
    if (spArtemisBuffer) {
      const artVal = samplePolarStereoBuffer(spArtemisBuffer, spArtemisSize, SP_ARTEMIS_HALF_M, X, Y);
      if (artVal !== null) return artVal;
    }
  }

  // TIER 2: 16 px/deg (5760x320) 16-bit NASA LOLA South Pole Strip (80°S to 90°S, 0.5m vertical precision)
  if (southPole16Buffer && clampedLat <= -80.05) {
    const u = ((normLon + 180) / 360) * spWidth;
    // spStrip covers lat [-80.0, -90.0] across spHeight=320 rows
    const v = ((-80.0 - clampedLat) / 10.0) * (spHeight - 1);
    const x0 = ((Math.floor(u) % spWidth) + spWidth) % spWidth;
    const x1 = (x0 + 1) % spWidth;
    const y0 = Math.max(0, Math.min(spHeight - 1, Math.floor(v)));
    const y1 = Math.max(0, Math.min(spHeight - 1, y0 + 1));
    const fx = u - Math.floor(u);
    const fy = v - Math.floor(v);

    const e00 = southPole16Buffer[y0 * spWidth + x0];
    const e10 = southPole16Buffer[y0 * spWidth + x1];
    const e01 = southPole16Buffer[y1 * spWidth + x0];
    const e11 = southPole16Buffer[y1 * spWidth + x1];
    return (
      (1 - fx) * (1 - fy) * e00 +
      fx * (1 - fy) * e10 +
      (1 - fx) * fy * e01 +
      fx * fy * e11
    );
  }

  // TIER 1: Global 2880x1440 16-bit NASA LOLA DEM (or 2048x1024 fast-boot raster)
  let baseElev = 0;
  if (lolaDemBuffer) {
    const u = ((normLon + 180) / 360) * lolaWidth;
    const v = ((90 - clampedLat) / 180) * lolaHeight;
    const x0 = ((Math.floor(u) % lolaWidth) + lolaWidth) % lolaWidth;
    const x1 = (x0 + 1) % lolaWidth;
    const y0 = Math.max(0, Math.min(lolaHeight - 1, Math.floor(v)));
    const y1 = Math.max(0, Math.min(lolaHeight - 1, y0 + 1));
    const fx = u - Math.floor(u);
    const fy = v - Math.floor(v);

    const e00 = lolaDemBuffer[y0 * lolaWidth + x0];
    const e10 = lolaDemBuffer[y0 * lolaWidth + x1];
    const e01 = lolaDemBuffer[y1 * lolaWidth + x0];
    const e11 = lolaDemBuffer[y1 * lolaWidth + x1];
    baseElev =
      (1 - fx) * (1 - fy) * e00 +
      fx * (1 - fy) * e10 +
      (1 - fx) * fy * e01 +
      fx * fy * e11;
  } else {
    // Analytical fallback before LOLA image finishes loading
    const latR = clampedLat * DEG2RAD;
    const lonR = normLon * DEG2RAD;
    const farside = -1.6 * Math.cos(lonR) * Math.cos(latR);
    const spaDist = angularDistanceDeg(clampedLat, normLon, -53, -169);
    const spa = spaDist < 42 ? -6.2 * Math.cos(((spaDist / 42) * Math.PI) / 2) : 0;
    const imbriumDist = angularDistanceDeg(clampedLat, normLon, 33, -16);
    const imbrium = imbriumDist < 20 ? -3.1 * Math.cos(((imbriumDist / 20) * Math.PI) / 2) : 0;
    baseElev = farside + spa + imbrium + 0.6 * Math.sin(3 * latR) * Math.cos(2 * lonR);
  }

  return Math.max(-9.12, Math.min(10.78, baseElev));
}

/**
 * Report exact horizontal & vertical DEM resolution active at (latDeg, lonDeg)
 */
export function getDemResolutionAt(
  latDeg: number,
  lonDeg: number,
  subGridModelActive: boolean
): DemResolutionInfo {
  const patch = isInsideSite01Patch(latDeg, lonDeg);
  if (patch.inside && site01PatchBuffer) {
    return {
      tierName: 'Tier 4 • NASA PGDA Artemis Site 01 Polar Stereographic LOLA',
      nsPostingMeters: 10,
      ewPostingMeters: 10,
      verticalPrecisionMeters: 0.1,
      subGridModelActive,
      isAdequateForMeterScale: true,
      note: 'True 10 m/px (0.1 m vertical) self-consistent LOLA laser altimetry mosaic — directly resolves 20–50 m craters and ridge scarps for rover pathfinding.',
    };
  }

  if (latDeg <= -84.2) {
    const { X, Y } = latLonToSouthPolarStereoMeters(latDeg, normalizeLon(lonDeg));
    if (
      spInnerBuffer &&
      Math.abs(X) < SP_INNER_HALF_M * 0.985 &&
      Math.abs(Y) < SP_INNER_HALF_M * 0.985
    ) {
      return {
        tierName: 'Tier 3B • NASA LOLA LDEM_875S Polar Stereographic Core',
        nsPostingMeters: 35,
        ewPostingMeters: 35,
        verticalPrecisionMeters: 0.3,
        subGridModelActive,
        isAdequateForMeterScale: true,
        note: 'High-resolution 35 m × 35 m (16-bit, 0.3 m vertical) Polar Stereographic LOLA DEM resolving Shackleton, Connecting Ridge, and inner PSR walls with zero polar pinch.',
      };
    }
    if (
      spArtemisBuffer &&
      Math.abs(X) < SP_ARTEMIS_HALF_M * 0.985 &&
      Math.abs(Y) < SP_ARTEMIS_HALF_M * 0.985
    ) {
      return {
        tierName: 'Tier 3A • NASA LOLA LDEM_85S Polar Stereographic Artemis Cap',
        nsPostingMeters: 151,
        ewPostingMeters: 151,
        verticalPrecisionMeters: 0.3,
        subGridModelActive,
        isAdequateForMeterScale: subGridModelActive,
        note: '151 m × 151 m (16-bit, 0.3 m vertical) Polar Stereographic LOLA DEM across 85°S–90°S resolving Shoemaker, Faustini, Haworth, de Gerlache, Malapert & Nobile.',
      };
    }
  }

  const cosLat = Math.max(0.012, Math.cos(latDeg * DEG2RAD));
  if (southPole16Buffer && latDeg <= -80.05) {
    const nsM = Math.round((10.0 / (spHeight - 1)) * DEG2RAD * MOON_RADIUS_KM * 1000);
    const ewM = Math.max(25, Math.round((360.0 / spWidth) * DEG2RAD * MOON_RADIUS_KM * cosLat * 1000));
    return {
      tierName: 'Tier 2 • NASA LOLA 16-ppd 16-Bit Polar Cap DEM',
      nsPostingMeters: nsM,
      ewPostingMeters: ewM,
      verticalPrecisionMeters: 0.5,
      subGridModelActive,
      isAdequateForMeterScale: subGridModelActive,
      note: `16-bit vertical precision (0.5 m) with ${nsM} m × ${ewM} m posting. Captures massif/crater-wall slopes accurately; sub-grid Hurst model adds 10–150 m boulder/crater hazards.`,
    };
  }

  const nsM = Math.round((180.0 / lolaHeight) * DEG2RAD * MOON_RADIUS_KM * 1000);
  const ewM = Math.max(120, Math.round((360.0 / lolaWidth) * DEG2RAD * MOON_RADIUS_KM * cosLat * 1000));
  return {
    tierName: lolaIs16Bit
      ? 'Tier 1 • NASA LOLA 8-ppd 16-Bit Global DEM'
      : 'Tier 0 • Fast-Boot Global LOLA Raster',
    nsPostingMeters: nsM,
    ewPostingMeters: ewM,
    verticalPrecisionMeters: lolaIs16Bit ? 0.5 : 77.0,
    subGridModelActive,
    isAdequateForMeterScale: false,
    note: `Regional ${nsM} m × ${ewM} m grid (${lolaIs16Bit ? '0.5 m' : '77 m'} vertical). Resolves regional hills & basins; relies on LOLA Hurst roughness scaling for sub-kilometer obstacles.`,
  };
}

/**
 * Deterministic spatially-coherent LOLA 5-spot Hurst micro-topography (Rosenburg et al., JGR 2011)
 * Synthesizes 20 m – 250 m regolith craters/hummocks ONLY where DEM posting > 50 m!
 */
function sampleSubGridMicroReliefKm(latDeg: number, lonDeg: number): number {
  const patch = isInsideSite01Patch(latDeg, lonDeg);
  if (patch.inside && site01PatchBuffer) {
    // Already true 10 m/px LOLA altimetry — only tiny 2-5 m wheel-scale hummocks (~0.25 m)
    const s = Math.sin(latDeg * 14500.0 + lonDeg * 4200.0) * Math.cos(latDeg * 9300.0 - lonDeg * 3100.0);
    return s * 0.00025;
  }

  // Convert locally to metric surface arc coordinates (km) so wavelengths are isotropic even near poles!
  const yKm = latDeg * DEG2RAD * MOON_RADIUS_KM;
  const xKm = lonDeg * DEG2RAD * MOON_RADIUS_KM * Math.cos(latDeg * DEG2RAD);

  // Highlands are ~2.8x rougher than basaltic maria at 100m scale
  const isHighland = Math.abs(latDeg) > 60 || Math.abs(lonDeg) > 85 ? 1.0 : 0.42;

  // 3 octaves: ~320 m, ~110 m, ~40 m wavelengths with Hurst H ≈ 0.78 amplitude decay
  const w1 = Math.sin(xKm * 19.6 + yKm * 13.1) * Math.cos(yKm * 17.3 - xKm * 11.7); // ~320m
  const w2 = Math.sin(xKm * 57.1 - yKm * 41.9) * Math.cos(xKm * 37.7 + yKm * 53.3); // ~110m
  const w3 = Math.sin(xKm * 154.0 + yKm * 119.0) * Math.sin(yKm * 143.0 - xKm * 97.0); // ~40m

  const meters = isHighland * (w1 * 5.2 + w2 * 2.1 + w3 * 0.85);
  return meters / 1000.0;
}

export function sampleRoverElevationKm(
  latDeg: number,
  lonDeg: number,
  includeSubGridRoughness: boolean
): number {
  const macro = sampleElevationKm(latDeg, lonDeg);
  if (!includeSubGridRoughness) return macro;
  return macro + sampleSubGridMicroReliefKm(latDeg, lonDeg);
}

/**
 * Finite-difference terrain slope in degrees (adapts baseline to active DEM tier!)
 */
export function sampleSlopeDeg(latDeg: number, lonDeg: number): number {
  const patch = isInsideSite01Patch(latDeg, lonDeg);
  // Use 25m baseline inside 10m/px patch, 400m in polar 16-ppd strip, 2.0 km globally
  const baselineKm = patch.inside && site01PatchBuffer ? 0.025 : latDeg <= -80.05 && southPole16Buffer ? 0.45 : 2.0;
  const stepDeg = (baselineKm / MOON_RADIUS_KM) * RAD2DEG;
  const eN = sampleElevationKm(Math.min(89.998, latDeg + stepDeg), lonDeg);
  const eS = sampleElevationKm(Math.max(-89.998, latDeg - stepDeg), lonDeg);
  const cosLat = Math.max(0.008, Math.cos(latDeg * DEG2RAD));
  const lonStep = Math.min(25, stepDeg / cosLat);
  const eE = sampleElevationKm(latDeg, lonDeg + lonStep);
  const eW = sampleElevationKm(latDeg, lonDeg - lonStep);

  const dzDy = (eN - eS) / (2 * baselineKm);
  const dzDx = (eE - eW) / (2 * baselineKm);
  const macroSlopeDeg = Math.atan(Math.hypot(dzDx, dzDy)) * RAD2DEG;

  // At 10m/px we already measure true local slope; at coarser scales apply Rosenburg 5m Hurst scaling
  const effectiveSlope =
    patch.inside && site01PatchBuffer
      ? Math.min(42, macroSlopeDeg * 1.05 + 0.5)
      : Math.min(38, macroSlopeDeg * 1.55 + 1.4);
  return Number(effectiveSlope.toFixed(1));
}

/**
 * Destination (lat, lon) starting from (latDeg, lonDeg) along bearing (0° = North, 90° = East) by angular distance distDeg
 */
export function stepAlongBearing(
  latDeg: number,
  lonDeg: number,
  azimuthDeg: number,
  distDeg: number
): { lat: number; lon: number } {
  const lat1 = latDeg * DEG2RAD;
  const lon1 = lonDeg * DEG2RAD;
  const brng = azimuthDeg * DEG2RAD;
  const d = distDeg * DEG2RAD;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const y = Math.sin(brng) * Math.sin(d) * Math.cos(lat1);
  const x = Math.cos(d) - Math.sin(lat1) * Math.sin(lat2);
  const lon2 = lon1 + Math.atan2(y, x);
  return { lat: lat2 * RAD2DEG, lon: normalizeLon(lon2 * RAD2DEG) };
}

/**
 * Ray-march 36 azimuths (0°, 10°, ..., 350°) out to 140 km to compute true local topographic horizon mask (degrees)
 * Accounts for planetary curvature drop!
 */
export function computeHorizonProfileDeg(
  latDeg: number,
  lonDeg: number,
  observerMastMeters = 2.0
): number[] {
  const h0 = sampleElevationKm(latDeg, lonDeg) + observerMastMeters / 1000;
  const r0 = MOON_RADIUS_KM + h0;
  const profile: number[] = new Array(36).fill(-0.5);

  // Sample radial steps in degrees (0.12° ≈ 3.6 km up to 4.2° ≈ 127 km)
  const stepDistancesDeg = [0.12, 0.25, 0.45, 0.75, 1.15, 1.65, 2.3, 3.1, 4.2];

  for (let i = 0; i < 36; i++) {
    const az = i * 10;
    let maxElevDeg = -1.2; // planetary dip for high massifs
    for (const dDeg of stepDistancesDeg) {
      const pt = stepAlongBearing(latDeg, lonDeg, az, dDeg);
      const r1 = MOON_RADIUS_KM + sampleElevationKm(pt.lat, pt.lon);
      const gamma = dDeg * DEG2RAD;
      // Exact spherical trigonometry elevation angle above local horizontal tangent plane:
      // tan(el) = (r1 * cos(gamma) - r0) / (r1 * sin(gamma))
      const num = r1 * Math.cos(gamma) - r0;
      const den = r1 * Math.sin(gamma);
      const elDeg = Math.atan2(num, den) * RAD2DEG;
      if (elDeg > maxElevDeg) {
        maxElevDeg = elDeg;
      }
    }
    profile[i] = Number(Math.max(-2.0, Math.min(35.0, maxElevDeg)).toFixed(2));
  }
  return profile;
}

export function interpolateHorizonAtAzimuth(
  horizonProfile: number[],
  azimuthDeg: number
): number {
  const normAz = ((azimuthDeg % 360) + 360) % 360;
  const idx = normAz / 10;
  const i0 = Math.floor(idx) % 36;
  const i1 = (i0 + 1) % 36;
  const frac = idx - Math.floor(idx);
  return horizonProfile[i0] * (1 - frac) + horizonProfile[i1] * frac;
}

/**
 * Compute Sub-Solar and Sub-Earth selenographic coordinates for any UTC timestamp
 * Includes lunar axial tilt (1.5424° to ecliptic) and optical libration (±7.9° lon, ±6.68° lat)!
 */
export function computeSunEarthSelenographic(timeMs: number): {
  subSolarLat: number;
  subSolarLon: number;
  subEarthLat: number;
  subEarthLon: number;
  earthDistanceKm: number;
} {
  const daysSinceJ2000 = (timeMs - J2000_MS) / 86400000;

  // Synodic month = 29.530588853 days; Reference Full Moon (Sub-solar lon = 0°) near 2000-01-21 04:40 UTC (JD + 19.69)
  const synodicPhase = ((daysSinceJ2000 - 19.694) / 29.530588853) * 2 * Math.PI;
  // Sub-solar longitude moves Westward (-360° per synodic month)
  const subSolarLon = normalizeLon(-synodicPhase * RAD2DEG);

  // Draconic year = 346.620075 days governs seasonal ±1.5424° sub-solar latitude swing
  const draconicYearPhase = ((daysSinceJ2000 - 78.4) / 346.620075) * 2 * Math.PI;
  const subSolarLat = 1.5424 * Math.sin(draconicYearPhase);

  // Optical Libration of Earth in selenographic coordinates:
  // Anomalistic month = 27.554550 days -> Libration in Longitude (±6.29° eccentricity + ±1.27° evection)
  const meanAnomaly = ((daysSinceJ2000 - 4.52) / 27.55455) * 2 * Math.PI;
  const evectionArg = 2 * synodicPhase - meanAnomaly;
  const subEarthLon =
    6.29 * Math.sin(meanAnomaly) + 1.27 * Math.sin(evectionArg);

  // Draconic month = 27.212221 days -> Libration in Latitude (±6.68° combined inclination 5.145° + equator 1.542°)
  const argLatitude = ((daysSinceJ2000 - 11.15) / 27.212221) * 2 * Math.PI;
  const subEarthLat = -6.68 * Math.sin(argLatitude);

  // Earth-Moon center-to-center distance (km)
  const earthDistanceKm =
    384400 - 20905 * Math.cos(meanAnomaly) - 3699 * Math.cos(evectionArg);

  return {
    subSolarLat,
    subSolarLon,
    subEarthLat,
    subEarthLon,
    earthDistanceKm,
  };
}

/**
 * Topocentric horizontal coordinates (Azimuth clockwise from North, Elevation above local horizontal)
 * from surface observer (obsLat, obsLon, obsAltKm) to target at (targetLat, targetLon, targetRadiusKm)
 */
export function computeTopocentricAzEl(
  obsLatDeg: number,
  obsLonDeg: number,
  obsAltKm: number,
  targetLatDeg: number,
  targetLonDeg: number,
  targetRadiusKm: number
): { azimuthDeg: number; elevationDeg: number; slantRangeKm: number } {
  const obsR = MOON_RADIUS_KM + obsAltKm;
  const [ox, oy, oz] = latLonToCartesian(obsLatDeg, obsLonDeg, obsR);
  const [tx, ty, tz] = latLonToCartesian(targetLatDeg, targetLonDeg, targetRadiusKm);

  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  const slantRangeKm = Math.hypot(dx, dy, dz) || 1e-6;

  // Local Up, East, North unit basis at (obsLat, obsLon) in our Three.js Cartesian frame:
  // r_hat (Up) = (cosLat cosLon, sinLat, -cosLat sinLon)
  // East = d/dLon normalized = (-sinLon, 0, -cosLon)
  // North = d/dLat normalized = (-sinLat cosLon, cosLat, sinLat sinLon)
  const lat = obsLatDeg * DEG2RAD;
  const lon = obsLonDeg * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const up = dx * (cosLat * cosLon) + dy * sinLat + dz * (-cosLat * sinLon);
  const east = dx * -sinLon + dz * -cosLon;
  const north = dx * (-sinLat * cosLon) + dy * cosLat + dz * (sinLat * sinLon);

  const elevationDeg =
    Math.asin(Math.max(-1, Math.min(1, up / slantRangeKm))) * RAD2DEG;
  const azimuthDeg = ((Math.atan2(east, north) * RAD2DEG) + 360) % 360;

  return { azimuthDeg, elevationDeg, slantRangeKm };
}

/**
 * Estimate Surface Bolometric Temperature (K) matching Diviner DLRE physics
 */
export function estimateSurfaceTempK(
  latDeg: number,
  lonDeg: number,
  elevKm: number,
  sunVisible: boolean,
  sunElevDeg: number,
  illuminationDutyPct: number
): number {
  // Cold traps / Permanently Shadowed Regions
  if (!sunVisible && illuminationDutyPct < 8) {
    return Number((28 + illuminationDutyPct * 2.2).toFixed(1));
  }
  if (sunVisible && sunElevDeg > 0) {
    // Radiative equilibrium T ≈ (S_0 * (1 - A) * sin(el) / (epsilon * sigma))^0.25 + scatter floor
    const sinEl = Math.max(0.015, Math.sin(sunElevDeg * DEG2RAD));
    const eqTemp = 394.5 * Math.pow(sinEl, 0.25);
    return Number(Math.max(85, Math.min(396, eqTemp)).toFixed(1));
  }
  // Lunar night cooling curve based on how deep below horizon Sun currently sits
  const nightDepth = Math.min(1, Math.abs(sunElevDeg) / 45);
  const polarFloor = Math.abs(latDeg) > 80 ? 58 : 92;
  const nightTemp = polarFloor + (1 - nightDepth) * 34 + (elevKm > 2 ? -4 : 0);
  return Number(Math.max(32, nightTemp).toFixed(1));
}

/**
 * Estimate annual solar illumination duty cycle (%) & water-ice wt% at arbitrary clicked coordinates
 */
export function estimateClimatology(
  latDeg: number,
  lonDeg: number,
  elevKm: number,
  horizonProfile: number[]
): { illuminationDutyPct: number; waterIceWtPct: number } {
  const absLat = Math.abs(latDeg);
  const meanHorizon =
    horizonProfile.reduce((acc, v) => acc + v, 0) / horizonProfile.length;

  let illum = 50.0;
  if (absLat > 78) {
    // Near poles, Sun circles azimuth at ~0° ± 1.54°; ridges with negative/near-zero mean horizon stay sunlit >75%!
    // Deep crater floors with >4° mean horizon stay in permanent shadow (<5%)!
    const clearance = 1.1 - meanHorizon; // positive = sunlit peak, negative = shadowed floor
    illum = 50 + clearance * 16.5 + (elevKm > 2.0 ? 8 : 0);
    illum = Math.max(0, Math.min(89, illum));
  } else {
    illum = Math.max(38, Math.min(54, 50.2 - Math.max(0, meanHorizon) * 0.6));
  }

  let ice = 0.0;
  if (absLat > 79) {
    // Ice accumulates in polar cold traps & immediately adjacent ejecta blankets
    let trapBoost = 0;
    for (const f of POLAR_CRATERS) {
      if (!f.isColdTrap) continue;
      const d = angularDistanceDeg(latDeg, lonDeg, f.lat, f.lon);
      if (d < f.radiusDeg * 1.45) {
        trapBoost = Math.max(trapBoost, (1 - d / (f.radiusDeg * 1.45)) * 4.8);
      }
    }
    const coldShadowFactor = illum < 20 ? (20 - illum) * 0.22 : illum > 70 ? 0.6 : 1.1;
    ice = Math.min(5.6, Math.max(0.15, trapBoost * 0.85 + coldShadowFactor));
  } else if (absLat > 65) {
    ice = 0.25;
  }

  return {
    illuminationDutyPct: Number(illum.toFixed(1)),
    waterIceWtPct: Number(ice.toFixed(2)),
  };
}

/**
 * Compress physical altitude (km) for tactical 3D display while keeping exact 1:1 option available
 */
export function mapOrbitRadiusForDisplay(
  altKm: number,
  trueScale = false
): number {
  if (trueScale) {
    return 1.0 + Math.max(25, altKm) / MOON_RADIUS_KM;
  }
  // Tactical log-compressed scale:
  // 50 km -> 1.075 R_moon, 100 km -> 1.105 R_moon, 3,000 km -> 1.58 R_moon, 17,000 km -> 2.18 R_moon, 70,000 km -> 2.95 R_moon
  return 1.045 + 0.31 * Math.log10(1 + Math.max(15, altKm) / 65);
}

/**
 * Solve Kepler's Equation M = E - e sin(E) and return selenographic & 3D position at timeMs
 */
export function propagateSatellite(
  sat: LunarSatellite,
  timeMs: number,
  siteLat = -89.45,
  siteLon = -137.3,
  siteElevKm = 2.0,
  horizonProfile?: number[],
  trueScale = false
): SatelliteLiveState {
  const dtSec = (timeMs - Date.UTC(2026, 10, 4, 0, 0, 0)) / 1000;
  const a = sat.semiMajorAxisKm;
  const e = sat.eccentricity;
  const n = Math.sqrt(MOON_MU_KM3_S2 / (a * a * a)); // rad/s

  const M0 = sat.meanAnomalyEpochDeg * DEG2RAD;
  let M = (M0 + n * dtSec) % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;

  // Newton-Raphson solver for Eccentric Anomaly E
  let E = e > 0.75 ? Math.PI : M;
  for (let iter = 0; iter < 7; iter++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }

  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const rKm = a * (1 - e * cosE);
  const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e); // True anomaly

  // Vis-viva orbital speed km/s
  const speedKmS = Math.sqrt(MOON_MU_KM3_S2 * (2 / rKm - 1 / a));

  // Inertial perifocal -> Selenocentric frame with Moon's sidereal rotation (27.321661 days)
  const moonSiderealRateRadS = (2 * Math.PI) / (27.321661 * 86400);
  // Note: Southern NRHO (CAPSTONE) is Earth-Moon synodic locked (raan rotates with Earth-Moon line ~0°!)
  const omegaNode =
    sat.id === 'capstone'
      ? sat.raanDeg * DEG2RAD
      : sat.raanDeg * DEG2RAD - moonSiderealRateRadS * dtSec;

  const inc = sat.inclinationDeg * DEG2RAD;
  const u = sat.argPeriseleneDeg * DEG2RAD + nu;

  const cosO = Math.cos(omegaNode);
  const sinO = Math.sin(omegaNode);
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);

  // Standard celestial X (lon 0), Y_eq (lon +90E), Z_north (+90N)
  const xEq = rKm * (cosO * cosU - sinO * sinU * cosI);
  const yEq = rKm * (sinO * cosU + cosO * sinU * cosI);
  const zNorth = rKm * (sinU * sinI);

  // Map to our Three.js selenographic frame: +X = lon 0, +Y = North, -Z = lon +90E
  const lat = Math.asin(Math.max(-1, Math.min(1, zNorth / rKm))) * RAD2DEG;
  const lon = Math.atan2(yEq, xEq) * RAD2DEG;
  const altKm = Math.max(18, rKm - MOON_RADIUS_KM);

  const displayR = mapOrbitRadiusForDisplay(altKm, trueScale);
  const posCartesian = latLonToCartesian(lat, lon, displayR);

  // Topocentric visibility from landing site (using TRUE physical radius rKm!)
  const { azimuthDeg, elevationDeg, slantRangeKm } = computeTopocentricAzEl(
    siteLat,
    siteLon,
    siteElevKm,
    lat,
    lon,
    rKm
  );

  const horizonMaskDeg = horizonProfile
    ? interpolateHorizonAtAzimuth(horizonProfile, azimuthDeg)
    : 0;

  const minCommMask = Math.max(horizonMaskDeg, 2.0);
  const isVisibleFromSite = elevationDeg > minCommMask;

  // Link data rate scales with inverse square / elevation quality up to maxDataRateMbps
  const refRange = sat.aposeleneAltKm * 0.65 + 200;
  const rangeFactor = Math.min(1.25, (refRange / Math.max(80, slantRangeKm)) ** 0.55);
  const elevFactor = isVisibleFromSite
    ? Math.min(1, 0.35 + (elevationDeg / 45) * 0.65)
    : 0;
  const instantDataRateMbps = isVisibleFromSite
    ? Number(Math.min(sat.maxDataRateMbps, sat.maxDataRateMbps * rangeFactor * elevFactor).toFixed(1))
    : 0;

  // Geometric horizon footprint radius on Moon surface (km)
  const horizonCentralAngle = Math.acos(Math.min(1, MOON_RADIUS_KM / rKm));
  const footprintRadiusKm = Number((horizonCentralAngle * MOON_RADIUS_KM).toFixed(0));

  return {
    satellite: sat,
    posCartesian,
    lat,
    lon,
    altKm: Number(altKm.toFixed(0)),
    speedKmS: Number(speedKmS.toFixed(2)),
    azimuthDeg: Number(azimuthDeg.toFixed(1)),
    elevationDeg: Number(elevationDeg.toFixed(1)),
    horizonMaskDeg: Number(horizonMaskDeg.toFixed(1)),
    isVisibleFromSite,
    slantRangeKm: Number(slantRangeKm.toFixed(0)),
    instantDataRateMbps,
    footprintRadiusKm,
  };
}

/**
 * Sample full closed 3D orbital trajectory polyline for rendering the orbit ribbon
 */
export function sampleSatelliteOrbitCurve(
  sat: LunarSatellite,
  timeMs: number,
  segments = 128,
  trueScale = false
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const dtSec = (timeMs - Date.UTC(2026, 10, 4, 0, 0, 0)) / 1000;
  const moonSiderealRateRadS = (2 * Math.PI) / (27.321661 * 86400);
  const omegaNode =
    sat.id === 'capstone'
      ? sat.raanDeg * DEG2RAD
      : sat.raanDeg * DEG2RAD - moonSiderealRateRadS * dtSec;

  const a = sat.semiMajorAxisKm;
  const e = sat.eccentricity;
  const inc = sat.inclinationDeg * DEG2RAD;
  const cosO = Math.cos(omegaNode);
  const sinO = Math.sin(omegaNode);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);

  for (let i = 0; i <= segments; i++) {
    const E = (i / segments) * 2 * Math.PI;
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const rKm = a * (1 - e * cosE);
    const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
    const u = sat.argPeriseleneDeg * DEG2RAD + nu;

    const xEq = rKm * (cosO * Math.cos(u) - sinO * Math.sin(u) * cosI);
    const yEq = rKm * (sinO * Math.cos(u) + cosO * Math.sin(u) * cosI);
    const zNorth = rKm * (Math.sin(u) * sinI);

    const lat = Math.asin(Math.max(-1, Math.min(1, zNorth / rKm))) * RAD2DEG;
    const lon = Math.atan2(yEq, xEq) * RAD2DEG;
    const altKm = Math.max(18, rKm - MOON_RADIUS_KM);
    const displayR = mapOrbitRadiusForDisplay(altKm, trueScale);
    pts.push(latLonToCartesian(lat, lon, displayR));
  }
  return pts;
}

/**
 * Full real-time Mission Site Evaluation at timeMs
 */
export function evaluateLandingSite(
  site: LandingSite,
  timeMs: number,
  trueScale = false
): SiteEvaluation {
  const elevationKm =
    site.elevationKm !== undefined
      ? site.elevationKm
      : Number(sampleElevationKm(site.lat, site.lon).toFixed(2));
  const slopeDeg =
    site.slopeOverrideDeg !== undefined
      ? site.slopeOverrideDeg
      : sampleSlopeDeg(site.lat, site.lon);

  const horizonProfileDeg = computeHorizonProfileDeg(site.lat, site.lon, 2.0);
  const clim = estimateClimatology(site.lat, site.lon, elevationKm, horizonProfileDeg);
  const illuminationDutyPct =
    site.illuminationOverridePct !== undefined
      ? site.illuminationOverridePct
      : clim.illuminationDutyPct;
  const waterIceWtPct =
    site.iceOverrideWtPct !== undefined ? site.iceOverrideWtPct : clim.waterIceWtPct;

  const ephem = computeSunEarthSelenographic(timeMs);

  // Sun horizontal coordinates (1 AU = 149.6e6 km)
  const sunTopo = computeTopocentricAzEl(
    site.lat,
    site.lon,
    elevationKm,
    ephem.subSolarLat,
    ephem.subSolarLon,
    149597870
  );
  const sunHorizon = interpolateHorizonAtAzimuth(horizonProfileDeg, sunTopo.azimuthDeg);
  // Solar disk angular radius is ~0.266°; upper limb clears horizon at sunHorizon - 0.25°
  const sunVisible = sunTopo.elevationDeg > sunHorizon - 0.25;

  const sun: SkyBodyHorizontal & { subLat: number; subLon: number } = {
    azimuthDeg: Number(sunTopo.azimuthDeg.toFixed(1)),
    elevationDeg: Number(sunTopo.elevationDeg.toFixed(2)),
    horizonDeg: Number(sunHorizon.toFixed(2)),
    isVisible: sunVisible,
    subLat: Number(ephem.subSolarLat.toFixed(2)),
    subLon: Number(ephem.subSolarLon.toFixed(2)),
  };

  // Earth horizontal coordinates
  const earthTopo = computeTopocentricAzEl(
    site.lat,
    site.lon,
    elevationKm,
    ephem.subEarthLat,
    ephem.subEarthLon,
    ephem.earthDistanceKm
  );
  const earthHorizon = interpolateHorizonAtAzimuth(
    horizonProfileDeg,
    earthTopo.azimuthDeg
  );
  // Earth angular radius from Moon is ~0.95°!
  const earthVisible = earthTopo.elevationDeg > earthHorizon;

  const earth: SkyBodyHorizontal & {
    subLat: number;
    subLon: number;
    distanceKm: number;
  } = {
    azimuthDeg: Number(earthTopo.azimuthDeg.toFixed(1)),
    elevationDeg: Number(earthTopo.elevationDeg.toFixed(2)),
    horizonDeg: Number(earthHorizon.toFixed(2)),
    isVisible: earthVisible,
    subLat: Number(ephem.subEarthLat.toFixed(2)),
    subLon: Number(ephem.subEarthLon.toFixed(2)),
    distanceKm: Math.round(ephem.earthDistanceKm),
  };

  // Solar power flux (Solar constant at 1 AU = 1361 W/m²)
  // Horizontal deck vs 2-axis sun-tracking vertical polar mast!
  const solarConstant = 1361;
  const limbFraction = sunVisible
    ? Math.min(1, Math.max(0.15, (sunTopo.elevationDeg - (sunHorizon - 0.26)) / 0.53))
    : 0;
  const solarFluxHorizontalWm2 = sunVisible
    ? Math.round(
        solarConstant *
          limbFraction *
          Math.max(0.02, Math.sin(Math.max(0.5, sunTopo.elevationDeg) * DEG2RAD))
      )
    : 0;
  const solarFluxVerticalMastWm2 = sunVisible
    ? Math.round(
        solarConstant *
          limbFraction *
          Math.max(0.15, Math.cos(Math.max(0, sunTopo.elevationDeg) * DEG2RAD))
      )
    : 0;

  const surfaceTempK = estimateSurfaceTempK(
    site.lat,
    site.lon,
    elevationKm,
    sunVisible,
    sunTopo.elevationDeg,
    illuminationDutyPct
  );

  const activeSatellites = CISLUNAR_SATELLITES.map((sat) =>
    propagateSatellite(
      sat,
      timeMs,
      site.lat,
      site.lon,
      elevationKm,
      horizonProfileDeg,
      trueScale
    )
  );

  const visibleRelays = activeSatellites.filter(
    (s) => s.satellite.isRelay && s.isVisibleFromSite
  );

  // Flight-Rule Assessment Matrix (6 operational criteria)
  const bestFlux =
    Math.abs(site.lat) > 70 ? solarFluxVerticalMastWm2 : solarFluxHorizontalWm2;

  const powerStatus: ReadinessStatus =
    sunVisible && bestFlux >= 450
      ? 'GO'
      : sunVisible && bestFlux >= 150
      ? 'CAUTION'
      : 'NO-GO';

  const dteMargin = earth.elevationDeg - earth.horizonDeg;
  const commStatus: ReadinessStatus =
    earthVisible && dteMargin >= 3.0
      ? 'GO'
      : earthVisible || visibleRelays.length > 0
      ? 'CAUTION'
      : 'NO-GO';

  const slopeStatus: ReadinessStatus =
    slopeDeg <= 8.0 ? 'GO' : slopeDeg <= 12.0 ? 'CAUTION' : 'NO-GO';

  const thermalStatus: ReadinessStatus =
    surfaceTempK >= 95 && surfaceTempK <= 375
      ? 'GO'
      : surfaceTempK >= 55 && surfaceTempK <= 392
      ? 'CAUTION'
      : 'NO-GO';

  const relayStatus: ReadinessStatus =
    visibleRelays.length >= 2
      ? 'GO'
      : visibleRelays.length === 1
      ? 'CAUTION'
      : 'NO-GO';

  const isruStatus: ReadinessStatus =
    waterIceWtPct >= 2.0 ? 'GO' : waterIceWtPct >= 0.5 ? 'CAUTION' : 'CAUTION';

  const flightRules: FlightRuleCheck[] = [
    {
      id: 'power',
      label: 'Solar Array Generation',
      valueText: sunVisible
        ? `${bestFlux} W/m² (El ${sun.elevationDeg > 0 ? '+' : ''}${sun.elevationDeg}°)`
        : `ECLIPSED (${(sun.elevationDeg - sun.horizonDeg).toFixed(1)}° below rim)`,
      status: powerStatus,
      detail:
        Math.abs(site.lat) > 70
          ? `Vertical tracking mast receives ${solarFluxVerticalMastWm2} W/m²; annual duty ${illuminationDutyPct}%.`
          : `Horizontal deck receives ${solarFluxHorizontalWm2} W/m²; 354h lunar night requires RHU/RTG.`,
    },
    {
      id: 'comms',
      label: 'Earth & Relay Comms',
      valueText: earthVisible
        ? `DTE CLEAR (+${dteMargin.toFixed(1)}° margin)`
        : visibleRelays.length > 0
        ? `RELAY ACTIVE (${visibleRelays[0].satellite.name.split(' ')[0]})`
        : 'COMM BLACKOUT',
      status: commStatus,
      detail: earthVisible
        ? `Direct X-band link open (Earth El ${earth.elevationDeg}°, Az ${earth.azimuthDeg}°).`
        : visibleRelays.length > 0
        ? `DTE blocked by terrain/limb; ${visibleRelays.length} orbiter relay(s) bridging up to ${Math.max(...visibleRelays.map((r) => r.instantDataRateMbps))} Mbps.`
        : 'Both Direct-to-Earth and relay orbiters currently below local horizon mask.',
    },
    {
      id: 'slope',
      label: 'Touchdown Slope Hazard',
      valueText: `${slopeDeg.toFixed(1)}° gradient`,
      status: slopeStatus,
      detail:
        slopeDeg <= 8
          ? 'Within nominal <8° CLPS / HLS 4-leg touchdown stability envelope.'
          : slopeDeg <= 12
          ? 'Marginal 8–12° slope: requires Hazard Detection & Avoidance (HDA) lidar.'
          : 'Exceeds 12° lander tip-over limit; relocate ellipse off crater scarp.',
    },
    {
      id: 'thermal',
      label: 'Surface Thermal Load',
      valueText: `${surfaceTempK} K (${Math.round(surfaceTempK - 273.15)}°C)`,
      status: thermalStatus,
      detail:
        surfaceTempK < 95
          ? 'Cryogenic survival regime (<95 K): active survival heaters / RTG required.'
          : surfaceTempK > 375
          ? 'High subsolar IR flux (>375 K): orient zenith radiators away from bright regolith.'
          : 'Benign operational thermal envelope (95–375 K) for avionics & batteries.',
    },
    {
      id: 'relay-net',
      label: 'Orbital Constellation',
      valueText: `${activeSatellites.filter((s) => s.isVisibleFromSite).length}/5 In View (${visibleRelays.length} Relays)`,
      status: relayStatus,
      detail:
        visibleRelays.length > 0
          ? `Active overhead relays: ${visibleRelays.map((r) => r.satellite.name.split(' ')[0]).join(', ')}.`
          : 'Waiting for next South-Pole aposelene dwell or polar low-orbit pass.',
    },
    {
      id: 'isru',
      label: 'ISRU Volatile Proximity',
      valueText: `${waterIceWtPct.toFixed(1)} wt% H₂O-eq`,
      status: isruStatus,
      detail:
        waterIceWtPct >= 2.0
          ? 'High-grade polar hydrogen signature suitable for volatile prospecting drills.'
          : 'Desiccated regolith; oxygen extraction possible via ilmenite/regolith reduction.',
    },
  ];

  // Overall Flight Readiness Score (0-100)
  let score = 0;
  score += powerStatus === 'GO' ? 30 : powerStatus === 'CAUTION' ? 16 : 2;
  score += commStatus === 'GO' ? 26 : commStatus === 'CAUTION' ? 19 : 0;
  score += slopeStatus === 'GO' ? 20 : slopeStatus === 'CAUTION' ? 11 : 2;
  score += thermalStatus === 'GO' ? 14 : thermalStatus === 'CAUTION' ? 8 : 3;
  score += Math.min(10, Math.round(waterIceWtPct * 2 + (illuminationDutyPct / 100) * 5));

  const criticalFails = [powerStatus, commStatus, slopeStatus].filter(
    (s) => s === 'NO-GO'
  ).length;
  const overallStatus: ReadinessStatus =
    criticalFails > 0 ? 'NO-GO' : score >= 76 ? 'GO' : 'CAUTION';

  return {
    site,
    timestampMs: timeMs,
    elevationKm,
    slopeDeg,
    surfaceTempK,
    illuminationDutyPct,
    waterIceWtPct,
    sun,
    earth,
    horizonProfileDeg,
    solarFluxHorizontalWm2,
    solarFluxVerticalMastWm2,
    activeSatellites,
    visibleRelays,
    overallStatus,
    readinessScore: Math.min(100, Math.max(0, score)),
    flightRules,
  };
}

/**
 * Predict upcoming satellite access pass windows over the next `hoursAhead` hours (step = 4 min)
 */
export function predictSatellitePasses(
  site: LandingSite,
  startTimeMs: number,
  hoursAhead = 24
): SatellitePassWindow[] {
  const stepMs = 4 * 60 * 1000; // 4-minute resolution captures even 18-min LRO passes accurately
  const steps = Math.floor((hoursAhead * 3600 * 1000) / stepMs);
  const elevKm =
    site.elevationKm !== undefined
      ? site.elevationKm
      : sampleElevationKm(site.lat, site.lon);
  const horizon = computeHorizonProfileDeg(site.lat, site.lon, 2.0);

  const windows: SatellitePassWindow[] = [];

  for (const sat of CISLUNAR_SATELLITES) {
    let inPass = false;
    let aosMs = startTimeMs;
    let maxEl = 0;
    let peakRate = 0;

    for (let i = 0; i <= steps; i++) {
      const t = startTimeMs + i * stepMs;
      const st = propagateSatellite(sat, t, site.lat, site.lon, elevKm, horizon, false);
      if (st.isVisibleFromSite) {
        if (!inPass) {
          inPass = true;
          aosMs = t;
          maxEl = st.elevationDeg;
          peakRate = st.instantDataRateMbps;
        } else {
          if (st.elevationDeg > maxEl) maxEl = st.elevationDeg;
          if (st.instantDataRateMbps > peakRate) peakRate = st.instantDataRateMbps;
        }
      } else if (inPass) {
        inPass = false;
        const durMin = Math.max(4, Math.round((t - aosMs) / 60000));
        windows.push({
          satelliteId: sat.id,
          satelliteName: sat.name,
          color: sat.color,
          isRelay: sat.isRelay,
          aosTimeMs: aosMs,
          losTimeMs: t,
          durationMinutes: durMin,
          maxElevationDeg: Number(maxEl.toFixed(1)),
          peakDataRateMbps: peakRate,
          capabilities: sat.capabilities,
        });
      }
    }

    if (inPass) {
      const endMs = startTimeMs + steps * stepMs;
      windows.push({
        satelliteId: sat.id,
        satelliteName: sat.name,
        color: sat.color,
        isRelay: sat.isRelay,
        aosTimeMs: aosMs,
        losTimeMs: endMs,
        durationMinutes: Math.max(4, Math.round((endMs - aosMs) / 60000)),
        maxElevationDeg: Number(maxEl.toFixed(1)),
        peakDataRateMbps: peakRate,
        capabilities: sat.capabilities,
      });
    }
  }

  return windows.sort((a, b) => a.aosTimeMs - b.aosTimeMs);
}

/**
 * Generate 30-day synodic timeline (every 4 hours = 180 samples) for Sun, Earth DTE, Relays & Surface Temp
 */
export function computeSynodicTimeline(
  site: LandingSite,
  anchorTimeMs: number,
  days = 30
): TimelineSample[] {
  const stepMs = 4 * 3600 * 1000;
  const totalSteps = Math.floor((days * 24) / 4);
  const elevKm =
    site.elevationKm !== undefined
      ? site.elevationKm
      : sampleElevationKm(site.lat, site.lon);
  const horizon = computeHorizonProfileDeg(site.lat, site.lon, 2.0);
  const clim = estimateClimatology(site.lat, site.lon, elevKm, horizon);
  const illumDuty =
    site.illuminationOverridePct !== undefined
      ? site.illuminationOverridePct
      : clim.illuminationDutyPct;

  const samples: TimelineSample[] = [];

  for (let i = 0; i <= totalSteps; i++) {
    const t = anchorTimeMs + i * stepMs;
    const ephem = computeSunEarthSelenographic(t);

    const sunTopo = computeTopocentricAzEl(
      site.lat,
      site.lon,
      elevKm,
      ephem.subSolarLat,
      ephem.subSolarLon,
      149597870
    );
    const sunHor = interpolateHorizonAtAzimuth(horizon, sunTopo.azimuthDeg);
    const sunVisible = sunTopo.elevationDeg > sunHor - 0.25;

    const earthTopo = computeTopocentricAzEl(
      site.lat,
      site.lon,
      elevKm,
      ephem.subEarthLat,
      ephem.subEarthLon,
      ephem.earthDistanceKm
    );
    const earthHor = interpolateHorizonAtAzimuth(horizon, earthTopo.azimuthDeg);
    const earthVisible = earthTopo.elevationDeg > earthHor;

    const satVisibility: Record<string, boolean> = {};
    let relayCount = 0;
    for (const sat of CISLUNAR_SATELLITES) {
      const st = propagateSatellite(sat, t, site.lat, site.lon, elevKm, horizon, false);
      satVisibility[sat.id] = st.isVisibleFromSite;
      if (sat.isRelay && st.isVisibleFromSite) relayCount++;
    }

    const tempK = estimateSurfaceTempK(
      site.lat,
      site.lon,
      elevKm,
      sunVisible,
      sunTopo.elevationDeg,
      illumDuty
    );

    samples.push({
      timeMs: t,
      sunVisible,
      sunElevationDeg: Number((sunTopo.elevationDeg - sunHor).toFixed(1)),
      earthVisible,
      earthElevationDeg: Number((earthTopo.elevationDeg - earthHor).toFixed(1)),
      tempK,
      relayCount,
      satVisibility,
    });
  }

  return samples;
}

/**
 * Scan the 30-day synodic timeline to identify top continuous sunlit + comm-supported mission windows
 */
export function findOptimalTouchdownWindows(
  timeline: TimelineSample[],
  site: LandingSite
): OptimalWindowRecommendation[] {
  const candidates: OptimalWindowRecommendation[] = [];
  let runStartIdx = -1;

  for (let i = 0; i <= timeline.length; i++) {
    const s = timeline[i];
    const good = s && s.sunVisible && (s.earthVisible || s.relayCount > 0);
    if (good && runStartIdx === -1) {
      runStartIdx = i;
    } else if (!good && runStartIdx !== -1) {
      const slice = timeline.slice(runStartIdx, i);
      if (slice.length >= 3) {
        // at least 12 hours
        const durHours = slice.length * 4;
        const dtePct = Math.round(
          (slice.filter((x) => x.earthVisible).length / slice.length) * 100
        );
        const relayPct = Math.round(
          (slice.filter((x) => x.relayCount > 0).length / slice.length) * 100
        );
        const avgFlux =
          Math.abs(site.lat) > 70
            ? 1240
            : Math.round(
                slice.reduce(
                  (acc, x) =>
                    acc + 1361 * Math.max(0.1, Math.sin(Math.max(2, x.sunElevationDeg) * DEG2RAD)),
                  0
                ) / slice.length
              );
        const score = Math.min(
          99,
          Math.round(Math.min(55, durHours / 5) + dtePct * 0.25 + relayPct * 0.2)
        );
        candidates.push({
          startMs: slice[0].timeMs,
          endMs: slice[slice.length - 1].timeMs + 4 * 3600 * 1000,
          durationHours: durHours,
          avgSolarFluxWm2: avgFlux,
          dteCoveragePct: dtePct,
          relayCoveragePct: relayPct,
          score,
          rationale:
            dtePct > 80
              ? `${durHours}h continuous solar illumination with ${dtePct}% Direct-to-Earth X-band lock.`
              : `${durHours}h sunlit window bridged by ${relayPct}% cislunar relay coverage during Earth horizon dip.`,
        });
      }
      runStartIdx = -1;
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

/**
 * Given a clicked sample along `sampleSatelliteOrbitCurve` (eccentric anomaly E = (frac * 2π)),
 * compute the exact next timestamp (> fromTimeMs) when the spacecraft arrives at that orbital point.
 */
export function solveNextSatelliteOrbitPointTime(
  sat: LunarSatellite,
  fromTimeMs: number,
  orbitFraction01: number
): number {
  const Etarget = ((orbitFraction01 % 1) + 1) % 1 * 2 * Math.PI;
  const e = sat.eccentricity;
  let Mtarget = (Etarget - e * Math.sin(Etarget)) % (2 * Math.PI);
  if (Mtarget < 0) Mtarget += 2 * Math.PI;

  const a = sat.semiMajorAxisKm;
  const n = Math.sqrt(MOON_MU_KM3_S2 / (a * a * a)); // rad/s
  const dtSecNow = (fromTimeMs - Date.UTC(2026, 10, 4, 0, 0, 0)) / 1000;
  const M0 = sat.meanAnomalyEpochDeg * DEG2RAD;
  let Mnow = (M0 + n * dtSecNow) % (2 * Math.PI);
  if (Mnow < 0) Mnow += 2 * Math.PI;

  let dM = (Mtarget - Mnow) % (2 * Math.PI);
  if (dM < 0) dM += 2 * Math.PI;
  if (dM < 0.015) dM += 2 * Math.PI;

  const waitSec = dM / n;
  return Math.round(fromTimeMs + waitSec * 1000);
}

/**
 * Compute upcoming KSP "Warp To" surface events (Local Sunrise, Solar Peak, Sunset, DTE Earthrise)
 * for the selected landing site using 360° LOLA horizon ray-tracing + bisection.
 */
export function computeSiteSurfaceWarpTargets(
  site: LandingSite,
  fromTimeMs: number
): WarpTargetOption[] {
  const elevKm = site.elevationKm ?? sampleElevationKm(site.lat, site.lon);
  const horizon = computeHorizonProfileDeg(site.lat, site.lon, 2.0);
  const results: WarpTargetOption[] = [];

  const evalSunClearance = (tMs: number): { margin: number; el: number } => {
    const se = computeSunEarthSelenographic(tMs);
    const topo = computeTopocentricAzEl(
      site.lat,
      site.lon,
      elevKm + 0.002,
      se.subSolarLat,
      se.subSolarLon,
      149597870
    );
    const mask = interpolateHorizonAtAzimuth(horizon, topo.azimuthDeg) - 0.26;
    return { margin: topo.elevationDeg - mask, el: topo.elevationDeg };
  };

  const evalEarthClearance = (tMs: number): { margin: number; el: number } => {
    const se = computeSunEarthSelenographic(tMs);
    const topo = computeTopocentricAzEl(
      site.lat,
      site.lon,
      elevKm + 0.002,
      se.subEarthLat,
      se.subEarthLon,
      se.earthDistanceKm
    );
    const mask = Math.max(interpolateHorizonAtAzimuth(horizon, topo.azimuthDeg), 1.0);
    return { margin: topo.elevationDeg - mask, el: topo.elevationDeg };
  };

  const stepMs = 3 * 3600 * 1000; // 3-hour scan over 30 days
  const totalSteps = 242;

  let sunriseMs: number | null = null;
  let sunsetMs: number | null = null;
  let dteRiseMs: number | null = null;
  let peakSunMs = fromTimeMs;
  let peakSunEl = -90;

  let prevSun = evalSunClearance(fromTimeMs);
  let prevEarth = evalEarthClearance(fromTimeMs);

  const bisectCrossing = (
    fn: (ms: number) => { margin: number },
    t0: number,
    t1: number,
    rising: boolean
  ): number => {
    let lo = t0;
    let hi = t1;
    for (let k = 0; k < 14; k++) {
      const mid = 0.5 * (lo + hi);
      const m = fn(mid).margin;
      if ((rising && m < 0) || (!rising && m >= 0)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return Math.round(hi);
  };

  for (let i = 1; i <= totalSteps; i++) {
    const t = fromTimeMs + i * stepMs;
    const curSun = evalSunClearance(t);
    const curEarth = evalEarthClearance(t);

    if (curSun.margin > 0 && curSun.el > peakSunEl) {
      peakSunEl = curSun.el;
      peakSunMs = t;
    }

    if (sunriseMs === null && prevSun.margin <= 0 && curSun.margin > 0) {
      sunriseMs = bisectCrossing(evalSunClearance, t - stepMs, t, true);
    }
    if (sunsetMs === null && prevSun.margin > 0 && curSun.margin <= 0) {
      sunsetMs = bisectCrossing(evalSunClearance, t - stepMs, t, false);
    }
    if (dteRiseMs === null && prevEarth.margin <= 0 && curEarth.margin > 0) {
      dteRiseMs = bisectCrossing(evalEarthClearance, t - stepMs, t, true);
    }

    prevSun = curSun;
    prevEarth = curEarth;
  }

  const shortSite = site.name.split(' (')[0];

  if (sunriseMs !== null) {
    results.push({
      id: 'site-sunrise',
      label: `Local Sunrise at ${shortSite}`,
      subtitle: 'Sun clears local 360° LOLA topographic horizon rim',
      targetTimeMs: sunriseMs,
      category: 'surface',
      recommendedView: 'lunar-globe',
    });
  }

  if (peakSunEl > 0 && peakSunMs > fromTimeMs + 1800000) {
    results.push({
      id: 'site-noon',
      label: `Peak Solar Elevation (+${peakSunEl.toFixed(1)}°)`,
      subtitle: `Maximum solar array incidence at ${shortSite}`,
      targetTimeMs: peakSunMs,
      category: 'surface',
      recommendedView: 'lunar-globe',
    });
  }

  if (sunsetMs !== null) {
    results.push({
      id: 'site-sunset',
      label: `Local Sunset at ${shortSite}`,
      subtitle: 'Onset of lunar night / topographic shadow behind rim',
      targetTimeMs: sunsetMs,
      category: 'surface',
      recommendedView: 'lunar-globe',
    });
  }

  if (dteRiseMs !== null) {
    results.push({
      id: 'site-dte-rise',
      label: `Next DTE Earthrise at ${shortSite}`,
      subtitle: 'Optical libration lifts Earth above local horizon mask',
      targetTimeMs: dteRiseMs,
      category: 'surface',
      recommendedView: 'lunar-globe',
    });
  }

  return results.sort((a, b) => a.targetTimeMs - b.targetTimeMs);
}

/**
 * Solve for a Lunar Surface Location (lat, lon) specified manually WITH RESPECT TO THE SUN AND EARTH!
 * Supports:
 *  - 'sun-offset': Offset Δλ from Sub-Solar Longitude (0° = Noon, -90° = Sunrise Terminator, +90° = Sunset) + Target Lat
 *  - 'earth-offset': Offset Δλ, Δφ from Sub-Earth Libration Zenith (0° = Peak DTE, ±90° = Grazing Limb, ±180° = Far-Side Quiet)
 *  - 'dual-elevation': Exact closed-form 3D vector intersection for desired Sun Elevation + desired Earth Elevation!
 */
export function solveSurfaceLocationWrtSunEarth(params: {
  timeMs: number;
  mode: SunEarthSurfaceMode;
  deltaLonFromSunDeg: number;
  deltaLonFromEarthDeg: number;
  deltaLatFromEarthDeg: number;
  targetLatDeg: number;
  useRelativeEarthLat: boolean;
  desiredSunElevDeg: number;
  desiredEarthElevDeg: number;
  preferredHemisphere: 'south' | 'north';
}): SunEarthSurfaceSolution {
  const se = computeSunEarthSelenographic(params.timeMs);
  const [sx, sy, sz] = latLonToCartesian(se.subSolarLat, se.subSolarLon, 1);
  const [ex, ey, ez] = latLonToCartesian(se.subEarthLat, se.subEarthLon, 1);

  const dotSE = Math.max(-1, Math.min(1, sx * ex + sy * ey + sz * ez));
  const sunEarthSeparationDeg = Number((Math.acos(dotSE) * RAD2DEG).toFixed(1));

  let lat = 0;
  let lon = 0;
  let exactFeasible = true;
  let note: string | undefined;

  if (params.mode === 'sun-offset') {
    lat = Math.max(-89.9, Math.min(89.9, params.targetLatDeg));
    lon = normalizeLon(se.subSolarLon + params.deltaLonFromSunDeg);
  } else if (params.mode === 'earth-offset') {
    const rawLat = params.useRelativeEarthLat
      ? se.subEarthLat + params.deltaLatFromEarthDeg
      : params.targetLatDeg;
    lat = Math.max(-89.9, Math.min(89.9, rawLat));
    lon = normalizeLon(se.subEarthLon + params.deltaLonFromEarthDeg);
  } else {
    // 'dual-elevation': Solve n · s = sin(h_sun), n · e = sin(h_earth), ||n|| = 1
    const a = Math.sin(Math.max(-90, Math.min(90, params.desiredSunElevDeg)) * DEG2RAD);
    const b = Math.sin(Math.max(-90, Math.min(90, params.desiredEarthElevDeg)) * DEG2RAD);
    const denom = 1 - dotSE * dotSE;

    if (denom > 1e-5) {
      const alpha = (a - b * dotSE) / denom;
      const beta = (b - a * dotSE) / denom;
      const vx = alpha * sx + beta * ex;
      const vy = alpha * sy + beta * ey;
      const vz = alpha * sz + beta * ez;
      const lenSq = vx * vx + vy * vy + vz * vz;

      if (lenSq <= 1.0002) {
        const rem = Math.sqrt(Math.max(0, 1 - lenSq));
        // Cross product w = (s x e) / ||s x e||
        const cx = sy * ez - sz * ey;
        const cy = sz * ex - sx * ez;
        const cz = sx * ey - sy * ex;
        const cNorm = Math.hypot(cx, cy, cz) || 1;
        const wx = cx / cNorm;
        const wy = cy / cNorm;
        const wz = cz / cNorm;

        const p1: [number, number, number] = [vx + rem * wx, vy + rem * wy, vz + rem * wz];
        const p2: [number, number, number] = [vx - rem * wx, vy - rem * wy, vz - rem * wz];
        const chosen =
          params.preferredHemisphere === 'south'
            ? p1[1] <= p2[1]
              ? p1
              : p2
            : p1[1] >= p2[1]
            ? p1
            : p2;
        const ll = cartesianToLatLon(chosen[0], chosen[1], chosen[2]);
        lat = ll.lat;
        lon = normalizeLon(ll.lon);
      } else {
        // Closest feasible point on the Sun-Earth great circle
        exactFeasible = false;
        const vNorm = Math.hypot(vx, vy, vz) || 1;
        const ll = cartesianToLatLon(vx / vNorm, vy / vNorm, vz / vNorm);
        lat = ll.lat;
        lon = normalizeLon(ll.lon);
        note = `Sun & Earth are currently ${sunEarthSeparationDeg}° apart; projected to closest feasible point on the Sun–Earth great circle.`;
      }
    } else {
      // Sun and Earth nearly collinear (New Moon ~180° or Full Moon ~0°)
      exactFeasible = Math.abs(a - b * dotSE) < 0.03;
      const zAngleRad = Math.acos(Math.max(-1, Math.min(1, a)));
      const az = params.preferredHemisphere === 'south' ? 180 : 0;
      const pt = stepAlongBearing(se.subSolarLat, se.subSolarLon, az, zAngleRad * RAD2DEG);
      lat = pt.lat;
      lon = pt.lon;
      if (!exactFeasible) {
        note = `Sun & Earth are nearly aligned (${sunEarthSeparationDeg}° separation); matched target Sun elevation.`;
      }
    }
  }

  const [nx, ny, nz] = latLonToCartesian(lat, lon, 1);
  const geometricSunElevDeg = Number(
    (Math.asin(Math.max(-1, Math.min(1, nx * sx + ny * sy + nz * sz))) * RAD2DEG).toFixed(1)
  );
  const geometricEarthElevDeg = Number(
    (Math.asin(Math.max(-1, Math.min(1, nx * ex + ny * ey + nz * ez))) * RAD2DEG).toFixed(1)
  );

  return {
    lat: Number(lat.toFixed(2)),
    lon: Number(lon.toFixed(2)),
    exactFeasible,
    sunEarthSeparationDeg,
    geometricSunElevDeg,
    geometricEarthElevDeg,
    deltaLonFromSunDeg: Number(normalizeLon(lon - se.subSolarLon).toFixed(1)),
    deltaLonFromEarthDeg: Number(normalizeLon(lon - se.subEarthLon).toFixed(1)),
    note,
  };
}

