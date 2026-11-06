export type HeatmapMode =
  | 'albedo'
  | 'elevation'
  | 'temperature'
  | 'slope'
  | 'illumination'
  | 'ice'
  | 'dte';

export interface HeatmapConfig {
  id: HeatmapMode;
  label: string;
  shortLabel: string;
  instrument: string;
  unit: string;
  minLabel: string;
  midLabel: string;
  maxLabel: string;
  gradientCss: string;
  description: string;
  plannerInsight: string;
}

export type SiteCategory = 'artemis' | 'clps' | 'isru' | 'historic' | 'custom';

export interface LandingSite {
  id: string;
  name: string;
  subtitle: string;
  category: SiteCategory;
  missionTag: string;
  lat: number; // degrees, -90 to +90
  lon: number; // degrees, -180 to +180 (East positive)
  elevationKm?: number;
  slopeOverrideDeg?: number;
  illuminationOverridePct?: number;
  iceOverrideWtPct?: number;
  geology: string;
  strategicNotes: string;
}

export type AccessCapability =
  | 'UHF / S-Band Surface Relay'
  | 'X / Ka-Band High-Rate Trunk'
  | 'Optical Sub-Meter Recon (0.5m)'
  | 'PSR Ultra-Low-Light (ShadowCam)'
  | 'Thermal IR Radiometry'
  | 'Cislunar PNT / Ranging Beacon';

export interface LunarSatellite {
  id: string;
  name: string;
  agency: string;
  orbitType: string;
  color: string;
  semiMajorAxisKm: number; // from Moon center (R_moon = 1737.4 km)
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number; // Right Ascension of Ascending Node
  argPeriseleneDeg: number; // Argument of Periselene (90° = apolune over South Pole if -90? Wait: sin(u) = sin(omega + nu); if omega = +270° (-90°), nu=0 periselene is at -90° North/South; we will verify exact sign!)
  meanAnomalyEpochDeg: number;
  periseleneAltKm: number;
  aposeleneAltKm: number;
  periodHours: number;
  swathHalfAngleDeg: number; // sensor/comms half-cone angle from nadir, or horizon-limited comm cone
  isRelay: boolean;
  maxDataRateMbps: number;
  bands: string;
  instruments: string[];
  capabilities: AccessCapability[];
  summary: string;
}

export interface SatelliteLiveState {
  satellite: LunarSatellite;
  posCartesian: [number, number, number]; // in Moon radii (R_moon = 1.0 in 3D scene or scaled)
  lat: number;
  lon: number;
  altKm: number;
  speedKmS: number;
  azimuthDeg: number; // from selected site
  elevationDeg: number; // above ideal tangent plane at selected site
  horizonMaskDeg: number; // local terrain obstruction angle at this azimuth
  isVisibleFromSite: boolean; // elevationDeg > max(horizonMaskDeg, 2°)
  slantRangeKm: number;
  instantDataRateMbps: number;
  footprintRadiusKm: number;
}

export interface SatellitePassWindow {
  satelliteId: string;
  satelliteName: string;
  color: string;
  isRelay: boolean;
  aosTimeMs: number;
  losTimeMs: number;
  durationMinutes: number;
  maxElevationDeg: number;
  peakDataRateMbps: number;
  capabilities: AccessCapability[];
}

export type ReadinessStatus = 'GO' | 'CAUTION' | 'NO-GO';

export interface FlightRuleCheck {
  id: string;
  label: string;
  valueText: string;
  status: ReadinessStatus;
  detail: string;
}

export interface SkyBodyHorizontal {
  azimuthDeg: number;
  elevationDeg: number;
  horizonDeg: number;
  isVisible: boolean;
}

export interface SiteEvaluation {
  site: LandingSite;
  timestampMs: number;
  elevationKm: number;
  slopeDeg: number;
  surfaceTempK: number;
  illuminationDutyPct: number;
  waterIceWtPct: number;
  sun: SkyBodyHorizontal & { subLat: number; subLon: number };
  earth: SkyBodyHorizontal & { subLat: number; subLon: number; distanceKm: number };
  horizonProfileDeg: number[]; // 36 bins (every 10° azimuth from 0° North clockwise)
  solarFluxHorizontalWm2: number;
  solarFluxVerticalMastWm2: number;
  activeSatellites: SatelliteLiveState[];
  visibleRelays: SatelliteLiveState[];
  overallStatus: ReadinessStatus;
  readinessScore: number; // 0-100
  flightRules: FlightRuleCheck[];
}

