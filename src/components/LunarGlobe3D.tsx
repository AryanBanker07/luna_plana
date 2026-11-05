import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import {
  cartesianToLatLon,
  latLonToCartesian,
  sampleElevationKm,
  sampleSatelliteOrbitCurve,
} from '../engine/selenography';
import {
  CandidateCorridorPath,
  HeatmapMode,
  LandingSite,
  RoverCoords,
  RoverPickMode,
  RoverRangeEnvelope,
  RoverTraversePlan,
  RoverWorkflowStep,
  SiteEvaluation,
} from '../types/lunar';

const HEATMAP_INDEX: Record<HeatmapMode, number> = {
  albedo: 0,
  elevation: 1,
  temperature: 2,
  slope: 3,
  illumination: 4,
  ice: 5,
  dte: 6,
};

const VERTEX_SHADER = /* glsl */ `
  uniform sampler2D uDemMap;
  uniform float uDisplacementScale;

  varying vec2 vUv;
  varying vec3 vNormalObj;
  varying vec3 vPosObj;
  varying float vDemRaw;

  void main() {
    vUv = uv;
    float dem = texture2D(uDemMap, uv).r;
    vDemRaw = dem;
    vNormalObj = normalize(normal);

    // Center datum around 0.458 (~0 km selenoid)
    float radialOffset = (dem - 0.458) * uDisplacementScale;
    vec3 displaced = position + normalize(position) * radialOffset;
    vPosObj = normalize(position);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uColorMap;
  uniform sampler2D uDemMap;
  uniform int uMode;
  uniform vec3 uSunDir;
  uniform vec3 uEarthDir;
  uniform vec3 uSiteDir;
  uniform vec3 uCompareSiteDir;
  uniform float uHasCompare;
  uniform float uShowGrid;
  uniform float uShowTerminator;
  uniform float uNightBoost;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vNormalObj;
  varying vec3 vPosObj;
  varying float vDemRaw;

  // Hypsometric Elevation Ramp (-9.1 km to +10.8 km)
  vec3 rampElevation(float t) {
    vec3 c0 = vec3(0.09, 0.11, 0.26); // -9.1 km SPA deep indigo
    vec3 c1 = vec3(0.11, 0.35, 0.54); // -4 km basin blue
    vec3 c2 = vec3(0.12, 0.62, 0.45); // 0 km mare emerald-teal
    vec3 c3 = vec3(0.85, 0.64, 0.25); // +4 km highland ochre
    vec3 c4 = vec3(0.79, 0.36, 0.24); // +7.5 km ridge terracotta
    vec3 c5 = vec3(0.98, 0.96, 0.94); // +10.8 km summit ivory
    if (t < 0.24) return mix(c0, c1, t / 0.24);
    if (t < 0.48) return mix(c1, c2, (t - 0.24) / 0.24);
    if (t < 0.72) return mix(c2, c3, (t - 0.48) / 0.24);
    if (t < 0.88) return mix(c3, c4, (t - 0.72) / 0.16);
    return mix(c4, c5, (t - 0.88) / 0.12);
  }

  // Diviner Bolometric Temperature Ramp (25 K to 395 K)
  vec3 rampTemp(float t) {
    vec3 c0 = vec3(0.06, 0.04, 0.18); // 25 K PSR cryo-violet
    vec3 c1 = vec3(0.17, 0.20, 0.58); // 95 K lunar night blue
    vec3 c2 = vec3(0.52, 0.11, 0.44); // 185 K terminator magenta
    vec3 c3 = vec3(0.85, 0.26, 0.18); // 285 K warm crimson
    vec3 c4 = vec3(0.96, 0.62, 0.05); // 355 K solar amber
    vec3 c5 = vec3(1.00, 0.98, 0.78); // 395 K subsolar ivory
    if (t < 0.20) return mix(c0, c1, t / 0.20);
    if (t < 0.44) return mix(c1, c2, (t - 0.20) / 0.24);
    if (t < 0.68) return mix(c2, c3, (t - 0.44) / 0.24);
    if (t < 0.86) return mix(c3, c4, (t - 0.68) / 0.18);
    return mix(c4, c5, (t - 0.86) / 0.14);
  }

  // Slope Hazard Ramp (0° to 32°+)
  vec3 rampSlope(float t) {
    vec3 c0 = vec3(0.03, 0.30, 0.23); // 0° ultra-flat mare
    vec3 c1 = vec3(0.06, 0.72, 0.51); // 6° safe ellipse
    vec3 c2 = vec3(0.64, 0.90, 0.21); // 11° caution
    vec3 c3 = vec3(0.96, 0.62, 0.04); // 18° hazardous rim
    vec3 c4 = vec3(0.94, 0.26, 0.26); // 28° steep scarp
    vec3 c5 = vec3(1.00, 0.82, 0.82); // >32° cliff
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
    if (t < 0.74) return mix(c2, c3, (t - 0.50) / 0.24);
    if (t < 0.92) return mix(c3, c4, (t - 0.74) / 0.18);
    return mix(c4, c5, (t - 0.92) / 0.08);
  }

  // Solar Illumination Duty Cycle Ramp (0% to 90%)
  vec3 rampIllum(float t) {
    vec3 c0 = vec3(0.02, 0.03, 0.06); // 0% PSR dark
    vec3 c1 = vec3(0.11, 0.18, 0.35); // 25% shadowed bench
    vec3 c2 = vec3(0.12, 0.34, 0.82); // 50% diurnal mare/highland
    vec3 c3 = vec3(0.88, 0.50, 0.05); // 72% polar ridge
    vec3 c4 = vec3(0.99, 0.78, 0.16); // 84% high illumination
    vec3 c5 = vec3(1.00, 1.00, 1.00); // >88% Peak of Eternal Light
    if (t < 0.22) return mix(c0, c1, t / 0.22);
    if (t < 0.50) return mix(c1, c2, (t - 0.22) / 0.28);
    if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
    if (t < 0.90) return mix(c3, c4, (t - 0.75) / 0.15);
    return mix(c4, c5, (t - 0.90) / 0.10);
  }

  // Water-Ice Volatiles Ramp (0 to 5.5 wt%)
  vec3 rampIce(float t) {
    vec3 c0 = vec3(0.09, 0.10, 0.13); // 0% desiccated regolith
    vec3 c1 = vec3(0.13, 0.18, 0.26); // 0.8% trace H
    vec3 c2 = vec3(0.05, 0.45, 0.56); // 2.2% polar epithermal H
    vec3 c3 = vec3(0.13, 0.83, 0.93); // 4.0% cold-trap ice
    vec3 c4 = vec3(0.93, 0.99, 1.00); // 5.5% high-grade PSR deposit
    if (t < 0.25) return mix(c0, c1, t / 0.25);
    if (t < 0.58) return mix(c1, c2, (t - 0.25) / 0.33);
    if (t < 0.84) return mix(c2, c3, (t - 0.58) / 0.26);
    return mix(c3, c4, (t - 0.84) / 0.16);
  }

  // Direct-to-Earth Visibility Ramp
  vec3 rampDte(float earthDot, float localProminence) {
    float effElevDeg = asin(clamp(earthDot, -1.0, 1.0)) * 57.29578 + localProminence * 3.5;
    if (effElevDeg < -3.0) {
      float deep = clamp((-effElevDeg - 3.0) / 55.0, 0.0, 1.0);
      return mix(vec3(0.32, 0.10, 0.13), vec3(0.12, 0.07, 0.10), deep);
    }
    if (effElevDeg < 5.5) {
      // Optical Libration Fringe Zone (-3° to +5.5°)
      float f = (effElevDeg + 3.0) / 8.5;
      return mix(vec3(0.62, 0.14, 0.14), vec3(0.96, 0.62, 0.05), f);
    }
    float clearT = clamp((effElevDeg - 5.5) / 70.0, 0.0, 1.0);
    return mix(vec3(0.02, 0.52, 0.78), vec3(0.16, 0.83, 0.59), clearT);
  }

  void main() {
    vec3 n = normalize(vPosObj);
    float latRad = asin(clamp(n.y, -1.0, 1.0));
    float lonRad = atan(-n.z, n.x);
    float absLatDeg = abs(latRad) * 57.29578;

    // Sample LROC albedo & multi-scale LOLA DEM gradients
    vec3 albedoTex = texture2D(uColorMap, vUv).rgb;
    float demC = texture2D(uDemMap, vUv).r;

    vec2 texel = vec2(1.0 / 1024.0, 1.0 / 512.0);
    float latScale = max(0.12, cos(latRad));
    vec2 stepUv = vec2(texel.x / latScale, texel.y);

    float demE = texture2D(uDemMap, vec2(fract(vUv.x + stepUv.x), vUv.y)).r;
    float demW = texture2D(uDemMap, vec2(fract(vUv.x - stepUv.x), vUv.y)).r;
    float demN = texture2D(uDemMap, vec2(vUv.x, clamp(vUv.y + stepUv.y, 0.001, 0.999))).r;
    float demS = texture2D(uDemMap, vec2(vUv.x, clamp(vUv.y - stepUv.y, 0.001, 0.999))).r;

    // Wider neighborhood average (~35 km) to detect local crater bowls vs sunlit ridges
    vec2 wideUv = stepUv * 4.5;
    float demAvg = 0.25 * (
      texture2D(uDemMap, vec2(fract(vUv.x + wideUv.x), vUv.y)).r +
      texture2D(uDemMap, vec2(fract(vUv.x - wideUv.x), vUv.y)).r +
      texture2D(uDemMap, vec2(vUv.x, clamp(vUv.y + wideUv.y, 0.001, 0.999))).r +
      texture2D(uDemMap, vec2(vUv.x, clamp(vUv.y - wideUv.y, 0.001, 0.999))).r
    );
    float localProminence = (demC - demAvg) * 14.0; // >0 = ridge/rim, <0 = crater bowl

    // Tangent basis for bump normal
    vec3 east = normalize(vec3(-sin(lonRad), 0.0, -cos(lonRad)));
    vec3 north = normalize(cross(east, n));
    float dHdE = (demE - demW) * 11.5;
    float dHdN = (demN - demS) * 11.5;
    vec3 bumpedNormal = normalize(n - east * dHdE - north * dHdN);

    float gradMag = length(vec2(demE - demW, demN - demS)) * 26.0;
    float albedoDetail = dot(albedoTex, vec3(0.333));
    float regolithHillshade = clamp(0.55 + 0.45 * dot(bumpedNormal, normalize(uSunDir + n * 0.45)), 0.25, 1.15);

    // Real-time Solar & Earth illumination geometry
    float sunDot = dot(bumpedNormal, normalize(uSunDir));
    float sunMacro = dot(n, normalize(uSunDir));
    float earthDot = dot(n, normalize(uEarthDir));

    // Smooth solar terminator
    float sunlit = smoothstep(-0.04, 0.07, sunDot) * smoothstep(-0.08, 0.03, sunMacro);
    // Lommel-Seeliger lunar scattering feel (flatter limb brightness than pure Lambert)
    float lommel = sunlit * mix(max(0.0, sunDot), pow(max(0.0, sunDot), 0.62), 0.65);
    float earthshine = max(0.0, earthDot) * 0.035;

    vec3 baseColor = albedoTex;

    if (uMode == 0) {
      // LROC True Albedo + Solar Terminator + Night-boost option
      float minLight = mix(0.025 + earthshine, 0.24, uNightBoost);
      float lightLevel = max(minLight, lommel * 1.18);
      // Warm solar tint on dayside, cool earthshine slate on nightside
      vec3 litTint = mix(vec3(0.72, 0.80, 0.96), vec3(1.03, 0.99, 0.94), sunlit);
      baseColor = pow(albedoTex, vec3(0.92)) * lightLevel * litTint;
    } else if (uMode == 1) {
      // Topographic Elevation (LOLA DEM)
      vec3 heat = rampElevation(clamp(demC, 0.0, 1.0));
      // Subtle contour lines every ~1.5 km
      float contour = abs(fract(demC * 13.0) - 0.5);
      float contourLine = 1.0 - smoothstep(0.0, 0.055, contour);
      baseColor = heat * (0.72 + 0.36 * albedoDetail) * regolithHillshade;
      baseColor = mix(baseColor, baseColor * 1.25, contourLine * 0.18);
      if (uShowTerminator > 0.5) {
        baseColor *= mix(0.42, 1.05, sunlit);
      }
    } else if (uMode == 2) {
      // Diviner Surface Temperature (K)
      float polarColdTrap = smoothstep(79.0, 88.5, absLatDeg) * smoothstep(0.05, -0.22, localProminence);
      float dayTempNorm = pow(max(0.0, sunDot), 0.28);
      float nightTempNorm = 0.16 - 0.08 * smoothstep(0.0, -0.7, sunMacro);
      float tempNorm = mix(nightTempNorm, 0.24 + 0.76 * dayTempNorm, sunlit);
      tempNorm = mix(tempNorm, 0.02, clamp(polarColdTrap * 1.35, 0.0, 0.96));
      vec3 heat = rampTemp(clamp(tempNorm, 0.0, 1.0));
      baseColor = heat * (0.82 + 0.24 * albedoDetail);
    } else if (uMode == 3) {
      // Terrain Slope & Hazard
      float albedoRough = abs(albedoDetail - 0.48) * 0.22;
      float slopeNorm = clamp(gradMag * 0.88 + abs(localProminence) * 0.35 + albedoRough, 0.0, 1.0);
      vec3 heat = rampSlope(slopeNorm);
      baseColor = heat * (0.80 + 0.26 * albedoDetail);
      if (uShowTerminator > 0.5) {
        baseColor *= mix(0.48, 1.04, sunlit);
      }
    } else if (uMode == 4) {
      // Solar Illumination Duty Cycle (%)
      float polarFactor = smoothstep(76.0, 88.5, absLatDeg);
      float polarDuty = clamp(0.50 + localProminence * 1.35 + (demC - 0.46) * 0.55, 0.0, 0.98);
      float dutyNorm = mix(0.50 + localProminence * 0.12, polarDuty, polarFactor);
      vec3 heat = rampIllum(clamp(dutyNorm, 0.0, 1.0));
      baseColor = heat * (0.84 + 0.22 * albedoDetail);
    } else if (uMode == 5) {
      // Water-Ice Equivalent (wt% H2O)
      float polarMask = smoothstep(77.5, 87.5, absLatDeg);
      float trapDepth = smoothstep(0.12, -0.32, localProminence) * 0.75 + smoothstep(0.52, 0.30, demC) * 0.45;
      float iceNorm = clamp(polarMask * (0.18 + trapDepth * 0.95), 0.0, 1.0);
      vec3 heat = rampIce(iceNorm);
      baseColor = mix(albedoTex * 0.32, heat, clamp(iceNorm * 1.35 + 0.25, 0.0, 1.0));
      if (uShowTerminator > 0.5) {
        baseColor *= mix(0.55, 1.05, sunlit);
      }
    } else if (uMode == 6) {
      // Direct-to-Earth (DTE) Comm Visibility
      vec3 heat = rampDte(earthDot, localProminence);
      baseColor = heat * (0.76 + 0.32 * albedoDetail);
      if (uShowTerminator > 0.5) {
        baseColor *= mix(0.52, 1.05, sunlit);
      }
    }

    // Optional Selenographic Graticule Grid (every 15° lat/lon + Polar Artemis Circles)
    if (uShowGrid > 0.5) {
      float latDeg = latRad * 57.29578;
      float lonDeg = lonRad * 57.29578;

      float latStep = abs(fract((latDeg + 90.0) / 15.0 + 0.5) - 0.5);
      float lonStep = abs(fract((lonDeg + 180.0) / 15.0 + 0.5) - 0.5);
      float dLat = fwidth(latDeg / 15.0) * 1.15;
      float dLon = fwidth(lonDeg / 15.0) * 1.15;

      float gridLat = 1.0 - smoothstep(0.0, max(0.004, dLat), latStep);
      // Suppress dense longitude lines right inside 88.5° pole cap
      float gridLon = (absLatDeg < 88.0) ? (1.0 - smoothstep(0.0, max(0.004, dLon), lonStep)) : 0.0;
      float grid = max(gridLat, gridLon);

      // Highlight Equator (0°), Prime Meridian (0°), and 85°S Artemis Polar Ring
      float isPrimeOrEq = (abs(latDeg) < 0.45 || abs(lonDeg) < 0.45) ? 1.0 : 0.0;
      float isArtemisRing = (abs(latDeg + 85.0) < 0.32) ? 1.0 : 0.0;

      vec3 gridCol = isArtemisRing > 0.5
        ? vec3(0.96, 0.62, 0.05)
        : (isPrimeOrEq > 0.5 ? vec3(0.22, 0.74, 0.97) : vec3(0.82, 0.88, 0.96));
      float gridAlpha = isArtemisRing > 0.5 ? 0.55 : (isPrimeOrEq > 0.5 ? 0.34 : 0.14);
      baseColor = mix(baseColor, gridCol, clamp(grid + isArtemisRing * 0.7, 0.0, 1.0) * gridAlpha);
    }

    // Animated Radar Ring around Selected Primary Landing Site
    float siteAng = acos(clamp(dot(n, normalize(uSiteDir)), -1.0, 1.0));
    float ringPulse = mod(uTime * 0.022, 0.045);
    float outerPulse = (1.0 - smoothstep(0.0, 0.0045, abs(siteAng - ringPulse))) * (1.0 - ringPulse / 0.045);
    float fixedRing = 1.0 - smoothstep(0.0, 0.0032, abs(siteAng - 0.014));
    baseColor = mix(baseColor, vec3(0.98, 0.73, 0.14), clamp(fixedRing * 0.85 + outerPulse * 0.65, 0.0, 1.0));

    // Secondary Compare Site Ring (Cyan)
    if (uHasCompare > 0.5) {
      float cmpAng = acos(clamp(dot(n, normalize(uCompareSiteDir)), -1.0, 1.0));
      float cmpRing = 1.0 - smoothstep(0.0, 0.0032, abs(cmpAng - 0.014));
      baseColor = mix(baseColor, vec3(0.22, 0.74, 0.97), cmpRing * 0.85);
    }

    // Subtle atmospheric-free Fresnel rim sheen for crisp 3D silhouette against deep space
    gl_FragColor = vec4(baseColor, 1.0);
  }
`;

