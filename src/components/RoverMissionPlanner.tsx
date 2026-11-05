import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Crosshair,
  LineChart,
  ListOrdered,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  Sparkles,
  Target,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import {
  BENCHMARK_ROVER_ROUTES,
  CURATED_LANDING_SITES,
  ROVER_PRESETS,
} from '../data/lunarCatalog';
import {
  formatRelativeEpochDelta,
  formatUtcParts,
  parseUtcDateAndTime,
} from '../engine/celestialEphemeris';
import { estimateFlatRangeKm } from '../engine/roverPlanner';
import { ScientificPlotModal } from './ScientificPlotModal';
import {
  CandidateCorridorPath,
  LandingSite,
  ReadinessStatus,
  RoverCoords,
  RoverParams,
  RoverPickMode,
  RoverRangeEnvelope,
  RoverTraversePlan,
  RoverWorkflowStep,
} from '../types/lunar';

export function formatDurationHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0m';
  const totalMin = Math.round(hours * 60);
  if (totalMin < 60) return `${totalMin}m`;
  const d = Math.floor(totalMin / (24 * 60));
  const remMin = totalMin % (24 * 60);
  const h = Math.floor(remMin / 60);
  const m = remMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function statusPillClass(status: ReadinessStatus): string {
  if (status === 'GO')
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/45';
  if (status === 'CAUTION')
    return 'bg-amber-500/15 text-amber-300 border-amber-500/45';
  return 'bg-rose-500/15 text-rose-300 border-rose-500/45';
}

function formatCleanLabel(lbl: string): string {
  if (!lbl) return '';
  return lbl.replace(/\s*\([^)]*\)/g, '').trim() || lbl;
}

interface RoverControlsPanelProps {
  workflowStep: RoverWorkflowStep;
  startCoords: RoverCoords;
  endCoords: RoverCoords;
  checkpoints: RoverCoords[];
  roverParams: RoverParams;
  routingMode: 'astar' | 'direct';
  pickMode: RoverPickMode;
  rangeEnvelope: RoverRangeEnvelope | null;
  plan: RoverTraversePlan;
  animProgress: number; // 0..1
  isAnimating: boolean;
  animSpeed: number; // 1 | 2 | 4
  chaseCam: boolean;
  onSetWorkflowStep: (step: RoverWorkflowStep) => void;
  onConfirmRoverDetails: () => void;
  onConfirmStartAndZoomLocality: (coords: RoverCoords) => void;
  onAddCheckpoint: (coords: RoverCoords) => void;
  onRemoveCheckpoint: (index: number) => void;
  onReorderCheckpoints: (fromIndex: number, toIndex: number) => void;
  onClearCheckpoints: () => void;
  onSelectEndPoint: (coords: RoverCoords) => void;
  onSelectCandidatePath: (path: CandidateCorridorPath) => void;
  onStartAnimation: () => void;
  onTogglePlayAnimation: () => void;
  onReplayAnimation: () => void;
  onScrubProgress: (prog: number) => void;
  onChangeAnimSpeed: (spd: number) => void;
  onToggleChaseCam: () => void;
  onZoomLocality: () => void;
  onFocusRouteCamera: () => void;
  onSwapEndpoints: () => void;
  onChangeParams: (p: RoverParams) => void;
  onChangeRoutingMode: (m: 'astar' | 'direct') => void;
  onChangePickMode: (m: RoverPickMode) => void;
  onSelectBenchmarkRoute: (routeId: string) => void;
  missionEpochMs: number;
  simTimeMs: number;
  onChangeMissionEpoch: (epochMs: number, syncSimClock?: boolean) => void;
  onOpenEpochModal: () => void;
  curatedSites?: LandingSite[];
}

const STEP_ITEMS: { id: RoverWorkflowStep; num: string; label: string }[] = [
  { id: 'rover-setup', num: '1', label: 'Rover' },
  { id: 'select-start', num: '2', label: 'Start' },
  { id: 'checkpoints', num: '3', label: 'Waypoints' },
  { id: 'range-explore', num: '4', label: 'Range & End' },
  { id: 'route-ready', num: '5', label: 'Review' },
  { id: 'animating', num: '6', label: 'Animate' },
];

const STEP_ORDER: Record<RoverWorkflowStep, number> = {
  idle: 0,
  'rover-setup': 1,
  'select-start': 2,
  checkpoints: 3,
  'range-explore': 4,
  'route-ready': 5,
  animating: 6,
};

