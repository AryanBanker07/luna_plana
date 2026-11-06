import React, { useState } from 'react';
import { ShieldCheck, Calendar, Sun, Radio, Mountain, Sparkles } from 'lucide-react';
import {
  OptimalWindowRecommendation,
  SatellitePassWindow,
  SiteEvaluation,
} from '../types/lunar';

interface AiMissionAdvisorProps {
  evaluation: SiteEvaluation;
  passes: SatellitePassWindow[];
  optimalWindows: OptimalWindowRecommendation[];
  onJumpToTime: (ms: number) => void;
}

export const AiMissionAdvisor: React.FC<AiMissionAdvisorProps> = ({
  evaluation,
  passes,
  optimalWindows,
  onJumpToTime,
}) => {
  const [activeCategory, setActiveCategory] = useState<'overview' | 'comms' | 'power'>('overview');

  const isPolar = Math.abs(evaluation.site.lat) > 75;
  const bestFlux = isPolar
    ? evaluation.solarFluxVerticalMastWm2
    : evaluation.solarFluxHorizontalWm2;
  const relayPasses = passes.filter((p) => p.isRelay);

  const topWindow = optimalWindows[0];

  return (
    <div className="pt-2.5 border-t border-white/[0.07] space-y-2">
      {/* Header & Status Indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span className="text-[11px] font-display uppercase tracking-[0.12em] text-slate-200 font-semibold">
            Flight Readiness & Windows
          </span>
        </div>
        <span
          className={`text-[10px] font-mono-tech px-2 py-0.5 rounded border font-semibold ${
            evaluation.overallStatus === 'GO'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              : evaluation.overallStatus === 'CAUTION'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
          }`}
        >
          {evaluation.overallStatus} ({evaluation.readinessScore}/100)
        </span>
      </div>

      {/* Primary Recommended Touchdown Window Card */}
      {topWindow ? (
        <div className="p-2.5 rounded-lg bg-[#38bdf8]/[0.06] border border-[#38bdf8]/25 flex items-center justify-between gap-2">
          <div className="text-[10px] leading-tight min-w-0">
            <div className="flex items-center gap-1 font-mono-tech text-[#7dd3fc] font-semibold">
              <Calendar className="w-3 h-3 text-[#38bdf8] shrink-0" />
              <span>
                Recommended Epoch: {topWindow.durationHours}h Continuous Sunlight
              </span>
            </div>
            <div className="text-slate-400 mt-1 font-mono-tech text-[9.5px]">
              {new Date(topWindow.startMs).toISOString().slice(0, 16).replace('T', ' ')}Z •{' '}
              DTE {topWindow.dteCoveragePct}% • Relay {topWindow.relayCoveragePct}%
            </div>
          </div>
          <button
            type="button"
            onClick={() => onJumpToTime(topWindow.startMs + 6 * 3600 * 1000)}
            className="hud-btn shrink-0 px-2.5 py-1 rounded bg-[#38bdf8] text-[#05070b] font-mono-tech font-bold text-[10px] hover:bg-[#7dd3fc] cursor-pointer flex items-center gap-1 shadow-sm"
          >
            <Sparkles className="w-3 h-3" />
            <span>Warp</span>
          </button>
        </div>
      ) : (
        <div className="p-2 rounded-lg bg-white/[0.02] border border-white/10 text-[10px] text-slate-400">
          Permanent shadow region — solar touchdown unavailable. RTG / nuclear power required.
        </div>
      )}

      {/* Category Toggle Tabs */}
      <div className="grid grid-cols-3 gap-1 p-0.5 rounded bg-black/30 border border-white/[0.08] text-[10px] font-mono-tech">
        <button
          type="button"
          onClick={() => setActiveCategory('overview')}
          className={`py-1 rounded text-center cursor-pointer transition-colors ${
            activeCategory === 'overview'
              ? 'bg-white/10 text-white font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Synthesis
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory('comms')}
          className={`py-1 rounded text-center cursor-pointer transition-colors ${
            activeCategory === 'comms'
              ? 'bg-white/10 text-white font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Comms
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory('power')}
          className={`py-1 rounded text-center cursor-pointer transition-colors ${
            activeCategory === 'power'
              ? 'bg-white/10 text-white font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Power/Thermal
        </button>
      </div>

      {/* Detailed Analysis Output Card */}
      <div className="bg-[#060911] rounded-lg border border-white/10 p-2.5 text-[10.5px] leading-relaxed space-y-1.5 font-mono-tech">
        {activeCategory === 'overview' && (
          <div className="space-y-1.5">
            <div className="flex items-start gap-1.5 text-slate-300">
              <Mountain className="w-3.5 h-3.5 text-[#38bdf8] shrink-0 mt-0.5" />
              <div>
                <span className="text-white font-semibold">Terrain:</span> Elev{' '}
                {evaluation.elevationKm >= 0 ? '+' : ''}
                {evaluation.elevationKm.toFixed(2)} km • Slope {evaluation.slopeDeg.toFixed(1)}° (
                {evaluation.slopeDeg <= 8 ? (
                  <span className="text-emerald-400">Safe &lt;8°</span>
                ) : (
                  <span className="text-amber-400">Hazard &gt;8°</span>
                )}
                )
              </div>
            </div>
            <div className="flex items-start gap-1.5 text-slate-300">
              <Sun className="w-3.5 h-3.5 text-[#fbbf24] shrink-0 mt-0.5" />
              <div>
                <span className="text-white font-semibold">Illumination:</span>{' '}
                {evaluation.sun.isVisible ? (
                  <span className="text-amber-300">Sunlit (+{evaluation.sun.elevationDeg.toFixed(1)}°)</span>
                ) : (
                  <span className="text-slate-400">Shadowed</span>
                )}{' '}
                • {evaluation.illuminationDutyPct}% annual duty • {evaluation.surfaceTempK} K
              </div>
            </div>
            <div className="flex items-start gap-1.5 text-slate-300">
              <Radio className="w-3.5 h-3.5 text-[#34d399] shrink-0 mt-0.5" />
              <div>
                <span className="text-white font-semibold">Comms:</span>{' '}
                {evaluation.earth.isVisible ? (
                  <span className="text-emerald-300">DTE Open (+{evaluation.earth.elevationDeg.toFixed(1)}°)</span>
                ) : (
                  <span className="text-amber-300">DTE Masked</span>
                )}{' '}
                • {evaluation.visibleRelays.length} active relay(s) in line-of-sight
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'comms' && (
          <div className="text-slate-300 space-y-1">
            <div className="text-white font-semibold flex items-center gap-1">
              <Radio className="w-3 h-3 text-[#34d399]" />
              <span>Direct-to-Earth (DTE) & Cislunar Relays</span>
            </div>
            <p>
              • DTE Status:{' '}
              {evaluation.earth.isVisible
                ? `OPEN at +${evaluation.earth.elevationDeg.toFixed(1)}° (clearing +${evaluation.earth.horizonDeg.toFixed(1)}° rim)`
                : `BLOCKED (Earth at ${evaluation.earth.elevationDeg.toFixed(1)}° vs +${evaluation.earth.horizonDeg.toFixed(1)}° mask)`}
            </p>
            <p>
              • Active Constellation:{' '}
              {evaluation.visibleRelays.length > 0
                ? evaluation.visibleRelays
                    .map(
                      (r) =>
                        `${r.satellite.name.split(' (')[0]} (+${r.elevationDeg.toFixed(0)}°, ${r.instantDataRateMbps} Mbps)`
                    )
                    .join(', ')
                : relayPasses[0]
                ? `Next AOS in ${Math.max(1, Math.round((relayPasses[0].aosTimeMs - evaluation.timestampMs) / 60000))}m (${relayPasses[0].satelliteName.split(' ')[0]})`
                : 'No active pass in next hour'}
            </p>
          </div>
        )}

        {activeCategory === 'power' && (
          <div className="text-slate-300 space-y-1">
            <div className="text-white font-semibold flex items-center gap-1">
              <Sun className="w-3 h-3 text-[#fbbf24]" />
              <span>Solar Irradiance & Thermal Environment</span>
            </div>
            <p>
              • Solar Flux: {bestFlux.toFixed(0)} W/m² (
              {evaluation.sun.isVisible
                ? `El +${evaluation.sun.elevationDeg.toFixed(1)}°`
                : 'Local Shadow'}
              ) • Temp {evaluation.surfaceTempK} K
            </p>
            <p>
              • Architecture: {isPolar ? 'Vertical 1-axis tracking mast' : 'Horizontal solar deck'} (
              {evaluation.illuminationDutyPct >= 75
                ? 'High polar ridge duty limits continuous eclipse <55h'
                : 'Requires battery reserve or RHUs for eclipse'}
              )
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
