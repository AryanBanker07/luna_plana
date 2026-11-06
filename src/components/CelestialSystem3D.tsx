import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import {
  computeCelestialSystemState,
  eclipticToCartesian,
  evalEarthOrbitPointAtLon,
  evalMoonOrbitPointAtLon,
  formatUtcParts,
  formatWarpDelta,
  norm360,
  sampleEarthHeliocentricOrbit,
  sampleMoonGeocentricOrbit,
  solveNextEarthHelioLonTime,
  solveNextLunarApsisOrNodeTime,
  solveNextMoonGeocentricLonTime,
} from '../engine/celestialEphemeris';
import { latLonToCartesian } from '../engine/selenography';
import { CelestialSystemState, SiteEvaluation } from '../types/lunar';

const DEG2RAD = Math.PI / 180;

export type AstroCameraPreset =
  | 'em-overview'
  | 'em-top'
  | 'em-nodes'
  | 'em-moon'
  | 'em-earth'
  | 'helio-overview'
  | 'helio-top'
  | 'helio-follow-em'
  | 'helio-tilt';

// ============================================================================
// CUSTOM PROCEDURAL EARTH SHADER (Continents, Oceans, Ice Caps, Clouds, Night Lights & Atmosphere)
// ============================================================================
const EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vObjPos = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const EARTH_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uSunWorldPos;
  uniform float uIsPointSun;
  uniform vec3 uSunDirWorld;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
          mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
          mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise3(p);
      p *= 2.04;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 nObj = normalize(vObjPos);
    vec3 nWorld = normalize(vWorldNormal);
    vec3 L = uIsPointSun > 0.5
      ? normalize(uSunWorldPos - vWorldPos)
      : normalize(uSunDirWorld);
    vec3 V = normalize(cameraPosition - vWorldPos);

    float lat = asin(clamp(nObj.y, -1.0, 1.0));
    float absLat = abs(lat);

    // Multi-scale continental elevation field
    float contMacro = fbm(nObj * 2.35 + vec3(1.4, -0.7, 0.9));
    float contDetail = fbm(nObj * 7.5 + vec3(-2.1, 3.3, 1.2));
    float landHeight = contMacro * 0.78 + contDetail * 0.22;
    // Suppress equatorial ocean bias slightly & open southern ocean
    landHeight += 0.06 * sin(lat * 2.5) - 0.05 * smoothstep(0.6, 1.2, -lat);

    float landMask = smoothstep(0.495, 0.525, landHeight);

    // Ocean bathymetry & surface color
    vec3 deepOcean = vec3(0.02, 0.11, 0.29);
    vec3 shallowShelf = vec3(0.04, 0.32, 0.52);
    vec3 oceanCol = mix(deepOcean, shallowShelf, smoothstep(0.38, 0.50, landHeight));

    // Biomes: lush green -> arid ochre -> mountain rock
    float arid = smoothstep(0.18, 0.52, absLat) * (1.0 - smoothstep(0.52, 0.85, absLat));
    float moisture = fbm(nObj * 4.5 + vec3(4.2, 1.1, -2.5));
    vec3 forest = vec3(0.09, 0.34, 0.14);
    vec3 desert = vec3(0.66, 0.54, 0.32);
    vec3 highland = vec3(0.42, 0.39, 0.36);
    vec3 landCol = mix(forest, desert, clamp(arid * (1.25 - moisture), 0.0, 1.0));
    landCol = mix(landCol, highland, smoothstep(0.60, 0.74, landHeight));

    vec3 surfaceCol = mix(oceanCol, landCol, landMask);

    // Polar ice caps
    float iceCap = smoothstep(1.14, 1.30, absLat + contDetail * 0.12);
    surfaceCol = mix(surfaceCol, vec3(0.92, 0.96, 1.0), iceCap);

    // Dynamic cloud layer
    float cloudNoise = fbm(nObj * 3.8 + vec3(uTime * 0.008, 0.0, -uTime * 0.005));
    float cloudSwirl = fbm(nObj * 8.5 + vec3(cloudNoise * 1.6));
    float clouds = smoothstep(0.53, 0.74, cloudNoise * 0.65 + cloudSwirl * 0.35);
    surfaceCol = mix(surfaceCol, vec3(0.96, 0.98, 1.0), clouds * 0.62);

    // Solar day/night illumination
    float sunDot = dot(nWorld, L);
    float dayFactor = smoothstep(-0.08, 0.12, sunDot);
    float diffuse = max(0.0, sunDot);

    // Ocean specular glint on sunlit water
    vec3 H = normalize(L + V);
    float spec = pow(max(0.0, dot(nWorld, H)), 42.0) * (1.0 - landMask) * (1.0 - iceCap) * (1.0 - clouds * 0.8);

    // Night-side city lights along temperate coastal/continental regions
    float cityPattern = smoothstep(0.66, 0.82, fbm(nObj * 18.0));
    float habitable = landMask * (1.0 - iceCap) * (1.0 - smoothstep(0.64, 0.72, landHeight));
    vec3 nightLights = vec3(1.0, 0.74, 0.32) * cityPattern * habitable * (1.0 - clouds * 0.7) * 0.85;

    // Atmospheric Rayleigh limb glow (clear silhouette on both day & night limbs)
    float fresnel = pow(1.0 - max(0.0, dot(nWorld, V)), 2.8);
    vec3 atmoColor = mix(vec3(0.14, 0.42, 0.82), vec3(0.32, 0.72, 1.0), dayFactor);

    vec3 litDay = surfaceCol * (0.14 + 1.08 * pow(diffuse, 0.85)) + vec3(0.85, 0.90, 1.0) * spec * 0.45 * dayFactor;
    vec3 litNight = surfaceCol * 0.13 + nightLights * (1.0 - dayFactor);
    vec3 finalCol = mix(litNight, litDay, dayFactor) + atmoColor * fresnel * (0.46 + 0.58 * dayFactor);

    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

// ============================================================================
// ORBITAL LROC MOON SHADER (World-Space True Phase Terminator + Earthshine)
// ============================================================================
const ORBIT_MOON_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ORBIT_MOON_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uColorMap;
  uniform sampler2D uDemMap;
  uniform vec3 uSunWorldPos;
  uniform float uIsPointSun;
  uniform vec3 uSunDirWorld;
  uniform vec3 uEarthWorldPos;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 albedo = texture2D(uColorMap, vUv).rgb;
    float dem = texture2D(uDemMap, vUv).r;

    vec3 N = normalize(vWorldNormal);
    vec3 L = uIsPointSun > 0.5
      ? normalize(uSunWorldPos - vWorldPos)
      : normalize(uSunDirWorld);
    vec3 E = normalize(uEarthWorldPos - vWorldPos);
    vec3 V = normalize(cameraPosition - vWorldPos);

    float sunDot = dot(N, L);
    float sunlit = smoothstep(-0.04, 0.06, sunDot);
    // Lommel-Seeliger lunar scattering
    float lommel = sunlit * mix(max(0.0, sunDot), pow(max(0.0, sunDot), 0.62), 0.65);

    // Clear bluish Earthshine + subtle limb rim so crescent/dark Moon never vanishes into space
    float earthDot = max(0.0, dot(N, E));
    float limbRim = pow(1.0 - max(0.0, dot(N, V)), 2.6);
    vec3 earthshine = vec3(0.46, 0.68, 1.0) * earthDot * 0.20 + vec3(0.115);

    vec3 base = pow(albedo, vec3(0.90)) * (0.90 + 0.22 * dem);
    vec3 col = base * mix(earthshine, vec3(1.20, 1.17, 1.10) * max(0.16, lommel), sunlit);
    col += vec3(0.36, 0.46, 0.62) * limbRim * 0.20;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// ANIMATED SOLAR PHOTOSPHERE SHADER
// ============================================================================
const SUN_VERTEX_SHADER = /* glsl */ `
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vObjPos = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SUN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vec3 p = normalize(vObjPos);
    float g1 = noise(p * 8.0 + vec3(uTime * 0.18, -uTime * 0.12, uTime * 0.09));
    float g2 = noise(p * 19.0 - vec3(uTime * 0.25, uTime * 0.15, 0.0));
    float gran = g1 * 0.65 + g2 * 0.35;

    vec3 V = normalize(cameraPosition - vWorldPos);
    float mu = max(0.0, dot(normalize(vWorldNormal), V));
    float limb = pow(mu, 0.42);

    vec3 deepOrange = vec3(0.95, 0.36, 0.04);
    vec3 goldCore = vec3(1.0, 0.78, 0.22);
    vec3 whiteHot = vec3(1.0, 0.98, 0.86);

    vec3 col = mix(deepOrange, goldCore, limb);
    col = mix(col, whiteHot, smoothstep(0.45, 0.88, gran * limb));
    gl_FragColor = vec4(col, 1.0);
  }
`;

