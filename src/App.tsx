import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Calendar,
  CheckCircle2,
  Compass,
  Crosshair,
  Download,
  Eye,
  Flame,
  Globe,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Moon,
  Orbit,
  Pause,
  Play,
  Radio,
  Route,
  Satellite,
  ShieldAlert,
  Sun,
  TriangleAlert,
} from 'lucide-react';
import {
  BENCHMARK_ROVER_ROUTES,
  CISLUNAR_SATELLITES,
  CURATED_LANDING_SITES,
  HEATMAP_CONFIGS,
  ROVER_PRESETS,
} from './data/lunarCatalog';
import {
  computeCelestialSystemState,
  formatRelativeEpochDelta,
  formatUtcParts,
} from './engine/celestialEphemeris';
import {
  computeSynodicTimeline,
  evaluateLandingSite,
  findOptimalTouchdownWindows,
  getDemResolutionAt,
  initLolaDemSampler,
  onLolaDemLoaded,
  predictSatellitePasses,
} from './engine/selenography';
import {
  computeRoverRangeEnvelope,
  planRoverTraverse,
} from './engine/roverPlanner';
import { CameraPreset, LunarGlobe3D } from './components/LunarGlobe3D';
import {
  AstroCameraPreset,
  CelestialSystem3D,
} from './components/CelestialSystem3D';
import { MissionEpochModal } from './components/MissionEpochModal';
import { KspActiveWarpBanner, KspWarpMenu } from './components/KspWarpMenu';
import { SunEarthLocatorModal } from './components/SunEarthLocatorModal';
import { PolarHorizonSkyplot } from './components/PolarHorizonSkyplot';
import { SynodicTimelineDrawer } from './components/SynodicTimelineDrawer';
import { SiteComparisonModal } from './components/SiteComparisonModal';
import { AiMissionAdvisor } from './components/AiMissionAdvisor';
import {
  RoverControlsPanel,
  RoverElevationDrawer,
} from './components/RoverMissionPlanner';
import {
  ActiveTimeWarpState,
  CandidateCorridorPath,
  HeatmapMode,
  LandingSite,
  ReadinessStatus,
  RoverCoords,
  RoverParams,
  RoverPickMode,
  RoverWorkflowStep,
  ViewportViewMode,
} from './types/lunar';

type LeftTab = 'heatmaps' | 'sites' | 'satellites' | 'rover';

const SPEED_OPTIONS = [
  { label: '1×', mult: 1, title: 'Real-time (1s / sec)' },
  { label: '1m/s', mult: 60, title: '60× — Live Cislunar Satellite Motion' },
  { label: '30m/s', mult: 1800, title: '1,800× — Fast Orbiter Passes' },
  { label: '4h/s', mult: 14400, title: '14,400× — Lunar Terminator Sweep' },
  { label: '1d/s', mult: 86400, title: '86,400× — Moon Around Earth (~27s / orbit)' },
  { label: '15d/s', mult: 1296000, title: '1,296,000× — Earth & Moon Around Sun (~24s / yr)' },
];

function statusStyle(status: ReadinessStatus): {
  pill: string;
  dot: string;
  icon: React.ReactNode;
} {
  if (status === 'GO') {
    return {
      pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      dot: 'bg-emerald-400',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
    };
  }
  if (status === 'CAUTION') {
    return {
      pill: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      dot: 'bg-amber-400',
      icon: <TriangleAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
    };
  }
  return {
    pill: 'bg-rose-500/15 text-rose-300 border-rose-500/45',
    dot: 'bg-rose-500',
    icon: <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />,
  };
}