export type CameraPreset =
  | 'free'
  | 'south-pole'
  | 'north-pole'
  | 'nearside'
  | 'farside'
  | 'site'
  | 'rover-locality'
  | 'rover-route';

interface LunarGlobe3DProps {
  heatmapMode: HeatmapMode;
  evaluation: SiteEvaluation;
  compareSite: LandingSite | null;
  curatedSites: LandingSite[];
  selectedSatelliteId: string | null;
  showOrbits: boolean;
  showSiteLabels: boolean;
  showVectors: boolean;
  showGrid: boolean;
  showTerminator: boolean;
  nightBoost: boolean;
  trueOrbitScale: boolean;
  terrainExaggeration: number; // 0 to 3.5
  cameraPreset: CameraPreset;
  cameraPresetNonce: number;
  roverWorkflowStep?: RoverWorkflowStep;
  roverStartCoords?: RoverCoords | null;
  roverCheckpoints?: RoverCoords[];
  roverRangeEnvelope?: RoverRangeEnvelope | null;
  roverPlan?: RoverTraversePlan | null;
  roverPickMode?: RoverPickMode;
  roverAnimProgress?: number; // 0.0 to 1.0 continuous
  isRoverAnimating?: boolean;
  roverChaseCam?: boolean;
  onSelectSite: (site: LandingSite) => void;
  onSelectCustomPoint: (lat: number, lon: number) => void;
  onRoverPickPoint?: (lat: number, lon: number, label?: string) => void;
  onSelectCandidatePath?: (path: CandidateCorridorPath) => void;
  onSelectSatellite: (satId: string) => void;
  onHoverCoords: (coords: { lat: number; lon: number; elevKm: number } | null) => void;
}

