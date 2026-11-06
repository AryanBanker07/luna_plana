import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Clock,
  Check,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import {
  MISSION_EPOCH_PRESETS,
  SYNODIC_MONTH_DAYS,
  computeCelestialSystemState,
  formatRelativeEpochDelta,
  formatUtcParts,
  parseUtcDateAndTime,
} from '../engine/celestialEphemeris';

interface MissionEpochModalProps {
  isOpen: boolean;
  onClose: () => void;
  simTimeMs: number;
  roverMissionEpochMs: number;
  onApplyTime: (newTimeMs: number, syncRoverEpoch: boolean, pauseClock: boolean) => void;
}

const MONTH_NAMES = [
  '01 • Jan',
  '02 • Feb',
  '03 • Mar',
  '04 • Apr',
  '05 • May',
  '06 • Jun',
  '07 • Jul',
  '08 • Aug',
  '09 • Sep',
  '10 • Oct',
  '11 • Nov',
  '12 • Dec',
];

export const MissionEpochModal: React.FC<MissionEpochModalProps> = ({
  isOpen,
  onClose,
  simTimeMs,
  roverMissionEpochMs,
  onApplyTime,
}) => {
  const [draftDate, setDraftDate] = useState<string>('2026-11-04');
  const [draftTime, setDraftTime] = useState<string>('12:00');
  const [yearNum, setYearNum] = useState<string>('2026');
  const [monthNum, setMonthNum] = useState<number>(11);
  const [dayNum, setDayNum] = useState<string>('4');
  const [syncRover, setSyncRover] = useState<boolean>(true);
  const [livePreviewApply, setLivePreviewApply] = useState<boolean>(true);

  // Movable window state
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });

  // Sync draft fields when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const parts = formatUtcParts(simTimeMs);
    setDraftDate(parts.dateStr);
    setDraftTime(parts.timeStr);
    const d = new Date(simTimeMs);
    setYearNum(String(d.getUTCFullYear()));
    setMonthNum(d.getUTCMonth() + 1);
    setDayNum(String(d.getUTCDate()));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const parsedDraftMs = useMemo(
    () => parseUtcDateAndTime(draftDate, draftTime) ?? simTimeMs,
    [draftDate, draftTime, simTimeMs]
  );

  const previewCelestial = useMemo(
    () => computeCelestialSystemState(parsedDraftMs),
    [parsedDraftMs]
  );

  if (!isOpen) return null;

  const syncAllFieldsFromMs = (ms: number, triggerApply: boolean) => {
    const parts = formatUtcParts(ms);
    const d = new Date(ms);
    setDraftDate(parts.dateStr);
    setDraftTime(parts.timeStr);
    setYearNum(String(d.getUTCFullYear()));
    setMonthNum(d.getUTCMonth() + 1);
    setDayNum(String(d.getUTCDate()));
    if (triggerApply) {
      onApplyTime(ms, syncRover, true);
    }
  };

  const handleYmdFieldChange = (newY: string, newM: number, newD: string) => {
    setYearNum(newY);
    setMonthNum(newM);
    setDayNum(newD);
    const y = Number(newY);
    const d = Number(newD);
    if (Number.isInteger(y) && y >= 1800 && y <= 2300 && Number.isInteger(d) && d >= 1 && d <= 31) {
      // Clamp day to days in month
      const maxDay = new Date(Date.UTC(y, newM, 0)).getUTCDate();
      const clampedDay = Math.min(d, maxDay);
      const nextDateStr = `${String(y).padStart(4, '0')}-${String(newM).padStart(2, '0')}-${String(
        clampedDay
      ).padStart(2, '0')}`;
      setDraftDate(nextDateStr);
      const ms = parseUtcDateAndTime(nextDateStr, draftTime);
      if (ms !== null && livePreviewApply) {
        onApplyTime(ms, syncRover, true);
      }
    }
  };

  const handleStepMs = (deltaMs: number) => {
    const baseMs = parsedDraftMs;
    syncAllFieldsFromMs(baseMs + deltaMs, true);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, a')) return;
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setOffset({
      x: dragStartRef.current.origX + (e.clientX - dragStartRef.current.startX),
      y: dragStartRef.current.origY + (e.clientY - dragStartRef.current.startY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const roverParts = formatUtcParts(roverMissionEpochMs);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center p-3 sm:p-5 select-none">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px] pointer-events-auto"
        onClick={onClose}
      />

      <div
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="hud-panel relative z-10 pointer-events-auto rounded-2xl w-full max-w-2xl bg-[#080d1a]/96 backdrop-blur-md border border-amber-500/45 shadow-[0_20px_60px_rgba(0,0,0,0.85)] flex flex-col max-h-[92vh] overflow-hidden text-slate-100 touch-none tabular-nums"
      >
        {/* Draggable Header */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={() => setOffset({ x: 0, y: 0 })}
          className="flex items-center justify-between px-4 py-3 bg-[#060a14] border-b border-white/10 cursor-grab active:cursor-grabbing"
          title="Drag header to move window around the 3D orbital views"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#f59e0b]/20 border border-[#f59e0b]/50 flex items-center justify-center text-[#fbbf24]">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-display font-bold uppercase tracking-wider text-white">
                  Mission Time & Orbital Epoch Selector
                </h2>
                {(offset.x !== 0 || offset.y !== 0) && (
                  <button
                    type="button"
                    onClick={() => setOffset({ x: 0, y: 0 })}
                    className="flex items-center gap-1 text-[9px] font-mono-tech text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/10 cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
              <p className="text-[10px] font-mono-tech text-slate-400">
                Plan missions at any Past, Present, or Future UTC date • Updates Sun, Earth, Moon & Rover physics
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="hud-btn p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 font-mono-tech text-xs">
          {/* SECTION 1: MANUAL EXACT UTC DATE & TIME ENTRY (PAST OR FUTURE) */}
          <div className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.09] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#fcd34d] uppercase flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>1. Manual Mission Date & Time (UTC)</span>
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/35 text-[10px] text-[#fde68a] font-semibold">
                {formatRelativeEpochDelta(parsedDraftMs)}
              </span>
            </div>

            {/* Fast Direct Year / Month / Day / HH:MM Inputs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[9.5px] text-slate-400 mb-1">
                  Year (Past/Future)
                </label>
                <input
                  type="number"
                  min={1900}
                  max={2200}
                  step={1}
                  value={yearNum}
                  onChange={(e) => handleYmdFieldChange(e.target.value, monthNum, dayNum)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="block text-[9.5px] text-slate-400 mb-1">Month (UTC)</label>
                <select
                  value={monthNum}
                  onChange={(e) => handleYmdFieldChange(yearNum, Number(e.target.value), dayNum)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]"
                >
                  {MONTH_NAMES.map((lbl, idx) => (
                    <option key={lbl} value={idx + 1} className="bg-[#0b1019]">
                      {lbl}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9.5px] text-slate-400 mb-1">Day of Month</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  step={1}
                  value={dayNum}
                  onChange={(e) => handleYmdFieldChange(yearNum, monthNum, e.target.value)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <div>
                <label className="block text-[9.5px] text-slate-400 mb-1">Time (HH:MM UTC)</label>
                <input
                  type="time"
                  value={draftTime}
                  onChange={(e) => {
                    const nextT = e.target.value || '00:00';
                    setDraftTime(nextT);
                    const ms = parseUtcDateAndTime(draftDate, nextT);
                    if (ms !== null && livePreviewApply) {
                      onApplyTime(ms, syncRover, true);
                    }
                  }}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#f59e0b]"
                />
              </div>
            </div>

            {/* Calendar Date Picker + Real-Time "Now" Button */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">Calendar Picker:</span>
                <input
                  type="date"
                  value={draftDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraftDate(val);
                    const ms = parseUtcDateAndTime(val, draftTime);
                    if (ms !== null) {
                      const d = new Date(ms);
                      setYearNum(String(d.getUTCFullYear()));
                      setMonthNum(d.getUTCMonth() + 1);
                      setDayNum(String(d.getUTCDate()));
                      if (livePreviewApply) onApplyTime(ms, syncRover, true);
                    }
                  }}
                  className="bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#f59e0b]"
                />
              </div>

              <button
                type="button"
                onClick={() => syncAllFieldsFromMs(Date.now(), true)}
                className="hud-btn px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/50 text-emerald-200 text-[11px] font-semibold cursor-pointer"
              >
                ⊕ Jump to Live Real-Time UTC (Now)
              </button>
            </div>

            {/* Quick Relative Time Stepper (Past <-> Future) */}
            <div className="pt-1.5 border-t border-white/[0.06] space-y-1">
              <div className="text-[9.5px] text-slate-400">
                Step Backward (Past) or Forward (Future):
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  { lbl: '−10 Yr', ms: -10 * 365.25 * 86400000 },
                  { lbl: '−1 Yr', ms: -365.25 * 86400000 },
                  { lbl: '−1 Lunation', ms: -SYNODIC_MONTH_DAYS * 86400000 },
                  { lbl: '−7d', ms: -7 * 86400000 },
                  { lbl: '−1d', ms: -86400000 },
                  { lbl: '−6h', ms: -6 * 3600000 },
                  { lbl: '+6h', ms: 6 * 3600000 },
                  { lbl: '+1d', ms: 86400000 },
                  { lbl: '+7d', ms: 7 * 86400000 },
                  { lbl: '+1 Lunation', ms: SYNODIC_MONTH_DAYS * 86400000 },
                  { lbl: '+1 Yr', ms: 365.25 * 86400000 },
                  { lbl: '+10 Yr', ms: 10 * 365.25 * 86400000 },
                ].map((step) => (
                  <button
                    key={step.lbl}
                    type="button"
                    onClick={() => handleStepMs(step.ms)}
                    className={`hud-btn px-2 py-0.8 rounded text-[10px] border cursor-pointer ${
                      step.ms < 0
                        ? 'bg-sky-500/10 hover:bg-sky-500/25 border-sky-400/30 text-sky-200'
                        : 'bg-amber-500/10 hover:bg-amber-500/25 border-amber-400/30 text-amber-200'
                    }`}
                  >
                    {step.lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SECTION 2: LIVE EPHEMERIS PREVIEW AT SELECTED EPOCH */}
          <div className="p-2.5 rounded-xl bg-[#060911] border border-sky-500/30 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.05]">
              <div className="text-[9px] text-slate-400">Lunar Phase</div>
              <div className="text-white font-semibold truncate">
                {previewCelestial.phaseName} ({previewCelestial.illuminatedFractionPct}%)
              </div>
            </div>
            <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.05]">
              <div className="text-[9px] text-slate-400">Earth–Moon Dist</div>
              <div className="text-cyan-300 font-semibold">
                {previewCelestial.earthMoonDistanceKm.toLocaleString()} km
              </div>
            </div>
            <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.05]">
              <div className="text-[9px] text-slate-400">Sun–Earth Dist</div>
              <div className="text-[#fcd34d] font-semibold">
                {previewCelestial.earthSunDistanceAu} AU ({previewCelestial.earthOrbitalSpeedKms} km/s)
              </div>
            </div>
            <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.05]">
              <div className="text-[9px] text-slate-400">Ecliptic Lat β</div>
              <div className="text-purple-300 font-semibold">
                {previewCelestial.moonGeoLatDeg > 0 ? '+' : ''}
                {previewCelestial.moonGeoLatDeg}° (Age {previewCelestial.lunarAgeDays}d)
              </div>
            </div>
          </div>

          {/* SECTION 3: HISTORIC PAST & PLANNED FUTURE MISSION BENCHMARKS */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
            <div className="text-[11px] font-semibold text-[#38bdf8] uppercase flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>2. Benchmark Past & Future Mission Epochs</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              {MISSION_EPOCH_PRESETS.map((preset) => {
                const pMs = Date.parse(preset.utcIso);
                const isSelected = Math.abs(parsedDraftMs - pMs) < 60000;
                const badgeColor =
                  preset.era === 'past'
                    ? 'bg-sky-500/15 text-sky-300 border-sky-400/35'
                    : preset.era === 'future'
                    ? 'bg-purple-500/15 text-purple-300 border-purple-400/35'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35';

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => syncAllFieldsFromMs(pMs, true)}
                    title={preset.description}
                    className={`hud-btn text-left p-2 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-400/65 text-white'
                        : 'bg-white/[0.02] border-white/[0.07] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`px-1.5 py-0.2 rounded border text-[8.5px] font-bold ${badgeColor}`}>
                        {preset.tag}
                      </span>
                      <span className="text-[9px] text-slate-400">
                        {preset.utcIso.slice(0, 10)}
                      </span>
                    </div>
                    <div className="text-[10.5px] font-semibold text-white mt-1 truncate">
                      {preset.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SECTION 4: SYNCHRONIZATION OPTIONS */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[11px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={syncRover}
                onChange={(e) => setSyncRover(e.target.checked)}
                className="accent-[#f59e0b]"
              />
              <span>
                Update Rover Planned Mission Time (currently{' '}
                <strong className="text-emerald-300">{roverParts.fullUtcLabel}</strong>)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={livePreviewApply}
                onChange={(e) => setLivePreviewApply(e.target.checked)}
                className="accent-[#38bdf8]"
              />
              <span>Live-update 3D Orbits while editing</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#060a14] border-t border-white/10 font-mono-tech">
          <div className="text-[11px] text-slate-300">
            Selected: <strong className="text-[#fde68a]">{formatUtcParts(parsedDraftMs).fullUtcLabel}</strong>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="hud-btn px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                onApplyTime(parsedDraftMs, syncRover, true);
                onClose();
              }}
              className="hud-btn px-4 py-1.5 rounded-xl bg-[#f59e0b] hover:bg-[#fbbf24] text-[#05070b] font-display font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-lg"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Mission Time</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

