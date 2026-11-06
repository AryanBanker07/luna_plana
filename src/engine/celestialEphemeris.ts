import {
  CelestialSystemState,
  MissionEpochPreset,
  WarpTargetOption,
} from '../types/lunar';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
export const AU_KM = 149597870.7;
export const EARTH_RADIUS_KM = 6371.0;
export const MOON_RADIUS_KM_EPHEM = 1737.4;
export const SYNODIC_MONTH_DAYS = 29.530588853;

export const MISSION_EPOCH_PRESETS: MissionEpochPreset[] = [
  {
    id: 'apollo-11',
    label: 'Apollo 11 Eagle Landing',
    era: 'past',
    utcIso: '1969-07-20T20:17:00Z',
    tag: '1969 PAST',
    description: 'Historic first crewed lunar touchdown at Mare Tranquillitatis (0.67°N, 23.47°E).',
  },
  {
    id: 'apollo-17',
    label: 'Apollo 17 LRV Traverse',
    era: 'past',
    utcIso: '1972-12-11T19:54:00Z',
    tag: '1972 PAST',
    description: 'Longest crewed Apollo Lunar Roving Vehicle expedition at Taurus-Littrow.',
  },
  {
    id: 'chandrayaan-3',
    label: 'Chandrayaan-3 Vikram & Pragyan',
    era: 'past',
    utcIso: '2023-08-23T12:33:00Z',
    tag: '2023 PAST',
    description: 'First southern high-latitude landing & rover sortie at Shiv Shakti Point (69.37°S).',
  },
  {
    id: 'im1-odysseus',
    label: 'CLPS IM-1 Odysseus Touchdown',
    era: 'past',
    utcIso: '2024-02-22T23:23:00Z',
    tag: '2024 PAST',
    description: 'Commercial South Pole region touchdown near Malapert-A crater (80.13°S).',
  },
  {
    id: 'baseline-2026',
    label: 'SELENE OPS Baseline Window',
    era: 'present',
    utcIso: '2026-11-04T12:00:00Z',
    tag: '2026 NOMINAL',
    description: 'Nominal Space Apps 2026 southern polar illumination & cislunar relay reference.',
  },
  {
    id: 'artemis-3',
    label: 'Artemis III Polar Surface Ops',
    era: 'future',
    utcIso: '2027-09-18T14:00:00Z',
    tag: '2027 FUTURE',
    description: 'Candidate South Pole sunlit ridge window near Shackleton / Mons Mouton.',
  },
  {
    id: 'griffin-polar-2028',
    label: 'Polar Summer Peak Illumination',
    era: 'future',
    utcIso: '2028-02-12T06:00:00Z',
    tag: '2028 FUTURE',
    description: 'Favorable southern sub-solar latitude (-1.5°) maximizing polar ridge solar duty.',
  },
  {
    id: 'artemis-4',
    label: 'Artemis IV Gateway & LTV Sortie',
    era: 'future',
    utcIso: '2029-08-24T18:00:00Z',
    tag: '2029 FUTURE',
    description: 'Integrated NRHO Gateway relay + Lunar Terrain Vehicle long-range sortie window.',
  },
  {
    id: 'basecamp-2032',
    label: 'Artemis Base Camp Solstice',
    era: 'future',
    utcIso: '2032-12-18T12:00:00Z',
    tag: '2032 FUTURE',
    description: 'Long-horizon sustained polar surface infrastructure & ISRU rover operations.',
  },
];

export function norm360(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

export function norm180(deg: number): number {
  let l = ((deg + 180) % 360 + 360) % 360 - 180;
  if (l === -180) l = 180;
  return l;
}

/**
 * Safe UTC Date/Time string helpers supporting arbitrary past & future years (e.g. 1900..2150)
 */
export function formatUtcParts(timeMs: number): {
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:MM
  fullUtcLabel: string; // YYYY-MM-DD HH:MM UTC
  year: number;
} {
  const d = new Date(timeMs);
  const year = d.getUTCFullYear();
  const yStr =
    year < 0
      ? `-${String(Math.abs(year)).padStart(4, '0')}`
      : String(year).padStart(4, '0');
  const mStr = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getUTCDate()).padStart(2, '0');
  const hhStr = String(d.getUTCHours()).padStart(2, '0');
  const mmStr = String(d.getUTCMinutes()).padStart(2, '0');
  const dateStr = `${yStr}-${mStr}-${dayStr}`;
  const timeStr = `${hhStr}:${mmStr}`;
  return {
    dateStr,
    timeStr,
    fullUtcLabel: `${dateStr} ${timeStr} UTC`,
    year,
  };
}