export interface TimelineSample {
  timeMs: number;
  sunVisible: boolean;
  sunElevationDeg: number;
  earthVisible: boolean;
  earthElevationDeg: number;
  tempK: number;
  relayCount: number;
  satVisibility: Record<string, boolean>;
}

export interface OptimalWindowRecommendation {
  startMs: number;
  endMs: number;
  durationHours: number;
  avgSolarFluxWm2: number;
  dteCoveragePct: number;
  relayCoveragePct: number;
  score: number;
  rationale: string;
}

export interface RoverCoords {
  lat: number;
  lon: number;
  label?: string;
}

export interface RoverCheckpoint extends RoverCoords {
  id: string;
  elevationKm?: number;
}

export interface RoverParams {
  presetId: string;
  name: string;
  massKg: number;
  maxInclineDeg: number;
  cruiseSpeedKmh: number;
  batteryCapacityWh: number;
  minReserveSocPct: number;
  avionicsLoadW: number;
  solarPeakW: number;
  useSolarCharging: boolean;
  rollingResistanceCoeff: number;
  drivetrainEfficiency: number;
  regenEfficiency: number;
  includeSubGridRoughness: boolean;
}

export interface RoverPreset {
  id: string;
  name: string;
  agency: string;
  tagline: string;
  params: RoverParams;
}

export interface TraverseBenchmarkRoute {
  id: string;
  name: string;
  subtitle: string;
  start: RoverCoords;
  end: RoverCoords;
  recommendedPresetId: string;
}

export interface DemResolutionInfo {
  tierName: string;
  nsPostingMeters: number;
  ewPostingMeters: number;
  verticalPrecisionMeters: number;
  subGridModelActive: boolean;
  isAdequateForMeterScale: boolean;
  note: string;
}

export interface TraverseWaypoint {
  index: number;
  lat: number;
  lon: number;
  cumDistanceKm: number;
  segmentDistKm: number;
  elevationKm: number;
  slopeDeg: number; // directional + local terrain slope magnitude
  gradeDeg: number; // signed longitudinal grade (+ uphill, - downhill)
  speedKmh: number;
  elapsedHours: number;
  timestampMs: number;
  tractionEnergyWh: number;
  avionicsEnergyWh: number;
  solarHarvestWh: number;
  netEnergyUsedWh: number;
  batterySocPct: number;
  sunVisible: boolean;
  commLinked: boolean; // DTE or Relay overhead
  slopeStatus: ReadinessStatus;
}

export type RoverPickMode = 'none' | 'pick-start' | 'pick-checkpoint' | 'pick-end';

export type RoverWorkflowStep =
  | 'idle'
  | 'rover-setup'
  | 'select-start'
  | 'checkpoints'
  | 'range-explore'
  | 'route-ready'
  | 'animating';

export interface RangeBoundaryPoint {
  lat: number;
  lon: number;
  elevKm: number;
  radiusKm: number;
  blockedBySlope: boolean;
}

export interface CandidateCorridorPath {
  id: string;
  label: string;
  sectorName: string;
  azimuthDeg: number;
  distanceKm: number;
  driveHours: number;
  energyUsedWh: number;
  finalSocPct: number;
  maxSlopeDeg: number;
  endCoords: RoverCoords;
  points: { lat: number; lon: number; elevKm: number; socPct: number }[];
}

export interface ReachablePredefinedTarget {
  id: string;
  name: string;
  tag: string;
  coords: RoverCoords;
  distanceKm: number;
  inRange: boolean;
}

export type CraterClass = 'fresh' | 'mature' | 'degraded';
export type CraterStatus = 'no-go' | 'avoid' | 'endpoint';

export interface CharacterizedCrater {
  id: string;
  lat: number;
  lon: number;
  radiusKm: number;
  depthM: number;
  depthToDiameter: number;
  wallSlopeDeg: number;
  craterClass: CraterClass;
  severity: number; // 0..1
  status: CraterStatus; // endpoint = contains mission start/goal, not avoided
}

export interface CraterRouteStats {
  detected: number;
  noGo: number;
  interiorCrossings: number;
  rimCrossings: number;
  directInteriorCrossings: number | null; // null when direct line was not evaluated against the crater field
  computeMs: number;
}

export interface RoverRangeEnvelope {
  craters: CharacterizedCrater[];
  origin: RoverCoords;
  usableBatteryWh: number;
  nominalFlatRangeKm: number;
  maxReachableRadiusKm: number;
  minReachableRadiusKm: number;
  reachableAreaKm2: number;
  boundaryRing: RangeBoundaryPoint[];
  innerHalfRing: { lat: number; lon: number; elevKm: number }[];
  candidatePaths: CandidateCorridorPath[];
  nearbyTargets: ReachablePredefinedTarget[];
}

