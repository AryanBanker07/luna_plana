import React, { useState } from 'react';
import { SiteEvaluation } from '../types/lunar';

interface PolarHorizonSkyplotProps {
  evaluation: SiteEvaluation;
  selectedSatelliteId: string | null;
  onSelectSatellite: (id: string) => void;
}

export const PolarHorizonSkyplot: React.FC<PolarHorizonSkyplotProps> = ({
  evaluation,
  selectedSatelliteId,
  onSelectSatellite,
}) => {
  const [viewMode, setViewMode] = useState<'polar' | 'panorama'>('polar');

  const { horizonProfileDeg, sun, earth, activeSatellites } = evaluation;

  // Polar plot helper: center (110, 110), outer ring = -10° elevation (radius 92), 0° = radius 82, +90° zenith = radius 0
  const cx = 110;
  const cy = 110;
  const elToRadius = (elDeg: number) => {
    const clamped = Math.max(-12, Math.min(90, elDeg));
    // +90° -> 0px, 0° -> 80px, -12° -> 92px
    return ((90 - clamped) / 102) * 92;
  };

  const azElToXY = (azDeg: number, elDeg: number) => {
    const r = elToRadius(elDeg);
    const rad = ((azDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  // Build closed terrain obstruction annulus (between outer -12° ring and local horizonProfileDeg)
  const outerR = elToRadius(-12);
  const horizonPoints = horizonProfileDeg.map((hDeg, idx) =>
    azElToXY(idx * 10, Math.max(-10, hDeg))
  );

  const outerCirclePath = `M ${cx} ${cy - outerR} A ${outerR} ${outerR} 0 1 1 ${cx - 0.01} ${
    cy - outerR
  } Z`;
  const innerHorizonPath =
    horizonPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ') + ' Z';

  const sunPt = azElToXY(sun.azimuthDeg, sun.elevationDeg);
  const earthPt = azElToXY(earth.azimuthDeg, earth.elevationDeg);

  return (
    <div className="pt-2.5 border-t border-white/[0.07]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[11px] font-display uppercase tracking-[0.12em] text-slate-300 font-semibold">
            Local Horizon & LOS Skyplot
          </div>
          <div className="text-[10px] text-slate-400">
            2 m Lander Mast • LOLA Terrain Mask
          </div>
        </div>
        <div className="flex items-center bg-[#070a11] p-0.5 rounded-md border border-white/10">
          <button
            type="button"
            onClick={() => setViewMode('polar')}
            className={`hud-btn px-2 py-0.5 text-[10px] font-mono-tech rounded cursor-pointer ${
              viewMode === 'polar'
                ? 'bg-[#f59e0b]/20 text-[#fcd34d] border border-[#f59e0b]/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            DOME
          </button>
          <button
            type="button"
            onClick={() => setViewMode('panorama')}
            className={`hud-btn px-2 py-0.5 text-[10px] font-mono-tech rounded cursor-pointer ${
              viewMode === 'panorama'
                ? 'bg-[#38bdf8]/20 text-[#7dd3fc] border border-[#38bdf8]/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            360° RIM
          </button>
        </div>
      </div>

      {viewMode === 'polar' ? (
        <div className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 220 220"
            className="w-[172px] h-[172px] shrink-0 mx-auto select-none"
          >
            {/* Sky Dome Background */}
            <circle
              cx={cx}
              cy={cy}
              r={outerR}
              fill="#060911"
              stroke="rgba(226,232,240,0.12)"
              strokeWidth="1"
            />

            {/* Terrain Obstruction Mask (shaded outside innerHorizonPath) */}
            <path
              d={`${outerCirclePath} ${innerHorizonPath}`}
              fillRule="evenodd"
              fill="rgba(239, 68, 68, 0.17)"
            />
            <path
              d={innerHorizonPath}
              fill="none"
              stroke="rgba(248, 113, 113, 0.65)"
              strokeWidth="1.25"
            />

            {/* Elevation Rings: 0° ideal horizon, 30°, 60° */}
            <circle
              cx={cx}
              cy={cy}
              r={elToRadius(0)}
              fill="none"
              stroke="rgba(148,163,184,0.28)"
              strokeDasharray="2 2"
              strokeWidth="0.9"
            />
            <circle
              cx={cx}
              cy={cy}
              r={elToRadius(30)}
              fill="none"
              stroke="rgba(148,163,184,0.14)"
              strokeWidth="0.8"
            />
            <circle
              cx={cx}
              cy={cy}
              r={elToRadius(60)}
              fill="none"
              stroke="rgba(148,163,184,0.14)"
              strokeWidth="0.8"
            />

            {/* Cardinal Crosshairs */}
            <line
              x1={cx}
              y1={cy - outerR}
              x2={cx}
              y2={cy + outerR}
              stroke="rgba(148,163,184,0.12)"
              strokeWidth="0.8"
            />
            <line
              x1={cx - outerR}
              y1={cy}
              x2={cx + outerR}
              y2={cy}
              stroke="rgba(148,163,184,0.12)"
              strokeWidth="0.8"
            />

            {/* Cardinal Labels */}
            <text x={cx} y={13} textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="JetBrains Mono">
              N 0°
            </text>
            <text x={210} y={cy + 3} textAnchor="end" fill="#94a3b8" fontSize="9" fontFamily="JetBrains Mono">
              E
            </text>
            <text x={cx} y={215} textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="JetBrains Mono">
              S
            </text>
            <text x={9} y={cy + 3} textAnchor="start" fill="#94a3b8" fontSize="9" fontFamily="JetBrains Mono">
              W
            </text>

            {/* Orbiting Satellites Above -10° */}
            {activeSatellites
              .filter((s) => s.elevationDeg > -10)
              .map((s) => {
                const pt = azElToXY(s.azimuthDeg, s.elevationDeg);
                const isSel = selectedSatelliteId === s.satellite.id;
                return (
                  <g
                    key={s.satellite.id}
                    className="cursor-pointer"
                    onClick={() => onSelectSatellite(s.satellite.id)}
                  >
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isSel ? 5.2 : 3.6}
                      fill={s.isVisibleFromSite ? s.satellite.color : '#475569'}
                      stroke="#05070b"
                      strokeWidth="1.2"
                    />
                    {s.isVisibleFromSite && (
                      <text
                        x={pt.x + 6}
                        y={pt.y + 3}
                        fill={s.satellite.color}
                        fontSize="7.5"
                        fontFamily="JetBrains Mono"
                      >
                        {s.satellite.id.slice(0, 3).toUpperCase()}
                      </text>
                    )}
                  </g>
                );
              })}

            {/* Earth Marker */}
            {earth.elevationDeg > -12 && (
              <g>
                <circle
                  cx={earthPt.x}
                  cy={earthPt.y}
                  r={5.5}
                  fill={earth.isVisible ? '#38bdf8' : '#7f1d1d'}
                  stroke={earth.isVisible ? '#e0f2fe' : '#ef4444'}
                  strokeWidth="1.3"
                />
                <text
                  x={earthPt.x}
                  y={earthPt.y - 7.5}
                  textAnchor="middle"
                  fill="#7dd3fc"
                  fontSize="8"
                  fontWeight="600"
                  fontFamily="JetBrains Mono"
                >
                  ⊕
                </text>
              </g>
            )}

            {/* Sun Marker */}
            {sun.elevationDeg > -12 && (
              <g>
                <circle
                  cx={sunPt.x}
                  cy={sunPt.y}
                  r={5.8}
                  fill={sun.isVisible ? '#fbbf24' : '#78350f'}
                  stroke={sun.isVisible ? '#fef9c3' : '#f59e0b'}
                  strokeWidth="1.3"
                />
                <text
                  x={sunPt.x}
                  y={sunPt.y + 13}
                  textAnchor="middle"
                  fill="#fde68a"
                  fontSize="8"
                  fontWeight="600"
                  fontFamily="JetBrains Mono"
                >
                  ☉
                </text>
              </g>
            )}

            {/* Zenith Cross */}
            <circle cx={cx} cy={cy} r={1.8} fill="#64748b" />
          </svg>

          {/* Compact Skyplot Legend & Angles */}
          <div className="flex-1 space-y-1.5 text-[11px] font-mono-tech">
            <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center justify-between text-[#fcd34d]">
                <span>☉ SUN</span>
                <span>{sun.isVisible ? 'CLEAR' : 'MASKED'}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                El {sun.elevationDeg > 0 ? '+' : ''}
                {sun.elevationDeg}° / Rim {sun.horizonDeg}°
              </div>
              <div className="text-[10px] text-slate-500">Az {sun.azimuthDeg}°</div>
            </div>

            <div className="p-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center justify-between text-[#7dd3fc]">
                <span>⊕ EARTH</span>
                <span>{earth.isVisible ? 'DTE LOCK' : 'OCCULTED'}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                El {earth.elevationDeg > 0 ? '+' : ''}
                {earth.elevationDeg}° / Rim {earth.horizonDeg}°
              </div>
              <div className="text-[10px] text-slate-500">Az {earth.azimuthDeg}°</div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-rose-300/85 pt-0.5">
              <span className="w-2.5 h-2 rounded-xs bg-rose-500/35 border border-rose-400/70 inline-block" />
              <span>Crater Rim Mask</span>
            </div>
          </div>
        </div>
      ) : (
        /* 360° Linear Unwrapped Topographic Horizon Silhouette */
        <div className="bg-[#060911] rounded-md border border-white/10 p-2">
          <svg viewBox="0 0 360 110" className="w-full h-[118px] select-none">
            {/* Elevation grid lines: -5°, 0°, +10°, +20°, +30° */}
            {[0, 10, 20].map((el) => {
              const y = 90 - el * 2.2;
              return (
                <g key={el}>
                  <line
                    x1={0}
                    y1={y}
                    x2={360}
                    y2={y}
                    stroke={el === 0 ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.12)'}
                    strokeDasharray={el === 0 ? '3 2' : undefined}
                    strokeWidth="0.8"
                  />
                  <text x={4} y={y - 2} fill="#64748b" fontSize="8" fontFamily="JetBrains Mono">
                    {el}°
                  </text>
                </g>
              );
            })}

            {/* Terrain Horizon Polygon */}
            <path
              d={
                `M 0 110 ` +
                horizonProfileDeg
                  .map((h, i) => `L ${i * 10} ${(90 - h * 2.2).toFixed(1)}`)
                  .join(' ') +
                ` L 360 ${(90 - horizonProfileDeg[0] * 2.2).toFixed(1)} L 360 110 Z`
              }
              fill="rgba(239, 68, 68, 0.24)"
              stroke="#f87171"
              strokeWidth="1.2"
            />

            {/* Sun & Earth Azimuth/Elevation Pins */}
            {sun.elevationDeg > -8 && sun.elevationDeg < 38 && (
              <g>
                <circle
                  cx={sun.azimuthDeg}
                  cy={90 - sun.elevationDeg * 2.2}
                  r={4.8}
                  fill={sun.isVisible ? '#fbbf24' : '#78350f'}
                  stroke="#fef08a"
                  strokeWidth="1"
                />
                <text
                  x={Math.min(342, Math.max(18, sun.azimuthDeg))}
                  y={Math.max(10, 90 - sun.elevationDeg * 2.2 - 7)}
                  textAnchor="middle"
                  fill="#fde68a"
                  fontSize="8.5"
                  fontFamily="JetBrains Mono"
                >
                  ☉ {sun.elevationDeg}°
                </text>
              </g>
            )}

            {earth.elevationDeg > -8 && earth.elevationDeg < 38 && (
              <g>
                <circle
                  cx={earth.azimuthDeg}
                  cy={90 - earth.elevationDeg * 2.2}
                  r={4.8}
                  fill={earth.isVisible ? '#38bdf8' : '#7f1d1d'}
                  stroke="#bae6fd"
                  strokeWidth="1"
                />
                <text
                  x={Math.min(342, Math.max(18, earth.azimuthDeg))}
                  y={Math.max(10, 90 - earth.elevationDeg * 2.2 - 7)}
                  textAnchor="middle"
                  fill="#7dd3fc"
                  fontSize="8.5"
                  fontFamily="JetBrains Mono"
                >
                  ⊕ {earth.elevationDeg}°
                </text>
              </g>
            )}

            {/* Azimuth X-axis Ticks */}
            {[
              { az: 0, lbl: 'N' },
              { az: 90, lbl: 'E 90°' },
              { az: 180, lbl: 'S 180°' },
              { az: 270, lbl: 'W 270°' },
              { az: 355, lbl: 'N' },
            ].map((t, idx) => (
              <text
                key={idx}
                x={t.az}
                y={106}
                textAnchor={t.az === 0 ? 'start' : t.az === 355 ? 'end' : 'middle'}
                fill="#94a3b8"
                fontSize="8.5"
                fontFamily="JetBrains Mono"
              >
                {t.lbl}
              </text>
            ))}
          </svg>
          <div className="flex justify-between text-[10px] text-slate-400 font-mono-tech mt-1">
            <span>Max Rim Obstruction: +{Math.max(...horizonProfileDeg).toFixed(1)}°</span>
            <span>Min Horizon Dip: {Math.min(...horizonProfileDeg).toFixed(1)}°</span>
          </div>
        </div>
      )}
    </div>
  );
};