export function parseUtcDateAndTime(dateStr: string, timeStr: string): number | null {
  const dm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(timeStr.trim());
  if (!dm || !tm) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const min = Number(tm[2]);
  const sec = tm[3] ? Number(tm[3]) : 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    min < 0 ||
    min > 59
  ) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, min, sec);
  return Number.isNaN(ms) ? null : ms;
}

export function formatRelativeEpochDelta(targetMs: number, refNowMs = Date.now()): string {
  const diffDays = (targetMs - refNowMs) / 86400000;
  if (Math.abs(diffDays) < 0.04) return 'LIVE NOW';
  const sign = diffDays >= 0 ? '+' : '−';
  const absDays = Math.abs(diffDays);
  if (absDays >= 365.25) {
    return `${sign}${(absDays / 365.25).toFixed(1)}y (${diffDays >= 0 ? 'Future' : 'Past'})`;
  }
  if (absDays >= 2) {
    return `${sign}${absDays.toFixed(1)}d (${diffDays >= 0 ? 'Future' : 'Past'})`;
  }
  return `${sign}${(absDays * 24).toFixed(1)}h (${diffDays >= 0 ? 'Future' : 'Past'})`;
}

/**
 * Right-handed Ecliptic Cartesian coordinates matching Three.js scene convention:
 * +X = Vernal Equinox (lon = 0°)
 * +Y = North Ecliptic Pole (lat = +90°)
 * -Z = Summer Solstice direction (lon = +90°, prograde CCW when viewed from +Y)
 */
export function eclipticToCartesian(
  latDeg: number,
  lonDeg: number,
  radius: number
): [number, number, number] {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);
  return [
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * cosLat * Math.sin(lon),
  ];
}

function classifyLunarPhase(elongationDeg: number): string {
  const e = norm360(elongationDeg);
  if (e < 11.25 || e >= 348.75) return 'New Moon';
  if (e < 78.75) return 'Waxing Crescent';
  if (e < 101.25) return 'First Quarter';
  if (e < 168.75) return 'Waxing Gibbous';
  if (e < 191.25) return 'Full Moon';
  if (e < 258.75) return 'Waning Gibbous';
  if (e < 281.25) return 'Third Quarter';
  return 'Waning Crescent';
}

function classifyEarthSeason(solarDeclinationDeg: number, sunGeoLonDeg: number): string {
  const lon = norm360(sunGeoLonDeg);
  if (lon >= 355 || lon < 5) return 'Vernal Equinox (N. Spring / S. Autumn)';
  if (lon >= 85 && lon < 95) return 'June Solstice (N. Summer / S. Winter)';
  if (lon >= 175 && lon < 185) return 'Autumnal Equinox (N. Autumn / S. Spring)';
  if (lon >= 265 && lon < 275) return 'December Solstice (N. Winter / S. Summer)';
  if (solarDeclinationDeg >= 0) {
    return lon < 90 ? 'N. Spring / S. Autumn' : 'N. Summer / S. Winter';
  }
  return lon < 270 ? 'N. Autumn / S. Spring' : 'N. Winter / S. Summer';
}

/**
 * Analytical Heliocentric (Sun–Earth–Moon) and Geocentric (Earth–Moon) Ephemeris
 * Synchronized with selenography.ts across arbitrary past & future dates.
 */
