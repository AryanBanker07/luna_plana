import React, { useState } from 'react';
import { Bot, KeyRound, Send, Sparkles } from 'lucide-react';
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

interface ChatItem {
  role: 'user' | 'assistant';
  text: string;
}

const QUICK_PROMPTS = [
  'Full Go/No-Go Risk Brief',
  'Comm Blackout & Relay Plan',
  'Power & Night Survival',
  'Best Touchdown Epoch',
];

function buildDeterministicBrief(
  prompt: string,
  ev: SiteEvaluation,
  passes: SatellitePassWindow[],
  optimalWindows: OptimalWindowRecommendation[]
): string {
  const q = prompt.toLowerCase();
  const isPolar = Math.abs(ev.site.lat) > 75;
  const bestFlux = isPolar ? ev.solarFluxVerticalMastWm2 : ev.solarFluxHorizontalWm2;
  const relayPasses = passes.filter((p) => p.isRelay);

  if (q.includes('comm') || q.includes('relay') || q.includes('blackout') || q.includes('dte')) {
    const dteText = ev.earth.isVisible
      ? `Direct-to-Earth (DTE) is OPEN at +${ev.earth.elevationDeg}° elevation (clearing the ${ev.earth.horizonDeg}° local crater rim by +${(ev.earth.elevationDeg - ev.earth.horizonDeg).toFixed(1)}°).`
      : `Direct-to-Earth (DTE) is BLOCKED (Earth at ${ev.earth.elevationDeg}° vs +${ev.earth.horizonDeg}° terrain mask).`;

    const activeRelayList =
      ev.visibleRelays.length > 0
        ? `Currently ${ev.visibleRelays.length} relay orbiter(s) are overhead: ${ev.visibleRelays
            .map(
              (r) =>
                `${r.satellite.name.split(' (')[0]} (+${r.elevationDeg}°, ${r.instantDataRateMbps} Mbps)`
            )
            .join('; ')}.`
        : `Zero relays currently above horizon mask; next relay AOS in ${
            relayPasses[0]
              ? `${Math.max(1, Math.round((relayPasses[0].aosTimeMs - ev.timestampMs) / 60000))} min (${relayPasses[0].satelliteName.split(' ')[0]})`
              : '<60 min'
          }.`;

    return `COMM ARCHITECTURE BRIEF [${ev.site.name}]:\n• ${dteText}\n• ${activeRelayList}\n• Recommendation: Configure S/X-band HGA for primary DTE when Earth latitude libration > +1.5°, with autonomous UHF/S-band failover to Queqiao-2 (16,941 km apolune dwell) and CAPSTONE/Gateway NRHO.`;
  }

  if (q.includes('power') || q.includes('night') || q.includes('solar') || q.includes('thermal')) {
    const arrayType = isPolar
      ? '2 m deployable vertical 1-axis tracking solar mast (captures grazing ~1–6° polar sunlight)'
      : 'horizontal body-mounted / gull-wing solar deck';
    return `POWER & THERMAL SURVIVAL [${ev.site.name}]:\n• Instantaneous Irradiance: ${bestFlux} W/m² (${
      ev.sun.isVisible ? `Sun El +${ev.sun.elevationDeg}°` : 'LOCAL ECLIPSE'
    }), Surface Temp ${ev.surfaceTempK} K.\n• Annual Illumination Duty: ${ev.illuminationDutyPct}%.\n• Hardware Guidance: Deploy ${arrayType}. ${
      ev.illuminationDutyPct >= 75
        ? 'High polar ridge duty limits max continuous shadow <55 hours — survivable on Li-ion secondary batteries (1.8 kWh/100W load) without RTGs.'
        : 'Long eclipse durations require Radioisotope Heater Units (RHUs) or solid-oxide regenerative fuel cells.'
    }`;
  }

  if (q.includes('touchdown') || q.includes('epoch') || q.includes('best') || q.includes('window')) {
    if (optimalWindows.length === 0) {
      return `WINDOW SCAN [${ev.site.name}]: Deeply shadowed site (${ev.illuminationDutyPct}% annual sun). Recommend RTG/nuclear rover traverse from an adjacent sunlit rim rather than solar touchdown.`;
    }
    const top = optimalWindows[0];
    const startStr = new Date(top.startMs).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
    return `OPTIMAL TOUCHDOWN EPOCH [${ev.site.name}]:\n• #1 Window Opens: ${startStr} (${top.durationHours} hrs continuous sunlight, Score ${top.score}/100).\n• Comm Lock: ${top.dteCoveragePct}% Direct-to-Earth + ${top.relayCoveragePct}% Cislunar Relay backup.\n• Click "Jump to #1 Window" above to synchronize the 3D globe and orbital ephemeris.`;
  }

  // Default comprehensive Go/No-Go synthesis
  return `FLIGHT READINESS BRIEF — ${ev.site.name} [${ev.overallStatus} • ${ev.readinessScore}/100]:\n• Topography: Elev ${
    ev.elevationKm >= 0 ? '+' : ''
  }${ev.elevationKm} km, Slope ${ev.slopeDeg}° (${
    ev.slopeDeg <= 8 ? 'SAFE <8° ellipse' : 'HDA LIDAR REQUIRED'
  }).\n• Power & Thermal: ${
    ev.sun.isVisible ? `${bestFlux} W/m² sunlit` : 'Shadowed'
  } | ${ev.surfaceTempK} K | ${ev.illuminationDutyPct}% annual sun.\n• Comms & ISRU: ${
    ev.earth.isVisible ? `DTE Open (+${ev.earth.elevationDeg}°)` : `Relay-dependent (${ev.visibleRelays.length} active)`
  } | ${ev.waterIceWtPct} wt% H₂O-eq volatile potential.`;
}