export interface RoverTraverseLeg {
  legIndex: number;
  fromLabel: string;
  toLabel: string;
  distanceKm: number;
  driveHours: number;
  energyWh: number;
  maxSlopeDeg: number;
  elevationGainM: number;
  elevationLossM: number;
  startWaypointIdx: number;
  endWaypointIdx: number;
}

export interface RoverTraversePlan {
  craters: CharacterizedCrater[];
  craterStats: CraterRouteStats;
  mode: 'astar' | 'direct';
  start: RoverCoords;
  end: RoverCoords;
  checkpoints?: RoverCheckpoint[];
  legs?: RoverTraverseLeg[];
  geodesicDistanceKm: number;
  totalDistanceKm: number;
  detourPct: number;
  totalDriveHours: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  maxSlopeEncounteredDeg: number;
  avgSpeedKmh: number;
  grossEnergyUsedWh: number;
  solarEnergyHarvestedWh: number;
  netEnergyUsedWh: number;
  specificEnergyWhPerKm: number;
  minBatterySocPct: number;
  finalBatterySocPct: number;
  sunlitFractionPct: number;
  commCoveragePct: number;
  inclineViolationsCount: number;
  feasibilityStatus: ReadinessStatus;
  feasibilityScore: number;
  reasons: string[];
  demInfo: DemResolutionInfo;
  waypoints: TraverseWaypoint[];
  directComparison: {
    distanceKm: number;
    maxSlopeDeg: number;
    netEnergyWh: number;
    minSocPct: number;
    status: ReadinessStatus;
  };
}

export type ViewportViewMode = 'lunar-globe' | 'south-pole' | 'earth-moon' | 'heliocentric';

export interface CelestialSystemState {
  timestampMs: number;
  // Heliocentric Earth parameters (J2000 Ecliptic)
  earthHelioLonDeg: number; // 0..360 ecliptic longitude of Earth around Sun
  sunGeoLonDeg: number; // 0..360 apparent ecliptic longitude of Sun from Earth
  earthMeanAnomalyDeg: number;
  earthSunDistanceAu: number;
  earthSunDistanceKm: number;
  earthOrbitalSpeedKms: number;
  earthObliquityDeg: number; // ~23.439°
  earthGmstDeg: number; // Greenwich Mean Sidereal Time 0..360
  solarDeclinationDeg: number; // -23.44°..+23.44° on Earth
  earthSeasonLabel: string;

  // Geocentric Moon parameters (around Earth)
  moonGeoLonDeg: number; // 0..360 ecliptic longitude
  moonGeoLatDeg: number; // -5.145°..+5.145° ecliptic latitude
  earthMoonDistanceKm: number;
  earthMoonDistanceEarthRadii: number;
  moonOrbitalSpeedKms: number;
  moonMeanAnomalyDeg: number;
  ascendingNodeLonDeg: number; // Omega (0..360)
  perigeeLonDeg: number; // Longitude of perigee (0..360)
  elongationDeg: number; // 0..360 (0 = New, 90 = First Quarter, 180 = Full, 270 = Third Quarter)
  illuminatedFractionPct: number; // 0..100
  lunarAgeDays: number; // 0..29.53
  phaseName: string;
  eclipseGeometryNote: string | null;
}

export interface MissionEpochPreset {
  id: string;
  label: string;
  era: 'past' | 'present' | 'future';
  utcIso: string; // e.g. '1969-07-20T20:17:00Z'
  tag: string;
  description: string;
}

export interface WarpTargetOption {
  id: string;
  label: string;
  subtitle: string;
  targetTimeMs: number;
  category: 'surface' | 'lunar-orbit' | 'heliocentric' | 'satellite';
  recommendedView?: ViewportViewMode;
}

export interface ActiveTimeWarpState {
  startTimeMs: number;
  targetTimeMs: number;
  startedRealMs: number;
  label: string;
  currentRateMult: number;
  warpArrows: number; // 1..6 KSP green arrows
}

export type SunEarthSurfaceMode =
  | 'sun-offset'
  | 'earth-offset'
  | 'dual-elevation';

export interface SunEarthSurfaceSolution {
  lat: number;
  lon: number;
  exactFeasible: boolean;
  sunEarthSeparationDeg: number;
  geometricSunElevDeg: number;
  geometricEarthElevDeg: number;
  deltaLonFromSunDeg: number;
  deltaLonFromEarthDeg: number;
  note?: string;
}