export function computeCelestialSystemState(timeMs: number): CelestialSystemState {
  const d = (timeMs - J2000_MS) / 86400000;
  const T = d / 36525;

  // 1. Sun apparent geocentric longitude & Earth heliocentric orbit (Meeus Ch. 25)
  const L0 = norm360(280.46646 + 0.98564736 * d);
  const MsunDeg = norm360(357.52911 + 0.98560028 * d);
  const Msun = MsunDeg * DEG2RAD;
  const eEarth = Math.max(0.015, Math.min(0.018, 0.016708634 - 0.000042037 * T));

  const Csun =
    (1.914602 - 0.004817 * T) * Math.sin(Msun) +
    0.019993 * Math.sin(2 * Msun) +
    0.000289 * Math.sin(3 * Msun);

  const sunGeoLonDeg = norm360(L0 + Csun);
  const earthHelioLonDeg = norm360(sunGeoLonDeg + 180);
  const nuEarth = (MsunDeg + Csun) * DEG2RAD;

  const earthSunDistanceAu =
    (1.000001018 * (1 - eEarth * eEarth)) / (1 + eEarth * Math.cos(nuEarth));
  const earthSunDistanceKm = earthSunDistanceAu * AU_KM;
  const earthOrbitalSpeedKms =
    29.7847 * Math.sqrt(Math.max(0.1, 2 / earthSunDistanceAu - 1 / 1.000001018));

  const earthObliquityDeg = 23.439291 - 0.0130042 * T;
  const earthGmstDeg = norm360(280.46061837 + 360.98564736629 * d);
  const solarDeclinationDeg =
    Math.asin(
      Math.sin(earthObliquityDeg * DEG2RAD) * Math.sin(sunGeoLonDeg * DEG2RAD)
    ) * RAD2DEG;

  // 2. Moon geocentric orbit around Earth (synced with selenography.ts)
  // Full Moon reference at d = 19.694 (2000-01-21 04:40 UTC) -> synodicPhase = 0 => elongation = 180°
  const synodicCycles = (d - 19.694) / SYNODIC_MONTH_DAYS;
  const synodicPhaseRad = synodicCycles * 2 * Math.PI;
  const meanElongationDeg = norm360(180 + synodicCycles * 360);

  const moonMeanAnomalyDeg = norm360(((d - 4.52) / 27.55455) * 360);
  const Mmoon = moonMeanAnomalyDeg * DEG2RAD;
  const evectionArg = 2 * synodicPhaseRad - Mmoon;
  const DmeanRad = meanElongationDeg * DEG2RAD;

  // Perturbations in lunar longitude (Equation of center + Evection + Variation)
  const deltaLonMoon =
    6.289 * Math.sin(Mmoon) +
    1.274 * Math.sin(evectionArg) +
    0.658 * Math.sin(2 * DmeanRad);

  const moonGeoLonDeg = norm360(sunGeoLonDeg + meanElongationDeg + deltaLonMoon);

  // Nodal regression (18.61-year period) & 5.145° orbital inclination to ecliptic
  const ascendingNodeLonDeg = norm360(125.04452 - 0.05295377 * d);
  const moonInclinationRad = 5.145396 * DEG2RAD;
  const uMoonRad = (moonGeoLonDeg - ascendingNodeLonDeg) * DEG2RAD;
  const moonGeoLatDeg =
    Math.asin(Math.max(-1, Math.min(1, Math.sin(moonInclinationRad) * Math.sin(uMoonRad)))) *
    RAD2DEG;

  // Earth–Moon center-to-center distance (exact match to selenography.ts)
  const earthMoonDistanceKm =
    384400 - 20905 * Math.cos(Mmoon) - 3699 * Math.cos(evectionArg);
  const earthMoonDistanceEarthRadii = earthMoonDistanceKm / EARTH_RADIUS_KM;

  // Vis-viva speed of Moon relative to Earth (mu_E+M ≈ 403503 km^3/s^2)
  const muEarthMoon = 403503.2;
  const moonOrbitalSpeedKms = Math.sqrt(
    Math.max(0.1, muEarthMoon * (2 / earthMoonDistanceKm - 1 / 384400))
  );

  // Osculating perigee longitude
  const nuMoonApproxDeg =
    moonMeanAnomalyDeg + 2 * 0.0549 * Math.sin(Mmoon) * RAD2DEG;
  const perigeeLonDeg = norm360(moonGeoLonDeg - nuMoonApproxDeg);

  // True phase angle & illuminated fraction seen from Earth
  // cos(elongation) = cos(beta) * cos(lambda_moon - lambda_sun)
  const dLonRad = (moonGeoLonDeg - sunGeoLonDeg) * DEG2RAD;
  const cosElong =
    Math.cos(moonGeoLatDeg * DEG2RAD) * Math.cos(dLonRad);
  const elongationAbsDeg = Math.acos(Math.max(-1, Math.min(1, cosElong))) * RAD2DEG;
  const elongationDeg = norm360(moonGeoLonDeg - sunGeoLonDeg);
  const illuminatedFractionPct = 0.5 * (1 - Math.cos(elongationAbsDeg * DEG2RAD)) * 100;
  const lunarAgeDays = (elongationDeg / 360) * SYNODIC_MONTH_DAYS;

  let eclipseGeometryNote: string | null = null;
  if (Math.abs(moonGeoLatDeg) < 1.45) {
    if (elongationDeg < 10 || elongationDeg > 350) {
      eclipseGeometryNote = 'Solar Eclipse Alignment Window (New Moon near Ecliptic Node)';
    } else if (Math.abs(elongationDeg - 180) < 10) {
      eclipseGeometryNote = 'Lunar Eclipse Shadow Window (Full Moon near Ecliptic Node)';
    }
  }

  return {
    timestampMs: timeMs,
    earthHelioLonDeg: Number(earthHelioLonDeg.toFixed(2)),
    sunGeoLonDeg: Number(sunGeoLonDeg.toFixed(2)),
    earthMeanAnomalyDeg: Number(MsunDeg.toFixed(2)),
    earthSunDistanceAu: Number(earthSunDistanceAu.toFixed(4)),
    earthSunDistanceKm: Math.round(earthSunDistanceKm),
    earthOrbitalSpeedKms: Number(earthOrbitalSpeedKms.toFixed(2)),
    earthObliquityDeg: Number(earthObliquityDeg.toFixed(2)),
    earthGmstDeg: Number(earthGmstDeg.toFixed(2)),
    solarDeclinationDeg: Number(solarDeclinationDeg.toFixed(2)),
    earthSeasonLabel: classifyEarthSeason(solarDeclinationDeg, sunGeoLonDeg),

    moonGeoLonDeg: Number(moonGeoLonDeg.toFixed(2)),
    moonGeoLatDeg: Number(moonGeoLatDeg.toFixed(2)),
    earthMoonDistanceKm: Math.round(earthMoonDistanceKm),
    earthMoonDistanceEarthRadii: Number(earthMoonDistanceEarthRadii.toFixed(2)),
    moonOrbitalSpeedKms: Number(moonOrbitalSpeedKms.toFixed(3)),
    moonMeanAnomalyDeg: Number(moonMeanAnomalyDeg.toFixed(2)),
    ascendingNodeLonDeg: Number(ascendingNodeLonDeg.toFixed(2)),
    perigeeLonDeg: Number(perigeeLonDeg.toFixed(2)),
    elongationDeg: Number(elongationDeg.toFixed(1)),
    illuminatedFractionPct: Number(illuminatedFractionPct.toFixed(1)),
    lunarAgeDays: Number(lunarAgeDays.toFixed(1)),
    phaseName: classifyLunarPhase(elongationDeg),
    eclipseGeometryNote,
  };
}