export function App() {
  // Default mission epoch: 2026-11-04 12:00 UTC
  const [simTimeMs, setSimTimeMs] = useState<number>(() =>
    Date.UTC(2026, 10, 4, 12, 0, 0)
  );
  const [timelineAnchorMs, setTimelineAnchorMs] = useState<number>(() =>
    Date.UTC(2026, 10, 4, 0, 0, 0)
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speedMult, setSpeedMult] = useState<number>(60); // 1 min/sec default shows live satellite orbital motion smoothly

  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>('elevation');
  const [leftTab, setLeftTab] = useState<LeftTab>('heatmaps');
  const [selectedSite, setSelectedSite] = useState<LandingSite>(
    CURATED_LANDING_SITES[0] // Shackleton Connecting Ridge
  );
  const [compareSite, setCompareSite] = useState<LandingSite>(
    CURATED_LANDING_SITES[1] // Malapert Massif
  );
  const [isCompareOpen, setIsCompareOpen] = useState<boolean>(false);

  const [selectedSatelliteId, setSelectedSatelliteId] = useState<string | null>(
    'queqiao-2'
  );
  const [siteFilter, setSiteFilter] = useState<string>('all');
  const [customLatInput, setCustomLatInput] = useState<string>('-88.20');
  const [customLonInput, setCustomLonInput] = useState<string>('124.50');

  // Rover Traverse Mission Planner State
  const [roverActive, setRoverActive] = useState<boolean>(false);
  const [roverStart, setRoverStart] = useState<RoverCoords>(
    BENCHMARK_ROVER_ROUTES[0].start
  );
  const [roverEnd, setRoverEnd] = useState<RoverCoords>(
    BENCHMARK_ROVER_ROUTES[0].end
  );
  const [roverCheckpoints, setRoverCheckpoints] = useState<RoverCoords[]>([]);
  const [roverParams, setRoverParams] = useState<RoverParams>(
    ROVER_PRESETS[0].params
  );
  const [roverRoutingMode, setRoverRoutingMode] = useState<'astar' | 'direct'>(
    'astar'
  );
  const [roverPickMode, setRoverPickMode] = useState<RoverPickMode>('none');
  const [roverWorkflowStep, setRoverWorkflowStep] =
    useState<RoverWorkflowStep>('idle');
  const [roverMissionEpochMs, setRoverMissionEpochMs] = useState<number>(() =>
    Date.UTC(2026, 10, 4, 12, 0, 0)
  );
  const [roverAnimProgress, setRoverAnimProgress] = useState<number>(0);
  const [isRoverAnimating, setIsRoverAnimating] = useState<boolean>(false);
  const [roverAnimSpeed, setRoverAnimSpeed] = useState<number>(1);
  const [roverChaseCam, setRoverChaseCam] = useState<boolean>(false);
  const [bottomDrawerMode, setBottomDrawerMode] = useState<'synodic' | 'rover'>(
    'synodic'
  );

  // 3D Globe Visual Controls
  const [showOrbits, setShowOrbits] = useState<boolean>(true);
  const [showSiteLabels, setShowSiteLabels] = useState<boolean>(true);
  const [showVectors, setShowVectors] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showTerminator, setShowTerminator] = useState<boolean>(true);
  const [nightBoost, setNightBoost] = useState<boolean>(true);
  const [trueOrbitScale, setTrueOrbitScale] = useState<boolean>(false);
  const [terrainExaggeration, setTerrainExaggeration] = useState<number>(1.35);

  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('south-pole');
  const [cameraNonce, setCameraNonce] = useState<number>(0);
  const [viewMode, setViewMode] = useState<ViewportViewMode>('lunar-globe');
  const [astroPreset, setAstroPreset] =
    useState<AstroCameraPreset>('em-overview');
  const [astroNonce, setAstroNonce] = useState<number>(0);
  const [astroTrueScale, setAstroTrueScale] = useState<boolean>(false);
  const [isEpochModalOpen, setIsEpochModalOpen] = useState<boolean>(false);
  const [isSunEarthModalOpen, setIsSunEarthModalOpen] = useState<boolean>(false);
  const [previewSunEarthPoint, setPreviewSunEarthPoint] = useState<{
    lat: number;
    lon: number;
    label: string;
  } | null>(null);
  const [activeWarp, setActiveWarp] = useState<ActiveTimeWarpState | null>(null);
  const [zenMode, setZenMode] = useState<boolean>(false);

  const simTimeRef = useRef<number>(simTimeMs);
  simTimeRef.current = simTimeMs;

  const [hoverCoords, setHoverCoords] = useState<{
    lat: number;
    lon: number;
    elevKm: number;
  } | null>(null);
  const [demReadyTick, setDemReadyTick] = useState<number>(0);

  // Initialize NASA LOLA DEM raster sampler
  useEffect(() => {
    initLolaDemSampler('/textures/lola_dem.jpg');
    return onLolaDemLoaded(() => setDemReadyTick((t) => t + 1));
  }, []);

  // Simulation Clock Loop (yields while KSP Auto-Warp is active)
  const isWarping = activeWarp !== null;
  useEffect(() => {
    if (!isPlaying || isWarping) return;
    let last = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dtSec = Math.min(0.1, (now - last) / 1000);
      last = now;
      setSimTimeMs((prev) => prev + dtSec * speedMult * 1000);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, speedMult, isWarping]);

  // Kerbal Space Program (KSP) Smooth Auto-Warp Controller with Proportional Deceleration
  const warpSessionKey = activeWarp
    ? `${activeWarp.startedRealMs}:${activeWarp.targetTimeMs}`
    : '';
  useEffect(() => {
    if (!activeWarp) return;
    const { startTimeMs, targetTimeMs, startedRealMs } = activeWarp;
    let currentSim = simTimeRef.current;
    let last = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dtSec = Math.min(0.08, Math.max(0.001, (now - last) / 1000));
      last = now;

      const totalSpan = Math.max(1000, Math.abs(targetTimeMs - startTimeMs));
      const rem = targetTimeMs - currentSim;
      const remAbs = Math.abs(rem);

      // Smooth 0.35s ramp-up + KSP proportional deceleration as target approaches
      const elapsedRealMs = Math.max(0, now - startedRealMs);
      const rampIn = Math.min(1, 0.18 + (elapsedRealMs / 350) * 0.82);
      const peakRateMsPerSec = totalSpan / 2.4;
      const decelRateMsPerSec = Math.max(totalSpan * 0.035, remAbs * 2.8);
      const rateMsPerSec = Math.min(peakRateMsPerSec * rampIn, decelRateMsPerSec);
      const stepAbs = Math.min(remAbs, rateMsPerSec * dtSec);

      if (remAbs - stepAbs <= Math.max(250, totalSpan * 0.0008)) {
        simTimeRef.current = targetTimeMs;
        setSimTimeMs(targetTimeMs);
        setRoverMissionEpochMs(targetTimeMs);
        setIsPlaying(false);
        setActiveWarp(null);
        return;
      }

      currentSim += Math.sign(rem) * stepAbs;
      simTimeRef.current = currentSim;
      setSimTimeMs(currentSim);

      const currentRateMult = Math.max(1, rateMsPerSec / 1000);
      const warpArrows = Math.max(
        1,
        Math.min(6, Math.ceil((rateMsPerSec / peakRateMsPerSec) * 6))
      );
      setActiveWarp((prev) =>
        prev ? { ...prev, currentRateMult, warpArrows } : null
      );

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [warpSessionKey]);

  // Escape key aborts active KSP Time Warp when no modal is open
  useEffect(() => {
    if (!activeWarp) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !isEpochModalOpen &&
        !isCompareOpen &&
        !isSunEarthModalOpen
      ) {
        setActiveWarp(null);
        setIsPlaying(false);
        setRoverMissionEpochMs(simTimeRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [warpSessionKey, isEpochModalOpen, isCompareOpen, isSunEarthModalOpen]);

  // Keep 30-day timeline window centered/anchored if user jumps far outside [anchor, anchor + 30d]
  useEffect(() => {
    const thirtyDaysMs = 30 * 86400 * 1000;
    if (
      simTimeMs < timelineAnchorMs ||
      simTimeMs > timelineAnchorMs + thirtyDaysMs
    ) {
      setTimelineAnchorMs(simTimeMs - 2 * 86400 * 1000);
    }
  }, [simTimeMs, timelineAnchorMs]);

  // Live Selenographic & Orbital Evaluation
  const evaluation = useMemo(
    () => evaluateLandingSite(selectedSite, simTimeMs, trueOrbitScale),
    [selectedSite, simTimeMs, trueOrbitScale, demReadyTick]
  );

  // Live Heliocentric & Geocentric Celestial System State
  const celestialState = useMemo(
    () => computeCelestialSystemState(simTimeMs),
    [simTimeMs]
  );

  // Recompute 24h upcoming satellite passes every ~10 min of sim time or site change
  const passBucket = Math.floor(simTimeMs / (10 * 60 * 1000));
  const upcomingPasses = useMemo(
    () => predictSatellitePasses(selectedSite, simTimeMs, 24),
    [selectedSite, passBucket, demReadyTick]
  );

  // 30-Day Synodic Timeline & Optimal Touchdown Windows
  const synodicTimeline = useMemo(
    () => computeSynodicTimeline(selectedSite, timelineAnchorMs, 30),
    [selectedSite, timelineAnchorMs, demReadyTick]
  );

  const optimalWindows = useMemo(
    () => findOptimalTouchdownWindows(synodicTimeline, selectedSite),
    [synodicTimeline, selectedSite]
  );

  // Rover Traverse Plan — frozen to the mission epoch so the live clock doesn't re-plan mid-review/animation
  const roverPlan = useMemo(
    () =>
      planRoverTraverse(
        roverStart,
        roverEnd,
        roverParams,
        roverMissionEpochMs,
        roverRoutingMode,
        roverCheckpoints
      ),
    [
      roverStart,
      roverEnd,
      roverParams,
      roverMissionEpochMs,
      roverRoutingMode,
      roverCheckpoints,
      demReadyTick,
    ]
  );

  // Step 4: Operational range envelope + rough possible paths from Start [A] or last Checkpoint
  const roverRangeActive =
    roverWorkflowStep === 'range-explore' ||
    roverWorkflowStep === 'route-ready' ||
    roverWorkflowStep === 'animating';

  const rangeOrigin =
    roverCheckpoints.length > 0
      ? roverCheckpoints[roverCheckpoints.length - 1]
      : roverStart;

  const roverRangeEnvelope = useMemo(
    () =>
      roverRangeActive
        ? computeRoverRangeEnvelope(
            rangeOrigin,
            roverParams,
            roverMissionEpochMs,
            CURATED_LANDING_SITES
          )
        : null,
    [
      roverRangeActive,
      rangeOrigin,
      roverParams,
      roverMissionEpochMs,
      demReadyTick,
    ]
  );

  // Step 6: 60 FPS rover navigation animation loop (~14 s for a full traverse at 1×)
  useEffect(() => {
    if (!isRoverAnimating) return;
    let last = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let reachedEnd = false;
      setRoverAnimProgress((p) => {
        const next = p + (dt / 14) * roverAnimSpeed;
        if (next >= 1) {
          reachedEnd = true;
          return 1;
        }
        return next;
      });
      if (reachedEnd) {
        setIsRoverAnimating(false);
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isRoverAnimating, roverAnimSpeed]);

  const stopRoverAnimation = () => {
    setIsRoverAnimating(false);
    setRoverAnimProgress(0);
  };

  // Unified past / present / future UTC mission time setter
  const handleApplyMissionTime = (
    newTimeMs: number,
    syncRoverEpoch = true,
    pauseClock = true
  ) => {
    if (!Number.isFinite(newTimeMs)) return;
    setActiveWarp(null);
    simTimeRef.current = newTimeMs;
    setSimTimeMs(newTimeMs);
    if (syncRoverEpoch) {
      setRoverMissionEpochMs(newTimeMs);
      stopRoverAnimation();
    }
    if (pauseClock) {
      setIsPlaying(false);
    }
  };

  // KSP "Warp To" / "Warp Here" Initiation & Snap Handlers
  const applyWarpViewSwitch = (switchToView?: ViewportViewMode) => {
    if (!switchToView || switchToView === viewMode) return;
    setViewMode(switchToView);
    if (switchToView === 'earth-moon') {
      setAstroPreset('em-overview');
      setAstroNonce((n) => n + 1);
    } else if (switchToView === 'heliocentric') {
      setAstroPreset('helio-overview');
      setAstroNonce((n) => n + 1);
    }
  };

  const handleSnapTime = (
    targetTimeMs: number,
    switchToView?: ViewportViewMode
  ) => {
    if (!Number.isFinite(targetTimeMs)) return;
    applyWarpViewSwitch(switchToView);
    handleApplyMissionTime(targetTimeMs, true, true);
  };

  const handleStartWarp = (
    targetTimeMs: number,
    label: string,
    switchToView?: ViewportViewMode
  ) => {
    if (!Number.isFinite(targetTimeMs)) return;
    applyWarpViewSwitch(switchToView);
    const startMs = simTimeRef.current;
    if (Math.abs(targetTimeMs - startMs) < 1000) {
      handleApplyMissionTime(targetTimeMs, true, true);
      return;
    }
    stopRoverAnimation();
    setIsPlaying(false);
    setActiveWarp({
      label,
      startTimeMs: startMs,
      targetTimeMs,
      startedRealMs: performance.now(),
      currentRateMult: 1,
      warpArrows: 1,
    });
  };

  const handleCancelWarp = () => {
    setActiveWarp(null);
    setIsPlaying(false);
    setRoverMissionEpochMs(simTimeRef.current);
  };

  // Step 1: "Plan Mission" entry point
  const handleOpenPlanMission = () => {
    setLeftTab('rover');
    setRoverActive(true);
    setRoverCheckpoints([]);
    stopRoverAnimation();
    setRoverPickMode('none');
    setRoverWorkflowStep('rover-setup');
  };

  const ensureSurfaceView = (targetLat?: number) => {
    setViewMode((prev) => {
      if (prev === 'south-pole') {
        return targetLat !== undefined && targetLat > -70 ? 'lunar-globe' : 'south-pole';
      }
      if (prev === 'lunar-globe') {
        return 'lunar-globe';
      }
      return targetLat !== undefined && targetLat <= -78 ? 'south-pole' : 'lunar-globe';
    });
  };

  // Step 2 -> 3
  const handleConfirmRoverDetails = () => {
    ensureSurfaceView(roverStart.lat);
    setRoverWorkflowStep('select-start');
    setRoverPickMode('pick-start');
  };

  // Step 3 -> 3.5 (locality zoom) -> 3.7 (checkpoints) -> 4 (range + paths) -> 5 (pick end)
  const handleConfirmStartAndZoomLocality = (coords: RoverCoords) => {
    ensureSurfaceView(coords.lat);
    setRoverStart(coords);
    stopRoverAnimation();
    setRoverWorkflowStep('checkpoints');
    setRoverPickMode('pick-checkpoint');
    setBottomDrawerMode('synodic');
    setCameraPreset('rover-locality');
    setCameraNonce((n) => n + 1);
  };

  // Intermediate Checkpoints Handlers
  const handleAddCheckpoint = (coords: RoverCoords) => {
    setRoverCheckpoints((prev) => [...prev, coords]);
    stopRoverAnimation();
  };

  const handleRemoveCheckpoint = (index: number) => {
    setRoverCheckpoints((prev) => prev.filter((_, i) => i !== index));
    stopRoverAnimation();
  };

  const handleReorderCheckpoints = (fromIdx: number, toIdx: number) => {
    setRoverCheckpoints((prev) => {
      if (
        fromIdx < 0 ||
        fromIdx >= prev.length ||
        toIdx < 0 ||
        toIdx >= prev.length
      )
        return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    stopRoverAnimation();
  };

  const handleClearCheckpoints = () => {
    setRoverCheckpoints([]);
    stopRoverAnimation();
  };

  // Step 5: end point chosen -> feasibility review
  const handleSelectEndPoint = (coords: RoverCoords) => {
    setRoverEnd(coords);
    stopRoverAnimation();
    setRoverPickMode('none');
    setRoverWorkflowStep('route-ready');
    setBottomDrawerMode('rover');
  };

  const handleSelectCandidatePath = (path: CandidateCorridorPath) => {
    handleSelectEndPoint(path.endCoords);
  };

  // Step 6: generate rover navigation animation
  const handleStartAnimation = () => {
    ensureSurfaceView(roverStart.lat);
    setRoverAnimProgress(0);
    setRoverWorkflowStep('animating');
    setBottomDrawerMode('rover');
    setRoverChaseCam(true);
    setIsRoverAnimating(true);
  };

  const handleTogglePlayAnimation = () => {
    if (isRoverAnimating) {
      setIsRoverAnimating(false);
      return;
    }
    ensureSurfaceView(roverStart.lat);
    if (roverAnimProgress >= 0.995) setRoverAnimProgress(0);
    if (roverWorkflowStep !== 'animating') setRoverWorkflowStep('animating');
    setIsRoverAnimating(true);
  };

  const handleSelectBenchmarkRoute = (routeId: string) => {
    const found = BENCHMARK_ROVER_ROUTES.find((r) => r.id === routeId);
    if (!found) return;
    ensureSurfaceView(found.start.lat);
    setRoverStart(found.start);
    setRoverEnd(found.end);
    setRoverCheckpoints([]);
    const preset = ROVER_PRESETS.find(
      (p) => p.id === found.recommendedPresetId
    );
    if (preset) setRoverParams({ ...preset.params });
    stopRoverAnimation();
    setRoverPickMode('none');
    setRoverWorkflowStep('route-ready');
    setRoverActive(true);
    setBottomDrawerMode('rover');
    setCameraPreset('rover-route');
    setCameraNonce((n) => n + 1);
  };

  const handleRoverPickPoint = (
    lat: number,
    lon: number,
    label?: string
  ) => {
    if (roverPickMode === 'pick-start') {
      handleConfirmStartAndZoomLocality({
        lat,
        lon,
        label: label || `Start (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
      });
    } else if (roverPickMode === 'pick-checkpoint') {
      const cpNum = roverCheckpoints.length + 1;
      handleAddCheckpoint({
        lat,
        lon,
        label: label || `CP ${cpNum} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
      });
    } else if (roverPickMode === 'pick-end') {
      handleSelectEndPoint({
        lat,
        lon,
        label: label || `Goal (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
      });
    }
    setRoverActive(true);
  };

  const activeHeatmapConfig = useMemo(
    () => HEATMAP_CONFIGS.find((h) => h.id === heatmapMode) || HEATMAP_CONFIGS[0],
    [heatmapMode]
  );

  const triggerCamera = (preset: CameraPreset, forceMode?: 'lunar-globe' | 'south-pole') => {
    if (forceMode) {
      setViewMode(forceMode);
    } else {
      ensureSurfaceView(selectedSite.lat);
    }
    setCameraPreset(preset);
    setCameraNonce((n) => n + 1);
  };

  const triggerAstroCamera = (preset: AstroCameraPreset) => {
    setAstroPreset(preset);
    setAstroNonce((n) => n + 1);
  };

  const handleSelectSite = (site: LandingSite) => {
    setSelectedSite(site);
    if (viewMode === 'south-pole') {
      if (site.lat > -70) {
        setViewMode('lunar-globe');
      }
      setCameraPreset('site');
      setCameraNonce((n) => n + 1);
    } else if (viewMode === 'lunar-globe') {
      setCameraPreset('site');
      setCameraNonce((n) => n + 1);
    }
  };

  const handleSelectCustomPoint = (
    lat: number,
    lon: number,
    customName?: string
  ) => {
    const coordStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(
      lon
    ).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
    const custom: LandingSite = {
      id: `custom-${lat.toFixed(2)}-${lon.toFixed(2)}`,
      name: customName ? `${customName} (${coordStr})` : `Custom Target (${coordStr})`,
      subtitle: customName
        ? 'Sun & Earth Relative Selenographic Target'
        : 'Custom Selenographic Target',
      category: 'custom',
      missionTag: customName ? 'SUN/EARTH PIN' : 'CUSTOM PIN',
      lat,
      lon,
      geology:
        Math.abs(lat) > 78
          ? 'Polar cratered highland terrain sampled directly from NASA LOLA DEM.'
          : 'Lunar regolith sampled directly from NASA LRO LOLA & LROC global mosaics.',
      strategicNotes:
        'Custom landing ellipse evaluated in real time via 36-azimuth LOLA horizon ray-tracing and live Keplerian orbiter propagation.',
    };
    setSelectedSite(custom);
    setCustomLatInput(lat.toFixed(2));
    setCustomLonInput(lon.toFixed(2));
  };

  const handleExportBriefJson = () => {
    const payload = {
      generatedBy: 'SELENE OPS — NASA Space Apps 2026 Lunar Landing Site Navigator',
      epochUtc: new Date(simTimeMs).toISOString(),
      landingSite: evaluation.site,
      readiness: {
        overallStatus: evaluation.overallStatus,
        score: evaluation.readinessScore,
        flightRules: evaluation.flightRules,
      },
      environment: {
        elevationKm: evaluation.elevationKm,
        slopeDeg: evaluation.slopeDeg,
        surfaceTempK: evaluation.surfaceTempK,
        annualIlluminationPct: evaluation.illuminationDutyPct,
        waterIceWtPct: evaluation.waterIceWtPct,
        sunHorizontal: evaluation.sun,
        earthHorizontal: evaluation.earth,
      },
      visibleSatellites: evaluation.activeSatellites
        .filter((s) => s.isVisibleFromSite)
        .map((s) => ({
          name: s.satellite.name,
          altKm: s.altKm,
          elevationDeg: s.elevationDeg,
          azimuthDeg: s.azimuthDeg,
          slantRangeKm: s.slantRangeKm,
          dataRateMbps: s.instantDataRateMbps,
          capabilities: s.satellite.capabilities,
        })),
      next24hPassesCount: upcomingPasses.length,
      recommendedWindows: optimalWindows,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selene-ops-${evaluation.site.id}-${new Date(simTimeMs)
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const epochUtcParts = formatUtcParts(simTimeMs);
  const epochRelDelta = formatRelativeEpochDelta(simTimeMs);

  const filteredSites = CURATED_LANDING_SITES.filter((s) =>
    siteFilter === 'all' ? true : s.category === siteFilter
  );

  const selectedSatLive =
    evaluation.activeSatellites.find((s) => s.satellite.id === selectedSatelliteId) ||
    evaluation.activeSatellites[0];

  const overallBadge = statusStyle(evaluation.overallStatus);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#05070b] space-grid-overlay text-slate-100">
      {/* FULL-SCREEN 3D VIEWPORT: LUNAR GLOBE / SOUTH POLE OR EARTH-MOON OR HELIOCENTRIC SUN-EARTH-MOON */}
      <div className="absolute inset-0 z-0">
        {viewMode === 'lunar-globe' || viewMode === 'south-pole' ? (
          <LunarGlobe3D
            isSouthPoleFocus={viewMode === 'south-pole'}
            heatmapMode={heatmapMode}
            evaluation={evaluation}
            compareSite={isCompareOpen ? compareSite : null}
            curatedSites={CURATED_LANDING_SITES}
            selectedSatelliteId={selectedSatelliteId}
            showOrbits={showOrbits}
            showSiteLabels={showSiteLabels}
            showVectors={showVectors}
            showGrid={showGrid}
            showTerminator={showTerminator}
            nightBoost={nightBoost}
            trueOrbitScale={trueOrbitScale}
            terrainExaggeration={terrainExaggeration}
            cameraPreset={cameraPreset}
            cameraPresetNonce={cameraNonce}
            roverWorkflowStep={roverWorkflowStep}
            roverStartCoords={roverStart}
            roverCheckpoints={roverCheckpoints}
            roverRangeEnvelope={roverRangeEnvelope}
            roverPlan={roverWorkflowStep !== 'idle' || roverActive ? roverPlan : null}
            roverPickMode={roverPickMode}
            roverAnimProgress={roverAnimProgress}
            isRoverAnimating={isRoverAnimating}
            roverChaseCam={roverChaseCam}
            onSelectSite={handleSelectSite}
            onSelectCustomPoint={handleSelectCustomPoint}
            onRoverPickPoint={handleRoverPickPoint}
            onSelectCandidatePath={handleSelectCandidatePath}
            onSelectSatellite={(id) => {
              setSelectedSatelliteId(id);
              setLeftTab('satellites');
            }}
            onHoverCoords={setHoverCoords}
            onWarpToTime={(ms, lbl) => handleStartWarp(ms, lbl)}
            onSnapToTime={(ms) => handleSnapTime(ms)}
            previewSunEarthPoint={previewSunEarthPoint}
          />
        ) : (
          <CelestialSystem3D
            mode={viewMode}
            simTimeMs={simTimeMs}
            evaluation={evaluation}
            astroPreset={astroPreset}
            astroPresetNonce={astroNonce}
            truePhysicalScale={astroTrueScale}
            showLabels={showSiteLabels}
            onSwitchToEarthMoon={() => {
              setViewMode('earth-moon');
              setAstroPreset('em-overview');
              setAstroNonce((n) => n + 1);
            }}
            onSwitchToLunarSurface={() => setViewMode('lunar-globe')}
            onWarpToTime={(ms, lbl) => handleStartWarp(ms, lbl)}
            onSnapToTime={(ms) => handleSnapTime(ms)}
          />
        )}
      </div>

      {/* FOREGROUND MISSION CONTROL HUD SHELL */}
      <div className="relative z-10 w-full h-full flex flex-col justify-between p-2.5 sm:p-3 pointer-events-none gap-2.5">
        {/* TOP TELEMETRY & EPHEMERIS RIBBON */}
        <header className="hud-panel reticle-frame rounded-xl px-3.5 py-2 pointer-events-auto flex flex-wrap items-center justify-between gap-3">
          {/* Mission Identity */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#f59e0b]/15 border border-[#f59e0b]/45 flex items-center justify-center text-[#fbbf24]">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <h1 className="font-display font-bold text-sm sm:text-base tracking-[0.14em] uppercase text-white">
                SELENE OPS
              </h1>
            </div>
          </div>

          {/* Live Mission Clock, Past/Future Epoch Picker, Time-Warp Scrubber & KSP "Warp To" */}
          <div className="flex flex-wrap items-center gap-1.5 bg-[#060911]/90 px-2.5 py-1 rounded-lg border border-white/10 tabular-nums">
            <button
              type="button"
              onClick={() => {
                if (activeWarp) {
                  handleCancelWarp();
                } else {
                  setIsPlaying((p) => !p);
                }
              }}
              className="hud-btn w-7 h-7 rounded-md bg-[#f59e0b]/20 hover:bg-[#f59e0b]/35 border border-[#f59e0b]/45 flex items-center justify-center text-[#fcd34d] cursor-pointer"
              title={
                activeWarp
                  ? 'Abort Time Warp'
                  : isPlaying
                  ? 'Pause Orbital Propagation'
                  : 'Resume Orbital Propagation'
              }
            >
              {isPlaying || activeWarp ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleApplyMissionTime(simTimeMs - 86400 * 1000, true, false)}
              className="hud-btn px-1.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-[10px] font-mono-tech text-slate-300 cursor-pointer"
              title="Step backward 1 Earth day (−24h)"
            >
              −1d
            </button>

            <button
              type="button"
              onClick={() => setIsEpochModalOpen(true)}
              className="hud-btn px-2 py-1 rounded-md bg-white/[0.04] hover:bg-[#f59e0b]/15 border border-white/15 hover:border-[#f59e0b]/50 flex items-center gap-1.5 cursor-pointer group"
              title="Click to set any Past, Present, or Future Mission Date & Time (UTC)"
            >
              <Calendar className="w-3.5 h-3.5 text-[#fbbf24] shrink-0" />
              <span className="font-mono-tech text-xs text-white font-semibold">
                {epochUtcParts.dateStr} {epochUtcParts.timeStr}
              </span>
              <span className="text-[9.5px] font-mono-tech text-slate-400">UTC</span>
            </button>

            <button
              type="button"
              onClick={() => handleApplyMissionTime(simTimeMs + 86400 * 1000, true, false)}
              className="hud-btn px-1.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-[10px] font-mono-tech text-slate-300 cursor-pointer"
              title="Step forward 1 Earth day (+24h)"
            >
              +1d
            </button>

            <div className="h-4 w-[1px] bg-white/10 hidden sm:block mx-0.5" />

            <div className="flex items-center gap-0.5">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  title={opt.title}
                  onClick={() => {
                    setActiveWarp(null);
                    setSpeedMult(opt.mult);
                    setIsPlaying(true);
                  }}
                  className={`hud-btn px-1.5 py-0.5 rounded text-[10px] font-mono-tech cursor-pointer ${
                    !activeWarp && isPlaying && speedMult === opt.mult
                      ? 'bg-[#38bdf8]/25 text-[#7dd3fc] border border-[#38bdf8]/50'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-[1px] bg-white/10 hidden sm:block mx-0.5" />

            {/* KSP "Warp To" Event & Orbital Node Selector */}
            <KspWarpMenu
              simTimeMs={simTimeMs}
              selectedSite={selectedSite}
              upcomingPasses={upcomingPasses}
              optimalWindows={optimalWindows}
              activeWarp={activeWarp}
              onStartWarp={handleStartWarp}
              onSnapTime={handleSnapTime}
              onCancelWarp={handleCancelWarp}
            />
          </div>

          {/* Live Sub-Solar / Sub-Earth Libration & Trade-Study Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSunEarthModalOpen(true)}
              className="hidden 2xl:flex items-center gap-2.5 px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-cyan-500/10 border border-white/[0.08] hover:border-cyan-400/45 text-[11px] font-mono-tech cursor-pointer transition-colors"
              title="Click to select a Lunar Surface or Orbital Location manually WRT Sun & Earth"
            >
              <span className="text-[#fcd34d]">
                ☉ Sub-Sol: {evaluation.sun.subLat > 0 ? '+' : ''}
                {evaluation.sun.subLat}°, {evaluation.sun.subLon}°
              </span>
              <span className="text-white/20">|</span>
              <span className="text-[#7dd3fc]">
                ⊕ Libration: {evaluation.earth.subLat > 0 ? '+' : ''}
                {evaluation.earth.subLat}°, {evaluation.earth.subLon > 0 ? '+' : ''}
                {evaluation.earth.subLon}°
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsSunEarthModalOpen(true)}
              className={`hud-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono-tech cursor-pointer ${
                isSunEarthModalOpen
                  ? 'bg-cyan-400 text-[#05070b] border-cyan-200 font-semibold'
                  : 'bg-cyan-500/15 hover:bg-cyan-500/25 border-cyan-400/45 text-cyan-200'
              }`}
              title="Select Lunar Surface Target or Orbital Position Manually WRT Sun & Earth"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden md:inline">☉/⊕ WRT Sun–Earth</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPlanMission}
              className={`hud-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono-tech font-semibold cursor-pointer ${
                leftTab === 'rover' && roverWorkflowStep !== 'idle'
                  ? 'bg-[#f59e0b] text-[#05070b] border-[#fde68a]'
                  : 'bg-[#f59e0b]/20 hover:bg-[#f59e0b]/35 border-[#f59e0b]/60 text-[#fde68a]'
              }`}
              title="Start guided rover mission planning: Rover → Start → Range → End → Animate"
            >
              <Route className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Plan Mission</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCompareOpen(true)}
              className="hud-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 border border-[#38bdf8]/40 text-xs font-mono-tech text-[#bae6fd] cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compare Sites</span>
            </button>

            <button
              type="button"
              onClick={handleExportBriefJson}
              className="hud-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/15 text-xs font-mono-tech text-slate-200 cursor-pointer"
              title="Download Mission Readiness JSON Telemetry Package"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Export</span>
            </button>

            <button
              type="button"
              onClick={() => setZenMode((z) => !z)}
              className="hud-btn p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/15 text-slate-300 cursor-pointer"
              title={zenMode ? 'Restore Mission Console Docks' : 'Full-Screen 3D Moon Mode'}
            >
              {zenMode ? (
                <Minimize2 className="w-3.5 h-3.5 text-[#fbbf24]" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </header>

        {/* MIDDLE ROW: LEFT DOCK + CENTER GLOBE FLOATING CONTROLS + RIGHT DOCK */}
        <div className="flex-1 min-h-0 flex items-stretch justify-between gap-3">
          {/* LEFT DOCK: HEATMAPS, LANDING SITES & SATELLITES */}
          {!zenMode && (
            <aside className="hud-panel rounded-xl w-[332px] lg:w-[348px] shrink-0 pointer-events-auto flex flex-col overflow-hidden">
              {/* 4-Tab Switcher */}
              <div className="grid grid-cols-4 gap-1 p-1.5 bg-[#060911]/80 border-b border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setLeftTab('heatmaps')}
                  className={`hud-btn flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-display uppercase tracking-wider cursor-pointer ${
                    leftTab === 'heatmaps'
                      ? 'bg-[#f59e0b]/20 text-[#fcd34d] border border-[#f59e0b]/45 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>Layers</span>
                </button>

                <button
                  type="button"
                  onClick={() => setLeftTab('sites')}
                  className={`hud-btn flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-display uppercase tracking-wider cursor-pointer ${
                    leftTab === 'sites'
                      ? 'bg-[#f59e0b]/20 text-[#fcd34d] border border-[#f59e0b]/45 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <MapPin className="w-3 h-3" />
                  <span>Sites</span>
                </button>

                <button
                  type="button"
                  onClick={() => setLeftTab('satellites')}
                  className={`hud-btn flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-display uppercase tracking-wider cursor-pointer ${
                    leftTab === 'satellites'
                      ? 'bg-[#38bdf8]/20 text-[#7dd3fc] border border-[#38bdf8]/45 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Satellite className="w-3 h-3" />
                  <span>Orbits</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLeftTab('rover');
                    setRoverActive(true);
                    if (roverWorkflowStep === 'idle') setRoverWorkflowStep('rover-setup');
                  }}
                  className={`hud-btn flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-display uppercase tracking-wider cursor-pointer ${
                    leftTab === 'rover'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/45 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Route className="w-3 h-3" />
                  <span>Rover</span>
                </button>
              </div>

              {/* TAB 1: GLOBAL SCIENTIFIC HEATMAP LAYERS */}
              {leftTab === 'heatmaps' && (
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  <div className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-400">
                    Select 3D Global Selenographic Layer
                  </div>

                  <div className="space-y-1.5">
                    {HEATMAP_CONFIGS.map((hm) => {
                      const active = hm.id === heatmapMode;
                      return (
                        <button
                          key={hm.id}
                          type="button"
                          onClick={() => setHeatmapMode(hm.id)}
                          className={`hud-btn w-full text-left p-2.5 rounded-lg border cursor-pointer ${
                            active
                              ? 'bg-[#f59e0b]/[0.11] border-[#f59e0b]/55 shadow-sm'
                              : 'bg-white/[0.02] border-white/[0.07] hover:border-white/20 hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-semibold ${
                                active ? 'text-[#fde68a]' : 'text-slate-200'
                              }`}
                            >
                              {hm.label}
                            </span>
                            <span className="text-[10px] font-mono-tech text-slate-400">
                              {hm.unit}
                            </span>
                          </div>
                          {/* Perceptual Colorbar Preview */}
                          <div
                            className="h-1.5 w-full rounded-full mt-1.5 border border-white/10"
                            style={{ background: hm.gradientCss }}
                          />
                          <div className="flex justify-between text-[9px] font-mono-tech text-slate-400 mt-1">
                            <span>{hm.minLabel}</span>
                            <span>{hm.midLabel}</span>
                            <span>{hm.maxLabel}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Active Layer Instrument & Planner Note */}
                  <div className="p-2.5 rounded-lg bg-[#060911] border border-white/10 space-y-1 text-[11px]">
                    <div className="font-mono-tech text-[10px] text-[#7dd3fc]">
                      SOURCE: {activeHeatmapConfig.instrument}
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {activeHeatmapConfig.plannerInsight}
                    </p>
                  </div>

                  {/* 3D Surface Displacement & Overlay Toggles */}
                  <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                    <div>
                      <div className="flex justify-between text-[11px] font-mono-tech text-slate-300 mb-1">
                        <span>3D LOLA Terrain Relief</span>
                        <span className="text-[#fcd34d]">{terrainExaggeration.toFixed(1)}×</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={3.2}
                        step={0.1}
                        value={terrainExaggeration}
                        onChange={(e) => setTerrainExaggeration(Number(e.target.value))}
                        className="w-full accent-[#f59e0b] cursor-pointer"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono-tech">
                      {[
                        { label: 'Lat/Lon Grid', val: showGrid, set: setShowGrid },
                        { label: 'LOS Vectors', val: showVectors, set: setShowVectors },
                        { label: 'Orbit Ribbons', val: showOrbits, set: setShowOrbits },
                        { label: 'Site Labels', val: showSiteLabels, set: setShowSiteLabels },
                        { label: 'Day/Night Mask', val: showTerminator, set: setShowTerminator },
                        { label: 'Night Fill Light', val: nightBoost, set: setNightBoost },
                      ].map((t) => (
                        <button
                          key={t.label}
                          type="button"
                          onClick={() => t.set((v) => !v)}
                          className={`hud-btn px-2 py-1 rounded border text-left flex items-center justify-between cursor-pointer ${
                            t.val
                              ? 'bg-white/[0.08] border-white/25 text-white'
                              : 'bg-transparent border-white/[0.07] text-slate-500'
                          }`}
                        >
                          <span>{t.label}</span>
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              t.val ? 'bg-emerald-400' : 'bg-slate-600'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CURATED LANDING SITES + CUSTOM COORDINATE PICKER */}
              {leftTab === 'sites' && (
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {/* Category Filter Pills */}
                  <div className="flex flex-wrap gap-1">
                    {[
                      { id: 'all', lbl: 'All (10)' },
                      { id: 'artemis', lbl: 'Artemis III' },
                      { id: 'clps', lbl: 'CLPS' },
                      { id: 'isru', lbl: 'ISRU Ice' },
                      { id: 'historic', lbl: 'Historic' },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSiteFilter(cat.id)}
                        className={`hud-btn px-2 py-0.5 rounded text-[10px] font-mono-tech cursor-pointer ${
                          siteFilter === cat.id
                            ? 'bg-[#f59e0b] text-[#05070b] font-semibold'
                            : 'bg-white/[0.04] text-slate-300 border border-white/10 hover:bg-white/[0.08]'
                        }`}
                      >
                        {cat.lbl}
                      </button>
                    ))}
                  </div>

                  {/* Custom Coordinate Input Box */}
                  <div className="p-2.5 rounded-lg bg-[#060911] border border-white/10 space-y-1.5">
                    <div className="text-[10px] font-mono-tech text-[#fcd34d]">
                      <span>⊕ CUSTOM COORDINATE PIN</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.1"
                        min="-90"
                        max="90"
                        value={customLatInput}
                        onChange={(e) => setCustomLatInput(e.target.value)}
                        placeholder="Lat °"
                        className="w-1/2 bg-white/[0.04] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white focus:outline-none focus:border-[#f59e0b]"
                      />
                      <input
                        type="number"
                        step="0.1"
                        min="-180"
                        max="180"
                        value={customLonInput}
                        onChange={(e) => setCustomLonInput(e.target.value)}
                        placeholder="Lon °"
                        className="w-1/2 bg-white/[0.04] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white focus:outline-none focus:border-[#f59e0b]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const lat = Math.max(-90, Math.min(90, Number(customLatInput) || 0));
                          const lon = Math.max(-180, Math.min(180, Number(customLonInput) || 0));
                          handleSelectCustomPoint(lat, lon);
                          triggerCamera('site');
                        }}
                        className="hud-btn px-2.5 py-1 rounded bg-[#f59e0b] text-[#05070b] font-mono-tech font-semibold text-xs cursor-pointer"
                      >
                        Go
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsSunEarthModalOpen(true)}
                      className="hud-btn w-full mt-1 py-1.5 px-2.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/45 text-cyan-200 font-mono-tech text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5 text-cyan-300" />
                      <span>☉/⊕ Select Location WRT Sun & Earth</span>
                    </button>
                  </div>

                  {/* Site Cards */}
                  <div className="space-y-1.5">
                    {filteredSites.map((s) => {
                      const isSel = selectedSite.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSelectSite(s)}
                          className={`hud-btn w-full text-left p-2.5 rounded-lg border cursor-pointer ${
                            isSel
                              ? 'bg-[#f59e0b]/[0.12] border-[#f59e0b]/60'
                              : 'bg-white/[0.02] border-white/[0.07] hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-mono-tech px-1.5 py-0.2 rounded bg-white/[0.06] text-[#fcd34d]">
                              {s.missionTag}
                            </span>
                            <span className="text-[10px] font-mono-tech text-slate-400">
                              {Math.abs(s.lat).toFixed(2)}°{s.lat >= 0 ? 'N' : 'S'},{' '}
                              {Math.abs(s.lon).toFixed(1)}°{s.lon >= 0 ? 'E' : 'W'}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-white mt-1">{s.name}</div>
                          <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                            {s.strategicNotes}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: ACTIVE CISLUNAR SATELLITES & ACCESS SCHEDULE */}
              {leftTab === 'satellites' && (
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-400">
                      Active Cislunar Constellation
                    </span>
                    <button
                      type="button"
                      onClick={() => setTrueOrbitScale((v) => !v)}
                      className={`hud-btn px-2 py-0.5 rounded text-[10px] font-mono-tech border cursor-pointer ${
                        trueOrbitScale
                          ? 'bg-[#38bdf8]/20 text-[#7dd3fc] border-[#38bdf8]/50'
                          : 'bg-white/[0.04] text-slate-300 border-white/10'
                      }`}
                      title="Toggle between Tactical Compressed Orbits and True 1:1 70,000 km NRHO Scale"
                    >
                      {trueOrbitScale ? '1:1 Scale' : 'Tactical Scale'}
                    </button>
                  </div>

                  {/* Live Orbiter Selector List */}
                  <div className="space-y-1.5">
                    {evaluation.activeSatellites.map((st) => {
                      const sat = st.satellite;
                      const isSel = selectedSatelliteId === sat.id;
                      return (
                        <button
                          key={sat.id}
                          type="button"
                          onClick={() => setSelectedSatelliteId(sat.id)}
                          className={`hud-btn w-full text-left p-2 rounded-lg border cursor-pointer ${
                            isSel
                              ? 'bg-white/[0.08] border-white/35'
                              : 'bg-white/[0.02] border-white/[0.07] hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: sat.color }}
                              />
                              <span className="text-xs font-semibold text-white">
                                {sat.name.split(' (')[0]}
                              </span>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono-tech font-semibold ${
                                st.isVisibleFromSite
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'bg-white/[0.04] text-slate-400 border border-white/10'
                              }`}
                            >
                              {st.isVisibleFromSite
                                ? `IN VIEW +${st.elevationDeg}°`
                                : `OCCULTED (${st.elevationDeg}°)`}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] font-mono-tech text-slate-300">
                            <span>Alt {st.altKm.toLocaleString()} km</span>
                            <span>Rng {st.slantRangeKm.toLocaleString()} km</span>
                            <span className="text-right text-[#7dd3fc]">
                              {st.isVisibleFromSite ? `${st.instantDataRateMbps} Mbps` : sat.agency}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Inspected Satellite Payload & Capabilities Card */}
                  {selectedSatLive && (
                    <div className="p-2.5 rounded-lg bg-[#060911] border border-white/12 space-y-2">
                      <div className="flex items-center justify-between">
                        <span
                          className="text-xs font-semibold"
                          style={{ color: selectedSatLive.satellite.color }}
                        >
                          {selectedSatLive.satellite.name}
                        </span>
                        <span className="text-[10px] font-mono-tech text-slate-400">
                          T={selectedSatLive.satellite.periodHours}h
                        </span>
                      </div>
                      <div className="text-[10px] font-mono-tech text-slate-400">
                        {selectedSatLive.satellite.orbitType} • {selectedSatLive.satellite.bands}
                      </div>
                      <p className="text-[11px] text-slate-300 leading-snug">
                        {selectedSatLive.satellite.summary}
                      </p>

                      {/* What It Can Access Badges */}
                      <div>
                        <div className="text-[9px] font-mono-tech uppercase text-slate-400 mb-1">
                          What This Orbiter Accesses
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {selectedSatLive.satellite.capabilities.map((cap) => (
                            <span
                              key={cap}
                              className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[9px] font-mono-tech text-slate-200"
                            >
                              {cap}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Next 24h Access Windows Schedule */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between text-[10px] font-mono-tech uppercase text-slate-400 mb-1.5">
                      <span>Upcoming 24h Access Windows</span>
                    </div>
                    <div className="space-y-1 max-h-[195px] overflow-y-auto pr-0.5">
                      {upcomingPasses.slice(0, 12).map((pw, idx) => {
                        const isNow =
                          simTimeMs >= pw.aosTimeMs && simTimeMs <= pw.losTimeMs;
                        const shortSatName = pw.satelliteName
                          .split(' (')[0]
                          .split(' Relay')[0];
                        return (
                          <button
                            key={`${pw.satelliteId}-${idx}`}
                            type="button"
                            onClick={() => {
                              setSelectedSatelliteId(pw.satelliteId);
                              handleStartWarp(
                                Math.round((pw.aosTimeMs + pw.losTimeMs) / 2),
                                `${shortSatName} Peak Pass (+${pw.maxElevationDeg}°)`
                              );
                            }}
                            className={`hud-btn w-full text-left px-2 py-1.5 rounded border text-[10px] font-mono-tech cursor-pointer flex items-center justify-between ${
                              isNow
                                ? 'bg-emerald-500/12 border-emerald-500/40 text-emerald-200'
                                : 'bg-white/[0.02] border-white/[0.07] text-slate-300 hover:bg-white/[0.06]'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: pw.color }}
                                />
                                <span className="font-semibold text-white">
                                  {shortSatName}
                                </span>
                              </div>
                              <div className="text-slate-400 mt-0.5">
                                {new Date(pw.aosTimeMs).toISOString().slice(11, 16)}Z →{' '}
                                {new Date(pw.losTimeMs).toISOString().slice(11, 16)}Z (
                                {pw.durationMinutes}m)
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[#7dd3fc]">Max +{pw.maxElevationDeg}°</div>
                              <div className="text-slate-400">{pw.peakDataRateMbps} Mbps</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: ROVER TRAVERSE MISSION PLANNER & FEASIBILITY REVIEW */}
              {leftTab === 'rover' && (
                <RoverControlsPanel
                  workflowStep={roverWorkflowStep}
                  startCoords={roverStart}
                  endCoords={roverEnd}
                  checkpoints={roverCheckpoints}
                  roverParams={roverParams}
                  routingMode={roverRoutingMode}
                  pickMode={roverPickMode}
                  rangeEnvelope={roverRangeEnvelope}
                  plan={roverPlan}
                  animProgress={roverAnimProgress}
                  isAnimating={isRoverAnimating}
                  animSpeed={roverAnimSpeed}
                  chaseCam={roverChaseCam}
                  onSetWorkflowStep={(step) => {
                    if (step !== 'animating') setIsRoverAnimating(false);
                    setRoverWorkflowStep(step);
                  }}
                  onConfirmRoverDetails={handleConfirmRoverDetails}
                  onConfirmStartAndZoomLocality={handleConfirmStartAndZoomLocality}
                  onAddCheckpoint={handleAddCheckpoint}
                  onRemoveCheckpoint={handleRemoveCheckpoint}
                  onReorderCheckpoints={handleReorderCheckpoints}
                  onClearCheckpoints={handleClearCheckpoints}
                  onSelectEndPoint={handleSelectEndPoint}
                  onSelectCandidatePath={handleSelectCandidatePath}
                  onStartAnimation={handleStartAnimation}
                  onTogglePlayAnimation={handleTogglePlayAnimation}
                  onReplayAnimation={() => {
                    setRoverAnimProgress(0);
                    setIsRoverAnimating(true);
                  }}
                  onScrubProgress={(p) => {
                    setIsRoverAnimating(false);
                    setRoverAnimProgress(p);
                  }}
                  onChangeAnimSpeed={setRoverAnimSpeed}
                  onToggleChaseCam={() => setRoverChaseCam((c) => !c)}
                  onZoomLocality={() => triggerCamera('rover-locality')}
                  onFocusRouteCamera={() => {
                    setRoverChaseCam(false);
                    triggerCamera('rover-route');
                  }}
                  onSwapEndpoints={() => {
                    const prevA = roverStart;
                    setRoverStart(roverEnd);
                    setRoverEnd(prevA);
                    stopRoverAnimation();
                  }}
                  onChangeParams={setRoverParams}
                  onChangeRoutingMode={setRoverRoutingMode}
                  onChangePickMode={(m) => {
                    if (m !== 'none') setViewMode('lunar-globe');
                    setRoverPickMode(m);
                  }}
                  onSelectBenchmarkRoute={handleSelectBenchmarkRoute}
                  missionEpochMs={roverMissionEpochMs}
                  simTimeMs={simTimeMs}
                  onChangeMissionEpoch={(epochMs, syncSimClock = true) => {
                    if (syncSimClock) {
                      handleApplyMissionTime(epochMs, true, true);
                    } else {
                      setRoverMissionEpochMs(epochMs);
                      stopRoverAnimation();
                    }
                  }}
                  onOpenEpochModal={() => setIsEpochModalOpen(true)}
                  curatedSites={CURATED_LANDING_SITES}
                />
              )}
            </aside>
          )}

          {/* CENTER VIEWPORT FLOATING CONTROLS & LEGEND */}
          <main className="flex-1 flex flex-col justify-between items-center pointer-events-none min-w-0">
            <div className="flex flex-col items-center gap-1.5">
              {/* Primary 4-View Celestial & Polar Reference Frame Switcher */}
              <div className="flex flex-wrap items-center justify-center gap-1 hud-panel rounded-full px-2 py-1 pointer-events-auto border border-white/15 shadow-lg">
                <button
                  type="button"
                  onClick={() => setViewMode('lunar-globe')}
                  className={`hud-btn px-3 py-1 rounded-full text-[11px] font-mono-tech flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'lunar-globe'
                      ? 'bg-[#f59e0b] text-[#05070b] font-bold shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
                  title="Global 3D Selenographic Surface, LOLA DEM & Cislunar Constellation"
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Lunar Surface</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewMode('south-pole');
                    setCameraPreset(
                      selectedSite.lat <= -88.8 ? 'sp-shackleton' : 'sp-overview'
                    );
                    setCameraNonce((n) => n + 1);
                  }}
                  className={`hud-btn px-3 py-1 rounded-full text-[11px] font-mono-tech flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'south-pole'
                      ? 'bg-cyan-400 text-[#041017] font-bold shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
                  title="Dedicated High-Resolution Lunar South Pole View (NASA LROC NAC/WAC + 16-bit LOLA Polar Stereographic Clipmaps, 0° Prime Meridian Up)"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>South Pole</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewMode('earth-moon');
                    setAstroPreset('em-overview');
                    setAstroNonce((n) => n + 1);
                  }}
                  className={`hud-btn px-3 py-1 rounded-full text-[11px] font-mono-tech flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'earth-moon'
                      ? 'bg-[#38bdf8] text-[#05070b] font-bold shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
                  title="Geocentric 3D View: Moon Orbiting Tilted Rotating Earth (5.145° Inclined Orbit, Nodes, L1/L2 & DTE Link)"
                >
                  <Orbit className="w-3.5 h-3.5" />
                  <span>Moon Around Earth</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewMode('heliocentric');
                    setAstroPreset('helio-overview');
                    setAstroNonce((n) => n + 1);
                  }}
                  className={`hud-btn px-3 py-1 rounded-full text-[11px] font-mono-tech flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'heliocentric'
                      ? 'bg-[#fbbf24] text-[#05070b] font-bold shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
                  title="Heliocentric 3D View: Earth & Moon Orbiting the Sun (1 AU Ecliptic, Seasons, Perihelion/Aphelion & Epicycle)"
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>Earth & Moon Around Sun</span>
                </button>
              </div>

              {/* Context-Aware Camera Viewpoint Sub-Presets */}
              {viewMode === 'lunar-globe' && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 hud-panel rounded-full px-2.5 py-1 pointer-events-auto">
                  {[
                    { id: 'south-pole' as CameraPreset, lbl: 'South Pole (85°S)' },
                    { id: 'rover-locality' as CameraPreset, lbl: 'Rover Locality' },
                    { id: 'rover-route' as CameraPreset, lbl: 'Rover Route' },
                    { id: 'site' as CameraPreset, lbl: 'Focus Pin' },
                    { id: 'nearside' as CameraPreset, lbl: 'Near Side (DTE)' },
                    { id: 'farside' as CameraPreset, lbl: 'Far Side (SPA)' },
                    { id: 'north-pole' as CameraPreset, lbl: 'North Pole' },
                  ].map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => triggerCamera(cam.id, 'lunar-globe')}
                      className={`hud-btn px-2.5 py-0.5 rounded-full text-[11px] font-mono-tech cursor-pointer ${
                        cameraPreset === cam.id
                          ? 'bg-[#f59e0b]/25 text-[#fde68a] border border-[#f59e0b]/55 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {cam.lbl}
                    </button>
                  ))}
                </div>
              )}

              {viewMode === 'south-pole' && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 hud-panel rounded-full px-2.5 py-1 pointer-events-auto border border-cyan-400/25">
                  {[
                    { id: 'sp-overview' as CameraPreset, lbl: 'Polar Cap (90°S)' },
                    { id: 'sp-shackleton' as CameraPreset, lbl: 'Shackleton & Ridge' },
                    { id: 'sp-malapert' as CameraPreset, lbl: 'Malapert & Haworth' },
                    { id: 'sp-degerlache' as CameraPreset, lbl: 'de Gerlache & Shoemaker' },
                    { id: 'sp-mouton' as CameraPreset, lbl: 'Mons Mouton & Nobile' },
                    { id: 'site' as CameraPreset, lbl: 'Focus Pin' },
                    { id: 'rover-locality' as CameraPreset, lbl: 'Rover Locality' },
                    { id: 'rover-route' as CameraPreset, lbl: 'Rover Route' },
                  ].map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => triggerCamera(cam.id, 'south-pole')}
                      className={`hud-btn px-2.5 py-0.5 rounded-full text-[11px] font-mono-tech cursor-pointer ${
                        cameraPreset === cam.id
                          ? 'bg-cyan-400/25 text-cyan-200 border border-cyan-400/55 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {cam.lbl}
                    </button>
                  ))}
                </div>
              )}

              {viewMode === 'earth-moon' && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 hud-panel rounded-full px-2.5 py-1 pointer-events-auto">
                  {[
                    { id: 'em-overview' as AstroCameraPreset, lbl: 'System Overview' },
                    { id: 'em-top' as AstroCameraPreset, lbl: 'Ecliptic North' },
                    { id: 'em-nodes' as AstroCameraPreset, lbl: 'Nodes Edge-On (5.1°)' },
                    { id: 'em-moon' as AstroCameraPreset, lbl: 'Focus Moon' },
                    { id: 'em-earth' as AstroCameraPreset, lbl: 'Focus Earth' },
                  ].map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => triggerAstroCamera(cam.id)}
                      className={`hud-btn px-2.5 py-0.5 rounded-full text-[11px] font-mono-tech cursor-pointer ${
                        astroPreset === cam.id
                          ? 'bg-[#38bdf8]/25 text-[#bae6fd] border border-[#38bdf8]/55 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {cam.lbl}
                    </button>
                  ))}

                  <span className="h-3.5 w-[1px] bg-white/15 mx-0.5" />

                  <button
                    type="button"
                    onClick={() => {
                      setAstroTrueScale((s) => !s);
                      setAstroNonce((n) => n + 1);
                    }}
                    className={`hud-btn px-2.5 py-0.5 rounded-full text-[10.5px] font-mono-tech border cursor-pointer ${
                      astroTrueScale
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50 font-semibold'
                        : 'bg-white/[0.04] text-slate-300 border-white/15 hover:text-white'
                    }`}
                    title="Toggle between Schematic Readable Scale and True 1:1 Physical Scale (60.3 Earth Radii)"
                  >
                    {astroTrueScale ? '1:1 Physical (60 R⊕)' : 'Schematic Scale'}
                  </button>
                </div>
              )}

              {viewMode === 'heliocentric' && (
                <div className="flex flex-wrap items-center justify-center gap-1.5 hud-panel rounded-full px-2.5 py-1 pointer-events-auto">
                  {[
                    { id: 'helio-overview' as AstroCameraPreset, lbl: '1 AU System' },
                    { id: 'helio-top' as AstroCameraPreset, lbl: 'Ecliptic Top-Down' },
                    { id: 'helio-follow-em' as AstroCameraPreset, lbl: 'Follow Earth–Moon' },
                    { id: 'helio-tilt' as AstroCameraPreset, lbl: 'Axial Tilt & Seasons' },
                  ].map((cam) => (
                    <button
                      key={cam.id}
                      type="button"
                      onClick={() => triggerAstroCamera(cam.id)}
                      className={`hud-btn px-2.5 py-0.5 rounded-full text-[11px] font-mono-tech cursor-pointer ${
                        astroPreset === cam.id
                          ? 'bg-[#fbbf24]/25 text-[#fde68a] border border-[#fbbf24]/55 font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {cam.lbl}
                    </button>
                  ))}
                </div>
              )}

              {/* Active Time-Warp HUD Banner */}
              {activeWarp && (
                <KspActiveWarpBanner
                  activeWarp={activeWarp}
                  simTimeMs={simTimeMs}
                  onSnapNow={() => handleSnapTime(activeWarp.targetTimeMs)}
                  onCancel={handleCancelWarp}
                />
              )}
            </div>

            {/* Bottom-Center Floating Cursor Readout + Active Heatmap OR Orbital Telemetry */}
            {viewMode === 'lunar-globe' || viewMode === 'south-pole' ? (
              <div className="w-full flex flex-col items-center gap-2 mt-auto">
                {/* Hover Coordinate Readout Pill */}
                <div className="hud-panel rounded-full px-3 py-1 text-[11px] font-mono-tech text-slate-300 flex items-center gap-2.5 pointer-events-auto">
                  <Crosshair
                    className={`w-3.5 h-3.5 ${
                      viewMode === 'south-pole' ? 'text-cyan-300' : 'text-[#fbbf24]'
                    }`}
                  />
                  {hoverCoords ? (
                    <>
                      <span>
                        LAT{' '}
                        <strong className="text-white">
                          {Math.abs(hoverCoords.lat).toFixed(2)}°
                          {hoverCoords.lat >= 0 ? 'N' : 'S'}
                        </strong>
                      </span>
                      <span className="text-white/20">•</span>
                      <span>
                        LON{' '}
                        <strong className="text-white">
                          {Math.abs(hoverCoords.lon).toFixed(2)}°
                          {hoverCoords.lon >= 0 ? 'E' : 'W'}
                        </strong>
                      </span>
                      <span className="text-white/20">•</span>
                      <span>
                        LOLA{' '}
                        <strong className="text-[#7dd3fc]">
                          {hoverCoords.elevKm >= 0 ? '+' : ''}
                          {hoverCoords.elevKm.toFixed(2)} km
                        </strong>
                      </span>
                      {viewMode === 'south-pole' && hoverCoords.lat <= -70 && (
                        <>
                          <span className="text-white/20">•</span>
                          <span>
                            90°S{' '}
                            <strong className="text-cyan-300">
                              {(((90 + hoverCoords.lat) * Math.PI * 1737.4) / 180).toFixed(1)} km
                            </strong>
                          </span>
                        </>
                      )}
                      <span className="text-white/20">•</span>
                      <span className="text-[10px] text-emerald-300/90">
                        {
                          getDemResolutionAt(hoverCoords.lat, hoverCoords.lon, false)
                            .nsPostingMeters
                        }{' '}
                        m/px
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400 font-mono-tech text-[10px] tracking-wide">
                      {viewMode === 'south-pole'
                        ? 'NASA LROC NAC/WAC + 16-bit LOLA Polar Stereographic DEM (0° Prime Meridian Up)'
                        : 'LOLA Selenographic Terrain Model'}
                    </span>
                  )}
                </div>

                {/* Compact Active Heatmap Colorbar Strip */}
                <div className="hud-panel rounded-xl px-3.5 py-1.5 pointer-events-auto w-full max-w-md">
                  <div className="flex items-center justify-between text-[10px] font-mono-tech text-slate-300 mb-1">
                    <span className="font-semibold text-white">
                      {activeHeatmapConfig.label}
                    </span>
                    <span className="text-[#fcd34d]">{activeHeatmapConfig.unit}</span>
                  </div>
                  <div
                    className="h-2 w-full rounded-full border border-white/15"
                    style={{ background: activeHeatmapConfig.gradientCss }}
                  />
                  <div className="flex justify-between text-[9px] font-mono-tech text-slate-400 mt-0.5">
                    <span>{activeHeatmapConfig.minLabel}</span>
                    <span>{activeHeatmapConfig.midLabel}</span>
                    <span>{activeHeatmapConfig.maxLabel}</span>
                  </div>
                </div>
              </div>
            ) : viewMode === 'earth-moon' ? (
              <div className="w-full flex flex-col items-center gap-1.5 mt-auto tabular-nums">
                {celestialState.eclipseGeometryNote && (
                  <div className="hud-panel rounded-full px-3 py-1 border border-rose-400/50 bg-rose-500/15 text-rose-200 text-[10.5px] font-mono-tech pointer-events-auto">
                    ⚠ {celestialState.eclipseGeometryNote}
                  </div>
                )}

                <div className="hud-panel rounded-xl px-3.5 py-2 pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-mono-tech border border-sky-400/25">
                  <span>
                    Phase:{' '}
                    <strong className="text-[#fde68a]">
                      {celestialState.phaseName} ({celestialState.illuminatedFractionPct}%)
                    </strong>
                  </span>
                  <span className="text-white/20">•</span>
                  <span>
                    Range:{' '}
                    <strong className="text-[#7dd3fc]">
                      {Math.round(celestialState.earthMoonDistanceKm).toLocaleString()} km
                    </strong>{' '}
                    <span className="text-slate-400">
                      ({(celestialState.earthMoonDistanceKm / 6371).toFixed(1)} R⊕)
                    </span>
                  </span>
                  <span className="text-white/20">•</span>
                  <span>
                    V_moon:{' '}
                    <strong className="text-white">
                      {celestialState.moonOrbitalSpeedKms.toFixed(2)} km/s
                    </strong>
                  </span>
                  <span className="text-white/20">•</span>
                  <span>
                    β_ecl:{' '}
                    <strong className="text-emerald-300">
                      {celestialState.moonGeoLatDeg >= 0 ? '+' : ''}
                      {celestialState.moonGeoLatDeg.toFixed(2)}°
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSpeedMult(86400);
                      setIsPlaying(true);
                    }}
                    className="hud-btn px-2 py-0.5 rounded bg-[#38bdf8]/20 hover:bg-[#38bdf8]/35 border border-[#38bdf8]/45 text-[10px] text-[#bae6fd] cursor-pointer"
                    title="Warp simulation clock to 1 day/sec to watch the Moon orbit Earth"
                  >
                    Warp 1d/s
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center gap-1.5 mt-auto tabular-nums">
                <div className="hud-panel rounded-xl px-3.5 py-2 pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-mono-tech border border-amber-400/25">
                  <span>
                    Sun–Earth:{' '}
                    <strong className="text-[#fde68a]">
                      {celestialState.earthSunDistanceAu.toFixed(4)} AU
                    </strong>{' '}
                    <span className="text-slate-400">
                      ({(celestialState.earthSunDistanceKm / 1e6).toFixed(2)}M km)
                    </span>
                  </span>
                  <span className="text-white/20">•</span>
                  <span>
                    V_earth:{' '}
                    <strong className="text-[#7dd3fc]">
                      {celestialState.earthOrbitalSpeedKms.toFixed(2)} km/s
                    </strong>
                  </span>
                  <span className="text-white/20">•</span>
                  <span>
                    Season:{' '}
                    <strong className="text-emerald-300">
                      {celestialState.earthSeasonLabel}
                    </strong>
                  </span>
                  <span className="text-white/20">•</span>
                  <span>
                    Moon:{' '}
                    <strong className="text-white">
                      {celestialState.phaseName} ({celestialState.illuminatedFractionPct}%)
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSpeedMult(1296000);
                      setIsPlaying(true);
                    }}
                    className="hud-btn px-2 py-0.5 rounded bg-[#f59e0b]/20 hover:bg-[#f59e0b]/35 border border-[#f59e0b]/45 text-[10px] text-[#fde68a] cursor-pointer"
                    title="Warp simulation clock to 15 days/sec to watch Earth & Moon orbit the Sun"
                  >
                    Warp 15d/s
                  </button>
                </div>
              </div>
            )}
          </main>

          {/* RIGHT DOCK: MISSION READINESS GO/NO-GO CONSOLE, SKYPLOT & AI CO-PILOT */}
          {!zenMode && (
            <aside className="hud-panel rounded-xl w-[348px] lg:w-[368px] shrink-0 pointer-events-auto flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                {/* Target Header + Readiness Score */}
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/[0.08]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono-tech px-1.5 py-0.5 rounded bg-[#f59e0b]/20 text-[#fcd34d] border border-[#f59e0b]/35">
                        {evaluation.site.missionTag}
                      </span>
                      <span className="text-[10px] font-mono-tech text-slate-400">
                        {Math.abs(evaluation.site.lat).toFixed(2)}°
                        {evaluation.site.lat >= 0 ? 'N' : 'S'},{' '}
                        {Math.abs(evaluation.site.lon).toFixed(2)}°
                        {evaluation.site.lon >= 0 ? 'E' : 'W'}
                      </span>
                    </div>
                    <h2 className="font-display font-bold text-sm text-white mt-1 truncate">
                      {evaluation.site.name}
                    </h2>
                    <p className="text-[11px] text-slate-400 truncate">
                      {evaluation.site.subtitle}
                    </p>
                  </div>

                  {/* Go / Caution / No-Go Verdict Pill */}
                  <div
                    className={`shrink-0 px-2.5 py-1.5 rounded-lg border text-right font-mono-tech ${overallBadge.pill}`}
                  >
                    <div className="text-xs font-bold tracking-wider">
                      {evaluation.overallStatus}
                    </div>
                    <div className="text-[10px] opacity-90">
                      {evaluation.readinessScore}/100
                    </div>
                  </div>
                </div>

                {/* 6-Tile Telemetry Snapshot Grid */}
                <div className="grid grid-cols-3 gap-1.5 font-mono-tech">
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="text-[9px] text-slate-400 uppercase">Elevation</div>
                    <div className="text-xs font-semibold text-white mt-0.5">
                      {evaluation.elevationKm >= 0 ? '+' : ''}
                      {evaluation.elevationKm.toFixed(2)} km
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="text-[9px] text-slate-400 uppercase">Slope</div>
                    <div
                      className={`text-xs font-semibold mt-0.5 ${
                        evaluation.slopeDeg <= 8
                          ? 'text-emerald-300'
                          : evaluation.slopeDeg <= 12
                          ? 'text-amber-300'
                          : 'text-rose-400'
                      }`}
                    >
                      {evaluation.slopeDeg.toFixed(1)}°
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="text-[9px] text-slate-400 uppercase">Diviner Temp</div>
                    <div className="text-xs font-semibold text-rose-200 mt-0.5">
                      {evaluation.surfaceTempK} K
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="text-[9px] text-slate-400 uppercase">Solar Duty</div>
                    <div className="text-xs font-semibold text-[#fcd34d] mt-0.5">
                      {evaluation.illuminationDutyPct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="text-[9px] text-slate-400 uppercase">H₂O Ice</div>
                    <div className="text-xs font-semibold text-cyan-300 mt-0.5">
                      {evaluation.waterIceWtPct.toFixed(1)} wt%
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="text-[9px] text-slate-400 uppercase">Relays Live</div>
                    <div className="text-xs font-semibold text-emerald-300 mt-0.5">
                      {evaluation.visibleRelays.length} / 4
                    </div>
                  </div>
                </div>

                {/* Flight Rules Go/No-Go Matrix */}
                <div>
                  <div className="text-[11px] font-display uppercase tracking-[0.12em] text-slate-300 font-semibold mb-1.5">
                    Flight-Rule Readiness Checks
                  </div>
                  <div className="space-y-1.5">
                    {evaluation.flightRules.map((fr) => {
                      const st = statusStyle(fr.status);
                      return (
                        <div
                          key={fr.id}
                          className="p-2 rounded-lg bg-white/[0.025] border border-white/[0.07]"
                          title={fr.detail}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {st.icon}
                              <span className="text-xs font-medium text-slate-200 truncate">
                                {fr.label}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono-tech text-slate-200 shrink-0">
                              {fr.valueText}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 pl-5 leading-snug">
                            {fr.detail}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 360° Polar Skyplot / Topographic Horizon Rim */}
                <PolarHorizonSkyplot
                  evaluation={evaluation}
                  selectedSatelliteId={selectedSatelliteId}
                  onSelectSatellite={(id) => {
                    setSelectedSatelliteId(id);
                    setLeftTab('satellites');
                  }}
                />

                {/* Flight Readiness & Optimal Touchdown Finder */}
                <AiMissionAdvisor
                  evaluation={evaluation}
                  passes={upcomingPasses}
                  optimalWindows={optimalWindows}
                  onJumpToTime={(ms) => handleApplyMissionTime(ms, true, true)}
                />
              </div>
            </aside>
          )}
        </div>

        {/* BOTTOM DRAWER: ROVER ELEVATION/SOC PROFILE OR 30-DAY SYNODIC TIMELINE */}
        {!zenMode &&
          (bottomDrawerMode === 'rover' &&
          (roverWorkflowStep === 'route-ready' || roverWorkflowStep === 'animating') ? (
            <RoverElevationDrawer
              plan={roverPlan}
              roverParams={roverParams}
              animProgress={roverAnimProgress}
              isAnimating={isRoverAnimating}
              onTogglePlay={handleTogglePlayAnimation}
              onScrubProgress={(p) => {
                setIsRoverAnimating(false);
                setRoverAnimProgress(p);
                if (roverWorkflowStep !== 'animating') setRoverWorkflowStep('animating');
              }}
              onSwitchToSynodic={() => setBottomDrawerMode('synodic')}
            />
          ) : (
            <SynodicTimelineDrawer
              timeline={synodicTimeline}
              currentTimeMs={simTimeMs}
              anchorTimeMs={timelineAnchorMs}
              optimalWindows={optimalWindows}
              siteName={evaluation.site.name}
              onScrubTime={(ms) => handleApplyMissionTime(ms, true, true)}
              onSwitchToRover={() => {
                setBottomDrawerMode('rover');
                setLeftTab('rover');
              }}
            />
          ))}
      </div>

      {/* SIDE-BY-SIDE SITE & LAUNCH-SLIP COMPARISON MODAL */}
      <SiteComparisonModal
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        primaryEval={evaluation}
        allSites={CURATED_LANDING_SITES}
        compareSite={compareSite}
        onChangeCompareSite={setCompareSite}
      />

      {/* PAST / PRESENT / FUTURE MISSION EPOCH SELECTOR MODAL */}
      <MissionEpochModal
        isOpen={isEpochModalOpen}
        onClose={() => setIsEpochModalOpen(false)}
        simTimeMs={simTimeMs}
        roverMissionEpochMs={roverMissionEpochMs}
        onApplyTime={handleApplyMissionTime}
      />

      {/* MANUAL LUNAR SURFACE & ORBITAL LOCATION WRT SUN & EARTH MODAL */}
      <SunEarthLocatorModal
        isOpen={isSunEarthModalOpen}
        onClose={() => setIsSunEarthModalOpen(false)}
        simTimeMs={simTimeMs}
        onApplyLandingSite={(lat, lon, customName) => {
          handleSelectCustomPoint(lat, lon, customName);
          triggerCamera('site');
          setIsSunEarthModalOpen(false);
        }}
        onApplyRoverStart={(lat, lon, label) => {
          setLeftTab('rover');
          setRoverActive(true);
          handleConfirmStartAndZoomLocality({ lat, lon, label });
          setIsSunEarthModalOpen(false);
        }}
        onApplyRoverGoal={(lat, lon, label) => {
          setLeftTab('rover');
          setRoverActive(true);
          handleSelectEndPoint({ lat, lon, label });
          triggerCamera('rover-route');
          setIsSunEarthModalOpen(false);
        }}
        onStartWarp={handleStartWarp}
        onSnapTime={handleSnapTime}
        onChangeSurfacePreview={setPreviewSunEarthPoint}
      />
    </div>
  );
}

export default App;