interface SceneContentProps extends LunarGlobe3DProps {}

const MoonSceneContent: React.FC<SceneContentProps> = ({
  heatmapMode,
  evaluation,
  compareSite,
  curatedSites,
  selectedSatelliteId,
  showOrbits,
  showSiteLabels,
  showVectors,
  showGrid,
  showTerminator,
  nightBoost,
  trueOrbitScale,
  terrainExaggeration,
  cameraPreset,
  cameraPresetNonce,
  roverWorkflowStep = 'idle',
  roverStartCoords = null,
  roverCheckpoints = [],
  roverRangeEnvelope = null,
  roverPlan,
  roverPickMode = 'none',
  roverAnimProgress = 0,
  isRoverAnimating = false,
  roverChaseCam = false,
  onSelectSite,
  onSelectCustomPoint,
  onRoverPickPoint,
  onSelectCandidatePath,
  onSelectSatellite,
  onHoverCoords,
}) => {
  const [colorMap, demMap] = useLoader(THREE.TextureLoader, [
    '/textures/lroc_color.jpg',
    '/textures/lola_dem.jpg',
  ]);

  useEffect(() => {
    colorMap.wrapS = THREE.RepeatWrapping;
    colorMap.wrapT = THREE.ClampToEdgeWrapping;
    colorMap.anisotropy = 8;
    demMap.wrapS = THREE.RepeatWrapping;
    demMap.wrapT = THREE.ClampToEdgeWrapping;
  }, [colorMap, demMap]);

  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const controlsRef = useRef<any>(null);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const userGrabbedDuringAnim = useRef<boolean>(false);
  const { camera } = useThree();

  // Smooth camera transition target
  const flyTargetCamPos = useRef<THREE.Vector3 | null>(null);

  const dispScale = terrainExaggeration * 0.022;

  useEffect(() => {
    if (isRoverAnimating && roverChaseCam) {
      userGrabbedDuringAnim.current = false;
    }
  }, [isRoverAnimating, roverChaseCam]);

  // Trigger smooth camera fly-to when preset or locality changes
  useEffect(() => {
    if (cameraPreset === 'free') return;
    let targetLat = evaluation.site.lat;
    let targetLon = evaluation.site.lon;
    let dist = 2.55;

    if (cameraPreset === 'south-pole') {
      targetLat = -88.5;
      targetLon = 0;
      dist = 2.25;
    } else if (cameraPreset === 'north-pole') {
      targetLat = 88.5;
      targetLon = 0;
      dist = 2.35;
    } else if (cameraPreset === 'nearside') {
      targetLat = 8;
      targetLon = 0;
      dist = 2.85;
    } else if (cameraPreset === 'farside') {
      targetLat = -12;
      targetLon = 180;
      dist = 2.85;
    } else if (cameraPreset === 'site') {
      targetLat = evaluation.site.lat;
      targetLon = evaluation.site.lon;
      dist = Math.abs(targetLat) > 78 ? 2.15 : 2.45;
    } else if (cameraPreset === 'rover-locality') {
      const orig = roverStartCoords || roverRangeEnvelope?.origin || evaluation.site;
      targetLat = orig.lat;
      targetLon = orig.lon;
      const radiusKm = roverRangeEnvelope?.maxReachableRadiusKm ?? 16;
      // Zoom right into the local operational neighborhood around Start [A]
      dist = Math.max(1.068, Math.min(1.85, 1.052 + (radiusKm / 1737.4) * 3.8));
    } else if (cameraPreset === 'rover-route' && roverPlan && roverPlan.waypoints.length > 0) {
      const mid = roverPlan.waypoints[Math.floor(roverPlan.waypoints.length / 2)];
      targetLat = mid.lat;
      targetLon = mid.lon;
      dist = Math.max(1.075, Math.min(2.25, 1.058 + (roverPlan.geodesicDistanceKm / 1737.4) * 3.1));
    }

    const clampedLat = Math.max(-89.7, Math.min(89.7, targetLat));
    const [cx, cy, cz] = latLonToCartesian(clampedLat, targetLon, dist);
    flyTargetCamPos.current = new THREE.Vector3(cx, cy, cz);
  }, [
    cameraPreset,
    cameraPresetNonce,
    evaluation.site.id,
    roverStartCoords?.lat,
    roverStartCoords?.lon,
    roverRangeEnvelope?.maxReachableRadiusKm,
    roverPlan?.start.lat,
    roverPlan?.end.lat,
  ]);

  const uniforms = useMemo(
    () => ({
      uColorMap: { value: colorMap },
      uDemMap: { value: demMap },
      uDisplacementScale: { value: dispScale },
      uMode: { value: HEATMAP_INDEX[heatmapMode] },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uEarthDir: { value: new THREE.Vector3(1, 0, 0) },
      uSiteDir: { value: new THREE.Vector3(0, -1, 0) },
      uCompareSiteDir: { value: new THREE.Vector3(0, 1, 0) },
      uHasCompare: { value: 0 },
      uShowGrid: { value: 1 },
      uShowTerminator: { value: 1 },
      uNightBoost: { value: 0 },
      uTime: { value: 0 },
    }),
    [colorMap, demMap]
  );

  // Sync shader uniforms every render/prop update
  const sunVec = useMemo(
    () =>
      new THREE.Vector3(
        ...latLonToCartesian(evaluation.sun.subLat, evaluation.sun.subLon, 1)
      ).normalize(),
    [evaluation.sun.subLat, evaluation.sun.subLon]
  );

  const earthVec = useMemo(
    () =>
      new THREE.Vector3(
        ...latLonToCartesian(evaluation.earth.subLat, evaluation.earth.subLon, 1)
      ).normalize(),
    [evaluation.earth.subLat, evaluation.earth.subLon]
  );

  const siteRadialOffset =
    1.0 + ((evaluation.elevationKm + 9.12) / 19.88 - 0.458) * dispScale + 0.006;

  const sitePos3D = useMemo(
    () =>
      latLonToCartesian(
        evaluation.site.lat,
        evaluation.site.lon,
        siteRadialOffset
      ),
    [evaluation.site.lat, evaluation.site.lon, siteRadialOffset]
  );

  const comparePos3D = useMemo(() => {
    if (!compareSite) return null;
    const elev = compareSite.elevationKm ?? sampleElevationKm(compareSite.lat, compareSite.lon);
    const r = 1.0 + ((elev + 9.12) / 19.88 - 0.458) * dispScale + 0.006;
    return latLonToCartesian(compareSite.lat, compareSite.lon, r);
  }, [compareSite, dispScale]);

  useFrame((state, delta) => {
    if (shaderRef.current) {
      const u = shaderRef.current.uniforms;
      u.uDisplacementScale.value = dispScale;
      u.uMode.value = HEATMAP_INDEX[heatmapMode];
      u.uSunDir.value.copy(sunVec);
      u.uEarthDir.value.copy(earthVec);
      u.uSiteDir.value.set(...sitePos3D).normalize();
      if (comparePos3D) {
        u.uCompareSiteDir.value.set(...comparePos3D).normalize();
        u.uHasCompare.value = 1.0;
      } else {
        u.uHasCompare.value = 0.0;
      }
      u.uShowGrid.value = showGrid ? 1.0 : 0.0;
      u.uShowTerminator.value = showTerminator ? 1.0 : 0.0;
      u.uNightBoost.value = nightBoost ? 1.0 : 0.0;
      u.uTime.value = state.clock.elapsedTime;
    }

    // Adaptive fine-grained rotation speed when zoomed closely into a locality
    if (controlsRef.current) {
      const camDist = camera.position.length();
      controlsRef.current.rotateSpeed = Math.max(
        0.055,
        Math.min(0.65, (camDist - 1.0) * 0.62)
      );
    }

    // Step 6: Optional live Chase Camera tracking behind/above moving rover
    if (
      roverChaseCam &&
      isRoverAnimating &&
      !userGrabbedDuringAnim.current &&
      roverPlan &&
      roverPlan.waypoints.length >= 2
    ) {
      const wps = roverPlan.waypoints;
      const exact = Math.max(0, Math.min(1, roverAnimProgress)) * (wps.length - 1);
      const i0 = Math.floor(exact);
      const i1 = Math.min(wps.length - 1, i0 + 1);
      const frac = exact - i0;
      const lat = wps[i0].lat + (wps[i1].lat - wps[i0].lat) * frac;
      const lon = wps[i0].lon + (wps[i1].lon - wps[i0].lon) * frac;
      const clampedLat = Math.max(-89.7, Math.min(89.7, lat));
      const chaseDist = Math.max(
        1.062,
        Math.min(1.36, 1.052 + (roverPlan.geodesicDistanceKm / 1737.4) * 1.85)
      );
      const [cx, cy, cz] = latLonToCartesian(clampedLat, lon, chaseDist);
      const targetVec = new THREE.Vector3(cx, cy, cz);
      camera.position.lerp(targetVec, Math.min(1, delta * 3.8));
      if (controlsRef.current) {
        controlsRef.current.target.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, delta * 6));
        controlsRef.current.update();
      }
      flyTargetCamPos.current = null;
    } else if (flyTargetCamPos.current) {
      // Smooth camera fly-to interpolation
      camera.position.lerp(flyTargetCamPos.current, Math.min(1, delta * 5.2));
      if (controlsRef.current) {
        controlsRef.current.target.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, delta * 6));
        controlsRef.current.update();
      }
      if (camera.position.distanceTo(flyTargetCamPos.current) < 0.012) {
        flyTargetCamPos.current = null;
      }
    }
  });

  // Precompute orbit curves (re-evaluated every ~15 min of sim time or scale toggle)
  const orbitBucket = Math.floor(evaluation.timestampMs / (15 * 60 * 1000));
  const orbitCurves = useMemo(() => {
    return evaluation.activeSatellites.map((st) => ({
      sat: st.satellite,
      points: sampleSatelliteOrbitCurve(
        st.satellite,
        evaluation.timestampMs,
        128,
        trueOrbitScale
      ),
    }));
  }, [orbitBucket, trueOrbitScale]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    // Cancel camera fly animation if user grabs globe
    flyTargetCamPos.current = null;
    if (isRoverAnimating) {
      userGrabbedDuringAnim.current = true;
    }
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!pointerDownPos.current) return;
    const dist = Math.hypot(
      e.clientX - pointerDownPos.current.x,
      e.clientY - pointerDownPos.current.y
    );
    pointerDownPos.current = null;
    if (dist < 5) {
      e.stopPropagation();
      const pt = e.point;
      const { lat, lon } = cartesianToLatLon(pt.x, pt.y, pt.z);
      if (roverPickMode !== 'none' && onRoverPickPoint) {
        onRoverPickPoint(Number(lat.toFixed(3)), Number(lon.toFixed(3)));
      } else {
        onSelectCustomPoint(Number(lat.toFixed(2)), Number(lon.toFixed(2)));
      }
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const pt = e.point;
    const { lat, lon } = cartesianToLatLon(pt.x, pt.y, pt.z);
    const elevKm = Number(sampleElevationKm(lat, lon).toFixed(2));
    onHoverCoords({
      lat: Number(lat.toFixed(2)),
      lon: Number(lon.toFixed(2)),
      elevKm,
    });
  };

  // Sun & Earth LOS vector endpoints from selected landing site
  const sunVectorEnd: [number, number, number] = [
    sitePos3D[0] + sunVec.x * 0.95,
    sitePos3D[1] + sunVec.y * 0.95,
    sitePos3D[2] + sunVec.z * 0.95,
  ];

  const earthVectorEnd: [number, number, number] = [
    sitePos3D[0] + earthVec.x * 0.95,
    sitePos3D[1] + earthVec.y * 0.95,
    sitePos3D[2] + earthVec.z * 0.95,
  ];

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[sunVec.x * 12, sunVec.y * 12, sunVec.z * 12]}
        intensity={1.6}
      />

      <Stars
        radius={85}
        depth={45}
        count={3600}
        factor={3.2}
        saturation={0.15}
        fade
        speed={0.25}
      />

      {/* Distant Sun & Earth Directional Beacons on Celestial Sphere */}
      <group position={[sunVec.x * 16, sunVec.y * 16, sunVec.z * 16]}>
        <mesh>
          <sphereGeometry args={[0.28, 24, 24]} />
          <meshBasicMaterial color="#fde047" />
        </mesh>
        <Html center distanceFactor={24} zIndexRange={[1, 0]}>
          <div className="pointer-events-none px-1.5 py-0.5 rounded bg-[#f59e0b]/20 border border-[#f59e0b]/50 text-[10px] font-mono-tech text-[#fde047] whitespace-nowrap">
            ☉ SOL
          </div>
        </Html>
      </group>

      <group position={[earthVec.x * 14, earthVec.y * 14, earthVec.z * 14]}>
        <mesh>
          <sphereGeometry args={[0.24, 24, 24]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
        <Html center distanceFactor={22} zIndexRange={[1, 0]}>
          <div className="pointer-events-none px-1.5 py-0.5 rounded bg-[#38bdf8]/20 border border-[#38bdf8]/50 text-[10px] font-mono-tech text-[#7dd3fc] whitespace-nowrap">
            ⊕ TERRA (DTE)
          </div>
        </Html>
      </group>

      {/* Primary High-Resolution 3D Moon Mesh */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerOut={() => onHoverCoords(null)}
      >
        <sphereGeometry args={[1, 256, 128]} />
        <shaderMaterial
          ref={shaderRef}
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          uniforms={uniforms}
        />
      </mesh>

      {/* Subtle Outer Limb Halo */}
      <mesh scale={[1.018, 1.018, 1.018]}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshBasicMaterial
          color={heatmapMode === 'albedo' ? '#64748b' : '#38bdf8'}
          transparent
          opacity={0.05}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Curated Landing Site Beacons */}
      {curatedSites.map((s) => {
        const isSelected = s.id === evaluation.site.id;
        const isCompare = compareSite?.id === s.id;
        const elev = s.elevationKm ?? sampleElevationKm(s.lat, s.lon);
        const r = 1.0 + ((elev + 9.12) / 19.88 - 0.458) * dispScale + 0.008;
        const pos = latLonToCartesian(s.lat, s.lon, r);
        const handleSiteClick = (ev: any) => {
          ev.stopPropagation();
          if (roverPickMode !== 'none' && onRoverPickPoint) {
            onRoverPickPoint(s.lat, s.lon, s.name.split(' (')[0]);
          } else {
            onSelectSite(s);
          }
        };

        return (
          <group key={s.id} position={pos}>
            <mesh onClick={handleSiteClick}>
              <sphereGeometry args={[isSelected ? 0.015 : 0.009, 16, 16]} />
              <meshBasicMaterial
                color={
                  isSelected
                    ? '#fbbf24'
                    : isCompare
                    ? '#38bdf8'
                    : s.category === 'artemis'
                    ? '#f59e0b'
                    : s.category === 'isru'
                    ? '#22d3ee'
                    : '#e2e8f0'
                }
              />
            </mesh>
            {(showSiteLabels || isSelected || isCompare) && (
              <Html
                position={[0, 0.024, 0]}
                center
                occlude={false}
                zIndexRange={[10, 0]}
              >
                <button
                  type="button"
                  onClick={handleSiteClick}
                  className={`hud-btn px-1.5 py-0.5 rounded text-[10px] font-mono-tech whitespace-nowrap border backdrop-blur-md cursor-pointer ${
                    isSelected
                      ? 'bg-[#f59e0b]/90 text-[#05070b] font-semibold border-[#fde68a] shadow-lg'
                      : isCompare
                      ? 'bg-[#38bdf8]/90 text-[#05070b] font-semibold border-[#bae6fd]'
                      : 'bg-[#090d16]/75 text-slate-200/90 border-white/15 hover:border-[#f59e0b]/60 hover:text-white'
                  }`}
                >
                  {isSelected ? '◈ ' : isCompare ? '◇ ' : ''}
                  {s.name.split(' (')[0]}
                </button>
              </Html>
            )}
          </group>
        );
      })}

      {/* Custom Clicked Site Beacon (when user clicked an arbitrary coordinate) */}
      {evaluation.site.category === 'custom' && (
        <group position={sitePos3D}>
          <mesh>
            <sphereGeometry args={[0.018, 16, 16]} />
            <meshBasicMaterial color="#fbbf24" />
          </mesh>
          <Html position={[0, 0.032, 0]} center zIndexRange={[12, 0]}>
            <div className="px-2 py-0.5 rounded bg-[#f59e0b] text-[#05070b] font-mono-tech font-semibold text-[10px] border border-[#fef08a] whitespace-nowrap shadow-lg">
              ◈ {evaluation.site.name}
            </div>
          </Html>
        </group>
      )}

      {/* Line-of-Sight Laser Vectors from Selected Landing Site */}
      {showVectors && (
        <>
          {/* Sun LOS Ray */}
          <Line
            points={[sitePos3D, sunVectorEnd]}
            color={evaluation.sun.isVisible ? '#fbbf24' : '#ef4444'}
            lineWidth={evaluation.sun.isVisible ? 2.2 : 1.3}
            dashed={!evaluation.sun.isVisible}
            dashSize={0.04}
            gapSize={0.03}
          />
          <Html position={sunVectorEnd} center zIndexRange={[5, 0]}>
            <div
              className={`pointer-events-none px-1.5 py-0.5 rounded text-[9px] font-mono-tech border whitespace-nowrap ${
                evaluation.sun.isVisible
                  ? 'bg-[#f59e0b]/20 text-[#fde68a] border-[#f59e0b]/50'
                  : 'bg-[#ef4444]/20 text-[#fca5a5] border-[#ef4444]/50'
              }`}
            >
              ☉ {evaluation.sun.isVisible ? `SUN +${evaluation.sun.elevationDeg}°` : 'SUN BLOCKED'}
            </div>
          </Html>

          {/* Earth DTE LOS Ray */}
          <Line
            points={[sitePos3D, earthVectorEnd]}
            color={evaluation.earth.isVisible ? '#38bdf8' : '#ef4444'}
            lineWidth={evaluation.earth.isVisible ? 2.2 : 1.3}
            dashed={!evaluation.earth.isVisible}
            dashSize={0.04}
            gapSize={0.03}
          />
          <Html position={earthVectorEnd} center zIndexRange={[5, 0]}>
            <div
              className={`pointer-events-none px-1.5 py-0.5 rounded text-[9px] font-mono-tech border whitespace-nowrap ${
                evaluation.earth.isVisible
                  ? 'bg-[#38bdf8]/20 text-[#bae6fd] border-[#38bdf8]/50'
                  : 'bg-[#ef4444]/20 text-[#fca5a5] border-[#ef4444]/50'
              }`}
            >
              ⊕ {evaluation.earth.isVisible ? `DTE +${evaluation.earth.elevationDeg}°` : 'DTE OCCULTED'}
            </div>
          </Html>
        </>
      )}

      {/* Active Cislunar Constellation Orbits, Spacecraft & Crosslink Cones */}
      {showOrbits &&
        orbitCurves.map(({ sat, points }) => {
          const isFocus = selectedSatelliteId === sat.id;
          return (
            <Line
              key={`orbit-${sat.id}`}
              points={points}
              color={sat.color}
              lineWidth={isFocus ? 2.4 : 1.1}
              transparent
              opacity={isFocus ? 0.92 : selectedSatelliteId ? 0.24 : 0.48}
            />
          );
        })}

      {showOrbits &&
        evaluation.activeSatellites.map((st) => {
          const { satellite: sat, posCartesian, isVisibleFromSite } = st;
          const isFocus = selectedSatelliteId === sat.id;
          const nadirSurf = latLonToCartesian(st.lat, st.lon, 1.005);

          return (
            <group key={`sat-${sat.id}`}>
              {/* Active Crosslink Beam from Landing Site to Visible Orbiter */}
              {showVectors && isVisibleFromSite && (
                <Line
                  points={[sitePos3D, posCartesian]}
                  color={sat.color}
                  lineWidth={isFocus ? 2.2 : 1.35}
                  dashed
                  dashSize={0.035}
                  gapSize={0.025}
                />
              )}

              {/* Nadir Sub-Satellite Track Drop Line when inspected */}
              {isFocus && (
                <Line
                  points={[nadirSurf, posCartesian]}
                  color={sat.color}
                  lineWidth={1.2}
                  transparent
                  opacity={0.65}
                />
              )}

              {/* Spacecraft Bus + Solar Wings */}
              <group
                position={posCartesian}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelectSatellite(sat.id);
                }}
              >
                <mesh>
                  <octahedronGeometry args={[isFocus ? 0.032 : 0.022, 0]} />
                  <meshBasicMaterial color={sat.color} />
                </mesh>
                {/* Solar Array Crossbar */}
                <mesh rotation={[0, 0, Math.PI / 4]}>
                  <boxGeometry args={[isFocus ? 0.11 : 0.075, 0.008, 0.018]} />
                  <meshBasicMaterial color={isFocus ? '#fef08a' : sat.color} />
                </mesh>

                <Html position={[0, 0.045, 0]} center zIndexRange={[8, 0]}>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelectSatellite(sat.id);
                    }}
                    className={`hud-btn px-1.5 py-0.5 rounded text-[10px] font-mono-tech whitespace-nowrap border cursor-pointer ${
                      isFocus
                        ? 'bg-slate-900/95 text-white border-white/60 shadow-lg font-semibold'
                        : isVisibleFromSite
                        ? 'bg-[#090e18]/85 text-emerald-300 border-emerald-500/40 hover:border-white/50'
                        : 'bg-[#090e18]/70 text-slate-400 border-white/10 hover:text-slate-200'
                    }`}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                      style={{ backgroundColor: sat.color }}
                    />
                    {sat.name.split(' (')[0].split(' Relay')[0]}
                    {isVisibleFromSite ? ` • +${st.elevationDeg}°` : ''}
                  </button>
                </Html>
              </group>
            </group>
          );
        })}

      {/* 3D ROVER MISSION WORKFLOW: START [A], OPERATIONAL RANGE, POSSIBLE PATHS & ANIMATED ROVER */}
      {roverWorkflowStep !== 'idle' &&
        roverWorkflowStep !== 'rover-setup' &&
        (() => {
          const liftR = (elevKm: number, extra = 0.0042) =>
            1.0 + ((elevKm + 9.12) / 19.88 - 0.458) * dispScale + extra;

          const startCoord =
            roverStartCoords || roverRangeEnvelope?.origin || roverPlan?.start || null;
          const startElev = startCoord
            ? sampleElevationKm(startCoord.lat, startCoord.lon)
            : 0;
          const startPos3D = startCoord
            ? latLonToCartesian(startCoord.lat, startCoord.lon, liftR(startElev, 0.0052))
            : null;

          const showEnvelope =
            (roverWorkflowStep === 'range-explore' ||
              roverWorkflowStep === 'route-ready' ||
              roverWorkflowStep === 'animating') &&
            roverRangeEnvelope &&
            roverRangeEnvelope.boundaryRing.length >= 3;

          const showFinalRoute =
            (roverWorkflowStep === 'route-ready' ||
              roverWorkflowStep === 'animating') &&
            roverPlan &&
            roverPlan.waypoints.length >= 2;

          const isExploringRange = roverWorkflowStep === 'range-explore';

          return (
            <group>
              {/* STEP 4: OPERATIONAL RANGE ENVELOPE + ROUGH POSSIBLE PATHS */}
              {showEnvelope && roverRangeEnvelope && (() => {
                const ring = roverRangeEnvelope.boundaryRing;
                const closedRing = [...ring, ring[0]];
                const ringPts: [number, number, number][] = closedRing.map((p) =>
                  latLonToCartesian(p.lat, p.lon, liftR(p.elevKm, 0.0045))
                );
                const ringColors: [number, number, number][] = closedRing.map((p) =>
                  p.blockedBySlope ? [0.96, 0.62, 0.04] : [0.06, 0.85, 0.55]
                );

                const halfRing = roverRangeEnvelope.innerHalfRing;
                const closedHalf =
                  halfRing.length >= 3 ? [...halfRing, halfRing[0]] : [];
                const halfPts: [number, number, number][] = closedHalf.map((p) =>
                  latLonToCartesian(p.lat, p.lon, liftR(p.elevKm, 0.004))
                );

                const northTagPt = ringPts[0];

                return (
                  <group>
                    {/* Outer Max Operational Range Boundary */}
                    <Line
                      points={ringPts}
                      vertexColors={ringColors}
                      lineWidth={isExploringRange ? 2.6 : 1.5}
                      transparent
                      opacity={isExploringRange ? 0.92 : 0.45}
                    />

                    {/* Inner 50% Sortie Range Contour */}
                    {halfPts.length >= 4 && (
                      <Line
                        points={halfPts}
                        color="#34d399"
                        lineWidth={1.1}
                        dashed
                        dashSize={0.005}
                        gapSize={0.004}
                        transparent
                        opacity={isExploringRange ? 0.42 : 0.2}
                      />
                    )}

                    {/* Max Operational Range Badge on Perimeter */}
                    {isExploringRange && northTagPt && (
                      <Html position={northTagPt} center zIndexRange={[11, 0]}>
                        <div className="pointer-events-none px-1.5 py-0.5 rounded bg-[#061310]/90 text-emerald-300 font-mono-tech text-[9px] border border-emerald-400/50 whitespace-nowrap shadow">
                          MAX RANGE ≤ {roverRangeEnvelope.maxReachableRadiusKm} km
                        </div>
                      </Html>
                    )}

                    {/* Branching Rough Possible Paths from Start [A] */}
                    {roverRangeEnvelope.candidatePaths.map((cp) => {
                      if (cp.points.length < 2) return null;
                      const cpPts: [number, number, number][] = cp.points.map((pt) =>
                        latLonToCartesian(pt.lat, pt.lon, liftR(pt.elevKm, 0.0044))
                      );
                      const leafPos = cpPts[cpPts.length - 1];

                      return (
                        <group key={cp.id}>
                          <Line
                            points={cpPts}
                            color={isExploringRange ? '#38bdf8' : '#2dd4bf'}
                            lineWidth={isExploringRange ? 1.85 : 1.0}
                            transparent
                            opacity={isExploringRange ? 0.72 : 0.18}
                          />
                          {isExploringRange && onSelectCandidatePath && (
                            <group position={leafPos}>
                              <mesh
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onSelectCandidatePath(cp);
                                }}
                              >
                                <sphereGeometry args={[0.0038, 12, 12]} />
                                <meshBasicMaterial color="#38bdf8" />
                              </mesh>
                              <Html
                                position={[0, 0.008, 0]}
                                center
                                zIndexRange={[12, 0]}
                              >
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    onSelectCandidatePath(cp);
                                  }}
                                  className="hud-btn px-1.5 py-0.5 rounded bg-[#08121e]/90 hover:bg-[#38bdf8] text-[#7dd3fc] hover:text-[#05070b] font-mono-tech text-[8.5px] border border-[#38bdf8]/45 whitespace-nowrap cursor-pointer shadow"
                                  title={`Select ${cp.label} endpoint as Goal [B]`}
                                >
                                  ◇ {cp.sectorName} {cp.distanceKm.toFixed(1)}km
                                </button>
                              </Html>
                            </group>
                          )}
                        </group>
                      );
                    })}
                  </group>
                );
              })()}

              {/* START [A] BEACON */}
              {startPos3D && (
                <group position={startPos3D}>
                  <mesh>
                    <sphereGeometry args={[0.0065, 16, 16]} />
                    <meshBasicMaterial color="#10b981" />
                  </mesh>
                  <Html position={[0, 0.015, 0]} center zIndexRange={[14, 0]}>
                    <div className="pointer-events-none px-1.5 py-0.5 rounded bg-emerald-500 text-[#05070b] font-mono-tech font-bold text-[9px] border border-emerald-200 whitespace-nowrap shadow">
                      A • START
                    </div>
                  </Html>
                </group>
              )}

              {/* INTERMEDIATE CHECKPOINT [CP1, CP2...] BEACONS */}
              {roverCheckpoints &&
                roverCheckpoints.map((cp, idx) => {
                  const elev = sampleElevationKm(cp.lat, cp.lon);
                  const [cx, cy, cz] = latLonToCartesian(
                    cp.lat,
                    cp.lon,
                    liftR(elev, 0.005)
                  );
                  return (
                    <group key={idx} position={[cx, cy, cz]}>
                      <mesh>
                        <sphereGeometry args={[0.0052, 14, 14]} />
                        <meshBasicMaterial color="#06b6d4" />
                      </mesh>
                      <Html position={[0, 0.014, 0]} center zIndexRange={[13, 0]}>
                        <div className="pointer-events-none px-1.5 py-0.5 rounded bg-cyan-950/92 text-cyan-300 font-mono-tech font-bold text-[8.5px] border border-cyan-400/60 whitespace-nowrap shadow-lg">
                          CP {idx + 1}
                        </div>
                      </Html>
                    </group>
                  );
                })}

              {/* CHARACTERIZED CRATER HAZARD AVOIDANCE RINGS */}
              {(() => {
                const activeCraters =
                  roverPlan?.craters && roverPlan.craters.length > 0
                    ? roverPlan.craters
                    : roverRangeEnvelope?.craters && roverRangeEnvelope.craters.length > 0
                    ? roverRangeEnvelope.craters
                    : [];

                if (activeCraters.length === 0) return null;

                return (
                  <group>
                    {activeCraters.slice(0, 48).map((c) => {
                      const [cx, cy, cz] = latLonToCartesian(c.lat, c.lon, 1);
                      const centerNorm = new THREE.Vector3(cx, cy, cz).normalize();
                      const northRef =
                        Math.abs(c.lat) < 88.5
                          ? new THREE.Vector3(0, 1, 0)
                          : new THREE.Vector3(1, 0, 0);
                      const eEast = new THREE.Vector3()
                        .crossVectors(northRef, centerNorm)
                        .normalize();
                      const eNorth = new THREE.Vector3()
                        .crossVectors(centerNorm, eEast)
                        .normalize();
                      const angRad = Math.max(0.001, c.radiusKm / 1737.4);

                      const pts: [number, number, number][] = [];
                      const N_SEG = 20;
                      for (let k = 0; k <= N_SEG; k++) {
                        const th = (k / N_SEG) * Math.PI * 2;
                        const u = Math.sin(angRad) * Math.cos(th);
                        const v = Math.sin(angRad) * Math.sin(th);
                        const w = Math.cos(angRad);
                        const ptVec = new THREE.Vector3()
                          .addScaledVector(centerNorm, w)
                          .addScaledVector(eEast, u)
                          .addScaledVector(eNorth, v)
                          .normalize();
                        const ll = cartesianToLatLon(ptVec.x, ptVec.y, ptVec.z);
                        const elev = sampleElevationKm(ll.lat, ll.lon);
                        const r = liftR(elev, 0.0038);
                        pts.push([ptVec.x * r, ptVec.y * r, ptVec.z * r]);
                      }

                      const isNoGo = c.status === 'no-go';
                      const color = isNoGo
                        ? '#f43f5e'
                        : c.status === 'avoid'
                        ? '#f59e0b'
                        : '#10b981';

                      return (
                        <group key={c.id}>
                          <Line
                            points={pts}
                            color={color}
                            lineWidth={isNoGo ? 2.2 : 1.2}
                            dashed={!isNoGo}
                            dashSize={0.006}
                            gapSize={0.004}
                            transparent
                            opacity={isNoGo ? 0.85 : 0.45}
                          />
                          {isNoGo && (c.depthM >= 300 || c.radiusKm >= 3.5) && (
                            <Html position={pts[0]} center zIndexRange={[12, 0]}>
                              <div className="pointer-events-none px-1 py-0.5 rounded bg-[#1e070c]/90 text-rose-300 font-mono-tech text-[8.5px] border border-rose-500/40 whitespace-nowrap shadow">
                                ⚠ -{c.depthM}m ({c.wallSlopeDeg}°)
                              </div>
                            </Html>
                          )}
                        </group>
                      );
                    })}
                  </group>
                );
              })()}

              {/* STEP 5 & 6: SELECTED ROUTE TO GOAL [B] + ANIMATED 3D ARTICULATED ROVER */}
              {showFinalRoute && roverPlan && (() => {
                const wps = roverPlan.waypoints;
                const pathPoints: [number, number, number][] = wps.map((w) =>
                  latLonToCartesian(w.lat, w.lon, liftR(w.elevationKm, 0.0052))
                );

                const vertexColors: [number, number, number][] = wps.map((w) =>
                  w.slopeStatus === 'NO-GO'
                    ? [0.94, 0.27, 0.27]
                    : w.slopeStatus === 'CAUTION'
                    ? [0.96, 0.62, 0.04]
                    : [0.06, 0.85, 0.55]
                );

                const startPos = pathPoints[0];
                const endPos = pathPoints[pathPoints.length - 1];

                // Smooth continuous interpolation along waypoints for 60 FPS animation
                const clampedProg = Math.max(0, Math.min(1, roverAnimProgress));
                const exactIdx = clampedProg * (wps.length - 1);
                const i0 = Math.floor(exactIdx);
                const i1 = Math.min(wps.length - 1, i0 + 1);
                const frac = exactIdx - i0;

                const p0 = new THREE.Vector3(...pathPoints[i0]);
                const p1 = new THREE.Vector3(...pathPoints[i1]);
                const roverVec = new THREE.Vector3().lerpVectors(p0, p1, frac);
                const roverLen = p0.length() * (1 - frac) + p1.length() * frac;
                roverVec.normalize().multiplyScalar(roverLen);

                // Compute surface-tangent orientation (Y = surface normal up, Z = forward travel)
                const upVec = roverVec.clone().normalize();
                const iPrev = Math.max(0, i0 - 1);
                const iNext = Math.min(wps.length - 1, i0 + 1);
                const tangentRaw = new THREE.Vector3(...pathPoints[iNext]).sub(
                  new THREE.Vector3(...pathPoints[iPrev])
                );
                tangentRaw.addScaledVector(upVec, -tangentRaw.dot(upVec));
                if (tangentRaw.lengthSq() < 1e-10) {
                  tangentRaw.set(1, 0, 0).addScaledVector(upVec, -upVec.x);
                }
                const fwdVec = tangentRaw.normalize();
                const rightVec = new THREE.Vector3().crossVectors(upVec, fwdVec).normalize();
                const rotMat = new THREE.Matrix4().makeBasis(rightVec, upVec, fwdVec);
                const roverQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat);

                const wp0 = wps[i0];
                const wp1 = wps[i1];
                const liveSlope = (wp0.slopeDeg + (wp1.slopeDeg - wp0.slopeDeg) * frac).toFixed(1);
                const liveSoc = (
                  wp0.batterySocPct +
                  (wp1.batterySocPct - wp0.batterySocPct) * frac
                ).toFixed(0);
                const liveDist = (
                  wp0.cumDistanceKm +
                  (wp1.cumDistanceKm - wp0.cumDistanceKm) * frac
                ).toFixed(2);

                // Driven trail points (0 -> current rover position)
                const drivenPts: [number, number, number][] =
                  clampedProg > 0.005
                    ? [
                        ...pathPoints.slice(0, i0 + 1),
                        [roverVec.x, roverVec.y, roverVec.z],
                      ]
                    : [];

                // Scale miniature rover cleanly for both tight polar craters and regional traverses
                const roverScale = Math.max(
                  0.32,
                  Math.min(0.95, 0.28 + roverPlan.totalDistanceKm * 0.011)
                );

                return (
                  <group>
                    {/* Full Planned Route (terrain slope colored) */}
                    <Line
                      points={pathPoints}
                      vertexColors={vertexColors}
                      lineWidth={3.2}
                    />

                    {/* Progressive Driven Trail during Animation */}
                    {drivenPts.length >= 2 && (
                      <Line
                        points={drivenPts}
                        color="#fde047"
                        lineWidth={4.2}
                      />
                    )}

                    {/* Direct geodesic reference line when A* detours */}
                    {roverPlan.mode === 'astar' && roverPlan.detourPct > 0.4 && (
                      <Line
                        points={[startPos, endPos]}
                        color="#94a3b8"
                        lineWidth={1.1}
                        dashed
                        dashSize={0.008}
                        gapSize={0.006}
                        transparent
                        opacity={0.45}
                      />
                    )}

                    {/* Goal Waypoint [B] */}
                    <group position={endPos}>
                      <mesh>
                        <sphereGeometry args={[0.0065, 16, 16]} />
                        <meshBasicMaterial color="#38bdf8" />
                      </mesh>
                      <Html position={[0, 0.015, 0]} center zIndexRange={[14, 0]}>
                        <div className="pointer-events-none px-1.5 py-0.5 rounded bg-[#38bdf8] text-[#05070b] font-mono-tech font-bold text-[9px] border border-sky-200 whitespace-nowrap shadow">
                          B • GOAL ({roverPlan.totalDistanceKm} km)
                        </div>
                      </Html>
                    </group>

                    {/* Articulated 3D Lunar Rover Oriented Along Local Terrain Tangent */}
                    <group
                      position={[roverVec.x, roverVec.y, roverVec.z]}
                      quaternion={roverQuat}
                    >
                      <group scale={[roverScale, roverScale, roverScale]}>
                        {/* Thermal-Gold Rover Chassis */}
                        <mesh position={[0, 0.0055, 0]}>
                          <boxGeometry args={[0.013, 0.007, 0.019]} />
                          <meshBasicMaterial color="#fbbf24" />
                        </mesh>
                        {/* Top Deck / Avionics Radiator */}
                        <mesh position={[0, 0.0096, -0.001]}>
                          <boxGeometry args={[0.011, 0.0018, 0.014]} />
                          <meshBasicMaterial color="#f8fafc" />
                        </mesh>
                        {/* Vertical Polar Solar Array Wing */}
                        <mesh position={[0, 0.0155, -0.004]}>
                          <boxGeometry args={[0.015, 0.011, 0.0015]} />
                          <meshBasicMaterial color="#38bdf8" />
                        </mesh>
                        {/* Mast Stereo NavCam */}
                        <mesh position={[0, 0.016, 0.006]}>
                          <boxGeometry args={[0.0045, 0.0035, 0.004]} />
                          <meshBasicMaterial color="#fde047" />
                        </mesh>
                        {/* 4 Wheel Bogies */}
                        {[
                          [-0.0078, 0.0028, 0.0068],
                          [0.0078, 0.0028, 0.0068],
                          [-0.0078, 0.0028, -0.0068],
                          [0.0078, 0.0028, -0.0068],
                        ].map(([wx, wy, wz], wi) => (
                          <mesh
                            key={wi}
                            position={[wx, wy, wz]}
                            rotation={[0, 0, Math.PI / 2]}
                          >
                            <cylinderGeometry args={[0.0032, 0.0032, 0.0026, 12]} />
                            <meshBasicMaterial color="#334155" />
                          </mesh>
                        ))}
                        {/* Forward Hazard LiDAR Scan Cone during Active Navigation */}
                        {isRoverAnimating && (
                          <mesh
                            position={[0, 0.006, 0.022]}
                            rotation={[-Math.PI / 2, 0, 0]}
                          >
                            <coneGeometry args={[0.009, 0.024, 16, 1, true]} />
                            <meshBasicMaterial
                              color="#22d3ee"
                              transparent
                              opacity={0.28}
                              side={THREE.DoubleSide}
                            />
                          </mesh>
                        )}
                      </group>

                      <Html position={[0, 0.022 * roverScale + 0.006, 0]} center zIndexRange={[16, 0]}>
                        <div className="pointer-events-none px-1.5 py-0.5 rounded bg-[#090d16]/92 text-[#fde68a] font-mono-tech text-[9px] border border-[#f59e0b]/75 whitespace-nowrap shadow-lg">
                          ◈ ROVER • {liveDist}km • {liveSlope}° • {liveSoc}% SoC
                        </div>
                      </Html>
                    </group>
                  </group>
                );
              })()}
            </group>
          );
        })()}

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={1.045}
        maxDistance={trueOrbitScale ? 46 : 9.5}
        rotateSpeed={0.62}
        zoomSpeed={0.85}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
};

export const LunarGlobe3D: React.FC<LunarGlobe3DProps> = (props) => {
  return (
    <div className="w-full h-full relative select-none">
      <Canvas
        camera={{ position: [1.55, -1.65, 1.15], fov: 42, near: 0.004, far: 220 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
      >
        <React.Suspense fallback={null}>
          <MoonSceneContent {...props} />
        </React.Suspense>
      </Canvas>
    </div>
  );
};