export interface GeocentricOrbitGeometry {
  curvePoints: [number, number, number][];
  moonPosition: [number, number, number];
  perigeePoint: [number, number, number];
  apogeePoint: [number, number, number];
  ascendingNodePoint: [number, number, number];
  descendingNodePoint: [number, number, number];
}

/**
 * Sample the instantaneous inclined (5.145°), eccentric (e = 0.0549) Moon orbit around Earth
 * such that the Moon's instantaneous 3D position lies strictly on the curve.
 */
export function sampleMoonGeocentricOrbit(
  state: CelestialSystemState,
  mapDistanceKmToScene: (distKm: number) => number,
  segments = 180
): GeocentricOrbitGeometry {
  const e = 0.0549;
  const incRad = 5.145396 * DEG2RAD;
  const omegaNode = state.ascendingNodeLonDeg;
  const perigeeLon = state.perigeeLonDeg;

  // Calibrate osculating semi-major axis so r(moonGeoLonDeg) === state.earthMoonDistanceKm
  const nuNow = (state.moonGeoLonDeg - perigeeLon) * DEG2RAD;
  const unscaledNow = (1 - e * e) / (1 + e * Math.cos(nuNow));
  const aOscKm = state.earthMoonDistanceKm / Math.max(0.5, unscaledNow);

  const evalAtLon = (lonDeg: number): [number, number, number] => {
    const nu = (lonDeg - perigeeLon) * DEG2RAD;
    const rKm = (aOscKm * (1 - e * e)) / (1 + e * Math.cos(nu));
    const uRad = (lonDeg - omegaNode) * DEG2RAD;
    const latDeg =
      Math.asin(Math.max(-1, Math.min(1, Math.sin(incRad) * Math.sin(uRad)))) * RAD2DEG;
    return eclipticToCartesian(latDeg, lonDeg, mapDistanceKmToScene(rKm));
  };

  const curvePoints: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const lon = (i / segments) * 360;
    curvePoints.push(evalAtLon(lon));
  }

  return {
    curvePoints,
    moonPosition: evalAtLon(state.moonGeoLonDeg),
    perigeePoint: evalAtLon(perigeeLon),
    apogeePoint: evalAtLon(norm360(perigeeLon + 180)),
    ascendingNodePoint: evalAtLon(omegaNode),
    descendingNodePoint: evalAtLon(norm360(omegaNode + 180)),
  };
}

export interface HeliocentricOrbitGeometry {
  earthOrbitPoints: [number, number, number][];
  earthPosition: [number, number, number];
  perihelionPoint: [number, number, number];
  aphelionPoint: [number, number, number];
  vernalEquinoxPoint: [number, number, number];
  juneSolsticePoint: [number, number, number];
  autumnalEquinoxPoint: [number, number, number];
  decSolsticePoint: [number, number, number];
  moonEpicycleTrail: [number, number, number][];
}