interface CelestialSystem3DProps {
  mode: 'earth-moon' | 'heliocentric';
  simTimeMs: number;
  evaluation: SiteEvaluation;
  astroPreset: AstroCameraPreset;
  astroPresetNonce: number;
  truePhysicalScale: boolean;
  showLabels: boolean;
  onSwitchToEarthMoon: () => void;
  onSwitchToLunarSurface: () => void;
  onWarpToTime: (targetTimeMs: number, label: string) => void;
  onSnapToTime: (targetTimeMs: number) => void;
}

const EclipticGridRings: React.FC<{
  radii: number[];
  maxSpokeRadius: number;
  center?: [number, number, number];
  opacity?: number;
}> = ({ radii, maxSpokeRadius, center = [0, 0, 0], opacity = 0.16 }) => {
  const ringCurves = useMemo(() => {
    return radii.map((r) => {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push([Math.cos(a) * r, 0, -Math.sin(a) * r]);
      }
      return pts;
    });
  }, [radii]);

  const spokes = useMemo(() => {
    const arr: [number, number, number][][] = [];
    for (let deg = 0; deg < 360; deg += 30) {
      const r = deg * DEG2RAD;
      arr.push([
        [0, 0, 0],
        [Math.cos(r) * maxSpokeRadius, 0, -Math.sin(r) * maxSpokeRadius],
      ]);
    }
    return arr;
  }, [maxSpokeRadius]);

  return (
    <group position={center}>
      {ringCurves.map((pts, idx) => (
        <Line
          key={`ring-${idx}`}
          points={pts}
          color="#38bdf8"
          lineWidth={1}
          transparent
          opacity={opacity}
        />
      ))}
      {spokes.map((pts, idx) => (
        <Line
          key={`spoke-${idx}`}
          points={pts}
          color="#64748b"
          lineWidth={0.8}
          transparent
          opacity={opacity * 0.75}
        />
      ))}
    </group>
  );
};

// ============================================================================
// SCREEN-SPACE SMALL LEADER ARROW + INFO PLACARD CALLOUT
// Anchors at exact 3D [0,0,0] of parent group so the 3D body is never occluded,
// even when Moon/Earth are sub-pixel dots at 1:1 Physical (60 R⊕) scale.
// ============================================================================
type CalloutDirection =
  | 'up-right'
  | 'up-left'
  | 'down-right'
  | 'down-left'
  | 'up'
  | 'down';

const OrbitalCalloutPlacard: React.FC<{
  direction?: CalloutDirection;
  accentColor: string;
  gapPx?: number;
  lengthScale?: number;
  showReticle?: boolean;
  reticleRadius?: number;
  zIndexRange?: [number, number];
  interactive?: boolean;
  children: React.ReactNode;
}> = ({
  direction = 'up-right',
  accentColor,
  gapPx = 7,
  lengthScale = 1,
  showReticle = false,
  reticleRadius = 4.5,
  zIndexRange = [14, 0],
  interactive = true,
  children,
}) => {
  const presets: Record<
    CalloutDirection,
    { dx: number; dy: number; shelf: number; transform: string }
  > = {
    'up-right': {
      dx: 24 * lengthScale,
      dy: -30 * lengthScale,
      shelf: 10 * lengthScale,
      transform: 'translate(0%, -50%)',
    },
    'up-left': {
      dx: -24 * lengthScale,
      dy: -30 * lengthScale,
      shelf: -10 * lengthScale,
      transform: 'translate(-100%, -50%)',
    },
    'down-right': {
      dx: 20 * lengthScale,
      dy: 25 * lengthScale,
      shelf: 9 * lengthScale,
      transform: 'translate(0%, -50%)',
    },
    'down-left': {
      dx: -20 * lengthScale,
      dy: 25 * lengthScale,
      shelf: -9 * lengthScale,
      transform: 'translate(-100%, -50%)',
    },
    up: {
      dx: 0,
      dy: -22 * lengthScale,
      shelf: 0,
      transform: 'translate(-50%, -100%)',
    },
    down: {
      dx: 0,
      dy: 22 * lengthScale,
      shelf: 0,
      transform: 'translate(-50%, 0%)',
    },
  };

  const { dx, dy, shelf, transform } = presets[direction];
  const dist = Math.max(1, Math.hypot(dx, dy));
  const rx = dx / dist;
  const ry = dy / dist;
  const px = -ry;
  const py = rx;

  const arrowLen = 5.6;
  const arrowHalfWidth = 2.7;
  const safeGap = Math.min(gapPx, dist - arrowLen - 2);

  // Tip points inward toward (0, 0) stopping safeGap px short so 3D sphere stays clear
  const tipX = rx * safeGap;
  const tipY = ry * safeGap;
  const baseX = rx * (safeGap + arrowLen);
  const baseY = ry * (safeGap + arrowLen);
  const w1x = baseX + px * arrowHalfWidth;
  const w1y = baseY + py * arrowHalfWidth;
  const w2x = baseX - px * arrowHalfWidth;
  const w2y = baseY - py * arrowHalfWidth;

  const shelfX = dx + shelf;
  const polyPoints =
    shelf !== 0
      ? `${shelfX.toFixed(1)},${dy.toFixed(1)} ${dx.toFixed(1)},${dy.toFixed(1)} ${baseX.toFixed(1)},${baseY.toFixed(1)}`
      : `${dx.toFixed(1)},${dy.toFixed(1)} ${baseX.toFixed(1)},${baseY.toFixed(1)}`;

  const headPoints = `${tipX.toFixed(1)},${tipY.toFixed(1)} ${w1x.toFixed(1)},${w1y.toFixed(1)} ${w2x.toFixed(1)},${w2y.toFixed(1)}`;

  return (
    <Html position={[0, 0, 0]} zIndexRange={zIndexRange}>
      <div className="relative w-0 h-0 pointer-events-none select-none overflow-visible">
        <svg
          width="180"
          height="180"
          viewBox="-90 -90 180 180"
          className="absolute -left-[90px] -top-[90px] overflow-visible pointer-events-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
        >
          {showReticle && (
            <circle
              cx="0"
              cy="0"
              r={reticleRadius}
              fill="none"
              stroke={accentColor}
              strokeWidth="1.25"
              strokeOpacity="0.85"
            />
          )}
          <polyline
            points={polyPoints}
            fill="none"
            stroke={accentColor}
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.92"
          />
          <polygon points={headPoints} fill={accentColor} />
        </svg>

        <div
          style={{
            position: 'absolute',
            left: `${shelfX}px`,
            top: `${dy}px`,
            transform,
          }}
          className={interactive ? 'pointer-events-auto' : 'pointer-events-none'}
        >
          {children}
        </div>
      </div>
    </Html>
  );
};

