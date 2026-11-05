# SELENE OPS — Design System & Direction (`DESIGN.md`)

**Project:** Lunar Landing Site Navigator (NASA Space Apps Challenge 2026)  
**Design Direction:** *Flight-Deck Precision ("Apollo Titanium × Cryogenic Obsidian")*  
**Reference Discipline:** ECC `frontend-design-direction`, `design-system`, `make-interfaces-feel-better`, `dashboard-builder`

---

## 1. Aesthetic Point-of-View
- **Purpose:** Operational selenographic mission-planning workstation for CLPS payload directors, Artemis landing site analysts, and educators.
- **First Viewport Rule:** Zero marketing fluff. The first viewport opens directly into the live 3D WebGL lunar globe framed by mission-control telemetry HUD docks, real-time ephemeris scrubbers, and flight-rule readiness indicators.
- **Memorable Detail:** An interactive 3D multi-physics Moon with live GPU shader heatmaps, 3D orbital ribbons with ground-track access cones, laser line-of-sight vectors (Sun / Earth / Relay Satellites), and a live 360° Polar Horizon Skyplot showing whether local crater rims block solar arrays or Direct-to-Earth (DTE) dishes.

---

## 2. Typography Hierarchy
- **Display & Instrument Headers:** `'Chakra Petch', sans-serif` — angular aerospace geometry, crisp uppercase tracking (`0.08em–0.14em`).
- **Body & Analytical Prose:** `'Instrument Sans', sans-serif` — high x-height, clean legibility at `12px–14px` dense console scales (`text-wrap: pretty`).
- **Telemetry, Coordinates & Ephemeris:** `'JetBrains Mono', monospace` with mandatory `font-variant-numeric: tabular-nums` so ticking clocks, orbital elevations, and coordinate scrubbers never cause horizontal layout jitter.

---

## 3. Color System & Scientific Colormaps
### Core Surface & Accent Tokens
- `--bg-void`: `#05070B` (Deep cislunar vacuum)
- `--bg-bezel`: `rgba(10, 14, 22, 0.86)` (Translucent anodized instrument housing)
- `--bg-elevated`: `#111826` (Interactive control surface)
- `--border-hairline`: `rgba(226, 232, 240, 0.09)`
- `--border-active`: `rgba(245, 158, 11, 0.55)`
- `--accent-amber`: `#F59E0B` (Kapton MLI Gold / Solar Illumination / Active Selection)
- `--accent-cyan`: `#38BDF8` (Cislunar Telemetry / DTE Earth Vector / Relay Crosslink)
- `--status-go`: `#10B981` (Flight-Rule GO)
- `--status-caution`: `#F59E0B` (Flight-Rule Marginal / Relay Required)
- `--status-nogo`: `#EF4444` (Flight-Rule Violation / Eclipse or Horizon Blackout)

### Scientific Perceptual Colormaps (GPU Shader & Legend Matched)
1. **LROC True Albedo:** Calibrated LROC WAC regolith reflectance + real-time solar terminator + subtle Earthshine (`0.035` ambient on Earth-facing hemisphere).
2. **LOLA Topographic Elevation (`-9.1 km` to `+10.8 km`):** Hypsometric scientific ramp (Deep Abyssal Indigo → Teal → Emerald Mare → Ochre Highlands → Bone White Peaks).
3. **Diviner Bolometric Temperature (`25 K` to `395 K`):** Cryogenic-to-Thermal Inferno ramp (Cryo Violet/Blue `<100 K` PSR cold traps → Deep Crimson `200 K` → Molten Amber `320 K` → Incandescent Ivory `395 K`).
4. **Terrain Slope Hazard (`0°` to `35°+`):** Landing Safety ramp (Emerald `<5°` safe ellipse → Chartreuse `10°` → Amber `15°` caution → Crimson `>20°` scarp hazard).
5. **Solar Illumination Duty Cycle (`0%` to `100%`):** Obsidian PSR (`0%`) → Deep Cobalt (`25%`) → Warm Gold (`65%`) → Brilliant Solar White (`>85%` Peaks of Eternal Light).
6. **Water-Ice Equivalent (`0.0` to `5.5 wt% H₂O`):** Regolith Charcoal → Glacial Slate → Cyan-Ice → Crystalline Arctic White in polar cold traps (`<110 K`).
7. **Direct-to-Earth (DTE) Comm Visibility (`-20°` to `+90°` elevation):** Blocked Far-Side Charcoal → Libration Fringe Amber (`-2°` to `+5°`) → Clear Link Cyan/Emerald (`>10°`).

---

## 4. Micro-Interaction & Polish Standards (`make-interfaces-feel-better`)
- **Concentric Radii:** Outer dock panels `border-radius: 14px` with `8px` padding contain inner controls at `border-radius: 6px`.
- **Explicit Transitions:** Never `transition: all`; scope transitions explicitly to `background-color, border-color, color, opacity, transform` (`150ms cubic-bezier(0.16, 1, 0.3, 1)`).
- **No Nested Card Slop:** Use clean hairline dividers (`border-t border-white/[0.07]`) inside docked instrument panels rather than cards-inside-cards.