/**
 * Sample Earth's 1 AU elliptical orbit around the Sun + Moon's wavy heliocentric epicycle trail.
 * Eccentricity can be visually amplified slightly in schematic view while keeping exact perihelion alignment.
 */
export function sampleEarthHeliocentricOrbit(
  state: CelestialSystemState,
  auSceneRadius: number,
  moonOrbitSceneRadius: number,
  exaggerateEccentricity = 2.5,
  segments = 240
): HeliocentricOrbitGeometry {
  const ePhys = 0.0167086;
  const eVis = Math.min(0.08, ePhys * exaggerateEccentricity);
  // Inertial J2000 heliocentric longitude of Earth perihelion (~Jan 3, 102.937°)
  const perihelionLon = 102.9373;

  const evalEarthAtLon = (lonDeg: number): [number, number, number] => {
    const nu = (lonDeg - perihelionLon) * DEG2RAD;
    const rScene = (auSceneRadius * (1 - eVis * eVis)) / (1 + eVis * Math.cos(nu));
    return eclipticToCartesian(0, lonDeg, rScene);
  };

  const earthOrbitPoints: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    earthOrbitPoints.push(evalEarthAtLon((i / segments) * 360));
  }

  // Sample +/- 45 days of Moon's heliocentric wavy epicycle path around Earth's orbit
  const moonEpicycleTrail: [number, number, number][] = [];
  const trailSpanDays = 90;
  const trailSteps = 180;
  const startMs = state.timestampMs - (trailSpanDays * 0.5) * 86400000;
  for (let i = 0; i <= trailSteps; i++) {
    const t = startMs + (i / trailSteps) * trailSpanDays * 86400000;
    const st = computeCelestialSystemState(t);
    const ePos = evalEarthAtLon(st.earthHelioLonDeg);
    const mRel = eclipticToCartesian(
      st.moonGeoLatDeg * 2.2, // subtle vertical exaggeration so 5.1° nodal wave is visible
      st.moonGeoLonDeg,
      moonOrbitSceneRadius * (st.earthMoonDistanceKm / 384400)
    );
    moonEpicycleTrail.push([ePos[0] + mRel[0], ePos[1] + mRel[1], ePos[2] + mRel[2]]);
  }

  return {
    earthOrbitPoints,
    earthPosition: evalEarthAtLon(state.earthHelioLonDeg),
    perihelionPoint: evalEarthAtLon(perihelionLon),
    aphelionPoint: evalEarthAtLon(norm360(perihelionLon + 180)),
    // Note: Vernal Equinox (Sun at 0° from Earth) occurs when Earth is at helio lon 180°!
    vernalEquinoxPoint: evalEarthAtLon(180),
    juneSolsticePoint: evalEarthAtLon(270),
    autumnalEquinoxPoint: evalEarthAtLon(0),
    decSolsticePoint: evalEarthAtLon(90),
    moonEpicycleTrail,
  };
}

/**
 * Evaluate exact 3D scene point on Moon's osculating geocentric orbit at any ecliptic longitude
 */
export function evalMoonOrbitPointAtLon(
  state: CelestialSystemState,
  lonDeg: number,
  mapDistanceKmToScene: (distKm: number) => number
): [number, number, number] {
  const e = 0.0549;
  const incRad = 5.145396 * DEG2RAD;
  const omegaNode = state.ascendingNodeLonDeg;
  const perigeeLon = state.perigeeLonDeg;
  const nuNow = (state.moonGeoLonDeg - perigeeLon) * DEG2RAD;
  const unscaledNow = (1 - e * e) / (1 + e * Math.cos(nuNow));
  const aOscKm = state.earthMoonDistanceKm / Math.max(0.5, unscaledNow);

  const nu = (lonDeg - perigeeLon) * DEG2RAD;
  const rKm = (aOscKm * (1 - e * e)) / (1 + e * Math.cos(nu));
  const uRad = (lonDeg - omegaNode) * DEG2RAD;
  const latDeg =
    Math.asin(Math.max(-1, Math.min(1, Math.sin(incRad) * Math.sin(uRad)))) * RAD2DEG;
  return eclipticToCartesian(latDeg, lonDeg, mapDistanceKmToScene(rKm));
}

/**
 * Evaluate exact 3D scene point on Earth's heliocentric 1 AU orbit at any heliocentric longitude
 */
export function evalEarthOrbitPointAtLon(
  lonDeg: number,
  auSceneRadius: number,
  exaggerateEccentricity = 2.5
): [number, number, number] {
  const ePhys = 0.0167086;
  const eVis = Math.min(0.08, ePhys * exaggerateEccentricity);
  const perihelionLon = 102.9373;
  const nu = (lonDeg - perihelionLon) * DEG2RAD;
  const rScene = (auSceneRadius * (1 - eVis * eVis)) / (1 + eVis * Math.cos(nu));
  return eclipticToCartesian(0, lonDeg, rScene);
}

