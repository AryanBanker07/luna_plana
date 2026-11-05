import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Calendar, X } from 'lucide-react';
import { evaluateLandingSite } from '../engine/selenography';
import { LandingSite, ReadinessStatus, SiteEvaluation } from '../types/lunar';

interface SiteComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  primaryEval: SiteEvaluation;
  allSites: LandingSite[];
  compareSite: LandingSite;
  onChangeCompareSite: (site: LandingSite) => void;
}

const statusBadge = (status: ReadinessStatus) => {
  if (status === 'GO')
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (status === 'CAUTION')
    return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
};

export const SiteComparisonModal: React.FC<SiteComparisonModalProps> = ({
  isOpen,
  onClose,
  primaryEval,
  allSites,
  compareSite,
  onChangeCompareSite,
}) => {
  // Launch slip offset in days for Candidate B (allows comparing SAME site across launch delays or TWO different sites!)
  const [slipDays, setSlipDays] = useState<number>(0);

  const secondaryEval = useMemo(() => {
    const targetTime = primaryEval.timestampMs + slipDays * 86400 * 1000;
    return evaluateLandingSite(compareSite, targetTime, false);
  }, [compareSite, primaryEval.timestampMs, slipDays]);

  if (!isOpen) return null;

  const fluxA =
    Math.abs(primaryEval.site.lat) > 70
      ? primaryEval.solarFluxVerticalMastWm2
      : primaryEval.solarFluxHorizontalWm2;
  const fluxB =
    Math.abs(secondaryEval.site.lat) > 70
      ? secondaryEval.solarFluxVerticalMastWm2
      : secondaryEval.solarFluxHorizontalWm2;

  const rows = [
    {
      label: 'Coordinates (Lat, Lon)',
      a: `${primaryEval.site.lat.toFixed(2)}°, ${primaryEval.site.lon.toFixed(2)}°`,
      b: `${secondaryEval.site.lat.toFixed(2)}°, ${secondaryEval.site.lon.toFixed(2)}°`,
      winner: 'neutral',
    },
    {
      label: 'LOLA Topographic Elevation',
      a: `${primaryEval.elevationKm >= 0 ? '+' : ''}${primaryEval.elevationKm.toFixed(2)} km`,
      b: `${secondaryEval.elevationKm >= 0 ? '+' : ''}${secondaryEval.elevationKm.toFixed(2)} km`,
      winner:
        primaryEval.elevationKm > secondaryEval.elevationKm
          ? 'A'
          : secondaryEval.elevationKm > primaryEval.elevationKm
          ? 'B'
          : 'neutral',
    },
    {
      label: 'Touchdown Slope Hazard',
      a: `${primaryEval.slopeDeg.toFixed(1)}°`,
      b: `${secondaryEval.slopeDeg.toFixed(1)}°`,
      winner:
        primaryEval.slopeDeg < secondaryEval.slopeDeg
          ? 'A'
          : secondaryEval.slopeDeg < primaryEval.slopeDeg
          ? 'B'
          : 'neutral',
    },
    {
      label: 'Instant Solar Array Flux',
      a: `${fluxA} W/m² (${primaryEval.sun.isVisible ? `El +${primaryEval.sun.elevationDeg}°` : 'Eclipsed'})`,
      b: `${fluxB} W/m² (${secondaryEval.sun.isVisible ? `El +${secondaryEval.sun.elevationDeg}°` : 'Eclipsed'})`,
      winner: fluxA > fluxB ? 'A' : fluxB > fluxA ? 'B' : 'neutral',
    },
    {
      label: 'Annual Solar Duty Cycle',
      a: `${primaryEval.illuminationDutyPct.toFixed(1)}%`,
      b: `${secondaryEval.illuminationDutyPct.toFixed(1)}%`,
      winner:
        primaryEval.illuminationDutyPct > secondaryEval.illuminationDutyPct
          ? 'A'
          : secondaryEval.illuminationDutyPct > primaryEval.illuminationDutyPct
          ? 'B'
          : 'neutral',
    },
    {
      label: 'Direct-to-Earth (DTE) Link',
      a: primaryEval.earth.isVisible
        ? `CLEAR (+${(primaryEval.earth.elevationDeg - primaryEval.earth.horizonDeg).toFixed(1)}° margin)`
        : `BLOCKED (${primaryEval.earth.elevationDeg}°)`,
      b: secondaryEval.earth.isVisible
        ? `CLEAR (+${(secondaryEval.earth.elevationDeg - secondaryEval.earth.horizonDeg).toFixed(1)}° margin)`
        : `BLOCKED (${secondaryEval.earth.elevationDeg}°)`,
      winner:
        primaryEval.earth.isVisible && !secondaryEval.earth.isVisible
          ? 'A'
          : secondaryEval.earth.isVisible && !primaryEval.earth.isVisible
          ? 'B'
          : 'neutral',
    },
    {
      label: 'Active Cislunar Relays Overhead',
      a: `${primaryEval.visibleRelays.length} Relays (${primaryEval.visibleRelays.reduce((s, r) => s + r.instantDataRateMbps, 0).toFixed(0)} Mbps agg)`,
      b: `${secondaryEval.visibleRelays.length} Relays (${secondaryEval.visibleRelays.reduce((s, r) => s + r.instantDataRateMbps, 0).toFixed(0)} Mbps agg)`,
      winner:
        primaryEval.visibleRelays.length > secondaryEval.visibleRelays.length
          ? 'A'
          : secondaryEval.visibleRelays.length > primaryEval.visibleRelays.length
          ? 'B'
          : 'neutral',
    },
    {
      label: 'Diviner Surface Temperature',
      a: `${primaryEval.surfaceTempK} K (${Math.round(primaryEval.surfaceTempK - 273.15)}°C)`,
      b: `${secondaryEval.surfaceTempK} K (${Math.round(secondaryEval.surfaceTempK - 273.15)}°C)`,
      winner: 'neutral',
    },
    {
      label: 'ISRU Water-Ice Signature',
      a: `${primaryEval.waterIceWtPct.toFixed(2)} wt% H₂O`,
      b: `${secondaryEval.waterIceWtPct.toFixed(2)} wt% H₂O`,
      winner:
        primaryEval.waterIceWtPct > secondaryEval.waterIceWtPct
          ? 'A'
          : secondaryEval.waterIceWtPct > primaryEval.waterIceWtPct
          ? 'B'
          : 'neutral',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="hud-panel reticle-frame w-full max-w-4xl rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <ArrowLeftRight className="w-4 h-4 text-[#fbbf24]" />
            <div>
              <h2 className="font-display text-base uppercase tracking-[0.12em] text-white font-semibold">
                Mission Site & Launch-Slip Trade Study Matrix
              </h2>
              <p className="text-xs text-slate-400">
                Evaluate alternate landing sites or launch-delay date shifts side by side
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hud-btn p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Column Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-4">
          {/* Primary Site A */}
          <div className="p-3 rounded-xl bg-[#f59e0b]/[0.07] border border-[#f59e0b]/35">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono-tech uppercase tracking-wider text-[#fcd34d]">
                ◈ PRIMARY BASELINE (SITE A)
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono-tech border font-semibold ${statusBadge(
                  primaryEval.overallStatus
                )}`}
              >
                {primaryEval.overallStatus} • {primaryEval.readinessScore}/100
              </span>
            </div>
            <div className="text-sm font-semibold text-white mt-1">
              {primaryEval.site.name}
            </div>
            <div className="text-[11px] font-mono-tech text-slate-400 mt-0.5">
              Epoch: {new Date(primaryEval.timestampMs).toISOString().slice(0, 16).replace('T', ' ')} UTC
            </div>
          </div>

          {/* Alternate Site B + Launch Slip */}
          <div className="p-3 rounded-xl bg-[#38bdf8]/[0.07] border border-[#38bdf8]/35">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono-tech uppercase tracking-wider text-[#7dd3fc]">
                ◇ ALTERNATE CANDIDATE (SITE B)
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono-tech border font-semibold ${statusBadge(
                  secondaryEval.overallStatus
                )}`}
              >
                {secondaryEval.overallStatus} • {secondaryEval.readinessScore}/100
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={compareSite.id}
                onChange={(e) => {
                  const found =
                    allSites.find((s) => s.id === e.target.value) ||
                    (e.target.value === primaryEval.site.id ? primaryEval.site : null);
                  if (found) onChangeCompareSite(found);
                }}
                className="flex-1 min-w-[180px] bg-[#070b14] border border-white/15 rounded-md px-2 py-1 text-xs text-white font-medium focus:outline-none focus:border-[#38bdf8]"
              >
                {primaryEval.site.category === 'custom' && (
                  <option value={primaryEval.site.id}>
                    {primaryEval.site.name} (Same Site — Date Slip)
                  </option>
                )}
                {allSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 bg-[#070b14] border border-white/15 rounded-md px-2 py-1 text-[11px] font-mono-tech text-slate-300">
                <Calendar className="w-3 h-3 text-[#38bdf8]" />
                <span>Slip:</span>
                <select
                  value={slipDays}
                  onChange={(e) => setSlipDays(Number(e.target.value))}
                  className="bg-transparent text-[#7dd3fc] focus:outline-none"
                >
                  <option value={0} className="bg-[#0b1019]">0d (Same UTC)</option>
                  <option value={3} className="bg-[#0b1019]">+3d Delay</option>
                  <option value={7} className="bg-[#0b1019]">+7d Delay</option>
                  <option value={14} className="bg-[#0b1019]">+14d (Half Moon)</option>
                  <option value={29.5} className="bg-[#0b1019]">+29.5d (Next Lunation)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-white/[0.04] text-[10px] font-mono-tech uppercase text-slate-400 border-b border-white/10">
                <th className="py-2 px-3">Mission Parameter</th>
                <th className="py-2 px-3 text-[#fcd34d]">◈ Site A ({primaryEval.site.name.split(' ')[0]})</th>
                <th className="py-2 px-3 text-[#7dd3fc]">
                  ◇ Site B ({compareSite.name.split(' ')[0]}
                  {slipDays > 0 ? ` +${slipDays}d` : ''})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] font-mono-tech text-[11px]">
              {rows.map((r) => (
                <tr key={r.label} className="hover:bg-white/[0.02]">
                  <td className="py-2 px-3 font-sans text-slate-300">{r.label}</td>
                  <td
                    className={`py-2 px-3 ${
                      r.winner === 'A' ? 'text-emerald-300 font-semibold' : 'text-slate-200'
                    }`}
                  >
                    {r.a} {r.winner === 'A' ? '★' : ''}
                  </td>
                  <td
                    className={`py-2 px-3 ${
                      r.winner === 'B' ? 'text-emerald-300 font-semibold' : 'text-slate-200'
                    }`}
                  >
                    {r.b} {r.winner === 'B' ? '★' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Automated Trade-Study Recommendation Footer */}
        <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-slate-300 leading-relaxed">
          <span className="font-mono-tech text-[#fbbf24] uppercase mr-2">
            [Flight-Director Synthesis]
          </span>
          {primaryEval.readinessScore >= secondaryEval.readinessScore ? (
            <>
              <strong>{primaryEval.site.name}</strong> holds a{' '}
              <span className="font-mono-tech text-emerald-300">
                +{primaryEval.readinessScore - secondaryEval.readinessScore} pt
              </span>{' '}
              readiness advantage at this epoch due to{' '}
              {fluxA >= fluxB ? 'superior solar incidence' : 'safer terrain slope'} and{' '}
              {primaryEval.earth.isVisible
                ? 'unobstructed Direct-to-Earth X-band lock.'
                : `${primaryEval.visibleRelays.length} active cislunar relay links.`}
            </>
          ) : (
            <>
              Shifting to <strong>{secondaryEval.site.name}</strong>
              {slipDays > 0 ? ` (+${slipDays}d launch slip)` : ''} improves mission readiness by{' '}
              <span className="font-mono-tech text-emerald-300">
                +{secondaryEval.readinessScore - primaryEval.readinessScore} pts
              </span>{' '}
              ({secondaryEval.readinessScore}/100 vs {primaryEval.readinessScore}/100), mitigating{' '}
              {!primaryEval.sun.isVisible
                ? 'local solar horizon shadowing'
                : !primaryEval.earth.isVisible
                ? 'Direct-to-Earth terrain occultation'
                : 'slope & thermal margin constraints'}
              .
            </>
          )}
        </div>
      </div>
    </div>
  );
};

