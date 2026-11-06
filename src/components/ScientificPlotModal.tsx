import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  LineChart,
  Sliders,
  X,
  Check,
  FileCode,
  Layers,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { RoverParams, RoverTraversePlan } from '../types/lunar';
import {
  PlotConfig,
  openScientificPlotWindow,
} from '../utils/scientificPlotWindow';

function formatCleanLabel(lbl: string): string {
  if (!lbl) return '';
  return lbl.replace(/\s*\([^)]*\)/g, '').trim() || lbl;
}

interface ScientificPlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: RoverTraversePlan;
  roverParams: RoverParams;
}

export const ScientificPlotModal: React.FC<ScientificPlotModalProps> = ({
  isOpen,
  onClose,
  plan,
  roverParams,
}) => {
  if (!isOpen) return null;

  const totalDist = plan.totalDistanceKm || 1;
  const [startDistKm, setStartDistKm] = useState<number>(0);
  const [endDistKm, setEndDistKm] = useState<number>(totalDist);

  // Movable window offset state
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ startX: 0, startY: 0, origX: 0, origY: 0 });

  // Keyboard shortcut to close (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only drag from header and NOT interactive elements (buttons, inputs, etc.)
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
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setOffset({
      x: dragStartRef.current.origX + dx,
      y: dragStartRef.current.origY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handleResetPosition = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOffset({ x: 0, y: 0 });
  };

  // Selected quantities to plot
  const [selectedQuantities, setSelectedQuantities] = useState<string[]>([
    'elevation',
    'slope',
    'soc',
  ]);

  const [xAxis, setXAxis] = useState<'distance' | 'time' | 'index'>('distance');
  const [theme, setTheme] = useState<'scientific-dark' | 'publication-white'>('publication-white');
  const [showThresholds, setShowThresholds] = useState<boolean>(true);
  const [showCheckpoints, setShowCheckpoints] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [openNativeMatplotlib, setOpenNativeMatplotlib] = useState<boolean>(true);
  const [openWebWindow, setOpenWebWindow] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const toggleQty = (id: string) => {
    setSelectedQuantities((prev) =>
      prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]
    );
  };

  const handleSelectStandard = () => {
    setSelectedQuantities(['elevation', 'slope', 'soc']);
  };

  const handleSelectAll = () => {
    setSelectedQuantities(['elevation', 'slope', 'grade', 'soc', 'energy', 'speed', 'comm']);
  };

  // Count waypoints in range
  const wpsInRange = plan.waypoints.filter(
    (w) => w.cumDistanceKm >= startDistKm && w.cumDistanceKm <= endDistKm
  ).length;

  const handleGeneratePlot = async () => {
    if (selectedQuantities.length === 0) {
      alert('Please select at least one physical quantity to plot.');
      return;
    }

    const config: PlotConfig = {
      roverName: roverParams.name,
      maxInclineDeg: roverParams.maxInclineDeg,
      minReserveSocPct: roverParams.minReserveSocPct,
      startLabel: plan.start.label || 'Start [A]',
      endLabel: plan.end.label || 'Goal [B]',
      checkpoints: plan.checkpoints || [],
      xAxis,
      quantities: selectedQuantities,
      theme,
      showGrid,
      showThresholds,
      showCheckpoints,
      openNativeMatplotlib,
      openWebWindow,
      range: {
        startDistKm,
        endDistKm,
      },
    };

    setIsSubmitting(true);

    // 1. Launch Native Matplotlib Window if enabled
    if (openNativeMatplotlib) {
      try {
        const payload = {
          ...config,
          waypoints: plan.waypoints,
        };
        fetch('/api/plot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch((err) => {
          console.warn('[Matplotlib API Trigger Warning]', err);
        });
      } catch (e) {
        console.warn(e);
      }
    }

    // 2. Open Dedicated Interactive Scientific Web Window
    if (openWebWindow) {
      openScientificPlotWindow(plan, roverParams, config);
    }

    setIsSubmitting(false);
    onClose();
  };

  const handleDownloadCsv = () => {
    const headers = [
      'index',
      'cumDistanceKm',
      'elapsedHours',
      'elevationM',
      'slopeDeg',
      'gradeDeg',
      'speedKmh',
      'batterySocPct',
      'netEnergyUsedWh',
      'commLinked',
      'sunVisible',
      'lat',
      'lon',
    ];
    let csv = headers.join(',') + '\n';
    plan.waypoints.forEach((w) => {
      csv +=
        [
          w.index,
          w.cumDistanceKm.toFixed(3),
          w.elapsedHours.toFixed(2),
          Math.round(w.elevationKm * 1000),
          w.slopeDeg.toFixed(1),
          w.gradeDeg.toFixed(1),
          w.speedKmh.toFixed(2),
          w.batterySocPct.toFixed(1),
          Math.round(w.netEnergyUsedWh),
          w.commLinked ? 1 : 0,
          w.sunVisible ? 1 : 0,
          w.lat.toFixed(4),
          w.lon.toFixed(4),
        ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selene_ops_traverse_${roverParams.name.toLowerCase().replace(/\s+/g, '_')}_telemetry.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center p-3 sm:p-5 select-none">
      {/* Semi-transparent scrim that doesn't completely block background view */}
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-[1px] pointer-events-auto transition-opacity"
        onClick={onClose}
      />

      {/* Movable Floating Modal Window */}
      <div
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
        className="hud-panel relative z-10 pointer-events-auto rounded-2xl w-full max-w-2xl bg-[#080d1a]/95 backdrop-blur-md border border-sky-500/45 shadow-[0_20px_60px_rgba(0,0,0,0.85)] flex flex-col max-h-[92vh] overflow-hidden text-slate-100 touch-none"
      >
        {/* Modal Header — Draggable by pointer */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleResetPosition}
          className="flex items-center justify-between px-4 py-3 bg-[#060a14] border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
          title="Click and drag to move window • Double-click to re-center"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0284c7]/20 border border-[#38bdf8]/50 flex items-center justify-center text-[#38bdf8]">
              <LineChart className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-display font-bold uppercase tracking-wider text-white">
                  Plot Data
                </h2>
                {(offset.x !== 0 || offset.y !== 0) && (
                  <button
                    type="button"
                    onClick={handleResetPosition}
                    className="flex items-center gap-1 text-[9px] font-mono-tech text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/10 cursor-pointer"
                    title="Re-center window"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
              <p className="text-[10px] font-mono-tech text-slate-400">
                Multivariable Rover Traverse & Telemetry Analysis
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono-tech text-xs">
          {/* SECTION 1: TRAVERSE RANGE SELECTION */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#fcd34d] uppercase flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                <span>1. Analysis Distance Range</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] text-slate-300">
                {wpsInRange} of {plan.waypoints.length} waypoints selected
              </span>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setStartDistKm(0);
                  setEndDistKm(totalDist);
                }}
                className={`hud-btn px-2 py-0.8 rounded text-[10px] border cursor-pointer ${
                  startDistKm === 0 && endDistKm === totalDist
                    ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-[#7dd3fc] font-semibold'
                    : 'bg-white/[0.03] border-white/10 text-slate-400'
                }`}
              >
                Full Traverse (0 → {totalDist.toFixed(1)} km)
              </button>

              {plan.legs &&
                plan.legs.map((leg) => {
                  const startWp = plan.waypoints[leg.startWaypointIdx];
                  const endWp = plan.waypoints[leg.endWaypointIdx];
                  const lStart = startWp ? startWp.cumDistanceKm : 0;
                  const lEnd = endWp ? endWp.cumDistanceKm : totalDist;
                  const isSel = Math.abs(startDistKm - lStart) < 0.1 && Math.abs(endDistKm - lEnd) < 0.1;
                  return (
                    <button
                      key={leg.legIndex}
                      type="button"
                      onClick={() => {
                        setStartDistKm(Number(lStart.toFixed(1)));
                        setEndDistKm(Number(lEnd.toFixed(1)));
                      }}
                      className={`hud-btn px-2 py-0.8 rounded text-[10px] border cursor-pointer ${
                        isSel
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-semibold'
                          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-white'
                      }`}
                      title={`${leg.fromLabel} → ${leg.toLabel} (${leg.distanceKm} km)`}
                    >
                      Leg {leg.legIndex}: {formatCleanLabel(leg.fromLabel)} → {formatCleanLabel(leg.toLabel)} ({leg.distanceKm} km)
                    </button>
                  );
                })}
            </div>

            {/* Range Number Inputs */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Start Distance (km)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max={totalDist}
                  value={startDistKm}
                  onChange={(e) => setStartDistKm(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#38bdf8]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  End Distance (km)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max={totalDist}
                  value={endDistKm}
                  onChange={(e) => setEndDistKm(Math.min(totalDist, Math.max(startDistKm + 0.1, Number(e.target.value) || totalDist)))}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#38bdf8]"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: QUANTITIES TO PLOT */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#38bdf8] uppercase flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>2. Quantities to Plot (Subplots)</span>
              </span>
              <div className="flex gap-1.5 text-[9.5px]">
                <button
                  type="button"
                  onClick={handleSelectStandard}
                  className="text-cyan-300 hover:text-white underline cursor-pointer"
                >
                  Standard Flight
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-cyan-300 hover:text-white underline cursor-pointer"
                >
                  Select All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {[
                {
                  id: 'elevation',
                  label: 'Elevation Profile',
                  detail: 'LOLA Topographic Relief (meters/km)',
                  color: '#38bdf8',
                },
                {
                  id: 'slope',
                  label: 'Terrain Slope Hazard',
                  detail: 'Slope θ (deg) + 20° Chassis Slip Limit',
                  color: '#f59e0b',
                },
                {
                  id: 'soc',
                  label: 'Battery State of Charge',
                  detail: 'SoC (%) + 15% Flight-Rule Reserve Floor',
                  color: '#10b981',
                },
                {
                  id: 'grade',
                  label: 'Longitudinal Grade',
                  detail: 'Signed Slope Grade (±%, Climb vs Regen)',
                  color: '#a78bfa',
                },
                {
                  id: 'energy',
                  label: 'Cumulative Energy Balance',
                  detail: 'Net Wh vs Gross Traction & Solar Offset',
                  color: '#ea580c',
                },
                {
                  id: 'speed',
                  label: 'Rover Travel Speed',
                  detail: 'Cruise Speed (km/h, slope derated)',
                  color: '#06b6d4',
                },
                {
                  id: 'comm',
                  label: 'Communications & Sun LOS',
                  detail: 'DTE / Cislunar Relay Lock & Terminator Mask',
                  color: '#60a5fa',
                },
              ].map((q) => {
                const isChecked = selectedQuantities.includes(q.id);
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => toggleQty(q.id)}
                    className={`hud-btn text-left p-2 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-colors ${
                      isChecked
                        ? 'bg-white/[0.06] border-white/30 text-white'
                        : 'bg-transparent border-white/[0.07] text-slate-500 hover:border-white/15'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center shrink-0 border ${
                        isChecked
                          ? 'bg-[#0284c7] border-[#38bdf8] text-white'
                          : 'border-white/20'
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3" />}
                    </div>
                    <div>
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: q.color }}
                        />
                        <span>{q.label}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                        {q.detail}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SECTION 3: PLOT FORMATTING & DISPLAY OPTIONS */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2.5">
            <div className="text-[11px] font-semibold text-[#10b981] uppercase flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>3. Plot Formatting & Display Options</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* X-Axis */}
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Independent X-Axis
                </label>
                <select
                  value={xAxis}
                  onChange={(e) => setXAxis(e.target.value as any)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs text-white focus:outline-none"
                >
                  <option value="distance">Cumulative Distance (km)</option>
                  <option value="time">Mission Elapsed Time (Hours T+)</option>
                  <option value="index">Waypoint Index (#)</option>
                </select>
              </div>

              {/* Theme */}
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">
                  Visual Theme / Palette
                </label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as any)}
                  className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-xs text-white focus:outline-none"
                >
                  <option value="publication-white">Publication White (IEEE / Paper Print)</option>
                  <option value="scientific-dark">Scientific Dark (Console High-Contrast)</option>
                </select>
              </div>
            </div>

            {/* Checkbox Toggles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[10.5px]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showThresholds}
                  onChange={(e) => setShowThresholds(e.target.checked)}
                  className="accent-[#38bdf8]"
                />
                <span>Reference Limits (20°/15%)</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCheckpoints}
                  onChange={(e) => setShowCheckpoints(e.target.checked)}
                  className="accent-[#38bdf8]"
                />
                <span>Checkpoint Pins (CP)</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="accent-[#38bdf8]"
                />
                <span>Major & Minor Grids</span>
              </label>
            </div>
          </div>

          {/* SECTION 4: DISPLAY TARGETS */}
          <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30 space-y-2">
            <span className="text-[11px] font-semibold text-cyan-300 uppercase">
              4. Display Windows (Both Active by Default)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <label className="flex items-center gap-2 p-1.5 rounded bg-white/[0.03] border border-white/[0.08] cursor-pointer">
                <input
                  type="checkbox"
                  checked={openWebWindow}
                  onChange={(e) => setOpenWebWindow(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>
                  <strong className="text-white block">Interactive Popout Window</strong>
                  <span className="text-[9.5px] text-slate-400">
                    Browser window with hover crosshair probe & export
                  </span>
                </span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded bg-white/[0.03] border border-white/[0.08] cursor-pointer">
                <input
                  type="checkbox"
                  checked={openNativeMatplotlib}
                  onChange={(e) => setOpenNativeMatplotlib(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>
                  <strong className="text-white block">Python Matplotlib Window</strong>
                  <span className="text-[9.5px] text-slate-400">
                    TkAgg native GUI with pan, zoom & save toolbar
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[#060a14] border-t border-white/10">
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="hud-btn px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="hud-btn px-3 py-1.5 rounded-lg bg-transparent hover:bg-white/[0.06] text-slate-400 hover:text-white text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleGeneratePlot}
              className="hud-btn px-4 py-2 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white font-display font-bold text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
            >
              <LineChart className="w-4 h-4" />
              <span>Plot Data ↗</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