/**
 * Format duration in KSP style: e.g. "4d 11h 23m" or "18m 42s"
 */
export function formatWarpDelta(deltaMs: number): string {
  const absSec = Math.max(0, Math.round(Math.abs(deltaMs) / 1000));
  const d = Math.floor(absSec / 86400);
  const h = Math.floor((absSec % 86400) / 3600);
  const m = Math.floor((absSec % 3600) / 60);
  const s = absSec % 60;
  if (d >= 365) {
    const yrs = Math.floor(d / 365);
    const remD = d % 365;
    return `${yrs}y ${remD}d ${h}h`;
  }
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// High-precision unrounded internal orbital angles & distance for sub-second root-finding
function evalRawOrbitalAngles(timeMs: number): {
  earthHelioLonDeg: number;
  sunGeoLonDeg: number;
  moonGeoLonDeg: number;
  elongationDeg: number;
  ascendingNodeLonDeg: number;
  earthMoonDistKm: number;
} {
  const d = (timeMs - J2000_MS) / 86400000;
  const T = d / 36525;
  const L0 = norm360(280.46646 + 0.98564736 * d);
  const MsunDeg = norm360(357.52911 + 0.98560028 * d);
  const Msun = MsunDeg * DEG2RAD;
  const Csun =
    (1.914602 - 0.004817 * T) * Math.sin(Msun) +
    0.019993 * Math.sin(2 * Msun) +
    0.000289 * Math.sin(3 * Msun);
  const sunGeoLonDeg = norm360(L0 + Csun);
  const earthHelioLonDeg = norm360(sunGeoLonDeg + 180);

  const synodicCycles = (d - 19.694) / SYNODIC_MONTH_DAYS;
  const synodicPhaseRad = synodicCycles * 2 * Math.PI;
  const meanElongationDeg = norm360(180 + synodicCycles * 360);
  const moonMeanAnomalyDeg = norm360(((d - 4.52) / 27.55455) * 360);
  const Mmoon = moonMeanAnomalyDeg * DEG2RAD;
  const evectionArg = 2 * synodicPhaseRad - Mmoon;
  const DmeanRad = meanElongationDeg * DEG2RAD;
  const deltaLonMoon =
    6.289 * Math.sin(Mmoon) +
    1.274 * Math.sin(evectionArg) +
    0.658 * Math.sin(2 * DmeanRad);
  const moonGeoLonDeg = norm360(sunGeoLonDeg + meanElongationDeg + deltaLonMoon);
  const ascendingNodeLonDeg = norm360(125.04452 - 0.05295377 * d);
  const earthMoonDistKm =
    384400 - 20905 * Math.cos(Mmoon) - 3699 * Math.cos(evectionArg);

  return {
    earthHelioLonDeg,
    sunGeoLonDeg,
    moonGeoLonDeg,
    elongationDeg: norm360(moonGeoLonDeg - sunGeoLonDeg),
    ascendingNodeLonDeg,
    earthMoonDistKm,
  };
}

/**
 * Find exact next timestamp (> fromTimeMs) when Moon reaches target geocentric ecliptic longitude
 */
export function solveNextMoonGeocentricLonTime(
  fromTimeMs: number,
  targetLonDeg: number
): number {
  const target = norm360(targetLonDeg);
  const nowAngles = evalRawOrbitalAngles(fromTimeMs);
  let dLon = norm360(target - nowAngles.moonGeoLonDeg);
  if (dLon < 0.05) dLon += 360;
  const meanSiderealRateDegPerDay = 360 / 27.321661;
  let t = fromTimeMs + (dLon / meanSiderealRateDegPerDay) * 86400000;

  for (let i = 0; i < 8; i++) {
    const cur = evalRawOrbitalAngles(t).moonGeoLonDeg;
    const err = norm180(target - cur);
    t += (err / meanSiderealRateDegPerDay) * 86400000;
  }
  return Math.max(fromTimeMs + 30000, Math.round(t));
}

/**
 * Find exact next timestamp (> fromTimeMs) when Moon reaches target Sun–Earth elongation angle:
 * 0° = Sub-Solar (New Moon), 90° = First Quarter, 180° = Anti-Solar (Full Moon), 270° = Third Quarter
 */
export function solveNextMoonElongationTime(
  fromTimeMs: number,
  targetElongationDeg: number
): number {
  const target = norm360(targetElongationDeg);
  const nowAngles = evalRawOrbitalAngles(fromTimeMs);
  let dElong = norm360(target - nowAngles.elongationDeg);
  if (dElong < 0.05) dElong += 360;
  const meanSynodicRateDegPerDay = 360 / SYNODIC_MONTH_DAYS;
  let t = fromTimeMs + (dElong / meanSynodicRateDegPerDay) * 86400000;

  for (let i = 0; i < 9; i++) {
    const cur = evalRawOrbitalAngles(t).elongationDeg;
    const err = norm180(target - cur);
    t += (err / meanSynodicRateDegPerDay) * 86400000;
  }
  return Math.max(fromTimeMs + 30000, Math.round(t));
}

/**
 * Find exact next timestamp (> fromTimeMs) for Lunar Perigee, Apogee, Ascending Node, or Descending Node
 */
export function solveNextLunarApsisOrNodeTime(
  fromTimeMs: number,
  event: 'perigee' | 'apogee' | 'ascending-node' | 'descending-node'
): number {
  if (event === 'ascending-node' || event === 'descending-node') {
    const targetU = event === 'ascending-node' ? 0 : 180;
    const nowA = evalRawOrbitalAngles(fromTimeMs);
    const curU = norm360(nowA.moonGeoLonDeg - nowA.ascendingNodeLonDeg);
    let dU = norm360(targetU - curU);
    if (dU < 0.05) dU += 360;
    const draconicRateDegPerDay = 360 / 27.212221;
    let t = fromTimeMs + (dU / draconicRateDegPerDay) * 86400000;
    for (let i = 0; i < 8; i++) {
      const a = evalRawOrbitalAngles(t);
      const u = norm360(a.moonGeoLonDeg - a.ascendingNodeLonDeg);
      const err = norm180(targetU - u);
      t += (err / draconicRateDegPerDay) * 86400000;
    }
    return Math.max(fromTimeMs + 30000, Math.round(t));
  }

  // Perigee (minimum distance, M ≈ 0°) or Apogee (maximum distance, M ≈ 180°)
  const d0 = (fromTimeMs - J2000_MS) / 86400000;
  const curM = norm360(((d0 - 4.52) / 27.55455) * 360);
  const targetM = event === 'perigee' ? 0 : 180;
  let dM = norm360(targetM - curM);
  if (dM < 2.0) dM += 360;
  const estCenterMs = fromTimeMs + (dM / 360) * 27.55455 * 86400000;

  // Golden-section search over +/- 2.0 days to capture exact evection-perturbed extremum
  let a = Math.max(fromTimeMs + 60000, estCenterMs - 2.0 * 86400000);
  let b = estCenterMs + 2.0 * 86400000;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a);
  let dPt = a + phi * (b - a);
  const score = (ms: number) => {
    const dist = evalRawOrbitalAngles(ms).earthMoonDistKm;
    return event === 'perigee' ? dist : -dist;
  };
  let fc = score(c);
  let fd = score(dPt);
  for (let i = 0; i < 22; i++) {
    if (fc < fd) {
      b = dPt;
      dPt = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = score(c);
    } else {
      a = c;
      c = dPt;
      fc = fd;
      dPt = a + phi * (b - a);
      fd = score(dPt);
    }
  }
  return Math.round((a + b) / 2);
}

