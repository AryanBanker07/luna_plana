import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  FastForward,
  Globe,
  MapPin,
  Move,
  Orbit,
  RotateCcw,
  Route,
  Sun,
  X,
  Zap,
} from 'lucide-react';
import {
  computeCelestialSystemState,
  formatUtcParts,
  formatWarpDelta,
  norm360,
  solveNextEarthHelioLonTime,
  solveNextMoonElongationTime,
} from '../engine/celestialEphemeris';
import {
  computeSunEarthSelenographic,
  evaluateLandingSite,
  solveSurfaceLocationWrtSunEarth,
} from '../engine/selenography';
import {
  LandingSite,
  SunEarthSurfaceMode,
  ViewportViewMode,
} from '../types/lunar';

interface SunEarthLocatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  simTimeMs: number;
  onApplyLandingSite: (lat: number, lon: number, customName: string) => void;
  onApplyRoverStart: (lat: number, lon: number, label: string) => void;
  onApplyRoverGoal: (lat: number, lon: number, label: string) => void;
  onStartWarp: (
    targetTimeMs: number,
    label: string,
    switchToView?: ViewportViewMode
  ) => void;
  onSnapTime: (
    targetTimeMs: number,
    switchToView?: ViewportViewMode
  ) => void;
  onChangeSurfacePreview: (
    preview: { lat: number; lon: number; label: string } | null
  ) => void;
}