export const RoverControlsPanel: React.FC<RoverControlsPanelProps> = ({
  workflowStep,
  startCoords,
  endCoords,
  checkpoints,
  roverParams,
  routingMode,
  pickMode,
  rangeEnvelope,
  plan,
  animProgress,
  isAnimating,
  animSpeed,
  chaseCam,
  onSetWorkflowStep,
  onConfirmRoverDetails,
  onConfirmStartAndZoomLocality,
  onAddCheckpoint,
  onRemoveCheckpoint,
  onReorderCheckpoints,
  onClearCheckpoints,
  onSelectEndPoint,
  onSelectCandidatePath,
  onStartAnimation,
  onTogglePlayAnimation,
  onReplayAnimation,
  onScrubProgress,
  onChangeAnimSpeed,
  onToggleChaseCam,
  onZoomLocality,
  onFocusRouteCamera,
  onSwapEndpoints,
  onChangeParams,
  onChangeRoutingMode,
  onChangePickMode,
  onSelectBenchmarkRoute,
  missionEpochMs,
  simTimeMs,
  onChangeMissionEpoch,
  onOpenEpochModal,
  curatedSites = CURATED_LANDING_SITES,
}) => {
  const activeStep: RoverWorkflowStep =
    workflowStep === 'idle' ? 'rover-setup' : workflowStep;
  const activeOrder = STEP_ORDER[activeStep];

  const [epochDateDraft, setEpochDateDraft] = useState<string>(
    () => formatUtcParts(missionEpochMs).dateStr
  );
  const [epochTimeDraft, setEpochTimeDraft] = useState<string>(
    () => formatUtcParts(missionEpochMs).timeStr
  );

  React.useEffect(() => {
    const p = formatUtcParts(missionEpochMs);
    setEpochDateDraft(p.dateStr);
    setEpochTimeDraft(p.timeStr);
  }, [missionEpochMs]);

  const [manualStartLat, setManualStartLat] = useState<string>(
    startCoords.lat.toFixed(3)
  );
  const [manualStartLon, setManualStartLon] = useState<string>(
    startCoords.lon.toFixed(3)
  );
  const [manualEndLat, setManualEndLat] = useState<string>(
    endCoords.lat.toFixed(3)
  );
  const [manualEndLon, setManualEndLon] = useState<string>(
    endCoords.lon.toFixed(3)
  );
  const [manualCpLat, setManualCpLat] = useState<string>(
    (startCoords.lat + 0.08).toFixed(3)
  );
  const [manualCpLon, setManualCpLon] = useState<string>(
    (startCoords.lon + 0.08).toFixed(3)
  );
  const [manualCpLabel, setManualCpLabel] = useState<string>('');
  const [endTab, setEndTab] = useState<'sites' | 'paths' | 'custom'>('sites');

  React.useEffect(() => {
    setManualStartLat(startCoords.lat.toFixed(3));
    setManualStartLon(startCoords.lon.toFixed(3));
  }, [startCoords.lat, startCoords.lon]);

  React.useEffect(() => {
    setManualEndLat(endCoords.lat.toFixed(3));
    setManualEndLon(endCoords.lon.toFixed(3));
  }, [endCoords.lat, endCoords.lon]);

  React.useEffect(() => {
    const refPt =
      checkpoints.length > 0
        ? checkpoints[checkpoints.length - 1]
        : startCoords;
    setManualCpLat((refPt.lat + 0.06).toFixed(3));
    setManualCpLon((refPt.lon + 0.06).toFixed(3));
  }, [checkpoints.length, startCoords.lat, startCoords.lon]);

  const flatEst = estimateFlatRangeKm(roverParams);

  // Interpolated live telemetry for Step 6 animation
  const wps = plan.waypoints;
  const exactIdx =
    wps.length > 1
      ? Math.max(0, Math.min(1, animProgress)) * (wps.length - 1)
      : 0;
  const i0 = Math.floor(exactIdx);
  const i1 = Math.min(Math.max(0, wps.length - 1), i0 + 1);
  const frac = exactIdx - i0;
  const wp0 = wps[i0] || wps[0];
  const wp1 = wps[i1] || wp0;

  const liveDistKm = wp0
    ? wp0.cumDistanceKm + (wp1.cumDistanceKm - wp0.cumDistanceKm) * frac
    : 0;
  const liveHours = wp0
    ? wp0.elapsedHours + (wp1.elapsedHours - wp0.elapsedHours) * frac
    : 0;
  const liveSlope = wp0
    ? wp0.slopeDeg + (wp1.slopeDeg - wp0.slopeDeg) * frac
    : 0;
  const liveSpeed = wp0
    ? wp0.speedKmh + (wp1.speedKmh - wp0.speedKmh) * frac
    : 0;
  const liveSoc = wp0
    ? wp0.batterySocPct + (wp1.batterySocPct - wp0.batterySocPct) * frac
    : 100;
  const liveElevM = wp0
    ? (wp0.elevationKm + (wp1.elevationKm - wp0.elevationKm) * frac) * 1000
    : 0;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 tabular-nums">
      {/* GUIDED WORKFLOW STEP PROGRESS STRIP */}
      <div className="p-2 rounded-xl bg-[#060911] border border-white/12 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono-tech uppercase tracking-wider text-[#fcd34d] font-semibold">
            Rover Mission Sequence
          </span>
          <button
            type="button"
            onClick={() => {
              onChangePickMode('none');
              onSetWorkflowStep('rover-setup');
            }}
            className="hud-btn text-[10px] font-mono-tech text-slate-400 hover:text-white cursor-pointer flex items-center gap-1"
            title="Restart Rover Mission Sequence from Step 1"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>
        </div>

        <div className="grid grid-cols-6 gap-1">
          {STEP_ITEMS.map((st) => {
            const stOrder = STEP_ORDER[st.id];
            const isCurrent = activeStep === st.id;
            const isDone = stOrder < activeOrder;
            const canClick = stOrder <= Math.max(activeOrder, 4);
            return (
              <button
                key={st.id}
                type="button"
                disabled={!canClick}
                onClick={() => {
                  if (!canClick) return;
                  if (st.id === 'select-start') onChangePickMode('pick-start');
                  else if (st.id === 'checkpoints') onChangePickMode('pick-checkpoint');
                  else if (st.id === 'range-explore') onChangePickMode('pick-end');
                  else onChangePickMode('none');
                  onSetWorkflowStep(st.id);
                }}
                className={`hud-btn py-1 px-1 rounded-md border text-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isCurrent
                    ? 'bg-[#f59e0b]/25 border-[#f59e0b] text-[#fde68a] font-semibold'
                    : isDone
                    ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-300'
                    : 'bg-white/[0.02] border-white/[0.07] text-slate-500'
                }`}
              >
                <div className="text-[9px] font-mono-tech leading-none">
                  {isDone ? '✓' : st.num}
                </div>
                <div className="text-[8px] font-mono-tech truncate mt-0.5">
                  {st.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* PLANNED MISSION TIME SELECTOR (PAST / PRESENT / FUTURE UTC) */}
      <div className="p-2.5 rounded-xl bg-[#060911] border border-amber-500/30 space-y-2">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[10px] font-mono-tech uppercase text-[#fcd34d] font-semibold flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-[#f59e0b]" />
            <span>Planned Mission Time (UTC)</span>
          </span>
          <span className="px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-400/30 text-[8.5px] font-mono-tech text-[#fde68a]">
            {formatRelativeEpochDelta(missionEpochMs)}
          </span>
        </div>

        <div className="grid grid-cols-[1.35fr_1fr] gap-1.5">
          <input
            type="date"
            value={epochDateDraft}
            onChange={(e) => {
              const nextD = e.target.value;
              setEpochDateDraft(nextD);
              const parsed = parseUtcDateAndTime(nextD, epochTimeDraft);
              if (parsed !== null) onChangeMissionEpoch(parsed, true);
            }}
            className="w-full bg-white/[0.04] border border-white/15 rounded px-2 py-1 text-[11px] font-mono-tech text-white focus:outline-none focus:border-[#f59e0b]"
          />
          <input
            type="time"
            value={epochTimeDraft}
            onChange={(e) => {
              const nextT = e.target.value || '00:00';
              setEpochTimeDraft(nextT);
              const parsed = parseUtcDateAndTime(epochDateDraft, nextT);
              if (parsed !== null) onChangeMissionEpoch(parsed, true);
            }}
            className="w-full bg-white/[0.04] border border-white/15 rounded px-2 py-1 text-[11px] font-mono-tech text-white focus:outline-none focus:border-[#f59e0b]"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1 text-[9.5px] font-mono-tech">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChangeMissionEpoch(missionEpochMs - 14.765 * 86400000, true)}
              className="hud-btn px-1.5 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-slate-300 cursor-pointer"
              title="Step backward half a synodic month (−14.8d, flips lunar day/night)"
            >
              −15d
            </button>
            <button
              type="button"
              onClick={() => onChangeMissionEpoch(missionEpochMs + 14.765 * 86400000, true)}
              className="hud-btn px-1.5 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-slate-300 cursor-pointer"
              title="Step forward half a synodic month (+15d, flips lunar day/night)"
            >
              +15d
            </button>
            <button
              type="button"
              onClick={() => onChangeMissionEpoch(Date.now(), true)}
              className="hud-btn px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-300 cursor-pointer"
              title="Set planned mission time to current real-world UTC"
            >
              Now
            </button>
            {Math.abs(simTimeMs - missionEpochMs) > 60000 && (
              <button
                type="button"
                onClick={() => onChangeMissionEpoch(simTimeMs, false)}
                className="hud-btn px-1.5 py-0.5 rounded bg-sky-500/15 hover:bg-sky-500/30 border border-sky-400/35 text-sky-300 cursor-pointer"
                title="Adopt current 3D orbital clock timestamp as the rover mission start time"
              >
                Use Clock
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenEpochModal}
            className="hud-btn px-2 py-0.5 rounded bg-[#f59e0b]/20 hover:bg-[#f59e0b]/35 border border-[#f59e0b]/45 text-[#fde68a] font-semibold cursor-pointer flex items-center gap-1"
            title="Open Past / Future Year & Historic/Artemis Mission Epoch Picker"
          >
            <Clock className="w-2.5 h-2.5" />
            <span>Past/Future</span>
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* STEP 2 (WIZARD STAGE 1): SPECIFY ROVER DETAILS                        */}
      {/* ===================================================================== */}
      {activeStep === 'rover-setup' && (
        <div className="space-y-3">
          <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.09] space-y-2.5">
            <div>
              <div className="text-[10px] font-mono-tech uppercase text-[#fcd34d] font-semibold">
                Step 1 • Specify Rover Chassis & Parameters
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                Choose a reference lunar rover or dial in mass, max incline, speed, and energy budget.
              </p>
            </div>

            <select
              value={roverParams.presetId}
              onChange={(e) => {
                const found = ROVER_PRESETS.find((p) => p.id === e.target.value);
                if (found) onChangeParams({ ...found.params });
              }}
              className="w-full bg-[#060911] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]"
            >
              {ROVER_PRESETS.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0b1019]">
                  {p.name} ({p.agency})
                </option>
              ))}
            </select>

            {/* Max Incline Limit Slider */}
            <div>
              <div className="flex justify-between text-[10px] font-mono-tech text-slate-300">
                <span>Max Safe Incline Limit</span>
                <span className="text-[#fcd34d] font-semibold">
                  {roverParams.maxInclineDeg}°
                </span>
              </div>
              <input
                type="range"
                min={6}
                max={32}
                step={1}
                value={roverParams.maxInclineDeg}
                onChange={(e) =>
                  onChangeParams({
                    ...roverParams,
                    maxInclineDeg: Number(e.target.value),
                  })
                }
                className="w-full accent-[#f59e0b] cursor-pointer"
              />
            </div>

            {/* Battery Capacity Slider */}
            <div>
              <div className="flex justify-between text-[10px] font-mono-tech text-slate-300">
                <span>Battery Energy Capacity</span>
                <span className="text-emerald-300 font-semibold">
                  {roverParams.batteryCapacityWh.toLocaleString()} Wh
                </span>
              </div>
              <input
                type="range"
                min={150}
                max={90000}
                step={150}
                value={roverParams.batteryCapacityWh}
                onChange={(e) =>
                  onChangeParams({
                    ...roverParams,
                    batteryCapacityWh: Number(e.target.value),
                  })
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* 4 Engineering Inputs */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Cruise Speed (km/h)
                </label>
                <input
                  type="number"
                  step="0.2"
                  min="0.2"
                  max="18"
                  value={roverParams.cruiseSpeedKmh}
                  onChange={(e) =>
                    onChangeParams({
                      ...roverParams,
                      cruiseSpeedKmh: Math.max(0.15, Number(e.target.value) || 1),
                    })
                  }
                  className="w-full bg-[#060911] border border-white/12 rounded px-2 py-1 text-[11px] font-mono-tech text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Rover Mass (kg)
                </label>
                <input
                  type="number"
                  step="25"
                  min="15"
                  max="12000"
                  value={roverParams.massKg}
                  onChange={(e) =>
                    onChangeParams({
                      ...roverParams,
                      massKg: Math.max(10, Number(e.target.value) || 100),
                    })
                  }
                  className="w-full bg-[#060911] border border-white/12 rounded px-2 py-1 text-[11px] font-mono-tech text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Avionics Load (W)
                </label>
                <input
                  type="number"
                  step="10"
                  min="5"
                  max="4000"
                  value={roverParams.avionicsLoadW}
                  onChange={(e) =>
                    onChangeParams({
                      ...roverParams,
                      avionicsLoadW: Math.max(5, Number(e.target.value) || 50),
                    })
                  }
                  className="w-full bg-[#060911] border border-white/12 rounded px-2 py-1 text-[11px] font-mono-tech text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Solar Array Peak (W)
                </label>
                <input
                  type="number"
                  step="25"
                  min="0"
                  max="5000"
                  value={roverParams.solarPeakW}
                  onChange={(e) =>
                    onChangeParams({
                      ...roverParams,
                      solarPeakW: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full bg-[#060911] border border-white/12 rounded px-2 py-1 text-[11px] font-mono-tech text-white"
                />
              </div>
            </div>

            {/* Reserve SoC + Solar & Sub-Grid Toggles */}
            <div>
              <div className="flex justify-between text-[10px] font-mono-tech text-slate-300">
                <span>Min Flight-Rule Reserve SoC</span>
                <span className="text-[#7dd3fc]">{roverParams.minReserveSocPct}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={50}
                step={5}
                value={roverParams.minReserveSocPct}
                onChange={(e) =>
                  onChangeParams({
                    ...roverParams,
                    minReserveSocPct: Number(e.target.value),
                  })
                }
                className="w-full accent-[#38bdf8] cursor-pointer"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono-tech">
              <button
                type="button"
                onClick={() =>
                  onChangeParams({
                    ...roverParams,
                    useSolarCharging: !roverParams.useSolarCharging,
                  })
                }
                className={`hud-btn px-2 py-1 rounded border text-left flex items-center justify-between cursor-pointer ${
                  roverParams.useSolarCharging
                    ? 'bg-[#f59e0b]/15 border-[#f59e0b]/45 text-[#fde68a]'
                    : 'bg-transparent border-white/10 text-slate-500'
                }`}
              >
                <span>Solar Charge</span>
                <span>{roverParams.useSolarCharging ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onChangeParams({
                    ...roverParams,
                    includeSubGridRoughness: !roverParams.includeSubGridRoughness,
                  })
                }
                className={`hud-btn px-2 py-1 rounded border text-left flex items-center justify-between cursor-pointer ${
                  roverParams.includeSubGridRoughness
                    ? 'bg-[#38bdf8]/15 border-[#38bdf8]/45 text-[#bae6fd]'
                    : 'bg-transparent border-white/10 text-slate-500'
                }`}
              >
                <span>5m Roughness</span>
                <span>{roverParams.includeSubGridRoughness ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Live Nominal Capability Readout */}
          <div className="p-2.5 rounded-xl bg-[#060911] border border-emerald-500/30 grid grid-cols-3 gap-1.5 font-mono-tech text-[10px]">
            <div>
              <span className="text-slate-400 block">Usable Wh</span>
              <span className="text-xs font-semibold text-emerald-300">
                {flatEst.usableBatteryWh.toLocaleString()} Wh
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Net Draw</span>
              <span className="text-xs font-semibold text-[#fcd34d]">
                ~{flatEst.netPowerW} W
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Flat Radius</span>
              <span className="text-xs font-semibold text-[#7dd3fc]">
                ~{flatEst.flatRangeKm} km
              </span>
            </div>
          </div>

          {/* Primary Next Step CTA */}
          <button
            type="button"
            onClick={onConfirmRoverDetails}
            className="hud-btn w-full py-2.5 px-3 rounded-xl bg-[#f59e0b] hover:bg-[#fbbf24] text-[#05070b] font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg"
          >
            <span>Next: Specify Start Point [A]</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* Optional Quick-Load Benchmark Traverse */}
          <div className="pt-2 border-t border-white/[0.08]">
            <div className="text-[9.5px] font-mono-tech uppercase text-slate-500 mb-1">
              Or Quick-Load Complete Reference Mission
            </div>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onSelectBenchmarkRoute(e.target.value);
              }}
              className="w-full bg-[#060911] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-[#f59e0b]"
            >
              <option value="" disabled>
                Select benchmark traverse...
              </option>
              {BENCHMARK_ROVER_ROUTES.map((rt) => (
                <option key={rt.id} value={rt.id} className="bg-[#0b1019]">
                  {rt.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 3 (WIZARD STAGE 2): SPECIFY START POINT [A]                      */}
      {/* ===================================================================== */}
      {activeStep === 'select-start' && (
        <div className="space-y-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-tech uppercase text-emerald-300 font-semibold">
                Step 2 • Specify Start Point [A]
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-[#05070b] font-mono-tech font-bold text-[9px]">
                {pickMode === 'pick-start' ? '3D CLICK ACTIVE' : 'READY'}
              </span>
            </div>
            <p className="text-[11px] text-slate-200 leading-snug">
              Click anywhere directly on the <strong>3D Moon</strong>, select a landing site below, or enter coordinates. Confirming automatically zooms into the locality and computes operational range.
            </p>
            {pickMode !== 'pick-start' && (
              <button
                type="button"
                onClick={() => onChangePickMode('pick-start')}
                className="hud-btn w-full py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 text-xs font-mono-tech flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Enable 3D Moon Click for Start [A]</span>
              </button>
            )}
          </div>

          {/* Manual Coordinate Entry + Zoom Locality Trigger */}
          <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.08] space-y-2">
            <div className="text-[10px] font-mono-tech uppercase text-slate-300">
              Current / Custom Start [A] Coordinates
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Latitude (°)
                </label>
                <input
                  type="number"
                  step="0.02"
                  min="-90"
                  max="90"
                  value={manualStartLat}
                  onChange={(e) => setManualStartLat(e.target.value)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white focus:outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Longitude (°)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="-180"
                  max="180"
                  value={manualStartLon}
                  onChange={(e) => setManualStartLon(e.target.value)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const lat = Math.max(-90, Math.min(90, Number(manualStartLat) || 0));
                const lon = Math.max(-180, Math.min(180, Number(manualStartLon) || 0));
                onConfirmStartAndZoomLocality({
                  lat,
                  lon,
                  label: startCoords.label || `Start (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
                });
              }}
              className="hud-btn w-full py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#05070b] font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Zoom to Locality & Add Checkpoints</span>
            </button>
          </div>

          {/* Pre-Defined Landing Sites as Start [A] */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono-tech uppercase text-slate-400">
              Or Start From Curated Landing Site
            </div>
            <div className="space-y-1 max-h-[250px] overflow-y-auto pr-0.5">
              {curatedSites.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    onConfirmStartAndZoomLocality({
                      lat: s.lat,
                      lon: s.lon,
                      label: s.name.split(' (')[0],
                    })
                  }
                  className="hud-btn w-full text-left px-2.5 py-2 rounded-lg bg-white/[0.02] hover:bg-emerald-500/12 border border-white/[0.07] hover:border-emerald-400/50 cursor-pointer flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {s.name.split(' (')[0]}
                    </div>
                    <div className="text-[10px] font-mono-tech text-slate-400">
                      {s.missionTag} • {Math.abs(s.lat).toFixed(2)}°
                      {s.lat >= 0 ? 'N' : 'S'}, {Math.abs(s.lon).toFixed(1)}°
                      {s.lon >= 0 ? 'E' : 'W'}
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 3 (NEW WIZARD STAGE): MANUALLY SPECIFY CHECKPOINTS (VIA-POINTS)  */}
      {/* ===================================================================== */}
      {activeStep === 'checkpoints' && (
        <div className="space-y-3">
          {/* Information card */}
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-tech uppercase text-cyan-300 font-semibold flex items-center gap-1.5">
                <ListOrdered className="w-3.5 h-3.5" />
                <span>Step 3 • Intermediate Checkpoints (Via-Points)</span>
              </span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono-tech font-bold text-[9px] ${
                  pickMode === 'pick-checkpoint'
                    ? 'bg-cyan-400 text-[#05070b] animate-pulse'
                    : 'bg-white/10 text-cyan-300'
                }`}
              >
                {pickMode === 'pick-checkpoint' ? '3D CLICK ACTIVE' : 'OPTIONAL'}
              </span>
            </div>
            <p className="text-[11px] text-slate-200 leading-snug">
              Optionally place waypoints between Start [A] and Goal [B] to inspect crater rims, traverse ridgelines, or collect geological samples.
            </p>

            {/* 3D Pick button */}
            <button
              type="button"
              onClick={() =>
                onChangePickMode(
                  pickMode === 'pick-checkpoint' ? 'none' : 'pick-checkpoint'
                )
              }
              className={`hud-btn w-full py-2 rounded-lg border text-xs font-mono-tech flex items-center justify-center gap-1.5 cursor-pointer ${
                pickMode === 'pick-checkpoint'
                  ? 'bg-cyan-500/30 border-cyan-400 text-cyan-100 font-semibold shadow-md'
                  : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>
                {pickMode === 'pick-checkpoint'
                  ? `Click 3D Moon to Place CP ${checkpoints.length + 1} (Click to Stop)`
                  : `Click 3D Moon to Add Checkpoint CP ${checkpoints.length + 1}`}
              </span>
            </button>
          </div>

          {/* Manual Coordinate Form */}
          <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.08] space-y-2">
            <div className="text-[10px] font-mono-tech uppercase text-slate-300 flex items-center justify-between">
              <span>Enter Coordinates Manually</span>
              <span className="text-slate-500 text-[9px]">LOLA Surface Geodesic</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Latitude (°)
                </label>
                <input
                  type="number"
                  step="0.02"
                  min="-90"
                  max="90"
                  value={manualCpLat}
                  onChange={(e) => setManualCpLat(e.target.value)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                  Longitude (°)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="-180"
                  max="180"
                  value={manualCpLon}
                  onChange={(e) => setManualCpLon(e.target.value)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                Waypoint Label (Optional)
              </label>
              <input
                type="text"
                value={manualCpLabel}
                placeholder={`CP ${checkpoints.length + 1} - e.g. North Rim Station`}
                onChange={(e) => setManualCpLabel(e.target.value)}
                className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                const lat = Math.max(-90, Math.min(90, Number(manualCpLat) || 0));
                const lon = Math.max(-180, Math.min(180, Number(manualCpLon) || 0));
                onAddCheckpoint({
                  lat,
                  lon,
                  label:
                    manualCpLabel.trim() ||
                    `CP ${checkpoints.length + 1} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
                });
                setManualCpLabel('');
              }}
              className="hud-btn w-full py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/45 border border-cyan-400/50 text-cyan-200 text-xs font-mono-tech flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Via-Point CP {checkpoints.length + 1}</span>
            </button>
          </div>

          {/* Checkpoints List */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono-tech">
              <span className="uppercase text-slate-300">
                Planned Via-Points ({checkpoints.length})
              </span>
              {checkpoints.length > 0 && (
                <button
                  type="button"
                  onClick={onClearCheckpoints}
                  className="text-rose-400 hover:text-rose-300 text-[9.5px] cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {checkpoints.length === 0 ? (
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center text-[11px] text-slate-400 leading-relaxed">
                No checkpoints added yet. You can click on the 3D Moon above to add one, or proceed straight to choosing your final End Point [B].
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-0.5">
                {checkpoints.map((cp, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-[#060911]/90 border border-cyan-500/25 flex items-center justify-between gap-2 text-[10px] font-mono-tech"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 font-bold flex items-center justify-center text-[9px] shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate text-[11px]">
                          {cp.label || `Checkpoint ${idx + 1}`}
                        </div>
                        <div className="text-slate-400 text-[9px]">
                          {Math.abs(cp.lat).toFixed(2)}°{cp.lat >= 0 ? 'N' : 'S'},{' '}
                          {Math.abs(cp.lon).toFixed(2)}°{cp.lon >= 0 ? 'E' : 'W'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onReorderCheckpoints(idx, idx - 1)}
                        className="p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
                        title="Move Up"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === checkpoints.length - 1}
                        onClick={() => onReorderCheckpoints(idx, idx + 1)}
                        className="p-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
                        title="Move Down"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveCheckpoint(idx)}
                        className="p-1 rounded bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 cursor-pointer ml-0.5"
                        title="Delete Checkpoint"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Primary Continue CTA */}
          <div className="pt-1 space-y-1.5">
            <button
              type="button"
              onClick={() => {
                onChangePickMode('pick-end');
                onSetWorkflowStep('range-explore');
              }}
              className="hud-btn w-full py-2.5 px-3 rounded-xl bg-[#38bdf8] hover:bg-[#7dd3fc] text-[#05070b] font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg"
            >
              <span>
                {checkpoints.length > 0
                  ? 'Continue: Range & End Point [B]'
                  : 'Skip Checkpoints: Select End Point [B]'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                onChangePickMode('pick-start');
                onSetWorkflowStep('select-start');
              }}
              className="hud-btn w-full py-1.5 px-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 text-xs font-mono-tech flex items-center justify-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Start Point [A]</span>
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEPS 3.5, 4 & 5: LOCALITY ZOOM + RANGE & PATHS + SELECT END POINT    */}
      {/* ===================================================================== */}
      {activeStep === 'range-explore' && rangeEnvelope && (
        <div className="space-y-3">
          {/* Step 3.5 + Step 4 Operational Range Card */}
          <div className="p-2.5 rounded-xl bg-[#060911] border border-emerald-500/35 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono-tech uppercase text-emerald-300 font-semibold">
                  Locality & Operational Range
                </div>
                <div className="text-[11px] text-slate-300 truncate">
                  From{' '}
                  <strong className="text-white">
                    {checkpoints.length > 0
                      ? checkpoints[checkpoints.length - 1].label ||
                        `CP ${checkpoints.length} (${checkpoints[
                          checkpoints.length - 1
                        ].lat.toFixed(2)}°, ${checkpoints[
                          checkpoints.length - 1
                        ].lon.toFixed(2)}°)`
                      : startCoords.label ||
                        `${startCoords.lat.toFixed(2)}°, ${startCoords.lon.toFixed(2)}°`}
                  </strong>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onChangePickMode('pick-checkpoint');
                    onSetWorkflowStep('checkpoints');
                  }}
                  className="hud-btn px-2 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-[10px] font-mono-tech text-cyan-200 flex items-center gap-1 cursor-pointer"
                  title="Edit Traverse Checkpoints"
                >
                  <ListOrdered className="w-3 h-3" />
                  <span>CP ({checkpoints.length})</span>
                </button>
                <button
                  type="button"
                  onClick={onZoomLocality}
                  className="hud-btn px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-[10px] font-mono-tech text-[#fcd34d] flex items-center gap-1 cursor-pointer"
                  title="Re-center 3D locality zoom"
                >
                  <ZoomIn className="w-3 h-3" />
                  <span>Zoom</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 font-mono-tech text-[10px]">
              <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                <span className="text-slate-400 block">Max Radius</span>
                <span className="text-xs font-semibold text-emerald-300">
                  {rangeEnvelope.maxReachableRadiusKm} km
                </span>
              </div>
              <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                <span className="text-slate-400 block">Safe Area</span>
                <span className="text-xs font-semibold text-[#7dd3fc]">
                  {rangeEnvelope.reachableAreaKm2.toLocaleString()} km²
                </span>
              </div>
              <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                <span className="text-slate-400 block">Rough Paths</span>
                <span className="text-xs font-semibold text-[#fcd34d]">
                  {rangeEnvelope.candidatePaths.length} Corridors
                </span>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 leading-snug flex flex-wrap gap-x-3 gap-y-0.5 font-mono-tech">
              <span className="text-emerald-300">━ Energy/Sortie Perimeter</span>
              <span className="text-amber-300">━ Incline-Blocked Sector</span>
              <span className="text-[#7dd3fc]">━ Rough Possible Paths</span>
            </div>

            <div className="text-[9.5px] font-mono-tech text-slate-400 pt-1 border-t border-white/[0.06]">
              DEM Locality: {plan.demInfo.nsPostingMeters}m × {plan.demInfo.ewPostingMeters}m active (higher-res local DEM drop-in ready).
            </div>
          </div>

          {/* Step 5: Select End Point [B] */}
          <div className="p-2.5 rounded-xl bg-[#38bdf8]/[0.07] border border-[#38bdf8]/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-tech uppercase text-[#7dd3fc] font-semibold">
                Step 3 • Select End Point [B]
              </span>
              <span className="px-1.5 py-0.5 rounded bg-[#38bdf8] text-[#05070b] font-mono-tech font-bold text-[9px]">
                {pickMode === 'pick-end' ? 'CLICK 3D MOON' : 'SELECT TARGET'}
              </span>
            </div>
            <p className="text-[11px] text-slate-200 leading-snug">
              Click any point inside the <strong>3D range fan</strong>, click a corridor pill on the Moon, or choose a target below:
            </p>

            {/* Sub-Tabs: Pre-Defined / Local Sites | Computed Paths | Custom Coords */}
            <div className="grid grid-cols-3 gap-1 pt-0.5">
              {[
                { id: 'sites' as const, lbl: 'Sites & Targets' },
                { id: 'paths' as const, lbl: `Paths (${rangeEnvelope.candidatePaths.length})` },
                { id: 'custom' as const, lbl: 'Custom Lat/Lon' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setEndTab(t.id)}
                  className={`hud-btn py-1 px-1.5 rounded text-[10px] font-mono-tech border cursor-pointer ${
                    endTab === t.id
                      ? 'bg-[#38bdf8]/25 text-white border-[#38bdf8]/60 font-semibold'
                      : 'bg-[#060911]/70 text-slate-400 border-white/10 hover:text-white'
                  }`}
                >
                  {t.lbl}
                </button>
              ))}
            </div>

            {/* Tab A: Reachable Local Targets & Pre-Defined Landing Sites */}
            {endTab === 'sites' && (
              <div className="space-y-1 max-h-[215px] overflow-y-auto pr-0.5 pt-1">
                {rangeEnvelope.nearbyTargets.map((tgt) => (
                  <button
                    key={tgt.id}
                    type="button"
                    onClick={() => onSelectEndPoint(tgt.coords)}
                    className="hud-btn w-full text-left px-2 py-1.5 rounded-lg bg-[#060911]/85 hover:bg-[#38bdf8]/15 border border-white/10 hover:border-[#38bdf8]/50 cursor-pointer flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-white truncate">
                        {tgt.name}
                      </div>
                      <div className="text-[9.5px] font-mono-tech text-slate-400">
                        {tgt.tag} • {tgt.distanceKm} km away
                      </div>
                    </div>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[8.5px] font-mono-tech font-semibold border ${
                        tgt.inRange
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                      }`}
                    >
                      {tgt.inRange ? 'IN RANGE' : 'BEYOND'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Tab B: Computed Rough Possible Paths */}
            {endTab === 'paths' && (
              <div className="space-y-1 max-h-[215px] overflow-y-auto pr-0.5 pt-1">
                {rangeEnvelope.candidatePaths.map((cp) => (
                  <button
                    key={cp.id}
                    type="button"
                    onClick={() => onSelectCandidatePath(cp)}
                    className="hud-btn w-full text-left px-2 py-1.5 rounded-lg bg-[#060911]/85 hover:bg-[#38bdf8]/15 border border-white/10 hover:border-[#38bdf8]/50 cursor-pointer flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-[11px] font-semibold text-[#7dd3fc]">
                        {cp.label} (Az {cp.azimuthDeg}°)
                      </div>
                      <div className="text-[9.5px] font-mono-tech text-slate-400">
                        {formatDurationHours(cp.driveHours)} • Max {cp.maxSlopeDeg}° •{' '}
                        {cp.energyUsedWh} Wh
                      </div>
                    </div>
                    <span className="text-[10px] font-mono-tech text-emerald-300 shrink-0">
                      {cp.finalSocPct}% SoC
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Tab C: Custom Goal Coordinate Input */}
            {endTab === 'custom' && (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                      Goal Lat (°)
                    </label>
                    <input
                      type="number"
                      step="0.02"
                      min="-90"
                      max="90"
                      value={manualEndLat}
                      onChange={(e) => setManualEndLat(e.target.value)}
                      className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono-tech text-slate-400 mb-0.5">
                      Goal Lon (°)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min="-180"
                      max="180"
                      value={manualEndLon}
                      onChange={(e) => setManualEndLon(e.target.value)}
                      className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs font-mono-tech text-white"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const lat = Math.max(-90, Math.min(90, Number(manualEndLat) || 0));
                    const lon = Math.max(-180, Math.min(180, Number(manualEndLon) || 0));
                    onSelectEndPoint({
                      lat,
                      lon,
                      label: `Custom Goal (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
                    });
                  }}
                  className="hud-btn w-full py-1.5 rounded-lg bg-[#38bdf8] text-[#05070b] font-mono-tech font-bold text-xs cursor-pointer"
                >
                  Set Custom End Point [B]
                </button>
              </div>
            )}

            {/* Back button to Checkpoints */}
            <div className="pt-1 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  onChangePickMode('pick-checkpoint');
                  onSetWorkflowStep('checkpoints');
                }}
                className="hud-btn w-full py-1.5 px-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-xs font-mono-tech flex items-center justify-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Checkpoints ({checkpoints.length} via-points)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 5 RESULT (STAGE 4): FEASIBILITY REVIEW + GENERATE ANIMATION CTA  */}
      {/* ===================================================================== */}
      {activeStep === 'route-ready' && (
        <div className="space-y-3">
          {/* STEP 6 PRIMARY CTA: GENERATE ROVER NAVIGATION ANIMATION */}
          <button
            type="button"
            onClick={onStartAnimation}
            className="hud-btn w-full py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#05070b] font-display font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Generate Rover Navigation Animation</span>
          </button>

          {/* Route Endpoints Summary + Change End / Swap */}
          <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.08] space-y-2 text-[10px] font-mono-tech">
            <div className="flex items-center justify-between gap-1">
              <span className="text-emerald-300 truncate">
                A: {startCoords.label || `${startCoords.lat.toFixed(2)}°, ${startCoords.lon.toFixed(2)}°`}
              </span>
              <button
                type="button"
                onClick={onSwapEndpoints}
                className="hud-btn px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 flex items-center gap-1 cursor-pointer shrink-0"
              >
                <ArrowUpDown className="w-2.5 h-2.5 text-[#7dd3fc]" />
                <span>Swap</span>
              </button>
            </div>

            {checkpoints.length > 0 && (
              <div className="flex items-center justify-between gap-1 py-1 border-y border-white/[0.07]">
                <span className="text-cyan-300 truncate flex items-center gap-1">
                  <ListOrdered className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="truncate">
                    Via {checkpoints.length} CP: {checkpoints.map((c, i) => c.label || `CP${i + 1}`).join(' → ')}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onChangePickMode('pick-checkpoint');
                    onSetWorkflowStep('checkpoints');
                  }}
                  className="hud-btn px-1.5 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-400/35 cursor-pointer shrink-0"
                >
                  Edit CP
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-1">
              <span className="text-[#7dd3fc] truncate">
                B: {endCoords.label || `${endCoords.lat.toFixed(2)}°, ${endCoords.lon.toFixed(2)}°`}
              </span>
              <button
                type="button"
                onClick={() => {
                  onChangePickMode('pick-end');
                  onSetWorkflowStep('range-explore');
                }}
                className="hud-btn px-1.5 py-0.5 rounded bg-[#38bdf8]/15 hover:bg-[#38bdf8]/25 text-[#7dd3fc] border border-[#38bdf8]/35 cursor-pointer shrink-0"
              >
                Change [B]
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 pt-1">
              <button
                type="button"
                onClick={() => onChangeRoutingMode('astar')}
                className={`hud-btn py-1 px-1.5 rounded border cursor-pointer ${
                  routingMode === 'astar'
                    ? 'bg-[#f59e0b]/20 text-[#fcd34d] border-[#f59e0b]/50 font-semibold'
                    : 'text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                A* Optimal
              </button>
              <button
                type="button"
                onClick={() => onChangeRoutingMode('direct')}
                className={`hud-btn py-1 px-1.5 rounded border cursor-pointer ${
                  routingMode === 'direct'
                    ? 'bg-[#38bdf8]/20 text-[#7dd3fc] border-[#38bdf8]/50 font-semibold'
                    : 'text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                Direct Line
              </button>
              <button
                type="button"
                onClick={onFocusRouteCamera}
                className="hud-btn py-1 px-1.5 rounded border border-white/15 bg-white/[0.04] hover:bg-white/[0.1] text-slate-200 cursor-pointer"
              >
                Frame 3D
              </button>
            </div>
          </div>

          {/* Multi-Leg Traverse Breakdown when checkpoints exist */}
          {plan.legs && plan.legs.length > 0 && (
            <div className="p-2.5 rounded-xl bg-[#060911] border border-cyan-500/35 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono-tech">
                <span className="font-semibold text-cyan-300 uppercase flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Traverse Legs ({plan.legs.length} Legs via {checkpoints.length} CP)</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onChangePickMode('pick-checkpoint');
                    onSetWorkflowStep('checkpoints');
                  }}
                  className="text-cyan-300 hover:text-white text-[9.5px] underline cursor-pointer"
                >
                  Edit CP
                </button>
              </div>

              <div className="space-y-1.5">
                {plan.legs.map((leg) => (
                  <div
                    key={leg.legIndex}
                    className="p-2 rounded-lg bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.07] text-[10px] font-mono-tech transition-colors space-y-1"
                  >
                    {/* Row 1: Leg Badge + Clean Route + Distance */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 font-bold text-[9px] shrink-0 whitespace-nowrap">
                          LEG {leg.legIndex}
                        </span>
                        <span
                          className="text-white font-semibold truncate text-[10px]"
                          title={`${leg.fromLabel} → ${leg.toLabel}`}
                        >
                          {formatCleanLabel(leg.fromLabel)} → {formatCleanLabel(leg.toLabel)}
                        </span>
                      </div>
                      <div className="text-right shrink-0 whitespace-nowrap">
                        <span className="text-emerald-300 font-bold text-[10.5px] tabular-nums">
                          {leg.distanceKm} km
                        </span>
                      </div>
                    </div>

                    {/* Row 2: Subordinate Coordinate Details & Telemetry Chips */}
                    <div className="flex items-center justify-between gap-1.5 text-[9px] text-slate-400 pt-1 border-t border-white/[0.04]">
                      <span
                        className="text-slate-400 text-[8.5px] truncate max-w-[125px]"
                        title={`${leg.fromLabel} → ${leg.toLabel}`}
                      >
                        {leg.fromLabel} → {leg.toLabel}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                        <span className="text-slate-300">
                          {formatDurationHours(leg.driveHours)}
                        </span>
                        <span className="text-slate-600">•</span>
                        <span
                          className={
                            leg.maxSlopeDeg > roverParams.maxInclineDeg
                              ? 'text-rose-400 font-bold'
                              : 'text-[#fcd34d]'
                          }
                        >
                          {leg.maxSlopeDeg}° max
                        </span>
                        {leg.energyWh > 0 && (
                          <>
                            <span className="text-slate-600">•</span>
                            <span className="text-orange-300/80">
                              {Math.round(leg.energyWh)} Wh
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Traverse Feasibility Verdict Card */}
          <div className="p-2.5 rounded-xl bg-[#060911] border border-white/12 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono-tech uppercase tracking-wider text-slate-400">
                  Traverse Feasibility Review
                </div>
                <div className="text-xs font-semibold text-white mt-0.5">
                  {plan.totalDistanceKm} km • {formatDurationHours(plan.totalDriveHours)} Drive
                </div>
              </div>
              <div
                className={`px-2.5 py-1 rounded-lg border font-mono-tech text-right ${statusPillClass(
                  plan.feasibilityStatus
                )}`}
              >
                <div className="text-xs font-bold">{plan.feasibilityStatus}</div>
                <div className="text-[10px]">{plan.feasibilityScore}/100</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 font-mono-tech text-[10px]">
              <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                <span className="text-slate-400 block">Peak / Limit Incline</span>
                <span
                  className={`text-xs font-semibold ${
                    plan.maxSlopeEncounteredDeg > roverParams.maxInclineDeg
                      ? 'text-rose-400'
                      : plan.maxSlopeEncounteredDeg > roverParams.maxInclineDeg * 0.8
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }`}
                >
                  {plan.maxSlopeEncounteredDeg}° / {roverParams.maxInclineDeg}°
                </span>
              </div>
              <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                <span className="text-slate-400 block">Min / Final Battery</span>
                <span
                  className={`text-xs font-semibold ${
                    plan.minBatterySocPct <= 2
                      ? 'text-rose-400'
                      : plan.minBatterySocPct < roverParams.minReserveSocPct
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }`}
                >
                  {plan.minBatterySocPct}% / {plan.finalBatterySocPct}%
                </span>
              </div>
              <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                <span className="text-slate-400 block">Gross / Solar Wh</span>
                <span className="text-xs font-semibold text-[#fcd34d]">
                  {plan.grossEnergyUsedWh.toLocaleString()} / +
                  {plan.solarEnergyHarvestedWh.toLocaleString()} Wh
                </span>
              </div>
              <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                <span className="text-slate-400 block">Climb / Comm Lock</span>
                <span className="text-xs font-semibold text-[#7dd3fc]">
                  +{plan.elevationGainMeters}m • {plan.commCoveragePct}%
                </span>
              </div>
            </div>

            {/* Crater Characterization & Hazard Avoidance Audit */}
            {plan.craterStats && plan.craterStats.detected > 0 && (
              <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-rose-300 uppercase flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400" />
                    Crater Characterization & Avoidance
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    ⚡ {plan.craterStats.computeMs}ms solve
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-slate-400 block text-[9px]">Bowls Mapped</span>
                    <span className="text-xs font-semibold text-white">
                      {plan.craterStats.detected}
                    </span>
                  </div>
                  <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-slate-400 block text-[9px]">No-Go Steep</span>
                    <span className="text-xs font-semibold text-rose-300">
                      {plan.craterStats.noGo} avoided
                    </span>
                  </div>
                  <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-slate-400 block text-[9px]">Interiors Crossed</span>
                    <span
                      className={`text-xs font-semibold ${
                        plan.craterStats.interiorCrossings === 0
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                      }`}
                    >
                      {plan.craterStats.interiorCrossings}{' '}
                      <span className="text-[9px] text-slate-400 font-normal">
                        (dir: {plan.craterStats.directInteriorCrossings ?? 0})
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1 pt-1 border-t border-white/[0.06]">
              {plan.reasons.map((r, idx) => (
                <div
                  key={idx}
                  className="text-[10px] text-slate-300 leading-snug flex gap-1.5"
                >
                  <span className="text-[#fbbf24] shrink-0">•</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>

          {/* DEM Resolution Audit Box */}
          <div className="p-2.5 rounded-xl bg-[#060911] border border-[#38bdf8]/25 space-y-1 text-[10px]">
            <div className="flex items-center justify-between font-mono-tech text-[#7dd3fc]">
              <span className="font-semibold">DEM RESOLUTION AUDIT</span>
              <span>
                {plan.demInfo.nsPostingMeters}m × {plan.demInfo.ewPostingMeters}m
              </span>
            </div>
            <div className="font-mono-tech text-[9px] text-slate-400">
              {plan.demInfo.tierName}
            </div>
            <p className="text-slate-300 leading-relaxed pt-0.5">{plan.demInfo.note}</p>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 6 (STAGE 5): ACTIVE 3D ROVER NAVIGATION ANIMATION                */}
      {/* ===================================================================== */}
      {activeStep === 'animating' && (
        <div className="space-y-3">
          {/* Playback Transport & Camera Controller */}
          <div className="p-3 rounded-xl bg-[#060911] border border-[#f59e0b]/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-tech uppercase text-[#fcd34d] font-semibold flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5" />
                <span>3D Rover Navigation Playback</span>
              </span>
              <span className="text-[10px] font-mono-tech text-emerald-300 font-semibold">
                {Math.round(animProgress * 100)}%
              </span>
            </div>

            {/* Smooth Progress Slider */}
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(animProgress * 1000)}
              onChange={(e) => onScrubProgress(Number(e.target.value) / 1000)}
              className="w-full accent-[#fbbf24] cursor-pointer"
            />

            {/* Play / Pause + Replay + Speed Multipliers */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onTogglePlayAnimation}
                  className="hud-btn px-3 py-1.5 rounded-lg bg-[#f59e0b] hover:bg-[#fbbf24] text-[#05070b] font-mono-tech font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {isAnimating ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{animProgress >= 0.995 ? 'Replay' : 'Drive'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onReplayAnimation}
                  className="hud-btn p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-slate-200 cursor-pointer"
                  title="Restart rover from Start [A]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1 font-mono-tech text-[10px]">
                {[1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => onChangeAnimSpeed(spd)}
                    className={`hud-btn px-2 py-1 rounded border cursor-pointer ${
                      animSpeed === spd
                        ? 'bg-[#38bdf8]/25 text-[#7dd3fc] border-[#38bdf8]/60 font-semibold'
                        : 'bg-white/[0.03] text-slate-400 border-white/10 hover:text-white'
                    }`}
                  >
                    {spd}×
                  </button>
                ))}
              </div>
            </div>

            {/* Camera Mode Toggle: Chase Cam vs Route Overview */}
            <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-[10px] font-mono-tech">
              <button
                type="button"
                onClick={onToggleChaseCam}
                className={`hud-btn py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 cursor-pointer ${
                  chaseCam
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-semibold'
                    : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                <Camera className="w-3 h-3" />
                <span>Chase Cam {chaseCam ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={onFocusRouteCamera}
                className="hud-btn py-1.5 px-2 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.1] text-slate-200 cursor-pointer"
              >
                Route Overview
              </button>
            </div>
          </div>

          {/* Live 60-FPS Rover Telemetry Dashboard */}
          <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.09] space-y-2.5 font-mono-tech">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400 uppercase">Live Rover Telemetry</span>
              <span className="text-[#fcd34d]">{roverParams.name}</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              <div className="p-2 rounded-lg bg-[#060911] border border-white/[0.07]">
                <span className="text-slate-400 block">Distance Driven</span>
                <span className="text-xs font-semibold text-white">
                  {liveDistKm.toFixed(2)} / {plan.totalDistanceKm} km
                </span>
              </div>
              <div className="p-2 rounded-lg bg-[#060911] border border-white/[0.07]">
                <span className="text-slate-400 block">Mission Elapsed</span>
                <span className="text-xs font-semibold text-[#7dd3fc]">
                  T+{formatDurationHours(liveHours)}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-[#060911] border border-white/[0.07]">
                <span className="text-slate-400 block">Terrain Slope</span>
                <span
                  className={`text-xs font-semibold ${
                    liveSlope > roverParams.maxInclineDeg
                      ? 'text-rose-400'
                      : liveSlope > roverParams.maxInclineDeg * 0.8
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }`}
                >
                  {liveSlope.toFixed(1)}° ({liveSpeed.toFixed(2)} km/h)
                </span>
              </div>
              <div className="p-2 rounded-lg bg-[#060911] border border-white/[0.07]">
                <span className="text-slate-400 block">LOLA Elevation</span>
                <span className="text-xs font-semibold text-slate-200">
                  {liveElevM >= 0 ? '+' : ''}
                  {liveElevM.toFixed(0)} m
                </span>
              </div>
            </div>

            {/* Live Battery SoC Gauge */}
            <div className="p-2 rounded-lg bg-[#060911] border border-white/[0.07] space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-400">Battery State of Charge</span>
                <span className="text-emerald-300 font-semibold">
                  {liveSoc.toFixed(1)}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/[0.07] overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    liveSoc <= roverParams.minReserveSocPct
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.max(2, Math.min(100, liveSoc))}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-slate-400 pt-0.5">
                <span>
                  {wp0?.sunVisible ? '☉ Sunlit Array Charging' : '◐ Topographic Shadow'}
                </span>
                <span>
                  {wp0?.commLinked ? '📡 Relay/DTE Locked' : '⚠ Comm Occulted'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSetWorkflowStep('route-ready')}
            className="hud-btn w-full py-1.5 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/15 text-xs font-mono-tech text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Feasibility Review / Change Target</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface RoverElevationDrawerProps {
  plan: RoverTraversePlan;
  roverParams: RoverParams;
  animProgress: number; // 0..1 continuous
  isAnimating?: boolean;
  onTogglePlay?: () => void;
  onScrubProgress: (prog: number) => void;
  onSwitchToSynodic: () => void;
}

export const RoverElevationDrawer: React.FC<RoverElevationDrawerProps> = ({
  plan,
  roverParams,
  animProgress,
  isAnimating = false,
  onTogglePlay,
  onScrubProgress,
  onSwitchToSynodic,
}) => {
  const [isPlotModalOpen, setIsPlotModalOpen] = useState<boolean>(false);
  const wps = plan.waypoints;
  if (wps.length < 2) return null;

  const clampedProg = Math.max(0, Math.min(1, animProgress));
  const exactIdx = clampedProg * (wps.length - 1);
  const activeIdx = Math.min(wps.length - 1, Math.max(0, Math.round(exactIdx)));
  const activeWp = wps[activeIdx] || wps[0];

  const W = 720;
  const H = 86;

  const elevsM = wps.map((w) => w.elevationKm * 1000);
  const minE = Math.min(...elevsM);
  const maxE = Math.max(...elevsM);
  const eSpan = Math.max(20, maxE - minE);

  const maxSlopeScale = Math.max(
    roverParams.maxInclineDeg * 1.35,
    plan.maxSlopeEncounteredDeg + 3,
    22
  );

  const xOf = (i: number) => (i / (wps.length - 1)) * W;
  const yElev = (eM: number) => H - 14 - ((eM - minE) / eSpan) * (H - 24);
  const ySoc = (soc: number) => H - 14 - (soc / 100) * (H - 24);
  const ySlope = (s: number) => H - 14 - Math.min(1, s / maxSlopeScale) * (H - 24);

  const elevAreaPath =
    `M 0 ${H - 14} ` +
    wps
      .map(
        (w, i) => `L ${xOf(i).toFixed(1)} ${yElev(w.elevationKm * 1000).toFixed(1)}`
      )
      .join(' ') +
    ` L ${W} ${H - 14} Z`;

  const elevLinePts = wps
    .map((w, i) => `${xOf(i).toFixed(1)},${yElev(w.elevationKm * 1000).toFixed(1)}`)
    .join(' ');

  const socLinePts = wps
    .map((w, i) => `${xOf(i).toFixed(1)},${ySoc(w.batterySocPct).toFixed(1)}`)
    .join(' ');

  const slopeLinePts = wps
    .map((w, i) => `${xOf(i).toFixed(1)},${ySlope(w.slopeDeg).toFixed(1)}`)
    .join(' ');

  const limitY = ySlope(roverParams.maxInclineDeg);
  const cursorX = clampedProg * W;

  const handlePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onScrubProgress(frac);
  };

  return (
    <div className="hud-panel rounded-xl px-3.5 py-2.5 pointer-events-auto tabular-nums">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5">
          {onTogglePlay && (
            <button
              type="button"
              onClick={onTogglePlay}
              className="hud-btn w-6 h-6 rounded-md bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-500/50 flex items-center justify-center text-emerald-300 cursor-pointer"
              title={isAnimating ? 'Pause Rover Traverse' : 'Animate Rover Traverse'}
            >
              {isAnimating ? (
                <Pause className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
            </button>
          )}
          <span className="text-xs font-display uppercase tracking-[0.12em] text-[#fcd34d] font-semibold flex items-center gap-1.5">
            <Route className="w-3.5 h-3.5" />
            <span>Rover Traverse Elevation, Incline & Battery Telemetry</span>
          </span>
          <span className="hidden md:inline text-[11px] font-mono-tech text-slate-400">
            [{roverParams.name} • {plan.specificEnergyWhPerKm} Wh/km gross]
          </span>
        </div>

        {/* Live Scrubbed Waypoint Readout + Toggle to 30d Timeline */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tech">
          {/* Scientific Matplotlib Plot Button directly to the left of Dist */}
          <button
            type="button"
            onClick={() => setIsPlotModalOpen(true)}
            className="hud-btn px-2.5 py-0.5 rounded bg-[#38bdf8]/15 hover:bg-[#38bdf8]/30 text-[#7dd3fc] hover:text-white border border-[#38bdf8]/45 flex items-center gap-1.5 cursor-pointer font-semibold shadow-sm transition-colors"
            title="Configure and generate scientific matplotlib telemetry plots"
          >
            <LineChart className="w-3.5 h-3.5 text-[#38bdf8]" />
            <span>Plot Data</span>
          </button>

          <span className="px-2 py-0.5 rounded bg-white/[0.05] border border-white/10 text-slate-200">
            Dist: <strong>{activeWp.cumDistanceKm.toFixed(2)}</strong>/
            {plan.totalDistanceKm} km
          </span>
          <span className="px-2 py-0.5 rounded bg-white/[0.05] border border-white/10 text-[#7dd3fc]">
            Elev: <strong>{(activeWp.elevationKm * 1000).toFixed(0)} m</strong>
          </span>
          <span
            className={`px-2 py-0.5 rounded border ${
              activeWp.slopeDeg > roverParams.maxInclineDeg
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                : 'bg-white/[0.05] border-white/10 text-[#fcd34d]'
            }`}
          >
            Slope: <strong>{activeWp.slopeDeg}°</strong> ({activeWp.speedKmh} km/h)
          </span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/12 border border-emerald-500/30 text-emerald-300">
            SoC: <strong>{activeWp.batterySocPct}%</strong> (T+
            {formatDurationHours(activeWp.elapsedHours)})
          </span>

          <button
            type="button"
            onClick={onSwitchToSynodic}
            className="hud-btn px-2 py-0.5 rounded bg-white/[0.07] hover:bg-white/[0.14] border border-white/15 text-slate-300 cursor-pointer"
          >
            30d Orbit Strip
          </button>
        </div>
      </div>

      {/* Interactive Multi-Curve SVG Chart */}
      <div className="bg-[#060911] rounded-lg border border-white/10 p-1.5 select-none">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-[84px] block cursor-ew-resize"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            handlePointer(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) handlePointer(e);
          }}
        >
          <defs>
            <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Max Incline Flight-Rule Threshold Dashed Line */}
          <line
            x1={0}
            y1={limitY}
            x2={W}
            y2={limitY}
            stroke="#ef4444"
            strokeOpacity="0.55"
            strokeDasharray="4 3"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          {/* Terrain Elevation Filled Profile */}
          <path d={elevAreaPath} fill="url(#elevFill)" />
          <polyline
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
            points={elevLinePts}
          />

          {/* Local Slope (°) Curve */}
          <polyline
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
            points={slopeLinePts}
          />

          {/* Battery State-of-Charge (%) Curve */}
          <polyline
            fill="none"
            stroke="#10b981"
            strokeWidth="1.7"
            vectorEffect="non-scaling-stroke"
            points={socLinePts}
          />

          {/* Bottom Strip: Sunlit + Comm Status Bars per Waypoint */}
          {wps.map((w, idx) => {
            const bw = W / wps.length + 0.5;
            return (
              <g key={idx}>
                <rect
                  x={xOf(idx)}
                  y={H - 10}
                  width={bw}
                  height={4}
                  fill={
                    w.slopeStatus === 'NO-GO'
                      ? '#ef4444'
                      : w.sunVisible
                      ? '#fbbf24'
                      : '#1e293b'
                  }
                />
                <rect
                  x={xOf(idx)}
                  y={H - 4.5}
                  width={bw}
                  height={3.5}
                  fill={w.commLinked ? '#22d3ee' : '#331824'}
                />
              </g>
            );
          })}

          {/* Scrub / Animation Cursor Line */}
          <line
            x1={cursorX}
            y1={0}
            x2={cursorX}
            y2={H}
            stroke="#fde047"
            strokeWidth="2.0"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Legend Footer */}
        <div className="flex flex-wrap items-center justify-between text-[10px] font-mono-tech text-slate-400 mt-1 px-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[#7dd3fc]">
              ━ Elevation ({Math.round(minE)}m..{Math.round(maxE)}m)
            </span>
            <span className="text-[#fcd34d]">━ Slope (°)</span>
            <span className="text-rose-400">
              ┄ Max Incline ({roverParams.maxInclineDeg}°)
            </span>
            <span className="text-emerald-300">━ Battery SoC (%)</span>
          </div>
          <span>
            Direct Line: {plan.directComparison.distanceKm} km (Max{' '}
            {plan.directComparison.maxSlopeDeg}°, {plan.directComparison.status})
          </span>
        </div>
      </div>

      {/* Scientific Telemetry Plotter Modal (Matplotlib Engine) */}
      <ScientificPlotModal
        isOpen={isPlotModalOpen}
        onClose={() => setIsPlotModalOpen(false)}
        plan={plan}
        roverParams={roverParams}
      />
    </div>
  );
};
