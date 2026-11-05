import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import {
  computeCelestialSystemState,
  eclipticToCartesian,
  sampleEarthHeliocentricOrbit,
  sampleMoonGeocentricOrbit,
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

    // Atmospheric Rayleigh limb glow
    float fresnel = pow(1.0 - max(0.0, dot(nWorld, V)), 3.2);
    vec3 atmoColor = mix(vec3(0.08, 0.25, 0.55), vec3(0.28, 0.68, 1.0), dayFactor);

    vec3 litDay = surfaceCol * (0.10 + 1.08 * pow(diffuse, 0.85)) + vec3(0.85, 0.90, 1.0) * spec * 0.45 * dayFactor;
    vec3 litNight = surfaceCol * 0.045 + nightLights * (1.0 - dayFactor);
    vec3 finalCol = mix(litNight, litDay, dayFactor) + atmoColor * fresnel * (0.28 + 0.65 * dayFactor);

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

    float sunDot = dot(N, L);
    float sunlit = smoothstep(-0.04, 0.06, sunDot);
    // Lommel-Seeliger lunar scattering
    float lommel = sunlit * mix(max(0.0, sunDot), pow(max(0.0, sunDot), 0.62), 0.65);

    // Subtle bluish Earthshine on the unlit lunar nightside facing Earth!
    float earthDot = max(0.0, dot(N, E));
    vec3 earthshine = vec3(0.42, 0.62, 0.95) * earthDot * 0.11 + vec3(0.055);

    vec3 base = pow(albedo, vec3(0.92)) * (0.88 + 0.22 * dem);
    vec3 col = base * mix(earthshine, vec3(1.18, 1.15, 1.09) * max(0.12, lommel), sunlit);

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
}> = ({
  state,
  evaluation,
  astroPreset,
  astroPresetNonce,
  truePhysicalScale,
  showLabels,
  onSwitchToLunarSurface,
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
  const { camera } = useThree();

  // Scale configuration:
  // True 1:1 Scale: R_earth = 0.26, R_moon = 0.071, orbit ~ 15.7 units (exact 60.3x R_earth!)
  // Schematic Scale: R_earth = 0.92, R_moon = 0.36, orbit ~ 6.8 units (both spheres & 5.15° tilt crystal clear!)
  const earthRadius = truePhysicalScale ? 0.26 : 0.92;
  const moonRadius = truePhysicalScale ? 0.26 * (1737.4 / 6371.0) : 0.36;
  const baseOrbitRadius = truePhysicalScale ? 0.26 * (384400 / 6371.0) : 6.8;

  const orbitGeom = useMemo(
    () =>
      sampleMoonGeocentricOrbit(
        state,
        (distKm) => baseOrbitRadius * (distKm / 384400),
        192
      ),
    [state, baseOrbitRadius]
  );

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

  return (
    <>
      <color attach="background" args={['#03060c']} />
      <Stars radius={120} depth={65} count={4800} factor={3.4} saturation={0.15} fade />

      {/* Ecliptic Reference Plane Grid */}
      <EclipticGridRings
        radii={[baseOrbitRadius * 0.45, baseOrbitRadius * 0.75, baseOrbitRadius, baseOrbitRadius * 1.22]}
        maxSpokeRadius={baseOrbitRadius * 1.22}
        opacity={0.14}
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
          <sphereGeometry args={[earthRadius * 0.22, 20, 20]} />
          <meshBasicMaterial color="#fde047" />
        </mesh>
        {showLabels && (
          <Html position={[0, earthRadius * 0.42, 0]} center zIndexRange={[10, 0]}>
            <div className="pointer-events-none px-2 py-0.5 rounded bg-[#f59e0b]/20 border border-[#f59e0b]/60 text-[#fde68a] font-mono-tech text-[10px] whitespace-nowrap">
              ☉ TO SUN (1 AU • {state.earthSunDistanceAu} AU)
            </div>
          </Html>
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
      <group rotation={[-state.earthObliquityDeg * DEG2RAD, 0, 0]}>
        {/* Earth North-South Spin Axis */}
        <Line
          points={[
            [0, -earthRadius * 1.55, 0],
            [0, earthRadius * 1.55, 0],
          ]}
          color="#38bdf8"
          lineWidth={1.3}
          transparent
          opacity={0.65}
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
          opacity={0.45}
        />

        {/* Spinning Earth Globe */}
        <mesh rotation={[0, state.earthGmstDeg * DEG2RAD, 0]}>
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
          <sphereGeometry args={[earthRadius * 1.035, 48, 48]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.09}
            side={THREE.BackSide}
          />
        </mesh>

        {showLabels && (
          <Html position={[0, earthRadius * 1.72, 0]} center zIndexRange={[12, 0]}>
            <div className="pointer-events-none px-2 py-0.5 rounded bg-[#060911]/90 border border-sky-400/50 text-sky-200 font-mono-tech text-[10px] whitespace-nowrap shadow">
              ⊕ EARTH • Tilt {state.earthObliquityDeg}°
            </div>
          </Html>
        )}
      </group>

      {/* ================================================================== */}
      {/* MOON'S INCLINED (5.145°) ELLIPTICAL ORBIT AROUND EARTH             */}
      {/* ================================================================== */}
      <Line
        points={orbitGeom.curvePoints}
        color="#7dd3fc"
        lineWidth={2.2}
        transparent
        opacity={0.78}
      />

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

      {/* Orbital Mechanics Key Markers: Perigee, Apogee, Nodes, L1/L2 */}
      {showLabels && (
        <>
          <group position={orbitGeom.perigeePoint}>
            <mesh>
              <sphereGeometry args={[earthRadius * 0.07, 12, 12]} />
              <meshBasicMaterial color="#34d399" />
            </mesh>
            <Html position={[0, earthRadius * 0.22, 0]} center zIndexRange={[8, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-emerald-950/85 border border-emerald-400/45 text-emerald-300 font-mono-tech text-[9px] whitespace-nowrap">
                P • Perigee (~363k km)
              </div>
            </Html>
          </group>

          <group position={orbitGeom.apogeePoint}>
            <mesh>
              <sphereGeometry args={[earthRadius * 0.07, 12, 12]} />
              <meshBasicMaterial color="#f59e0b" />
            </mesh>
            <Html position={[0, earthRadius * 0.22, 0]} center zIndexRange={[8, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-amber-950/85 border border-amber-400/45 text-amber-300 font-mono-tech text-[9px] whitespace-nowrap">
                A • Apogee (~405k km)
              </div>
            </Html>
          </group>

          <group position={orbitGeom.ascendingNodePoint}>
            <mesh>
              <octahedronGeometry args={[earthRadius * 0.08, 0]} />
              <meshBasicMaterial color="#c084fc" />
            </mesh>
            <Html position={[0, earthRadius * 0.2, 0]} center zIndexRange={[8, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-purple-950/85 border border-purple-400/45 text-purple-200 font-mono-tech text-[9px] whitespace-nowrap">
                ☊ Asc Node ({state.ascendingNodeLonDeg.toFixed(0)}°)
              </div>
            </Html>
          </group>

          {/* Cislunar Lagrange Points EM-L1 & EM-L2 */}
          <group position={[l1Pos.x, l1Pos.y, l1Pos.z]}>
            <mesh>
              <octahedronGeometry args={[earthRadius * 0.06, 0]} />
              <meshBasicMaterial color="#22d3ee" />
            </mesh>
            <Html position={[0, earthRadius * 0.18, 0]} center zIndexRange={[8, 0]}>
              <div className="pointer-events-none px-1 py-0.2 rounded bg-[#060911]/85 border border-cyan-400/35 text-cyan-300 font-mono-tech text-[8.5px] whitespace-nowrap">
                EM-L1
              </div>
            </Html>
          </group>

          <group position={[l2Pos.x, l2Pos.y, l2Pos.z]}>
            <mesh>
              <octahedronGeometry args={[earthRadius * 0.06, 0]} />
              <meshBasicMaterial color="#22d3ee" />
            </mesh>
            <Html position={[0, earthRadius * 0.18, 0]} center zIndexRange={[8, 0]}>
              <div className="pointer-events-none px-1 py-0.2 rounded bg-[#060911]/85 border border-cyan-400/35 text-cyan-300 font-mono-tech text-[8.5px] whitespace-nowrap">
                EM-L2 (Far-Side Relay)
              </div>
            </Html>
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
      {/* 3D ORBITING MOON (Tidally Locked + True Solar Phase + Site Pin)    */}
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
          <Html position={[0, moonRadius * 1.65 + 0.12, 0]} center zIndexRange={[15, 0]}>
            <button
              type="button"
              onClick={onSwitchToLunarSurface}
              className="pointer-events-auto cursor-pointer px-2 py-0.5 rounded-md bg-[#080d1a]/92 hover:bg-[#0f172a] border border-amber-400/60 text-left font-mono-tech shadow-lg transition-colors"
              title="Click to zoom into 3D Lunar Surface View"
            >
              <div className="text-[10px] font-bold text-[#fde68a] whitespace-nowrap">
                ☾ MOON • {state.phaseName} ({state.illuminatedFractionPct}%)
              </div>
              <div className="text-[9px] text-slate-300 whitespace-nowrap">
                {state.earthMoonDistanceKm.toLocaleString()} km ({state.earthMoonDistanceEarthRadii} R⊕) • β {state.moonGeoLatDeg > 0 ? '+' : ''}
                {state.moonGeoLatDeg}°
              </div>
            </button>
          </Html>
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
}> = ({
  state,
  astroPreset,
  astroPresetNonce,
  showLabels,
  onSwitchToEarthMoon,
  onSwitchToLunarSurface,
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
          <Html position={[0, sunRadius * 1.55, 0]} center zIndexRange={[12, 0]}>
            <div className="pointer-events-none px-2.5 py-0.5 rounded bg-[#f59e0b]/20 border border-[#fbbf24]/65 text-[#fef08a] font-mono-tech font-bold text-[10px] whitespace-nowrap shadow-lg">
              ☉ SUN (Heliocentric Origin)
            </div>
          </Html>
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
        opacity={0.68}
      />

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
            <Html position={[0, 0.55, 0]} center zIndexRange={[6, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-400/40 text-emerald-300 font-mono-tech text-[9px] whitespace-nowrap">
                Perihelion • ~Jan 3 (0.983 AU)
              </div>
            </Html>
          </group>

          <group position={helioGeom.aphelionPoint}>
            <mesh>
              <sphereGeometry args={[0.18, 12, 12]} />
              <meshBasicMaterial color="#f59e0b" />
            </mesh>
            <Html position={[0, 0.55, 0]} center zIndexRange={[6, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-400/40 text-amber-300 font-mono-tech text-[9px] whitespace-nowrap">
                Aphelion • ~Jul 4 (1.017 AU)
              </div>
            </Html>
          </group>

          <group position={helioGeom.vernalEquinoxPoint}>
            <Html position={[0, -0.5, 0]} center zIndexRange={[5, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-slate-900/80 border border-white/15 text-slate-300 font-mono-tech text-[8.5px] whitespace-nowrap">
                Mar Equinox (λ⊕ 180°)
              </div>
            </Html>
          </group>

          <group position={helioGeom.juneSolsticePoint}>
            <Html position={[0, -0.5, 0]} center zIndexRange={[5, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-slate-900/80 border border-white/15 text-slate-300 font-mono-tech text-[8.5px] whitespace-nowrap">
                Jun Solstice (λ⊕ 270°)
              </div>
            </Html>
          </group>

          <group position={helioGeom.autumnalEquinoxPoint}>
            <Html position={[0, -0.5, 0]} center zIndexRange={[5, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-slate-900/80 border border-white/15 text-slate-300 font-mono-tech text-[8.5px] whitespace-nowrap">
                Sep Equinox (λ⊕ 0°)
              </div>
            </Html>
          </group>

          <group position={helioGeom.decSolsticePoint}>
            <Html position={[0, -0.5, 0]} center zIndexRange={[5, 0]}>
              <div className="pointer-events-none px-1.5 py-0.2 rounded bg-slate-900/80 border border-white/15 text-slate-300 font-mono-tech text-[8.5px] whitespace-nowrap">
                Dec Solstice (λ⊕ 90°)
              </div>
            </Html>
          </group>
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
          <Html position={[0, earthRadius * 2.1, 0]} center zIndexRange={[14, 0]}>
            <button
              type="button"
              onClick={onSwitchToEarthMoon}
              className="pointer-events-auto cursor-pointer px-2 py-0.5 rounded bg-[#080d1a]/92 hover:bg-[#0f172a] border border-sky-400/60 text-left font-mono-tech shadow-lg"
              title="Click to inspect Geocentric Earth–Moon System"
            >
              <div className="text-[10px] font-bold text-sky-200 whitespace-nowrap">
                ⊕ EARTH • {state.earthSunDistanceAu} AU ({state.earthOrbitalSpeedKms} km/s)
              </div>
              <div className="text-[8.5px] text-slate-300 whitespace-nowrap">
                {state.earthSeasonLabel}
              </div>
            </button>
          </Html>
        )}
      </group>

      {/* Local Moon Orbit Ring Around Moving Earth */}
      <Line
        points={localMoonRingShifted}
        color="#cbd5e1"
        lineWidth={1.3}
        transparent
        opacity={0.62}
      />

      {/* Orbiting 3D Moon */}
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
          <Html position={[0, moonRadius * 1.9, 0]} center zIndexRange={[14, 0]}>
            <button
              type="button"
              onClick={onSwitchToLunarSurface}
              className="pointer-events-auto cursor-pointer px-1.5 py-0.5 rounded bg-[#080d1a]/90 hover:bg-[#0f172a] border border-amber-400/55 text-[#fde68a] font-mono-tech text-[9px] whitespace-nowrap shadow"
              title="Click to zoom into 3D Lunar Surface View"
            >
              ☾ Moon • {state.phaseName}
            </button>
          </Html>
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
            />
          ) : (
            <HeliocentricScene
              state={state}
              astroPreset={astroPreset}
              astroPresetNonce={astroPresetNonce}
              showLabels={showLabels}
              onSwitchToEarthMoon={onSwitchToEarthMoon}
              onSwitchToLunarSurface={onSwitchToLunarSurface}
            />
          )}
        </React.Suspense>
      </Canvas>
    </div>
  );
};