export const SunEarthLocatorModal: React.FC<SunEarthLocatorModalProps> = ({
  isOpen,
  onClose,
  simTimeMs,
  onApplyLandingSite,
  onApplyRoverStart,
  onApplyRoverGoal,
  onStartWarp,
  onSnapTime,
  onChangeSurfacePreview,
}) => {
  const [activeTab, setActiveTab] = useState<'surface' | 'orbital'>('surface');

  // Surface WRT Sun & Earth state
  const [surfaceMode, setSurfaceMode] =
    useState<SunEarthSurfaceMode>('sun-offset');
  const [deltaLonSun, setDeltaLonSun] = useState<number>(-90); // -90° = Morning Sunrise Terminator
  const [deltaLonEarth, setDeltaLonEarth] = useState<number>(0);
  const [deltaLatEarth, setDeltaLatEarth] = useState<number>(0);
  const [useRelEarthLat, setUseRelEarthLat] = useState<boolean>(false);
  const [targetLat, setTargetLat] = useState<number>(-85.0);
  const [desiredSunEl, setDesiredSunEl] = useState<number>(8.0);
  const [desiredEarthEl, setDesiredEarthEl] = useState<number>(6.0);
  const [preferredHemisphere, setPreferredHemisphere] = useState<
    'south' | 'north'
  >('south');
  const [presetLabel, setPresetLabel] = useState<string>(
    'Sun/Earth Relative Target'
  );

  // Orbital WRT Sun & Earth state
  const [targetElongationDeg, setTargetElongationDeg] = useState<number>(180); // 180° = Full Moon
  const [targetHelioLonDeg, setTargetHelioLonDeg] = useState<number>(102.9); // Perihelion

  // Draggable movable window state
  const [offset, setOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      onChangeSurfacePreview(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, onChangeSurfacePreview]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      setOffset({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isDragging]);

  const sunEarthSub = useMemo(
    () => computeSunEarthSelenographic(simTimeMs),
    [simTimeMs]
  );

  const celestialState = useMemo(
    () => computeCelestialSystemState(simTimeMs),
    [simTimeMs]
  );

  const surfaceSolution = useMemo(
    () =>
      solveSurfaceLocationWrtSunEarth({
        timeMs: simTimeMs,
        mode: surfaceMode,
        deltaLonFromSunDeg: deltaLonSun,
        deltaLonFromEarthDeg: deltaLonEarth,
        deltaLatFromEarthDeg: deltaLatEarth,
        targetLatDeg: targetLat,
        useRelativeEarthLat: useRelEarthLat,
        desiredSunElevDeg: desiredSunEl,
        desiredEarthElevDeg: desiredEarthEl,
        preferredHemisphere,
      }),
    [
      simTimeMs,
      surfaceMode,
      deltaLonSun,
      deltaLonEarth,
      deltaLatEarth,
      targetLat,
      useRelEarthLat,
      desiredSunEl,
      desiredEarthEl,
      preferredHemisphere,
    ]
  );

  // Full LOLA topographic & horizon evaluation at the solved coordinate
  const liveSurfaceEval = useMemo(() => {
    if (!isOpen) return null;
    const tempSite: LandingSite = {
      id: 'rel-preview',
      name: presetLabel,
      subtitle: 'Sun & Earth Relative Coordinate',
      category: 'custom',
      missionTag: 'SUN/EARTH REL',
      lat: surfaceSolution.lat,
      lon: surfaceSolution.lon,
      geology: 'Evaluated from NASA LOLA DEM.',
      strategicNotes: 'Manually positioned wrt Sun & Earth.',
    };
    return evaluateLandingSite(tempSite, simTimeMs, false);
  }, [isOpen, surfaceSolution.lat, surfaceSolution.lon, simTimeMs, presetLabel]);

  // Broadcast live 3D reticle on LunarGlobe3D while surface tab is active
  useEffect(() => {
    if (isOpen && activeTab === 'surface') {
      onChangeSurfacePreview({
        lat: surfaceSolution.lat,
        lon: surfaceSolution.lon,
        label: presetLabel,
      });
    } else {
      onChangeSurfacePreview(null);
    }
  }, [
    isOpen,
    activeTab,
    surfaceSolution.lat,
    surfaceSolution.lon,
    presetLabel,
    onChangeSurfacePreview,
  ]);

  // Orbital solvers for Tab 2
  const nextMoonElongMs = useMemo(
    () =>
      isOpen
        ? solveNextMoonElongationTime(simTimeMs, targetElongationDeg)
        : simTimeMs,
    [isOpen, simTimeMs, targetElongationDeg]
  );

  const nextEarthHelioMs = useMemo(
    () =>
      isOpen
        ? solveNextEarthHelioLonTime(simTimeMs, targetHelioLonDeg)
        : simTimeMs,
    [isOpen, simTimeMs, targetHelioLonDeg]
  );

  if (!isOpen) return null;

  const formattedCoord = `${Math.abs(surfaceSolution.lat).toFixed(2)}°${
    surfaceSolution.lat >= 0 ? 'N' : 'S'
  }, ${Math.abs(surfaceSolution.lon).toFixed(2)}°${
    surfaceSolution.lon >= 0 ? 'E' : 'W'
  }`;

  const handleDialClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = e.clientX - rect.left - cx;
    const dy = e.clientY - rect.top - cy;
    // Right (+X) = 0° Toward Sun (New Moon); Top (-Y) = 90° First Quarter (CCW prograde!)
    const angleDeg = norm360(Math.atan2(-dy, dx) * (180 / Math.PI));
    setTargetElongationDeg(Math.round(angleDeg));
  };

  return (
    <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center p-3">
      <div
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="pointer-events-auto w-full max-w-[540px] max-h-[88vh] rounded-2xl bg-[#060a13]/96 border border-cyan-400/45 shadow-[0_24px_70px_rgba(0,0,0,0.85)] backdrop-blur-xl flex flex-col overflow-hidden tabular-nums"
      >
        {/* Draggable Header Bar */}
        <div
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            setIsDragging(true);
            dragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              origX: offset.x,
              origY: offset.y,
            };
          }}
          className={`px-4 py-2.5 bg-gradient-to-r from-cyan-950/55 via-[#070d19] to-amber-950/35 border-b border-white/12 flex items-center justify-between gap-2 select-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-400/45 flex items-center justify-center text-cyan-300 shrink-0">
              <Compass className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-xs sm:text-sm tracking-wider uppercase text-white truncate">
                  Sun & Earth Relative Locator
                </h2>
              </div>
              <p className="text-[10px] text-slate-400 truncate">
                Select surface or orbital positions manually wrt Sub-Solar (☉) & Sub-Earth (⊕)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {(offset.x !== 0 || offset.y !== 0) && (
              <button
                type="button"
                onClick={() => setOffset({ x: 0, y: 0 })}
                className="hud-btn px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-[9.5px] font-mono-tech text-slate-300 cursor-pointer flex items-center gap-1"
                title="Reset Window Position"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Reset</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="hud-btn p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.14] border border-white/10 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mode Switcher: Lunar Surface vs Orbital Space */}
        <div className="grid grid-cols-2 gap-1.5 p-2 bg-[#04070e] border-b border-white/10 font-mono-tech text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('surface')}
            className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer border ${
              activeTab === 'surface'
                ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-bold'
                : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-white'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Lunar Surface WRT Sun & Earth</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('orbital')}
            className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer border ${
              activeTab === 'orbital'
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-200 font-bold'
                : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-white'
            }`}
          >
            <Orbit className="w-3.5 h-3.5" />
            <span>Orbital Position & Warp</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {activeTab === 'surface' ? (
            <>
              {/* Instantaneous Sub-Solar & Sub-Earth Reference Strip */}
              <div className="grid grid-cols-3 gap-1.5 p-2 rounded-xl bg-white/[0.03] border border-white/10 font-mono-tech text-[10px]">
                <div>
                  <div className="text-amber-300 font-semibold">☉ Sub-Solar</div>
                  <div className="text-white mt-0.5">
                    {sunEarthSub.subSolarLat >= 0 ? '+' : ''}
                    {sunEarthSub.subSolarLat.toFixed(2)}°,{' '}
                    {sunEarthSub.subSolarLon.toFixed(1)}°
                  </div>
                </div>
                <div>
                  <div className="text-sky-300 font-semibold">⊕ Sub-Earth</div>
                  <div className="text-white mt-0.5">
                    {sunEarthSub.subEarthLat >= 0 ? '+' : ''}
                    {sunEarthSub.subEarthLat.toFixed(2)}°,{' '}
                    {sunEarthSub.subEarthLon >= 0 ? '+' : ''}
                    {sunEarthSub.subEarthLon.toFixed(1)}°
                  </div>
                </div>
                <div>
                  <div className="text-emerald-300 font-semibold">☉↔⊕ Angle</div>
                  <div className="text-white mt-0.5">
                    {surfaceSolution.sunEarthSeparationDeg}° ({celestialState.phaseName})
                  </div>
                </div>
              </div>

              {/* 8 Quick Sun/Earth Geometry Presets */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-400">
                  1. Quick Sun & Earth Reference Presets
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono-tech text-[10px]">
                  {[
                    {
                      lbl: '☉ Sub-Solar',
                      action: () => {
                        setSurfaceMode('sun-offset');
                        setDeltaLonSun(0);
                        setTargetLat(Number(sunEarthSub.subSolarLat.toFixed(2)));
                        setPresetLabel('Sub-Solar Zenith');
                      },
                    },
                    {
                      lbl: '🌅 Sunrise Term.',
                      action: () => {
                        setSurfaceMode('sun-offset');
                        setDeltaLonSun(-90);
                        setPresetLabel('Morning Sunrise Terminator');
                      },
                    },
                    {
                      lbl: '🌇 Sunset Term.',
                      action: () => {
                        setSurfaceMode('sun-offset');
                        setDeltaLonSun(90);
                        setPresetLabel('Evening Sunset Terminator');
                      },
                    },
                    {
                      lbl: '🌑 Anti-Solar',
                      action: () => {
                        setSurfaceMode('sun-offset');
                        setDeltaLonSun(180);
                        setTargetLat(Number((-sunEarthSub.subSolarLat).toFixed(2)));
                        setPresetLabel('Anti-Solar Midnight');
                      },
                    },
                    {
                      lbl: '⊕ Sub-Earth',
                      action: () => {
                        setSurfaceMode('earth-offset');
                        setUseRelEarthLat(true);
                        setDeltaLatEarth(0);
                        setDeltaLonEarth(0);
                        setPresetLabel('Sub-Earth DTE Zenith');
                      },
                    },
                    {
                      lbl: '📡 Polar DTE Limb',
                      action: () => {
                        setSurfaceMode('earth-offset');
                        setUseRelEarthLat(false);
                        setTargetLat(-85.5);
                        setDeltaLonEarth(0);
                        setPresetLabel('South Polar DTE Corridor');
                      },
                    },
                    {
                      lbl: '🔇 Far-Side Quiet',
                      action: () => {
                        setSurfaceMode('earth-offset');
                        setUseRelEarthLat(true);
                        setDeltaLatEarth(0);
                        setDeltaLonEarth(180);
                        setPresetLabel('Far-Side Radio-Quiet Zone');
                      },
                    },
                    {
                      lbl: '⚡ Sun+Earth Opt',
                      action: () => {
                        const halfSep = surfaceSolution.sunEarthSeparationDeg * 0.5;
                        const optEl = Math.max(4, Number((90 - halfSep).toFixed(1)));
                        setSurfaceMode('dual-elevation');
                        setDesiredSunEl(optEl);
                        setDesiredEarthEl(optEl);
                        setPresetLabel('Joint Sun+Earth Midpoint');
                      },
                    },
                  ].map((p) => (
                    <button
                      key={p.lbl}
                      type="button"
                      onClick={p.action}
                      className="hud-btn px-2 py-1.5 rounded-lg bg-white/[0.04] hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-400/50 text-slate-200 hover:text-cyan-200 cursor-pointer text-left truncate"
                    >
                      {p.lbl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Manual Coordinate Frame Selector */}
              <div className="space-y-2 p-2.5 rounded-xl bg-[#040811] border border-white/10">
                <div className="text-[10px] font-mono-tech uppercase tracking-wider text-cyan-300 font-semibold">
                  2. Manual Coordinate Frame WRT Sun & Earth
                </div>

                <div className="grid grid-cols-3 gap-1 font-mono-tech text-[10px]">
                  {[
                    { id: 'sun-offset' as SunEarthSurfaceMode, lbl: '☉ WRT Sun' },
                    { id: 'earth-offset' as SunEarthSurfaceMode, lbl: '⊕ WRT Earth' },
                    {
                      id: 'dual-elevation' as SunEarthSurfaceMode,
                      lbl: '☉+⊕ Sun & Earth El',
                    },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSurfaceMode(m.id);
                        setPresetLabel(
                          m.id === 'sun-offset'
                            ? 'Sun-Relative Target'
                            : m.id === 'earth-offset'
                            ? 'Earth-Relative Target'
                            : 'Dual Sun+Earth Target'
                        );
                      }}
                      className={`py-1 rounded border cursor-pointer ${
                        surfaceMode === m.id
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      {m.lbl}
                    </button>
                  ))}
                </div>

                {surfaceMode === 'sun-offset' && (
                  <div className="space-y-2 pt-1 font-mono-tech text-[11px]">
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Solar Longitude Offset (Δλ from Sub-Solar)</span>
                        <span className="text-amber-300 font-bold">
                          {deltaLonSun > 0 ? '+' : ''}
                          {deltaLonSun}°{' '}
                          <span className="text-[9.5px] text-slate-400 font-normal">
                            ({Math.abs(deltaLonSun) < 5
                              ? 'Noon'
                              : Math.abs(deltaLonSun + 90) < 6
                              ? 'Sunrise Term.'
                              : Math.abs(deltaLonSun - 90) < 6
                              ? 'Sunset Term.'
                              : Math.abs(Math.abs(deltaLonSun) - 180) < 6
                              ? 'Midnight'
                              : deltaLonSun < 0
                              ? 'Morning'
                              : 'Afternoon'})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={deltaLonSun}
                          onChange={(e) => setDeltaLonSun(Number(e.target.value))}
                          className="flex-1 accent-amber-400 cursor-pointer"
                        />
                        <input
                          type="number"
                          min={-180}
                          max={180}
                          step={0.5}
                          value={deltaLonSun}
                          onChange={(e) =>
                            setDeltaLonSun(
                              Math.max(-180, Math.min(180, Number(e.target.value) || 0))
                            )
                          }
                          className="w-16 bg-white/[0.05] border border-white/15 rounded px-1.5 py-0.5 text-xs text-white text-right"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Target Lunar Latitude (φ)</span>
                        <span className="text-cyan-300 font-bold">{targetLat}°</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={-89.8}
                          max={89.8}
                          step={0.2}
                          value={targetLat}
                          onChange={(e) => setTargetLat(Number(e.target.value))}
                          className="flex-1 accent-cyan-400 cursor-pointer"
                        />
                        <input
                          type="number"
                          min={-89.9}
                          max={89.9}
                          step={0.1}
                          value={targetLat}
                          onChange={(e) =>
                            setTargetLat(
                              Math.max(-89.9, Math.min(89.9, Number(e.target.value) || 0))
                            )
                          }
                          className="w-16 bg-white/[0.05] border border-white/15 rounded px-1.5 py-0.5 text-xs text-white text-right"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {surfaceMode === 'earth-offset' && (
                  <div className="space-y-2 pt-1 font-mono-tech text-[11px]">
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>Earth Longitude Offset (Δλ from Sub-Earth)</span>
                        <span className="text-sky-300 font-bold">
                          {deltaLonEarth > 0 ? '+' : ''}
                          {deltaLonEarth}°{' '}
                          <span className="text-[9.5px] text-slate-400 font-normal">
                            ({Math.abs(deltaLonEarth) < 85 ? 'Near Side DTE' : 'Far Side'})
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={deltaLonEarth}
                          onChange={(e) => setDeltaLonEarth(Number(e.target.value))}
                          className="flex-1 accent-sky-400 cursor-pointer"
                        />
                        <input
                          type="number"
                          min={-180}
                          max={180}
                          step={0.5}
                          value={deltaLonEarth}
                          onChange={(e) =>
                            setDeltaLonEarth(
                              Math.max(-180, Math.min(180, Number(e.target.value) || 0))
                            )
                          }
                          className="w-16 bg-white/[0.05] border border-white/15 rounded px-1.5 py-0.5 text-xs text-white text-right"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-300">
                      <span>Latitude Reference:</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setUseRelEarthLat(false)}
                          className={`px-2 py-0.5 rounded border cursor-pointer ${
                            !useRelEarthLat
                              ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                              : 'border-white/10 text-slate-400'
                          }`}
                        >
                          Selenographic φ
                        </button>
                        <button
                          type="button"
                          onClick={() => setUseRelEarthLat(true)}
                          className={`px-2 py-0.5 rounded border cursor-pointer ${
                            useRelEarthLat
                              ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                              : 'border-white/10 text-slate-400'
                          }`}
                        >
                          Δφ from Sub-Earth
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>
                          {useRelEarthLat
                            ? 'Latitude Offset Δφ from Sub-Earth'
                            : 'Target Lunar Latitude (φ)'}
                        </span>
                        <span className="text-sky-300 font-bold">
                          {useRelEarthLat ? deltaLatEarth : targetLat}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-89.5}
                        max={89.5}
                        step={0.5}
                        value={useRelEarthLat ? deltaLatEarth : targetLat}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (useRelEarthLat) setDeltaLatEarth(v);
                          else setTargetLat(v);
                        }}
                        className="w-full accent-sky-400 cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                {surfaceMode === 'dual-elevation' && (
                  <div className="space-y-2 pt-1 font-mono-tech text-[11px]">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-300">Preferred Hemisphere Intersection:</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setPreferredHemisphere('south')}
                          className={`px-2 py-0.5 rounded border cursor-pointer ${
                            preferredHemisphere === 'south'
                              ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-semibold'
                              : 'border-white/10 text-slate-400'
                          }`}
                        >
                          South (Artemis)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreferredHemisphere('north')}
                          className={`px-2 py-0.5 rounded border cursor-pointer ${
                            preferredHemisphere === 'north'
                              ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-semibold'
                              : 'border-white/10 text-slate-400'
                          }`}
                        >
                          North
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>☉ Desired Sun Elevation Angle</span>
                        <span className="text-amber-300 font-bold">
                          {desiredSunEl >= 0 ? '+' : ''}
                          {desiredSunEl}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-25}
                        max={85}
                        step={0.5}
                        value={desiredSunEl}
                        onChange={(e) => setDesiredSunEl(Number(e.target.value))}
                        className="w-full accent-amber-400 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>⊕ Desired Earth (DTE) Elevation Angle</span>
                        <span className="text-sky-300 font-bold">
                          {desiredEarthEl >= 0 ? '+' : ''}
                          {desiredEarthEl}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-25}
                        max={85}
                        step={0.5}
                        value={desiredEarthEl}
                        onChange={(e) => setDesiredEarthEl(Number(e.target.value))}
                        className="w-full accent-sky-400 cursor-pointer"
                      />
                    </div>

                    {surfaceSolution.note && (
                      <div className="p-2 rounded bg-amber-500/12 border border-amber-400/35 text-[10px] text-amber-200 leading-snug">
                        ℹ {surfaceSolution.note}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Resolved Coordinate & Live Topographic / LOS Verification */}
              {liveSurfaceEval && (
                <div className="p-3 rounded-xl bg-cyan-950/25 border border-cyan-400/40 space-y-2.5 font-mono-tech">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[9.5px] text-cyan-300 uppercase font-semibold">
                        Resolved Selenographic Coordinate (Live on 3D Moon ⌖)
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        {formattedCoord}
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-slate-300">
                      <div>Δλ_☉ {surfaceSolution.deltaLonFromSunDeg > 0 ? '+' : ''}{surfaceSolution.deltaLonFromSunDeg}°</div>
                      <div>Δλ_⊕ {surfaceSolution.deltaLonFromEarthDeg > 0 ? '+' : ''}{surfaceSolution.deltaLonFromEarthDeg}°</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                    <div className="p-1.5 rounded bg-black/35 border border-white/10">
                      <div className="text-slate-400 text-[8.5px]">LOLA ELEV</div>
                      <div className="text-white font-semibold">
                        {liveSurfaceEval.elevationKm >= 0 ? '+' : ''}
                        {liveSurfaceEval.elevationKm.toFixed(2)} km
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-black/35 border border-white/10">
                      <div className="text-slate-400 text-[8.5px]">SLOPE</div>
                      <div className="text-white font-semibold">
                        {liveSurfaceEval.slopeDeg.toFixed(1)}°
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-black/35 border border-white/10">
                      <div className="text-slate-400 text-[8.5px]">SUN LOS</div>
                      <div
                        className={`font-semibold ${
                          liveSurfaceEval.sun.isVisible
                            ? 'text-amber-300'
                            : 'text-rose-400'
                        }`}
                      >
                        {liveSurfaceEval.sun.elevationDeg >= 0 ? '+' : ''}
                        {liveSurfaceEval.sun.elevationDeg}°{' '}
                        {liveSurfaceEval.sun.isVisible ? 'CLR' : 'BLK'}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-black/35 border border-white/10">
                      <div className="text-slate-400 text-[8.5px]">EARTH DTE</div>
                      <div
                        className={`font-semibold ${
                          liveSurfaceEval.earth.isVisible
                            ? 'text-sky-300'
                            : 'text-rose-400'
                        }`}
                      >
                        {liveSurfaceEval.earth.elevationDeg >= 0 ? '+' : ''}
                        {liveSurfaceEval.earth.elevationDeg}°{' '}
                        {liveSurfaceEval.earth.isVisible ? 'CLR' : 'OCC'}
                      </div>
                    </div>
                  </div>

                  {/* Apply Buttons */}
                  <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        onApplyLandingSite(
                          surfaceSolution.lat,
                          surfaceSolution.lon,
                          `${presetLabel} (${formattedCoord})`
                        )
                      }
                      className="hud-btn py-1.5 px-2 rounded-lg bg-[#f59e0b] hover:bg-[#fbbf24] text-[#05070b] font-bold text-[10.5px] cursor-pointer flex items-center justify-center gap-1 shadow"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Set Site Pin</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onApplyRoverStart(
                          surfaceSolution.lat,
                          surfaceSolution.lon,
                          `${presetLabel} [A]`
                        )
                      }
                      className="hud-btn py-1.5 px-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/55 text-emerald-200 font-semibold text-[10.5px] cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Route className="w-3.5 h-3.5" />
                      <span>Rover Start [A]</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onApplyRoverGoal(
                          surfaceSolution.lat,
                          surfaceSolution.lon,
                          `${presetLabel} [B]`
                        )
                      }
                      className="hud-btn py-1.5 px-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/55 text-sky-200 font-semibold text-[10.5px] cursor-pointer flex items-center justify-center gap-1"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Rover Goal [B]</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* TAB 2: ORBITAL POSITION WRT SUN & EARTH + KSP WARP */
            <div className="space-y-3 font-mono-tech">
              {/* Section A: Moon Position WRT Sun–Earth Line */}
              <div className="p-3 rounded-xl bg-[#040811] border border-sky-400/35 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] uppercase text-sky-300 font-bold">
                    A. Moon Orbital Position WRT Sun–Earth Line
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Now: {celestialState.elongationDeg}° ({celestialState.phaseName})
                  </span>
                </div>

                {/* Interactive SVG Sun–Earth–Moon Phase Dial */}
                <div className="flex items-center gap-3">
                  <svg
                    viewBox="0 0 150 150"
                    onClick={handleDialClick}
                    className="w-[126px] h-[126px] shrink-0 rounded-xl bg-[#02050b] border border-white/10 cursor-pointer"
                  >
                    {/* Sunlight Rays from Right (+X = 0° Toward Sun) */}
                    <line x1="146" y1="30" x2="122" y2="30" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 2" opacity="0.6" />
                    <line x1="146" y1="75" x2="118" y2="75" stroke="#fbbf24" strokeWidth="1.6" strokeDasharray="3 2" opacity="0.85" />
                    <line x1="146" y1="120" x2="122" y2="120" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 2" opacity="0.6" />
                    <text x="145" y="18" textAnchor="end" fill="#fde047" fontSize="8">
                      ☉ SUN →
                    </text>

                    {/* Moon Orbit Circle */}
                    <circle
                      cx="72"
                      cy="75"
                      r="46"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="1.2"
                      strokeOpacity="0.45"
                    />

                    {/* Earth at Center */}
                    <circle cx="72" cy="75" r="9" fill="#0ea5e9" />
                    <path d="M 72 66 A 9 9 0 0 0 72 84 Z" fill="#082f49" />
                    <text x="72" y="95" textAnchor="middle" fill="#bae6fd" fontSize="7.5">
                      ⊕ Earth
                    </text>

                    {/* Current Moon Position */}
                    {(() => {
                      const rNow = (celestialState.elongationDeg * Math.PI) / 180;
                      const mx = 72 + 46 * Math.cos(rNow);
                      const my = 75 - 46 * Math.sin(rNow);
                      return (
                        <g>
                          <circle cx={mx} cy={my} r="4.5" fill="#cbd5e1" stroke="#fff" strokeWidth="0.8" />
                        </g>
                      );
                    })()}

                    {/* Selected Target Moon Angle */}
                    {(() => {
                      const rTgt = (targetElongationDeg * Math.PI) / 180;
                      const tx = 72 + 46 * Math.cos(rTgt);
                      const ty = 75 - 46 * Math.sin(rTgt);
                      return (
                        <g>
                          <line x1="72" y1="75" x2={tx} y2={ty} stroke="#22c55e" strokeWidth="1.1" strokeDasharray="2 2" />
                          <circle cx={tx} cy={ty} r="6" fill="#22c55e" fillOpacity="0.28" stroke="#4ade80" strokeWidth="1.5" />
                        </g>
                      );
                    })()}
                  </svg>

                  <div className="flex-1 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">Sun–Earth–Moon Angle:</span>
                      <span className="text-emerald-300 font-bold text-xs">
                        {targetElongationDeg}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={targetElongationDeg}
                      onChange={(e) => setTargetElongationDeg(Number(e.target.value))}
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                    <div className="grid grid-cols-4 gap-1 text-[9.5px]">
                      {[
                        { deg: 0, lbl: '0° New' },
                        { deg: 90, lbl: '90° 1Q' },
                        { deg: 180, lbl: '180° Full' },
                        { deg: 270, lbl: '270° 3Q' },
                      ].map((b) => (
                        <button
                          key={b.deg}
                          type="button"
                          onClick={() => setTargetElongationDeg(b.deg)}
                          className={`py-0.5 rounded border cursor-pointer ${
                            targetElongationDeg === b.deg
                              ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 font-bold'
                              : 'bg-white/[0.04] border-white/10 text-slate-300 hover:text-white'
                          }`}
                        >
                          {b.lbl}
                        </button>
                      ))}
                    </div>

                    <div className="text-[10px] text-slate-300">
                      Arrival: <strong className="text-white">T + {formatWarpDelta(nextMoonElongMs - simTimeMs)}</strong> ({formatUtcParts(nextMoonElongMs).dateStr})
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onStartWarp(
                        nextMoonElongMs,
                        `Moon Sun–Earth Angle ${targetElongationDeg}°`,
                        'earth-moon'
                      );
                      onClose();
                    }}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#04130d] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer shadow"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    <span>▸▸▸ Warp Moon To {targetElongationDeg}°</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSnapTime(nextMoonElongMs, 'earth-moon');
                      onClose();
                    }}
                    className="py-1.5 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-amber-200 text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Snap</span>
                  </button>
                </div>
              </div>

              {/* Section B: Earth Heliocentric Position WRT Sun */}
              <div className="p-3 rounded-xl bg-[#040811] border border-amber-400/35 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] uppercase text-amber-300 font-bold flex items-center gap-1.5">
                    <Sun className="w-3.5 h-3.5" />
                    <span>B. Earth 1 AU Position WRT Sun (λ⊕)</span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Now: λ⊕ {celestialState.earthHelioLonDeg}°
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={0.5}
                    value={targetHelioLonDeg}
                    onChange={(e) => setTargetHelioLonDeg(Number(e.target.value))}
                    className="flex-1 accent-amber-400 cursor-pointer"
                  />
                  <span className="w-16 text-right text-xs font-bold text-amber-200">
                    {targetHelioLonDeg.toFixed(1)}°
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-[9.5px]">
                  {[
                    { lon: 102.9, lbl: 'Perihelion' },
                    { lon: 180, lbl: 'Mar Eq' },
                    { lon: 270, lbl: 'Jun Sol' },
                    { lon: 282.9, lbl: 'Aphelion' },
                    { lon: 0, lbl: 'Sep Eq' },
                    { lon: 90, lbl: 'Dec Sol' },
                  ].map((s) => (
                    <button
                      key={s.lbl}
                      type="button"
                      onClick={() => setTargetHelioLonDeg(s.lon)}
                      className={`py-1 rounded border cursor-pointer ${
                        Math.abs(targetHelioLonDeg - s.lon) < 0.6
                          ? 'bg-amber-500/25 border-amber-400 text-amber-200 font-bold'
                          : 'bg-white/[0.04] border-white/10 text-slate-300 hover:text-white'
                      }`}
                    >
                      {s.lbl}
                    </button>
                  ))}
                </div>

                <div className="text-[10px] text-slate-300">
                  Arrival: <strong className="text-white">T + {formatWarpDelta(nextEarthHelioMs - simTimeMs)}</strong> ({formatUtcParts(nextEarthHelioMs).dateStr})
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onStartWarp(
                        nextEarthHelioMs,
                        `Earth Heliocentric λ⊕ ${targetHelioLonDeg.toFixed(1)}°`,
                        'heliocentric'
                      );
                      onClose();
                    }}
                    className="flex-1 py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#05070b] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer shadow"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    <span>▸▸▸ Warp Earth To λ⊕ {targetHelioLonDeg.toFixed(0)}°</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSnapTime(nextEarthHelioMs, 'heliocentric');
                      onClose();
                    }}
                    className="py-1.5 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-amber-200 text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Snap</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