// ============================================================================
// SCENE 1: GEOCENTRIC VIEW — MOON AROUND THE EARTH
// ============================================================================
const EarthMoonScene: React.FC<{
  state: CelestialSystemState;
  evaluation: SiteEvaluation;
  astroPreset: AstroCameraPreset;
  astroPresetNonce: number;
  truePhysicalScale: boolean;
  showLabels: boolean;
  onSwitchToLunarSurface: () => void;
  onWarpToTime: (targetTimeMs: number, label: string) => void;
  onSnapToTime: (targetTimeMs: number) => void;
}> = ({
  state,
  evaluation,
  astroPreset,
  astroPresetNonce,
  truePhysicalScale,
  showLabels,
  onSwitchToLunarSurface,
  onWarpToTime,
  onSnapToTime,
}) => {
  const [moonColorMap, moonDemMap] = useLoader(THREE.TextureLoader, [
    '/textures/lroc_color.jpg',
    '/textures/lola_dem.jpg',
  ]);

  const controlsRef = useRef<any>(null);
  const earthShaderRef = useRef<THREE.ShaderMaterial>(null);
  const moonShaderRef = useRef<THREE.ShaderMaterial>(null);
  const flyCamPos = useRef<THREE.Vector3 | null>(null);
  const flyTarget = useRef<THREE.Vector3 | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [hoverOrbitLon, setHoverOrbitLon] = useState<number | null>(null);
  const [selectedOrbitNode, setSelectedOrbitNode] = useState<{
    lonDeg: number;
    targetTimeMs: number;
    label: string;
  } | null>(null);
  const { camera } = useThree();

  // Scale configuration:
  // True 1:1 Scale: R_earth = 0.26, R_moon = 0.071, orbit ~ 15.7 units (exact 60.3x R_earth!)
  // Schematic Scale: R_earth = 0.92, R_moon = 0.36, orbit ~ 6.8 units (both spheres & 5.15° tilt crystal clear!)
  const earthRadius = truePhysicalScale ? 0.26 : 0.92;
  const moonRadius = truePhysicalScale ? 0.26 * (1737.4 / 6371.0) : 0.36;
  const baseOrbitRadius = truePhysicalScale ? 0.26 * (384400 / 6371.0) : 6.8;

  const mapMoonDist = useMemo(
    () => (distKm: number) => baseOrbitRadius * (distKm / 384400),
    [baseOrbitRadius]
  );

  const orbitGeom = useMemo(
    () => sampleMoonGeocentricOrbit(state, mapMoonDist, 192),
    [state, mapMoonDist]
  );

  // Invisible raycast tube along Moon's 3D orbit for KSP "Warp Here" hover & click
  const orbitHitCurve = useMemo(() => {
    const vecs = orbitGeom.curvePoints
      .slice(0, -1)
      .map(([x, y, z]) => new THREE.Vector3(x, y, z));
    return new THREE.CatmullRomCurve3(vecs, true);
  }, [orbitGeom.curvePoints]);

  // Auto-clear selected node once Moon arrives within ~2 minutes of target
  useEffect(() => {
    if (
      selectedOrbitNode &&
      state.timestampMs >= selectedOrbitNode.targetTimeMs - 90_000
    ) {
      setSelectedOrbitNode(null);
    }
  }, [state.timestampMs, selectedOrbitNode]);

  // Direction from Earth toward the Sun in Ecliptic coordinates
  const sunDirVec = useMemo(() => {
    const [sx, sy, sz] = eclipticToCartesian(0, state.sunGeoLonDeg, 1.0);
    return new THREE.Vector3(sx, sy, sz).normalize();
  }, [state.sunGeoLonDeg]);

  const moonPosVec = useMemo(
    () => new THREE.Vector3(...orbitGeom.moonPosition),
    [orbitGeom.moonPosition]
  );

  // Tidally lock Moon so its Prime Meridian (+X in Moon geometry) faces Earth [0,0,0], plus optical libration!
  const moonQuat = useMemo(() => {
    const toEarth = moonPosVec.clone().negate().normalize();
    const eclipticUp = new THREE.Vector3(0, 1, 0);
    // In our Moon geometry: +X = lon 0 (sub-Earth), +Y = North Pole, -Z = East (+90°E) -> +Z = West (-90°W)
    // Right-handed basis: X = toEarth, Y = North, Z = X cross Y
    const zAxis = new THREE.Vector3().crossVectors(toEarth, eclipticUp).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, toEarth).normalize();
    const m = new THREE.Matrix4().makeBasis(toEarth, yAxis, zAxis);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [moonPosVec]);

  // Selected Landing Site world position on the orbiting 3D Moon
  const siteWorldPos = useMemo(() => {
    const localSite = new THREE.Vector3(
      ...latLonToCartesian(evaluation.site.lat, evaluation.site.lon, moonRadius * 1.02)
    );
    return localSite.applyQuaternion(moonQuat).add(moonPosVec);
  }, [evaluation.site.lat, evaluation.site.lon, moonRadius, moonQuat, moonPosVec]);

  // Cislunar Lagrange Points EM-L1 (~84.9% of Earth-Moon distance) & EM-L2 (~115.6%)
  const l1Pos = useMemo(
    () => moonPosVec.clone().multiplyScalar(0.849),
    [moonPosVec]
  );
  const l2Pos = useMemo(
    () => moonPosVec.clone().multiplyScalar(1.156),
    [moonPosVec]
  );

  // Earth equatorial ring in Earth's tilted frame
  const equatorRing = useMemo(() => {
    const pts: [number, number, number][] = [];
    const r = earthRadius * 1.22;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push([Math.cos(a) * r, 0, -Math.sin(a) * r]);
    }
    return pts;
  }, [earthRadius]);

  // Vertical drop stem from Moon onto Ecliptic Plane to highlight 5.145° inclination height!
  const moonEclipticFoot = useMemo<[number, number, number]>(
    () => [moonPosVec.x, 0, moonPosVec.z],
    [moonPosVec]
  );

  const earthUniforms = useMemo(
    () => ({
      uSunWorldPos: { value: new THREE.Vector3(100, 0, 0) },
      uIsPointSun: { value: 0.0 },
      uSunDirWorld: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 },
    }),
    []
  );

  const moonUniforms = useMemo(
    () => ({
      uColorMap: { value: moonColorMap },
      uDemMap: { value: moonDemMap },
      uSunWorldPos: { value: new THREE.Vector3(100, 0, 0) },
      uIsPointSun: { value: 0.0 },
      uSunDirWorld: { value: new THREE.Vector3(1, 0, 0) },
      uEarthWorldPos: { value: new THREE.Vector3(0, 0, 0) },
    }),
    [moonColorMap, moonDemMap]
  );

  // Camera Preset Transitions
  useEffect(() => {
    const orbitSpan = baseOrbitRadius;
    if (astroPreset === 'em-top') {
      flyTarget.current = new THREE.Vector3(0, 0, 0);
      flyCamPos.current = new THREE.Vector3(0, orbitSpan * 2.35, 0.01);
    } else if (astroPreset === 'em-nodes') {
      // View perpendicular to Line of Nodes so 5.145° orbital tilt is edge-on!
      const perpLon = state.ascendingNodeLonDeg + 90;
      const [px, , pz] = eclipticToCartesian(4, perpLon, orbitSpan * 2.15);
      flyTarget.current = new THREE.Vector3(0, 0, 0);
      flyCamPos.current = new THREE.Vector3(px, orbitSpan * 0.16, pz);
    } else if (astroPreset === 'em-moon') {
      const offset = moonPosVec
        .clone()
        .normalize()
        .multiplyScalar(moonRadius * 5.2)
        .add(new THREE.Vector3(0, moonRadius * 2.2, 0));
      flyTarget.current = moonPosVec.clone();
      flyCamPos.current = moonPosVec.clone().add(offset);
    } else if (astroPreset === 'em-earth') {
      flyTarget.current = new THREE.Vector3(0, 0, 0);
      flyCamPos.current = new THREE.Vector3(
        earthRadius * 3.4,
        earthRadius * 1.5,
        earthRadius * 3.4
      );
    } else {
      // em-overview default
      flyTarget.current = new THREE.Vector3(0, 0, 0);
      flyCamPos.current = new THREE.Vector3(
        orbitSpan * 1.15,
        orbitSpan * 0.95,
        orbitSpan * 1.55
      );
    }
  }, [astroPreset, astroPresetNonce, truePhysicalScale]);

  useFrame(({ clock }, delta) => {
    if (earthShaderRef.current) {
      earthShaderRef.current.uniforms.uSunDirWorld.value.copy(sunDirVec);
      earthShaderRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
    if (moonShaderRef.current) {
      moonShaderRef.current.uniforms.uSunDirWorld.value.copy(sunDirVec);
      moonShaderRef.current.uniforms.uEarthWorldPos.value.set(0, 0, 0);
    }

    // Keep tracking Moon smoothly if user selected 'em-moon' and fly finished
    if (astroPreset === 'em-moon' && !flyCamPos.current && controlsRef.current) {
      controlsRef.current.target.lerp(moonPosVec, Math.min(1, delta * 5));
      controlsRef.current.update();
    }

    if (flyCamPos.current && controlsRef.current) {
      const step = Math.min(1, delta * 4.5);
      camera.position.lerp(flyCamPos.current, step);
      if (flyTarget.current) {
        controlsRef.current.target.lerp(flyTarget.current, step);
      }
      controlsRef.current.update();
      if (camera.position.distanceTo(flyCamPos.current) < 0.06) {
        flyCamPos.current = null;
      }
    }
  });

  const sunIndicatorPos = sunDirVec.clone().multiplyScalar(baseOrbitRadius * 1.38);
  const shadowEndPos = sunDirVec.clone().negate().multiplyScalar(baseOrbitRadius * 1.25);
  const markerUnit = Math.max(earthRadius * 0.08, baseOrbitRadius * 0.0085);

  const focusEarthInOrbit = () => {
    flyTarget.current = new THREE.Vector3(0, 0, 0);
    flyCamPos.current = new THREE.Vector3(
      earthRadius * 3.4,
      earthRadius * 1.5,
      earthRadius * 3.4
    );
  };

  const focusMoonInOrbit = () => {
    const offset = moonPosVec
      .clone()
      .normalize()
      .multiplyScalar(moonRadius * 5.6)
      .add(new THREE.Vector3(0, moonRadius * 2.4, 0));
    flyTarget.current = moonPosVec.clone();
    flyCamPos.current = moonPosVec.clone().add(offset);
  };

  return (
    <>
      <color attach="background" args={['#03060c']} />
      <Stars radius={120} depth={65} count={4800} factor={3.4} saturation={0.15} fade />

      {/* Ecliptic Reference Plane Grid */}
      <EclipticGridRings
        radii={[baseOrbitRadius * 0.45, baseOrbitRadius * 0.75, baseOrbitRadius, baseOrbitRadius * 1.22]}
        maxSpokeRadius={baseOrbitRadius * 1.22}
        opacity={0.18}
      />

      {/* Sunlight Direction Vector & Anti-Solar Earth Umbra Axis */}
      <Line
        points={[
          [0, 0, 0],
          [sunIndicatorPos.x, sunIndicatorPos.y, sunIndicatorPos.z],
        ]}
        color="#fbbf24"
        lineWidth={1.8}
        dashed
        dashSize={baseOrbitRadius * 0.04}
        gapSize={baseOrbitRadius * 0.025}
      />
      <group position={[sunIndicatorPos.x, sunIndicatorPos.y, sunIndicatorPos.z]}>
        <mesh>
          <sphereGeometry args={[markerUnit * 2.1, 20, 20]} />
          <meshBasicMaterial color="#fde047" />
        </mesh>
        {showLabels && (
          <OrbitalCalloutPlacard
            direction="up"
            accentColor="#fbbf24"
            gapPx={8}
            lengthScale={0.85}
            interactive={false}
            zIndexRange={[10, 0]}
          >
            <div className="px-2 py-0.5 rounded bg-[#070b14]/95 border border-[#f59e0b]/65 text-[#fde68a] font-mono-tech text-[10px] whitespace-nowrap shadow-lg">
              ☉ TO SUN (1 AU • {state.earthSunDistanceAu} AU)
            </div>
          </OrbitalCalloutPlacard>
        )}
      </group>

      {/* Earth Eclipse Shadow Axis (Anti-Solar) */}
      <Line
        points={[
          [0, 0, 0],
          [shadowEndPos.x, shadowEndPos.y, shadowEndPos.z],
        ]}
        color="#f43f5e"
        lineWidth={1.1}
        dashed
        dashSize={baseOrbitRadius * 0.03}
        gapSize={baseOrbitRadius * 0.03}
        transparent
        opacity={0.4}
      />

      {/* ================================================================== */}
      {/* 3D EARTH AT ORIGIN (23.44° Axial Obliquity + Live GMST Rotation)   */}
      {/* ================================================================== */}
      <group position={[0, 0, 0]}>
        <group rotation={[-state.earthObliquityDeg * DEG2RAD, 0, 0]}>
          {/* Earth North-South Spin Axis */}
          <Line
            points={[
              [0, -earthRadius * 1.65, 0],
              [0, earthRadius * 1.65, 0],
            ]}
            color="#38bdf8"
            lineWidth={1.4}
            transparent
            opacity={0.75}
          />
          {/* Equatorial Plane Reference Ring */}
          <Line
            points={equatorRing}
            color="#38bdf8"
            lineWidth={1}
            dashed
            dashSize={earthRadius * 0.12}
            gapSize={earthRadius * 0.08}
            transparent
            opacity={0.5}
          />

          {/* Spinning Earth Globe */}
          <mesh
            rotation={[0, state.earthGmstDeg * DEG2RAD, 0]}
            onClick={(e) => {
              e.stopPropagation();
              focusEarthInOrbit();
            }}
          >
            <sphereGeometry args={[earthRadius, 64, 64]} />
            <shaderMaterial
              ref={earthShaderRef}
              vertexShader={EARTH_VERTEX_SHADER}
              fragmentShader={EARTH_FRAGMENT_SHADER}
              uniforms={earthUniforms}
            />
          </mesh>

          {/* Subtle Atmospheric Rim Halo */}
          <mesh>
            <sphereGeometry args={[earthRadius * 1.045, 48, 48]} />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={0.14}
              side={THREE.BackSide}
            />
          </mesh>
        </group>

        {showLabels && (
          <OrbitalCalloutPlacard
            direction="up-left"
            accentColor="#38bdf8"
            gapPx={truePhysicalScale ? 8 : 18}
            lengthScale={1.08}
            showReticle={truePhysicalScale}
            reticleRadius={6.5}
            zIndexRange={[18, 0]}
          >
            <button
              type="button"
              onClick={focusEarthInOrbit}
              className="cursor-pointer rounded-md bg-[#050a14]/95 hover:bg-[#0b1528] border border-sky-400/65 px-2.5 py-1 text-left font-mono-tech shadow-[0_6px_20px_rgba(0,0,0,0.8)] backdrop-blur-md transition-colors tabular-nums"
              title="Click to focus camera on rotating 3D Earth"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-sky-200 whitespace-nowrap">
                <span>⊕ EARTH</span>
                <span className="text-sky-400/60">•</span>
                <span className="text-slate-200">Tilt {state.earthObliquityDeg}°</span>
              </div>
              <div className="text-[8.5px] text-slate-400 whitespace-nowrap">
                GMST {state.earthGmstDeg.toFixed(0)}°
              </div>
            </button>
          </OrbitalCalloutPlacard>
        )}
      </group>

      {/* ================================================================== */}
      {/* MOON'S INCLINED (5.145°) ELLIPTICAL ORBIT AROUND EARTH             */}
      {/* ================================================================== */}
      <Line
        points={orbitGeom.curvePoints}
        color="#7dd3fc"
        lineWidth={2.3}
        transparent
        opacity={0.85}
      />

      {/* Invisible Raycast Hit-Tube along Moon's Orbit for KSP "Warp Here" */}
      <mesh
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          pointerDownRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const lon = norm360(Math.atan2(-e.point.z, e.point.x) * (180 / Math.PI));
          setHoverOrbitLon(lon);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHoverOrbitLon(null);
          document.body.style.cursor = 'auto';
        }}
        onPointerUp={(e: ThreeEvent<PointerEvent>) => {
          if (!pointerDownRef.current) return;
          const dist = Math.hypot(
            e.clientX - pointerDownRef.current.x,
            e.clientY - pointerDownRef.current.y
          );
          pointerDownRef.current = null;
          if (dist < 6) {
            e.stopPropagation();
            const lon = norm360(Math.atan2(-e.point.z, e.point.x) * (180 / Math.PI));
            const targetMs = solveNextMoonGeocentricLonTime(state.timestampMs, lon);
            const elongAtTarget = norm360(lon - state.sunGeoLonDeg);
            setSelectedOrbitNode({
              lonDeg: lon,
              targetTimeMs: targetMs,
              label: `Moon Orbit (λ ${lon.toFixed(0)}° • Sun–Earth ${elongAtTarget.toFixed(0)}°)`,
            });
          }
        }}
      >
        <tubeGeometry args={[orbitHitCurve, 160, Math.max(0.28, baseOrbitRadius * 0.022), 8, true]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* KSP Hover Ghost Reticle on Moon Orbit */}
      {hoverOrbitLon !== null && !selectedOrbitNode && (() => {
        const hoverPt = evalMoonOrbitPointAtLon(state, hoverOrbitLon, mapMoonDist);
        const hoverMs = solveNextMoonGeocentricLonTime(state.timestampMs, hoverOrbitLon);
        const elong = norm360(hoverOrbitLon - state.sunGeoLonDeg);
        return (
          <group position={hoverPt}>
            <mesh>
              <sphereGeometry args={[markerUnit * 1.15, 16, 16]} />
              <meshBasicMaterial color="#4ade80" transparent opacity={0.9} />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up"
              accentColor="#4ade80"
              gapPx={7}
              lengthScale={0.95}
              interactive={false}
              zIndexRange={[25, 0]}
            >
              <div className="px-2 py-0.5 rounded bg-[#051810]/95 border border-emerald-400/75 text-emerald-200 font-mono-tech text-[9.5px] whitespace-nowrap shadow-lg tabular-nums">
                T + {formatWarpDelta(hoverMs - state.timestampMs)} (Sun–Earth {elong.toFixed(0)}°)
              </div>
            </OrbitalCalloutPlacard>
          </group>
        );
      })()}

      {/* Locked KSP "Warp Here" Maneuver/Target Node on Moon Orbit */}
      {selectedOrbitNode && (() => {
        const nodePt = evalMoonOrbitPointAtLon(state, selectedOrbitNode.lonDeg, mapMoonDist);
        const remMs = Math.max(0, selectedOrbitNode.targetTimeMs - state.timestampMs);
        return (
          <group position={nodePt}>
            <mesh>
              <octahedronGeometry args={[markerUnit * 1.5, 0]} />
              <meshBasicMaterial color="#22c55e" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up-right"
              accentColor="#22c55e"
              gapPx={7}
              lengthScale={1.05}
              showReticle
              reticleRadius={5.5}
              zIndexRange={[32, 0]}
            >
              <div className="rounded-lg bg-[#04130d]/95 border border-emerald-400/80 px-2.5 py-1.5 font-mono-tech shadow-2xl space-y-1 min-w-[188px] tabular-nums">
                <div className="flex items-center justify-between gap-2 text-[9.5px] text-emerald-300 font-bold">
                  <span>◈ {selectedOrbitNode.label}</span>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedOrbitNode(null);
                    }}
                    className="text-slate-400 hover:text-white cursor-pointer px-1"
                    title="Dismiss Warp Node"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-[9px] text-slate-300">
                  ETA: <strong className="text-white">T − {formatWarpDelta(remMs)}</strong> •{' '}
                  {formatUtcParts(selectedOrbitNode.targetTimeMs).dateStr}
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onWarpToTime(selectedOrbitNode.targetTimeMs, selectedOrbitNode.label);
                    }}
                    className="flex-1 px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-[#04130d] font-bold text-[10px] cursor-pointer shadow"
                  >
                    ▸▸▸ Warp Here
                  </button>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSnapToTime(selectedOrbitNode.targetTimeMs);
                      setSelectedOrbitNode(null);
                    }}
                    className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 border border-white/20 text-slate-200 text-[9.5px] cursor-pointer"
                    title="Instant Jump (0s)"
                  >
                    ⚡ Snap
                  </button>
                </div>
              </div>
            </OrbitalCalloutPlacard>
          </group>
        );
      })()}

      {/* Line of Nodes (Ascending <-> Descending Node across Ecliptic Plane) */}
      <Line
        points={[orbitGeom.ascendingNodePoint, orbitGeom.descendingNodePoint]}
        color="#a78bfa"
        lineWidth={1.1}
        dashed
        dashSize={baseOrbitRadius * 0.03}
        gapSize={baseOrbitRadius * 0.025}
        transparent
        opacity={0.55}
      />

      {/* Orbital Mechanics Key Markers: Clickable Perigee, Apogee, Nodes, L1/L2 */}
      {showLabels && (
        <>
          <group position={orbitGeom.perigeePoint}>
            <mesh>
              <sphereGeometry args={[markerUnit, 12, 12]} />
              <meshBasicMaterial color="#34d399" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up"
              accentColor="#34d399"
              gapPx={6}
              lengthScale={0.85}
              zIndexRange={[9, 0]}
            >
              <button
                type="button"
                onClick={() => {
                  const ms = solveNextLunarApsisOrNodeTime(state.timestampMs, 'perigee');
                  setSelectedOrbitNode({
                    lonDeg: state.perigeeLonDeg,
                    targetTimeMs: ms,
                    label: 'Lunar Perigee (Pe)',
                  });
                }}
                className="cursor-pointer px-1.5 py-0.5 rounded bg-[#041610]/92 hover:bg-emerald-900/90 border border-emerald-400/55 text-emerald-300 font-mono-tech text-[9px] whitespace-nowrap shadow"
                title="Click to Warp to Next Lunar Perigee"
              >
                P • Perigee (~363k km)
              </button>
            </OrbitalCalloutPlacard>
          </group>

          <group position={orbitGeom.apogeePoint}>
            <mesh>
              <sphereGeometry args={[markerUnit, 12, 12]} />
              <meshBasicMaterial color="#f59e0b" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up"
              accentColor="#f59e0b"
              gapPx={6}
              lengthScale={0.85}
              zIndexRange={[9, 0]}
            >
              <button
                type="button"
                onClick={() => {
                  const ms = solveNextLunarApsisOrNodeTime(state.timestampMs, 'apogee');
                  setSelectedOrbitNode({
                    lonDeg: norm360(state.perigeeLonDeg + 180),
                    targetTimeMs: ms,
                    label: 'Lunar Apogee (Ap)',
                  });
                }}
                className="cursor-pointer px-1.5 py-0.5 rounded bg-[#181004]/92 hover:bg-amber-900/90 border border-amber-400/55 text-amber-300 font-mono-tech text-[9px] whitespace-nowrap shadow"
                title="Click to Warp to Next Lunar Apogee"
              >
                A • Apogee (~405k km)
              </button>
            </OrbitalCalloutPlacard>
          </group>

          <group position={orbitGeom.ascendingNodePoint}>
            <mesh>
              <octahedronGeometry args={[markerUnit * 1.05, 0]} />
              <meshBasicMaterial color="#c084fc" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up"
              accentColor="#c084fc"
              gapPx={6}
              lengthScale={0.82}
              zIndexRange={[8, 0]}
            >
              <button
                type="button"
                onClick={() => {
                  const ms = solveNextLunarApsisOrNodeTime(state.timestampMs, 'ascending-node');
                  setSelectedOrbitNode({
                    lonDeg: state.ascendingNodeLonDeg,
                    targetTimeMs: ms,
                    label: 'Ascending Node (☊ AN)',
                  });
                }}
                className="cursor-pointer px-1.5 py-0.5 rounded bg-[#130821]/92 hover:bg-purple-900/90 border border-purple-400/55 text-purple-200 font-mono-tech text-[9px] whitespace-nowrap shadow"
                title="Click to Warp to Next Ascending Node"
              >
                ☊ Asc Node ({state.ascendingNodeLonDeg.toFixed(0)}°)
              </button>
            </OrbitalCalloutPlacard>
          </group>

          <group position={orbitGeom.descendingNodePoint}>
            <mesh>
              <octahedronGeometry args={[markerUnit * 0.95, 0]} />
              <meshBasicMaterial color="#a855f7" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="down"
              accentColor="#a855f7"
              gapPx={6}
              lengthScale={0.82}
              zIndexRange={[8, 0]}
            >
              <button
                type="button"
                onClick={() => {
                  const ms = solveNextLunarApsisOrNodeTime(state.timestampMs, 'descending-node');
                  setSelectedOrbitNode({
                    lonDeg: norm360(state.ascendingNodeLonDeg + 180),
                    targetTimeMs: ms,
                    label: 'Descending Node (☋ DN)',
                  });
                }}
                className="cursor-pointer px-1.5 py-0.5 rounded bg-[#130821]/90 hover:bg-purple-900/90 border border-purple-400/45 text-purple-200 font-mono-tech text-[8.5px] whitespace-nowrap shadow"
                title="Click to Warp to Next Descending Node"
              >
                ☋ Desc Node
              </button>
            </OrbitalCalloutPlacard>
          </group>

          {/* Cislunar Lagrange Points EM-L1 & EM-L2 — routed downward so they never overlap Moon's upper placard */}
          <group position={[l1Pos.x, l1Pos.y, l1Pos.z]}>
            <mesh>
              <octahedronGeometry args={[markerUnit * 0.8, 0]} />
              <meshBasicMaterial color="#22d3ee" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="down-left"
              accentColor="#22d3ee"
              gapPx={5}
              lengthScale={0.78}
              interactive={false}
              zIndexRange={[8, 0]}
            >
              <div className="px-1.5 py-0.5 rounded bg-[#050c16]/90 border border-cyan-400/40 text-cyan-300 font-mono-tech text-[8.5px] whitespace-nowrap shadow">
                EM-L1 (~58k km)
              </div>
            </OrbitalCalloutPlacard>
          </group>

          <group position={[l2Pos.x, l2Pos.y, l2Pos.z]}>
            <mesh>
              <octahedronGeometry args={[markerUnit * 0.8, 0]} />
              <meshBasicMaterial color="#22d3ee" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="down-right"
              accentColor="#22d3ee"
              gapPx={5}
              lengthScale={0.78}
              interactive={false}
              zIndexRange={[8, 0]}
            >
              <div className="px-1.5 py-0.5 rounded bg-[#050c16]/90 border border-cyan-400/40 text-cyan-300 font-mono-tech text-[8.5px] whitespace-nowrap shadow">
                EM-L2 (Far-Side Relay)
              </div>
            </OrbitalCalloutPlacard>
          </group>
        </>
      )}

      {/* Vertical Ecliptic Latitude Stem showing β above/below Ecliptic */}
      <Line
        points={[moonEclipticFoot, orbitGeom.moonPosition]}
        color="#fcd34d"
        lineWidth={1.3}
        transparent
        opacity={0.65}
      />

      {/* Direct-to-Earth (DTE) Comm Vector from Earth to Selected Lunar Site */}
      <Line
        points={[
          [0, 0, 0],
          [siteWorldPos.x, siteWorldPos.y, siteWorldPos.z],
        ]}
        color={evaluation.earth.isVisible ? '#10b981' : '#f43f5e'}
        lineWidth={evaluation.earth.isVisible ? 1.8 : 1.1}
        dashed={!evaluation.earth.isVisible}
        dashSize={baseOrbitRadius * 0.025}
        gapSize={baseOrbitRadius * 0.02}
        transparent
        opacity={0.75}
      />

      {/* ================================================================== */}
      {/* 3D ORBITING MOON + SMALL LEADER ARROW & INFO PLACARD               */}
      {/* ================================================================== */}
      <group position={orbitGeom.moonPosition}>
        <mesh
          quaternion={moonQuat}
          onClick={(e) => {
            e.stopPropagation();
            onSwitchToLunarSurface();
          }}
        >
          <sphereGeometry args={[moonRadius, 64, 64]} />
          <shaderMaterial
            ref={moonShaderRef}
            vertexShader={ORBIT_MOON_VERTEX_SHADER}
            fragmentShader={ORBIT_MOON_FRAGMENT_SHADER}
            uniforms={moonUniforms}
          />
        </mesh>

        {showLabels && (
          <OrbitalCalloutPlacard
            direction="up-right"
            accentColor="#fbbf24"
            gapPx={truePhysicalScale ? 7 : 16}
            lengthScale={1.18}
            showReticle={truePhysicalScale}
            reticleRadius={5}
            zIndexRange={[22, 0]}
          >
            <div className="rounded-lg bg-[#050a14]/95 border border-amber-400/75 px-2.5 py-1.5 font-mono-tech shadow-[0_8px_24px_rgba(0,0,0,0.85)] backdrop-blur-md space-y-1 tabular-nums">
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-[10.5px] font-bold text-[#fde68a] whitespace-nowrap">
                  ☾ MOON • {state.phaseName} ({state.illuminatedFractionPct}%)
                </span>
              </div>

              <div className="text-[9px] text-slate-200 whitespace-nowrap">
                {state.earthMoonDistanceKm.toLocaleString()} km ({state.earthMoonDistanceEarthRadii} R⊕) • V{' '}
                {state.moonOrbitalSpeedKms.toFixed(2)} km/s • β{' '}
                {state.moonGeoLatDeg > 0 ? '+' : ''}
                {state.moonGeoLatDeg}°
              </div>

              <div className="pt-0.5 border-t border-white/10 text-[8.5px]">
                <span
                  className={`whitespace-nowrap ${
                    evaluation.earth.isVisible ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  📍 {evaluation.site.name.split(' ')[0]} • DTE{' '}
                  {evaluation.earth.isVisible ? 'CLEAR' : 'OCCULTED'}
                </span>
              </div>
            </div>
          </OrbitalCalloutPlacard>
        )}
      </group>

      {/* Selected Landing Site Pin on the Orbiting Moon */}
      <group position={[siteWorldPos.x, siteWorldPos.y, siteWorldPos.z]}>
        <mesh>
          <sphereGeometry args={[moonRadius * 0.09, 12, 12]} />
          <meshBasicMaterial color="#fbbf24" />
        </mesh>
      </group>

      <OrbitControls
        ref={controlsRef}
        enablePan
        minDistance={earthRadius * 1.4}
        maxDistance={baseOrbitRadius * 5.5}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
};

// ============================================================================
// SCENE 2: HELIOCENTRIC VIEW — EARTH & MOON AROUND THE SUN
// ============================================================================
const HeliocentricScene: React.FC<{
  state: CelestialSystemState;
  astroPreset: AstroCameraPreset;
  astroPresetNonce: number;
  showLabels: boolean;
  onSwitchToEarthMoon: () => void;
  onSwitchToLunarSurface: () => void;
  onWarpToTime: (targetTimeMs: number, label: string) => void;
  onSnapToTime: (targetTimeMs: number) => void;
}> = ({
  state,
  astroPreset,
  astroPresetNonce,
  showLabels,
  onSwitchToEarthMoon,
  onSwitchToLunarSurface,
  onWarpToTime,
  onSnapToTime,
}) => {
  const [moonColorMap, moonDemMap] = useLoader(THREE.TextureLoader, [
    '/textures/lroc_color.jpg',
    '/textures/lola_dem.jpg',
  ]);

  const controlsRef = useRef<any>(null);
  const sunShaderRef = useRef<THREE.ShaderMaterial>(null);
  const earthShaderRef = useRef<THREE.ShaderMaterial>(null);
  const moonShaderRef = useRef<THREE.ShaderMaterial>(null);
  const flyCamPos = useRef<THREE.Vector3 | null>(null);
  const flyTarget = useRef<THREE.Vector3 | null>(null);
  const prevEarthPosRef = useRef<THREE.Vector3 | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [hoverHelioLon, setHoverHelioLon] = useState<number | null>(null);
  const [selectedHelioNode, setSelectedHelioNode] = useState<{
    lonDeg: number;
    targetTimeMs: number;
    label: string;
  } | null>(null);
  const { camera } = useThree();

  // Schematic Solar System Dimensions (clear visibility of Sun, 1 AU Earth Orbit, and Moon's local orbit!)
  const sunRadius = 2.15;
  const auSceneRadius = 19.5;
  const earthRadius = 0.68;
  const moonOrbitSceneRadius = 2.35;
  const moonRadius = 0.25;

  const helioGeom = useMemo(
    () =>
      sampleEarthHeliocentricOrbit(
        state,
        auSceneRadius,
        moonOrbitSceneRadius,
        2.5,
        240
      ),
    [state]
  );

  // Invisible raycast tube along Earth's 1 AU orbit for KSP "Warp Here"
  const earthOrbitHitCurve = useMemo(() => {
    const vecs = helioGeom.earthOrbitPoints
      .slice(0, -1)
      .map(([x, y, z]) => new THREE.Vector3(x, y, z));
    return new THREE.CatmullRomCurve3(vecs, true);
  }, [helioGeom.earthOrbitPoints]);

  useEffect(() => {
    if (
      selectedHelioNode &&
      state.timestampMs >= selectedHelioNode.targetTimeMs - 300_000
    ) {
      setSelectedHelioNode(null);
    }
  }, [state.timestampMs, selectedHelioNode]);

  const earthPosVec = useMemo(
    () => new THREE.Vector3(...helioGeom.earthPosition),
    [helioGeom.earthPosition]
  );

  // Local Moon orbit around Earth inside Heliocentric scene
  const localMoonOrbit = useMemo(
    () =>
      sampleMoonGeocentricOrbit(
        state,
        (distKm) => moonOrbitSceneRadius * (distKm / 384400),
        120
      ),
    [state]
  );

  const moonWorldPos = useMemo(
    () =>
      new THREE.Vector3(
        earthPosVec.x + localMoonOrbit.moonPosition[0],
        earthPosVec.y + localMoonOrbit.moonPosition[1] * 2.2, // match epicycle vertical clarity
        earthPosVec.z + localMoonOrbit.moonPosition[2]
      ),
    [earthPosVec, localMoonOrbit.moonPosition]
  );

  const localMoonRingShifted = useMemo<[number, number, number][]>(
    () =>
      localMoonOrbit.curvePoints.map(([x, y, z]) => [
        earthPosVec.x + x,
        earthPosVec.y + y * 2.2,
        earthPosVec.z + z,
      ]),
    [earthPosVec, localMoonOrbit.curvePoints]
  );

  const moonQuat = useMemo(() => {
    const toEarth = earthPosVec.clone().sub(moonWorldPos).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const zAxis = new THREE.Vector3().crossVectors(toEarth, up).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, toEarth).normalize();
    const m = new THREE.Matrix4().makeBasis(toEarth, yAxis, zAxis);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [earthPosVec, moonWorldPos]);

  const sunUniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const earthUniforms = useMemo(
    () => ({
      uSunWorldPos: { value: new THREE.Vector3(0, 0, 0) },
      uIsPointSun: { value: 1.0 },
      uSunDirWorld: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 },
    }),
    []
  );
  const moonUniforms = useMemo(
    () => ({
      uColorMap: { value: moonColorMap },
      uDemMap: { value: moonDemMap },
      uSunWorldPos: { value: new THREE.Vector3(0, 0, 0) },
      uIsPointSun: { value: 1.0 },
      uSunDirWorld: { value: new THREE.Vector3(1, 0, 0) },
      uEarthWorldPos: { value: new THREE.Vector3(0, 0, 0) },
    }),
    [moonColorMap, moonDemMap]
  );

  // Camera Preset Transitions
  useEffect(() => {
    if (astroPreset === 'helio-top') {
      flyTarget.current = new THREE.Vector3(0, 0, 0);
      flyCamPos.current = new THREE.Vector3(0, auSceneRadius * 2.35, 0.02);
    } else if (astroPreset === 'helio-follow-em') {
      const radialOut = earthPosVec.clone().normalize();
      const camOffset = radialOut
        .multiplyScalar(moonOrbitSceneRadius * 2.8)
        .add(new THREE.Vector3(0, moonOrbitSceneRadius * 2.1, 0));
      flyTarget.current = earthPosVec.clone();
      flyCamPos.current = earthPosVec.clone().add(camOffset);
      prevEarthPosRef.current = earthPosVec.clone();
    } else if (astroPreset === 'helio-tilt') {
      // Side-on view to showcase Earth's 23.44° axial obliquity relative to Sun rays
      const tangent = new THREE.Vector3(-earthPosVec.z, 0, earthPosVec.x).normalize();
      flyTarget.current = earthPosVec.clone();
      flyCamPos.current = earthPosVec
        .clone()
        .add(tangent.multiplyScalar(moonOrbitSceneRadius * 3.1))
        .add(new THREE.Vector3(0, moonOrbitSceneRadius * 0.65, 0));
      prevEarthPosRef.current = earthPosVec.clone();
    } else {
      // helio-overview
      flyTarget.current = new THREE.Vector3(0, 0, 0);
      flyCamPos.current = new THREE.Vector3(
        auSceneRadius * 0.95,
        auSceneRadius * 1.15,
        auSceneRadius * 1.65
      );
    }
  }, [astroPreset, astroPresetNonce]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    if (sunShaderRef.current) {
      sunShaderRef.current.uniforms.uTime.value = t;
    }
    if (earthShaderRef.current) {
      earthShaderRef.current.uniforms.uTime.value = t;
    }
    if (moonShaderRef.current) {
      moonShaderRef.current.uniforms.uEarthWorldPos.value.copy(earthPosVec);
    }

    // Smoothly co-move camera with Earth when in follow modes!
    const isFollowingEarth =
      astroPreset === 'helio-follow-em' || astroPreset === 'helio-tilt';
    if (isFollowingEarth && !flyCamPos.current && controlsRef.current) {
      if (prevEarthPosRef.current) {
        const deltaEarth = earthPosVec.clone().sub(prevEarthPosRef.current);
        if (deltaEarth.lengthSq() < 100) {
          camera.position.add(deltaEarth);
          controlsRef.current.target.add(deltaEarth);
        } else {
          controlsRef.current.target.copy(earthPosVec);
        }
        controlsRef.current.update();
      }
      prevEarthPosRef.current = earthPosVec.clone();
    } else {
      prevEarthPosRef.current = earthPosVec.clone();
    }

    if (flyCamPos.current && controlsRef.current) {
      const step = Math.min(1, delta * 4.5);
      camera.position.lerp(flyCamPos.current, step);
      if (flyTarget.current) {
        controlsRef.current.target.lerp(flyTarget.current, step);
      }
      controlsRef.current.update();
      if (camera.position.distanceTo(flyCamPos.current) < 0.15) {
        flyCamPos.current = null;
      }
    }
  });

  return (
    <>
      <color attach="background" args={['#02050a']} />
      <Stars radius={180} depth={80} count={5200} factor={4.0} saturation={0.2} fade />

      {/* Ecliptic Heliocentric Polar Grid (0.5 AU, 1.0 AU, 1.25 AU) */}
      <EclipticGridRings
        radii={[auSceneRadius * 0.45, auSceneRadius * 0.75, auSceneRadius, auSceneRadius * 1.2]}
        maxSpokeRadius={auSceneRadius * 1.2}
        opacity={0.12}
      />

      {/* ================================================================== */}
      {/* 3D SUN AT HELIOCENTRIC ORIGIN [0, 0, 0]                            */}
      {/* ================================================================== */}
      <group position={[0, 0, 0]}>
        <mesh>
          <sphereGeometry args={[sunRadius, 64, 64]} />
          <shaderMaterial
            ref={sunShaderRef}
            vertexShader={SUN_VERTEX_SHADER}
            fragmentShader={SUN_FRAGMENT_SHADER}
            uniforms={sunUniforms}
          />
        </mesh>
        {/* Multi-shell Additive Solar Corona */}
        <mesh>
          <sphereGeometry args={[sunRadius * 1.18, 40, 40]} />
          <meshBasicMaterial
            color="#f59e0b"
            transparent
            opacity={0.22}
            side={THREE.BackSide}
          />
        </mesh>
        <mesh>
          <sphereGeometry args={[sunRadius * 1.48, 40, 40]} />
          <meshBasicMaterial
            color="#ea580c"
            transparent
            opacity={0.09}
            side={THREE.BackSide}
          />
        </mesh>

        {showLabels && (
          <OrbitalCalloutPlacard
            direction="up"
            accentColor="#fbbf24"
            gapPx={24}
            lengthScale={1.2}
            interactive={false}
            zIndexRange={[12, 0]}
          >
            <div className="px-2.5 py-0.5 rounded bg-[#140c04]/95 border border-[#fbbf24]/70 text-[#fef08a] font-mono-tech font-bold text-[10px] whitespace-nowrap shadow-lg">
              ☉ SUN
            </div>
          </OrbitalCalloutPlacard>
        )}
      </group>

      {/* Sun -> Earth Radius Vector */}
      <Line
        points={[[0, 0, 0], helioGeom.earthPosition]}
        color="#fbbf24"
        lineWidth={1.3}
        dashed
        dashSize={0.55}
        gapSize={0.35}
        transparent
        opacity={0.55}
      />

      {/* ================================================================== */}
      {/* EARTH'S 1 AU ELLIPTICAL ORBIT + SEASONAL & APSIDAL MARKERS         */}
      {/* ================================================================== */}
      <Line
        points={helioGeom.earthOrbitPoints}
        color="#38bdf8"
        lineWidth={2.0}
        transparent
        opacity={0.75}
      />

      {/* Invisible Raycast Hit-Tube along Earth's 1 AU Orbit for KSP "Warp Here" */}
      <mesh
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          pointerDownRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const lon = norm360(Math.atan2(-e.point.z, e.point.x) * (180 / Math.PI));
          setHoverHelioLon(lon);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHoverHelioLon(null);
          document.body.style.cursor = 'auto';
        }}
        onPointerUp={(e: ThreeEvent<PointerEvent>) => {
          if (!pointerDownRef.current) return;
          const dist = Math.hypot(
            e.clientX - pointerDownRef.current.x,
            e.clientY - pointerDownRef.current.y
          );
          pointerDownRef.current = null;
          if (dist < 6) {
            e.stopPropagation();
            const lon = norm360(Math.atan2(-e.point.z, e.point.x) * (180 / Math.PI));
            const targetMs = solveNextEarthHelioLonTime(state.timestampMs, lon);
            setSelectedHelioNode({
              lonDeg: lon,
              targetTimeMs: targetMs,
              label: `Earth 1 AU Orbit (λ⊕ ${lon.toFixed(0)}°)`,
            });
          }
        }}
      >
        <tubeGeometry args={[earthOrbitHitCurve, 180, 0.55, 8, true]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* KSP Hover Ghost Reticle on Earth's 1 AU Orbit */}
      {hoverHelioLon !== null && !selectedHelioNode && (() => {
        const hoverPt = evalEarthOrbitPointAtLon(hoverHelioLon, auSceneRadius, 2.5);
        const hoverMs = solveNextEarthHelioLonTime(state.timestampMs, hoverHelioLon);
        return (
          <group position={hoverPt}>
            <mesh>
              <sphereGeometry args={[0.24, 16, 16]} />
              <meshBasicMaterial color="#4ade80" transparent opacity={0.9} />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up"
              accentColor="#4ade80"
              gapPx={7}
              lengthScale={0.95}
              interactive={false}
              zIndexRange={[25, 0]}
            >
              <div className="px-2 py-0.5 rounded bg-[#051810]/95 border border-emerald-400/75 text-emerald-200 font-mono-tech text-[9.5px] whitespace-nowrap shadow-lg tabular-nums">
                T + {formatWarpDelta(hoverMs - state.timestampMs)} ({formatUtcParts(hoverMs).dateStr})
              </div>
            </OrbitalCalloutPlacard>
          </group>
        );
      })()}

      {/* Locked KSP "Warp Here" Maneuver/Target Node on Earth's 1 AU Orbit */}
      {selectedHelioNode && (() => {
        const nodePt = evalEarthOrbitPointAtLon(selectedHelioNode.lonDeg, auSceneRadius, 2.5);
        const remMs = Math.max(0, selectedHelioNode.targetTimeMs - state.timestampMs);
        return (
          <group position={nodePt}>
            <mesh>
              <octahedronGeometry args={[0.34, 0]} />
              <meshBasicMaterial color="#22c55e" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up-right"
              accentColor="#22c55e"
              gapPx={7}
              lengthScale={1.05}
              showReticle
              reticleRadius={5.5}
              zIndexRange={[32, 0]}
            >
              <div className="rounded-lg bg-[#04130d]/95 border border-emerald-400/80 px-2.5 py-1.5 font-mono-tech shadow-2xl space-y-1 min-w-[195px] tabular-nums">
                <div className="flex items-center justify-between gap-2 text-[9.5px] text-emerald-300 font-bold">
                  <span>◈ {selectedHelioNode.label}</span>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedHelioNode(null);
                    }}
                    className="text-slate-400 hover:text-white cursor-pointer px-1"
                    title="Dismiss Warp Node"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-[9px] text-slate-300">
                  ETA: <strong className="text-white">T − {formatWarpDelta(remMs)}</strong> •{' '}
                  {formatUtcParts(selectedHelioNode.targetTimeMs).dateStr}
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onWarpToTime(selectedHelioNode.targetTimeMs, selectedHelioNode.label);
                    }}
                    className="flex-1 px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-[#04130d] font-bold text-[10px] cursor-pointer shadow"
                  >
                    ▸▸▸ Warp Here
                  </button>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSnapToTime(selectedHelioNode.targetTimeMs);
                      setSelectedHelioNode(null);
                    }}
                    className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 border border-white/20 text-slate-200 text-[9.5px] cursor-pointer"
                    title="Instant Jump (0s)"
                  >
                    ⚡ Snap
                  </button>
                </div>
              </div>
            </OrbitalCalloutPlacard>
          </group>
        );
      })()}

      {/* Moon's 90-Day Heliocentric Wavy Epicycle Path */}
      <Line
        points={helioGeom.moonEpicycleTrail}
        color="#fde047"
        lineWidth={1.5}
        transparent
        opacity={0.65}
      />

      {showLabels && (
        <>
          <group position={helioGeom.perihelionPoint}>
            <mesh>
              <sphereGeometry args={[0.18, 12, 12]} />
              <meshBasicMaterial color="#34d399" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up"
              accentColor="#34d399"
              gapPx={6}
              lengthScale={0.85}
              zIndexRange={[7, 0]}
            >
              <button
                type="button"
                onClick={() => {
                  const ms = solveNextEarthHelioLonTime(state.timestampMs, 102.9373);
                  setSelectedHelioNode({
                    lonDeg: 102.9373,
                    targetTimeMs: ms,
                    label: 'Earth Perihelion (~Jan 3)',
                  });
                }}
                className="cursor-pointer px-1.5 py-0.5 rounded bg-[#041610]/92 hover:bg-emerald-900/90 border border-emerald-400/55 text-emerald-300 font-mono-tech text-[9px] whitespace-nowrap shadow"
                title="Click to Warp to Earth Perihelion"
              >
                Perihelion • ~Jan 3 (0.983 AU)
              </button>
            </OrbitalCalloutPlacard>
          </group>

          <group position={helioGeom.aphelionPoint}>
            <mesh>
              <sphereGeometry args={[0.18, 12, 12]} />
              <meshBasicMaterial color="#f59e0b" />
            </mesh>
            <OrbitalCalloutPlacard
              direction="up"
              accentColor="#f59e0b"
              gapPx={6}
              lengthScale={0.85}
              zIndexRange={[7, 0]}
            >
              <button
                type="button"
                onClick={() => {
                  const ms = solveNextEarthHelioLonTime(state.timestampMs, 282.9373);
                  setSelectedHelioNode({
                    lonDeg: 282.9373,
                    targetTimeMs: ms,
                    label: 'Earth Aphelion (~Jul 4)',
                  });
                }}
                className="cursor-pointer px-1.5 py-0.5 rounded bg-[#181004]/92 hover:bg-amber-900/90 border border-amber-400/55 text-amber-300 font-mono-tech text-[9px] whitespace-nowrap shadow"
                title="Click to Warp to Earth Aphelion"
              >
                Aphelion • ~Jul 4 (1.017 AU)
              </button>
            </OrbitalCalloutPlacard>
          </group>

          {[
            { pt: helioGeom.vernalEquinoxPoint, lon: 180, lbl: 'Mar Equinox (λ⊕ 180°)' },
            { pt: helioGeom.juneSolsticePoint, lon: 270, lbl: 'Jun Solstice (λ⊕ 270°)' },
            { pt: helioGeom.autumnalEquinoxPoint, lon: 0, lbl: 'Sep Equinox (λ⊕ 0°)' },
            { pt: helioGeom.decSolsticePoint, lon: 90, lbl: 'Dec Solstice (λ⊕ 90°)' },
          ].map((item) => (
            <group key={item.lbl} position={item.pt}>
              <mesh>
                <sphereGeometry args={[0.13, 10, 10]} />
                <meshBasicMaterial color="#94a3b8" />
              </mesh>
              <OrbitalCalloutPlacard
                direction="down"
                accentColor="#94a3b8"
                gapPx={5}
                lengthScale={0.78}
                zIndexRange={[6, 0]}
              >
                <button
                  type="button"
                  onClick={() => {
                    const ms = solveNextEarthHelioLonTime(state.timestampMs, item.lon);
                    setSelectedHelioNode({
                      lonDeg: item.lon,
                      targetTimeMs: ms,
                      label: item.lbl,
                    });
                  }}
                  className="cursor-pointer px-1.5 py-0.5 rounded bg-[#070c16]/90 hover:bg-slate-800 border border-white/25 text-slate-300 hover:text-white font-mono-tech text-[8.5px] whitespace-nowrap shadow"
                  title={`Click to Warp to ${item.lbl}`}
                >
                  {item.lbl}
                </button>
              </OrbitalCalloutPlacard>
            </group>
          ))}
        </>
      )}

      {/* ================================================================== */}
      {/* MOVING EARTH–MOON SUBSYSTEM ORBITING THE SUN                       */}
      {/* ================================================================== */}
      <group position={helioGeom.earthPosition}>
        <group rotation={[-state.earthObliquityDeg * DEG2RAD, 0, 0]}>
          {/* Earth Spin Axis showing fixed inertial 23.44° tilt */}
          <Line
            points={[
              [0, -earthRadius * 1.7, 0],
              [0, earthRadius * 1.7, 0],
            ]}
            color="#38bdf8"
            lineWidth={1.3}
            transparent
            opacity={0.75}
          />
          <mesh
            rotation={[0, state.earthGmstDeg * DEG2RAD, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSwitchToEarthMoon();
            }}
          >
            <sphereGeometry args={[earthRadius, 48, 48]} />
            <shaderMaterial
              ref={earthShaderRef}
              vertexShader={EARTH_VERTEX_SHADER}
              fragmentShader={EARTH_FRAGMENT_SHADER}
              uniforms={earthUniforms}
            />
          </mesh>
        </group>

        {showLabels && (
          <OrbitalCalloutPlacard
            direction="up-left"
            accentColor="#38bdf8"
            gapPx={12}
            lengthScale={1.12}
            zIndexRange={[18, 0]}
          >
            <button
              type="button"
              onClick={onSwitchToEarthMoon}
              className="cursor-pointer rounded-lg bg-[#050a14]/95 hover:bg-[#0c1628] border border-sky-400/65 px-2.5 py-1 text-left font-mono-tech shadow-[0_6px_20px_rgba(0,0,0,0.8)] backdrop-blur-md tabular-nums"
              title="Click to inspect Geocentric Earth–Moon System"
            >
              <div className="text-[10px] font-bold text-sky-200 whitespace-nowrap">
                ⊕ EARTH • {state.earthSunDistanceAu} AU ({state.earthOrbitalSpeedKms} km/s)
              </div>
              <div className="text-[8.5px] text-slate-300 whitespace-nowrap">
                {state.earthSeasonLabel}
              </div>
            </button>
          </OrbitalCalloutPlacard>
        )}
      </group>

      {/* Local Moon Orbit Ring Around Moving Earth */}
      <Line
        points={localMoonRingShifted}
        color="#cbd5e1"
        lineWidth={1.3}
        transparent
        opacity={0.65}
      />

      {/* Orbiting 3D Moon (routed down-right so it never collides with Earth's up-left placard) */}
      <group position={[moonWorldPos.x, moonWorldPos.y, moonWorldPos.z]}>
        <mesh
          quaternion={moonQuat}
          onClick={(e) => {
            e.stopPropagation();
            onSwitchToLunarSurface();
          }}
        >
          <sphereGeometry args={[moonRadius, 40, 40]} />
          <shaderMaterial
            ref={moonShaderRef}
            vertexShader={ORBIT_MOON_VERTEX_SHADER}
            fragmentShader={ORBIT_MOON_FRAGMENT_SHADER}
            uniforms={moonUniforms}
          />
        </mesh>

        {showLabels && (
          <OrbitalCalloutPlacard
            direction="down-right"
            accentColor="#fbbf24"
            gapPx={8}
            lengthScale={1.08}
            zIndexRange={[18, 0]}
          >
            <button
              type="button"
              onClick={onSwitchToLunarSurface}
              className="cursor-pointer rounded-lg bg-[#050a14]/95 hover:bg-[#121827] border border-amber-400/65 px-2 py-1 text-left font-mono-tech shadow-[0_6px_20px_rgba(0,0,0,0.8)] backdrop-blur-md tabular-nums"
              title="Click to zoom into 3D Lunar Surface View"
            >
              <div className="text-[9.5px] font-bold text-[#fde68a] whitespace-nowrap">
                ☾ MOON • {state.phaseName} ({state.illuminatedFractionPct}%)
              </div>
              <div className="text-[8.5px] text-slate-300 whitespace-nowrap">
                Dist {Math.round(state.earthMoonDistanceKm).toLocaleString()} km
              </div>
            </button>
          </OrbitalCalloutPlacard>
        )}
      </group>

      <OrbitControls
        ref={controlsRef}
        enablePan
        minDistance={1.6}
        maxDistance={78}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
};

export const CelestialSystem3D: React.FC<CelestialSystem3DProps> = ({
  mode,
  simTimeMs,
  evaluation,
  astroPreset,
  astroPresetNonce,
  truePhysicalScale,
  showLabels,
  onSwitchToEarthMoon,
  onSwitchToLunarSurface,
  onWarpToTime,
  onSnapToTime,
}) => {
  const state = useMemo(
    () => computeCelestialSystemState(simTimeMs),
    [simTimeMs]
  );

  return (
    <div className="w-full h-full relative select-none">
      <Canvas
        camera={{ position: [12, 10, 16], fov: 42, near: 0.02, far: 450 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
      >
        <React.Suspense fallback={null}>
          {mode === 'earth-moon' ? (
            <EarthMoonScene
              state={state}
              evaluation={evaluation}
              astroPreset={astroPreset}
              astroPresetNonce={astroPresetNonce}
              truePhysicalScale={truePhysicalScale}
              showLabels={showLabels}
              onSwitchToLunarSurface={onSwitchToLunarSurface}
              onWarpToTime={onWarpToTime}
              onSnapToTime={onSnapToTime}
            />
          ) : (
            <HeliocentricScene
              state={state}
              astroPreset={astroPreset}
              astroPresetNonce={astroPresetNonce}
              showLabels={showLabels}
              onSwitchToEarthMoon={onSwitchToEarthMoon}
              onSwitchToLunarSurface={onSwitchToLunarSurface}
              onWarpToTime={onWarpToTime}
              onSnapToTime={onSnapToTime}
            />
          )}
        </React.Suspense>
      </Canvas>
    </div>
  );
};
