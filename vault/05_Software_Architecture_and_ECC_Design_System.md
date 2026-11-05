# Software Architecture & ECC Design System

Related: [[00_SELENE_OPS_Challenge_Overview]]

---

## 1. Tech Stack & ECC Standards

Built utilizing **EVERYTHING CLAUDE CODE (ECC)** engineering patterns (`frontend-design-direction`, `make-interfaces-feel-better`, `design-system`, `dashboard-builder`, `frontend-patterns`, `vite-patterns`):
- **Framework:** React 18 + TypeScript 5.6 + Vite 6 + Tailwind CSS v4
- **3D Engine:** Three.js (`r170`) + `@react-three/fiber` + `@react-three/drei` + Custom GLSL Vertex/Fragment Multi-Physics Shaders
- **Design Direction:** *Apollo Titanium × Cryogenic Obsidian* (`Chakra Petch` display headers, `Instrument Sans` body, `JetBrains Mono` with `tabular-nums` telemetry readouts; concentric bezel radii; explicit CSS transitions).

---

## 2. Module Breakdown

```
Lunar landing navigator/
├── DESIGN.md                              # ECC Design System & Colorbar Specification
├── public/textures/
│   ├── lroc_color.jpg                     # NASA GSFC SVS 4720 LROC WAC Mosaic
│   └── lola_dem.jpg                       # NASA GSFC SVS 4720 LOLA Laser Altimeter DEM
├── src/
│   ├── types/lunar.ts                     # Domain interfaces (Sites, Satellites, Flight Rules)
│   ├── data/lunarCatalog.ts               # 7 Heatmaps, 10 Sites, 5 Cislunar Orbiters
│   ├── engine/selenography.ts             # Ephemeris, Libration, LOLA Ray-Marching, Kepler Solver
│   ├── components/
│   │   ├── LunarGlobe3D.tsx               # 3D Displaced Moon, GLSL Heatmaps, Orbits & LOS Vectors
│   │   ├── PolarHorizonSkyplot.tsx        # 360° Polar Skyplot & Linear Crater-Rim Panorama
│   │   ├── SynodicTimelineDrawer.tsx      # 30-Day Synodic Sun/DTE/Relay/Temp Interactive Scrubber
│   │   ├── SiteComparisonModal.tsx        # Side-by-Side Site & Launch-Slip Trade Study Matrix
│   │   └── AiMissionAdvisor.tsx           # SELENE-AI Co-Pilot (Onboard Physics + Optional Gemini API)
│   └── App.tsx                            # Full-Viewport Mission Operations HUD Shell
└── vault/                                 # Obsidian Documentation Vault
```

---

## 3. Running Locally

```powershell
cd "c:\Users\banke\OneDrive\Desktop\nasa_spaceapps\Lunar landing navigator"
npm install
npm run dev
# Production Type-Checked Bundle:
npm run build
```