/**
 * Find exact next timestamp (> fromTimeMs) when Earth reaches target heliocentric longitude (0..360°)
 */
export function solveNextEarthHelioLonTime(
  fromTimeMs: number,
  targetHelioLonDeg: number
): number {
  const target = norm360(targetHelioLonDeg);
  const nowA = evalRawOrbitalAngles(fromTimeMs);
  let dLon = norm360(target - nowA.earthHelioLonDeg);
  if (dLon < 0.02) dLon += 360;
  const meanEarthRateDegPerDay = 360 / 365.25636;
  let t = fromTimeMs + (dLon / meanEarthRateDegPerDay) * 86400000;

  for (let i = 0; i < 8; i++) {
    const cur = evalRawOrbitalAngles(t).earthHelioLonDeg;
    const err = norm180(target - cur);
    t += (err / meanEarthRateDegPerDay) * 86400000;
  }
  return Math.max(fromTimeMs + 30000, Math.round(t));
}

/**
 * Curated list of upcoming Cislunar & Heliocentric KSP "Warp To" orbital milestones
 */
export function computeOrbitalWarpTargets(fromTimeMs: number): WarpTargetOption[] {
  const perigeeMs = solveNextLunarApsisOrNodeTime(fromTimeMs, 'perigee');
  const apogeeMs = solveNextLunarApsisOrNodeTime(fromTimeMs, 'apogee');
  const ascNodeMs = solveNextLunarApsisOrNodeTime(fromTimeMs, 'ascending-node');
  const descNodeMs = solveNextLunarApsisOrNodeTime(fromTimeMs, 'descending-node');

  const newMoonMs = solveNextMoonElongationTime(fromTimeMs, 0);
  const fqMoonMs = solveNextMoonElongationTime(fromTimeMs, 90);
  const fullMoonMs = solveNextMoonElongationTime(fromTimeMs, 180);
  const tqMoonMs = solveNextMoonElongationTime(fromTimeMs, 270);

  const perihelionMs = solveNextEarthHelioLonTime(fromTimeMs, 102.9373);
  const aphelionMs = solveNextEarthHelioLonTime(fromTimeMs, 282.9373);

  // Soonest upcoming cardinal season (Equinox or Solstice)
  const seasons = [
    { lbl: 'March Equinox (λ⊕ 180°)', lon: 180 },
    { lbl: 'June Solstice (λ⊕ 270°)', lon: 270 },
    { lbl: 'September Equinox (λ⊕ 0°)', lon: 0 },
    { lbl: 'December Solstice (λ⊕ 90°)', lon: 90 },
  ].map((s) => ({
    ...s,
    ms: solveNextEarthHelioLonTime(fromTimeMs, s.lon),
  }));
  seasons.sort((a, b) => a.ms - b.ms);
  const nextSeason = seasons[0];

  const perigeeDist = Math.round(evalRawOrbitalAngles(perigeeMs).earthMoonDistKm);
  const apogeeDist = Math.round(evalRawOrbitalAngles(apogeeMs).earthMoonDistKm);

  const lunarTargets: WarpTargetOption[] = [
    {
      id: 'moon-perigee',
      label: 'Lunar Perigee (Pe)',
      subtitle: `Closest Earth approach (~${perigeeDist.toLocaleString()} km)`,
      targetTimeMs: perigeeMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
    {
      id: 'moon-apogee',
      label: 'Lunar Apogee (Ap)',
      subtitle: `Farthest Earth distance (~${apogeeDist.toLocaleString()} km)`,
      targetTimeMs: apogeeMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
    {
      id: 'moon-an',
      label: 'Ascending Node (☊ AN)',
      subtitle: 'Moon crosses Ecliptic Plane Northward (β = 0°)',
      targetTimeMs: ascNodeMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
    {
      id: 'moon-dn',
      label: 'Descending Node (☋ DN)',
      subtitle: 'Moon crosses Ecliptic Plane Southward (β = 0°)',
      targetTimeMs: descNodeMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
    {
      id: 'phase-new',
      label: 'New Moon (0° Sub-Solar)',
      subtitle: 'Moon directly between Earth & Sun (Far-Side Noon)',
      targetTimeMs: newMoonMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
    {
      id: 'phase-fq',
      label: 'First Quarter (90° E)',
      subtitle: 'Evening quadrature wrt Sun–Earth line (50% lit)',
      targetTimeMs: fqMoonMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
    {
      id: 'phase-full',
      label: 'Full Moon (180° Anti-Solar)',
      subtitle: 'Opposition wrt Sun–Earth line (Near-Side Noon)',
      targetTimeMs: fullMoonMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
    {
      id: 'phase-tq',
      label: 'Third Quarter (270° W)',
      subtitle: 'Morning quadrature wrt Sun–Earth line (50% lit)',
      targetTimeMs: tqMoonMs,
      category: 'lunar-orbit',
      recommendedView: 'earth-moon',
    },
  ];
  lunarTargets.sort((a, b) => a.targetTimeMs - b.targetTimeMs);

  const helioTargets: WarpTargetOption[] = [
    {
      id: 'earth-season',
      label: nextSeason.lbl,
      subtitle: 'Next cardinal solar declination milestone',
      targetTimeMs: nextSeason.ms,
      category: 'heliocentric',
      recommendedView: 'heliocentric',
    },
    {
      id: 'earth-perihelion',
      label: 'Earth Perihelion (Pe)',
      subtitle: 'Closest to Sun (~0.9833 AU • Max orbital speed)',
      targetTimeMs: perihelionMs,
      category: 'heliocentric',
      recommendedView: 'heliocentric',
    },
    {
      id: 'earth-aphelion',
      label: 'Earth Aphelion (Ap)',
      subtitle: 'Farthest from Sun (~1.0167 AU • Min orbital speed)',
      targetTimeMs: aphelionMs,
      category: 'heliocentric',
      recommendedView: 'heliocentric',
    },
  ];
  helioTargets.sort((a, b) => a.targetTimeMs - b.targetTimeMs);

  return [...lunarTargets, ...helioTargets];
}