export const AiMissionAdvisor: React.FC<AiMissionAdvisorProps> = ({
  evaluation,
  passes,
  optimalWindows,
  onJumpToTime,
}) => {
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKeyBox, setShowKeyBox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([]);

  const askAdvisor = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    setMessages((prev) => [...prev.slice(-4), { role: 'user', text: trimmed }]);
    setInput('');

    // If user supplied a live Gemini API key, synthesize with Gemini 2.5 Flash using live telemetry context!
    if (apiKey.trim().length > 20) {
      setLoading(true);
      try {
        const telemetryContext = JSON.stringify({
          site: evaluation.site.name,
          lat: evaluation.site.lat,
          lon: evaluation.site.lon,
          elevKm: evaluation.elevationKm,
          slopeDeg: evaluation.slopeDeg,
          tempK: evaluation.surfaceTempK,
          sun: evaluation.sun,
          earth: evaluation.earth,
          illuminationDutyPct: evaluation.illuminationDutyPct,
          waterIceWtPct: evaluation.waterIceWtPct,
          visibleRelays: evaluation.visibleRelays.map((r) => ({
            name: r.satellite.name,
            el: r.elevationDeg,
            mbps: r.instantDataRateMbps,
          })),
          overallStatus: evaluation.overallStatus,
          readinessScore: evaluation.readinessScore,
        });

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
            apiKey.trim()
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `You are SELENE-AI, a concise NASA CLPS & Artemis Lunar Mission Flight Director. Given this live selenographic telemetry JSON: ${telemetryContext}\n\nAnswer the planner's request in <= 95 words with crisp bullet points and concrete numbers: ${trimmed}`,
                    },
                  ],
                },
              ],
            }),
          }
        );
        const data = await res.json();
        const reply =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          buildDeterministicBrief(trimmed, evaluation, passes, optimalWindows);
        setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
      } catch {
        const fallback = buildDeterministicBrief(
          trimmed,
          evaluation,
          passes,
          optimalWindows
        );
        setMessages((prev) => [...prev, { role: 'assistant', text: fallback }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Instant zero-latency onboard physics & flight-rule synthesis
    const reply = buildDeterministicBrief(trimmed, evaluation, passes, optimalWindows);
    setMessages((prev) => [...prev.slice(-5), { role: 'assistant', text: reply }]);
  };

  return (
    <div className="pt-2.5 border-t border-white/[0.07] space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-[#fbbf24]" />
          <span className="text-[11px] font-display uppercase tracking-[0.12em] text-slate-200 font-semibold">
            SELENE-AI Flight Co-Pilot
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowKeyBox((v) => !v)}
          className="hud-btn flex items-center gap-1 text-[10px] font-mono-tech text-slate-400 hover:text-[#7dd3fc] cursor-pointer"
          title="Optional: Connect Gemini API key for open-ended LLM queries (Onboard Physics AI active by default)"
        >
          <KeyRound className="w-3 h-3" />
          <span>{apiKey ? 'Gemini Live' : 'Onboard AI'}</span>
        </button>
      </div>

      {showKeyBox && (
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Optional Gemini API Key (blank = Onboard Physics Engine)"
          className="w-full bg-[#060911] border border-white/15 rounded px-2 py-1 text-[11px] font-mono-tech text-slate-200 focus:outline-none focus:border-[#38bdf8]"
        />
      )}

      {/* Top Optimal Touchdown Window Pill */}
      {optimalWindows.length > 0 && (
        <div className="p-2 rounded-lg bg-[#f59e0b]/[0.08] border border-[#f59e0b]/30 flex items-center justify-between gap-2">
          <div className="text-[10px] leading-tight">
            <div className="font-mono-tech text-[#fcd34d] font-semibold">
              ★ #1 Optimal Window: {optimalWindows[0].durationHours}h Sunlit
            </div>
            <div className="text-slate-400 mt-0.5">
              {new Date(optimalWindows[0].startMs).toISOString().slice(0, 13).replace('T', ' ')}Z •{' '}
              DTE {optimalWindows[0].dteCoveragePct}% / Relay {optimalWindows[0].relayCoveragePct}%
            </div>
          </div>
          <button
            type="button"
            onClick={() => onJumpToTime(optimalWindows[0].startMs + 6 * 3600 * 1000)}
            className="hud-btn shrink-0 px-2 py-1 rounded bg-[#f59e0b] text-[#05070b] font-mono-tech font-semibold text-[10px] hover:bg-[#fbbf24] cursor-pointer flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>Jump</span>
          </button>
        </div>
      )}

      {/* Quick Tactical Prompts */}
      <div className="flex flex-wrap gap-1">
        {QUICK_PROMPTS.map((qp) => (
          <button
            key={qp}
            type="button"
            onClick={() => askAdvisor(qp)}
            className="hud-btn px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-[10px] text-slate-300 cursor-pointer"
          >
            {qp}
          </button>
        ))}
      </div>

      {/* Latest Briefing Output */}
      {messages.length > 0 ? (
        <div className="max-h-[155px] overflow-y-auto space-y-1.5 bg-[#060911] rounded-lg border border-white/10 p-2 text-[11px]">
          {messages.slice(-2).map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'text-[10px] font-mono-tech text-[#7dd3fc]'
                  : 'text-slate-200 whitespace-pre-line leading-relaxed'
              }
            >
              {m.role === 'user' ? `> ${m.text}` : m.text}
            </div>
          ))}
          {loading && (
            <div className="text-[10px] font-mono-tech text-[#fcd34d] animate-pulse">
              Synthesizing telemetry...
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[#060911] rounded-lg border border-white/10 p-2 text-[11px] text-slate-300 whitespace-pre-line leading-relaxed">
          {buildDeterministicBrief('Full Go/No-Go Risk Brief', evaluation, passes, optimalWindows)}
        </div>
      )}

      {/* Custom Question Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          askAdvisor(input);
        }}
        className="flex items-center gap-1.5"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask SELENE-AI (e.g., 'relay gaps', 'solar mast')..."
          className="flex-1 bg-[#060911] border border-white/15 rounded-md px-2.5 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-[#f59e0b]"
        />
        <button
          type="submit"
          className="hud-btn p-1.5 rounded-md bg-[#f59e0b]/20 hover:bg-[#f59e0b]/35 border border-[#f59e0b]/40 text-[#fcd34d] cursor-pointer"
          aria-label="Send query"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};

