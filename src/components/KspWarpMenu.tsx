import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FastForward,
  Orbit,
  Radio,
  Sparkles,
  Square,
  Sun,
  Zap,
} from 'lucide-react';
import {
  computeOrbitalWarpTargets,
  formatUtcParts,
  formatWarpDelta,
} from '../engine/celestialEphemeris';
import { computeSiteSurfaceWarpTargets } from '../engine/selenography';
import {
  ActiveTimeWarpState,
  LandingSite,
  OptimalWindowRecommendation,
  SatellitePassWindow,
  ViewportViewMode,
  WarpTargetOption,
} from '../types/lunar';

interface KspWarpMenuProps {
  simTimeMs: number;
  selectedSite: LandingSite;
  upcomingPasses: SatellitePassWindow[];
  optimalWindows: OptimalWindowRecommendation[];
  activeWarp: ActiveTimeWarpState | null;
  onStartWarp: (
    targetTimeMs: number,
    label: string,
    switchToView?: ViewportViewMode
  ) => void;
  onSnapTime: (
    targetTimeMs: number,
    switchToView?: ViewportViewMode
  ) => void;
  onCancelWarp: () => void;
}

export const KspWarpMenu: React.FC<KspWarpMenuProps> = ({
  simTimeMs,
  selectedSite,
  upcomingPasses,
  optimalWindows,
  activeWarp,
  onStartWarp,
  onSnapTime,
  onCancelWarp,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [autoSwitchView, setAutoSwitchView] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'surface' | 'lunar' | 'helio'>(
    'surface'
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  // Recompute targets when menu opens (or every minute while open)
  const minuteBucket = Math.floor(simTimeMs / 60000);

  const surfaceTargets = useMemo<WarpTargetOption[]>(() => {
    if (!isOpen) return [];
    const base = computeSiteSurfaceWarpTargets(selectedSite, simTimeMs);

    const nextPass = upcomingPasses.find(
      (p) => p.aosTimeMs > simTimeMs + 30000
    );
    if (nextPass) {
      base.push({
        id: `pass-${nextPass.satelliteId}`,
        label: `Next Relay AOS: ${nextPass.satelliteName.split(' (')[0]}`,
        subtitle: `${nextPass.durationMinutes}m pass • Max +${nextPass.maxElevationDeg}° (${nextPass.peakDataRateMbps} Mbps)`,
        targetTimeMs: nextPass.aosTimeMs,
        category: 'satellite',
        recommendedView: 'lunar-globe',
      });
    }

    const nextOpt = optimalWindows.find(
      (w) => w.startMs > simTimeMs + 60000
    );
    if (nextOpt) {
      base.push({
        id: 'opt-touchdown',
        label: `Optimal Touchdown Window (${nextOpt.score}/100)`,
        subtitle: `${nextOpt.durationHours}h sunlit + comm lock`,
        targetTimeMs: nextOpt.startMs,
        category: 'surface',
        recommendedView: 'lunar-globe',
      });
    }

    return base.sort((a, b) => a.targetTimeMs - b.targetTimeMs);
  }, [isOpen, selectedSite, minuteBucket, upcomingPasses, optimalWindows]);

  const orbitalTargets = useMemo<WarpTargetOption[]>(() => {
    if (!isOpen) return [];
    return computeOrbitalWarpTargets(simTimeMs);
  }, [isOpen, minuteBucket]);

  const displayedTargets = useMemo(() => {
    if (activeTab === 'surface') return surfaceTargets;
    if (activeTab === 'lunar') {
      return orbitalTargets.filter((t) => t.category === 'lunar-orbit');
    }
    return orbitalTargets.filter((t) => t.category === 'heliocentric');
  }, [activeTab, surfaceTargets, orbitalTargets]);

  return (
    <div ref={containerRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`hud-btn px-2 py-1 rounded-md border text-[10.5px] font-mono-tech font-bold flex items-center gap-1 cursor-pointer transition-colors ${
          activeWarp
            ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 shadow-[0_0_12px_rgba(34,197,94,0.35)]'
            : isOpen
            ? 'bg-emerald-500/20 border-emerald-400/70 text-emerald-300'
            : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
        }`}
        title="'Warp To' Event & Orbital Milestone Selector"
      >
        <FastForward className="w-3 h-3 text-emerald-400" />
        <span>Warp To</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-[360px] max-w-[92vw] rounded-xl bg-[#050a12]/98 border border-emerald-400/45 shadow-[0_18px_50px_rgba(0,0,0,0.85)] backdrop-blur-xl z-50 overflow-hidden tabular-nums">
          {/* Header */}
          <div className="px-3 py-2 bg-emerald-950/35 border-b border-emerald-400/25 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400 font-mono-tech font-bold text-xs tracking-wider">
                ▸▸▸ WARP TO EVENT
              </span>
            </div>
            <label className="flex items-center gap-1.5 text-[9.5px] font-mono-tech text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSwitchView}
                onChange={(e) => setAutoSwitchView(e.target.checked)}
                className="accent-emerald-400 rounded cursor-pointer"
              />
              <span>Auto-frame 3D view</span>
            </label>
          </div>

          {/* Domain Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1.5 bg-[#04070d] border-b border-white/10 text-[10px] font-mono-tech">
            <button
              type="button"
              onClick={() => setActiveTab('surface')}
              className={`py-1 rounded flex items-center justify-center gap-1 cursor-pointer ${
                activeTab === 'surface'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/45 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>Site & Relays</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('lunar')}
              className={`py-1 rounded flex items-center justify-center gap-1 cursor-pointer ${
                activeTab === 'lunar'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/45 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Orbit className="w-3 h-3" />
              <span>Moon Orbit</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('helio')}
              className={`py-1 rounded flex items-center justify-center gap-1 cursor-pointer ${
                activeTab === 'helio'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-400/45 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sun className="w-3 h-3" />
              <span>Sun–Earth</span>
            </button>
          </div>

          {/* Target List */}
          <div className="max-h-[290px] overflow-y-auto p-2 space-y-1.5">
            {displayedTargets.length === 0 ? (
              <div className="py-6 text-center text-[11px] font-mono-tech text-slate-400">
                No upcoming transitions within scan window (site may be in continuous polar sunlight or shadow).
              </div>
            ) : (
              displayedTargets.map((item) => {
                const deltaMs = Math.max(0, item.targetTimeMs - simTimeMs);
                const utc = formatUtcParts(item.targetTimeMs);
                return (
                  <div
                    key={item.id}
                    className="p-2 rounded-lg bg-white/[0.025] hover:bg-white/[0.055] border border-white/[0.08] hover:border-emerald-400/40 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-white truncate">
                          {item.label}
                        </span>
                      </div>
                      <div className="text-[9.5px] text-slate-400 truncate mt-0.5">
                        {item.subtitle}
                      </div>
                      <div className="text-[9.5px] font-mono-tech text-emerald-300 mt-0.5">
                        T + {formatWarpDelta(deltaMs)} •{' '}
                        <span className="text-slate-400">
                          {utc.dateStr} {utc.timeStr}Z
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onStartWarp(
                            item.targetTimeMs,
                            item.label,
                            autoSwitchView ? item.recommendedView : undefined
                          );
                          setIsOpen(false);
                        }}
                        className="hud-btn px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-[#04130d] font-mono-tech font-bold text-[10px] cursor-pointer shadow"
                        title="Smooth time-warp with proportional acceleration & deceleration"
                      >
                        ▸▸ Warp
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSnapTime(
                            item.targetTimeMs,
                            autoSwitchView ? item.recommendedView : undefined
                          );
                          setIsOpen(false);
                        }}
                        className="hud-btn p-1 rounded bg-white/[0.07] hover:bg-white/[0.15] border border-white/15 text-slate-200 cursor-pointer"
                        title="Instant Jump (0s)"
                      >
                        <Zap className="w-3 h-3 text-amber-300" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const KspActiveWarpBanner: React.FC<{
  activeWarp: ActiveTimeWarpState;
  simTimeMs: number;
  onSnapNow: () => void;
  onCancel: () => void;
}> = ({ activeWarp, simTimeMs, onSnapNow, onCancel }) => {
  const totalSpan = Math.max(1, Math.abs(activeWarp.targetTimeMs - activeWarp.startTimeMs));
  const remSpan = Math.max(0, Math.abs(activeWarp.targetTimeMs - simTimeMs));
  const progressPct = Math.max(0, Math.min(100, ((totalSpan - remSpan) / totalSpan) * 100));

  const formatRateLabel = (mult: number): string => {
    if (mult >= 86400 * 30) return `${(mult / (86400 * 30)).toFixed(1)} mo/s`;
    if (mult >= 86400) return `${(mult / 86400).toFixed(1)} d/s`;
    if (mult >= 3600) return `${(mult / 3600).toFixed(1)} h/s`;
    if (mult >= 60) return `${Math.round(mult / 60)} m/s`;
    return `${Math.round(mult)}×`;
  };

  return (
    <div className="pointer-events-auto rounded-xl bg-[#04140d]/95 border border-emerald-400/75 px-3.5 py-2 shadow-[0_0_25px_rgba(16,185,129,0.3)] backdrop-blur-md flex flex-col gap-1.5 min-w-[320px] max-w-[460px] tabular-nums">
      <div className="flex items-center justify-between gap-3 font-mono-tech">
        <div className="flex items-center gap-2 min-w-0">
          {/* Iconic KSP Green Time-Warp Chevrons */}
          <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-400/50 text-emerald-400 text-[10px] tracking-tighter font-bold shrink-0">
            {'▸'.repeat(activeWarp.warpArrows)}
            <span className="text-emerald-900">
              {'▸'.repeat(Math.max(0, 6 - activeWarp.warpArrows))}
            </span>
          </span>
          <span className="text-[11px] font-bold text-emerald-200 truncate">
            WARPING TO: {activeWarp.label}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onSnapNow}
            className="hud-btn px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 border border-white/20 text-[9.5px] font-mono-tech text-amber-200 cursor-pointer"
            title="Finish warp immediately"
          >
            ⚡ Instant
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="hud-btn px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/50 text-[9.5px] font-mono-tech text-rose-200 flex items-center gap-1 cursor-pointer"
            title="Abort Time Warp (Esc)"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
            <span>Stop</span>
          </button>
        </div>
      </div>

      {/* Progress Bar & Countdown */}
      <div className="w-full h-1.5 rounded-full bg-emerald-950/90 border border-emerald-500/30 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-lime-300 transition-[width] duration-75"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono-tech text-slate-300">
        <span>
          Remaining: <strong className="text-white">T − {formatWarpDelta(remSpan)}</strong>
        </span>
        <span className="text-emerald-300">
          Warp Rate: {formatRateLabel(activeWarp.currentRateMult)}
        </span>
      </div>
    </div>
  );
};

