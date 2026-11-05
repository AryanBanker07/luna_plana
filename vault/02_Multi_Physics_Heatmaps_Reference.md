# Multi-Physics Global Heatmaps Reference

Related: [[00_SELENE_OPS_Challenge_Overview]] | [[01_Selenographic_Physics_and_Ephemeris]]

All 7 selenographic heatmaps execute at 60 FPS inside the custom WebGL GLSL shader (`src/components/LunarGlobe3D.tsx`) backed by local NASA SVS CGI Moon Kit LROC & LOLA rasters (`public/textures/lroc_color.jpg`, `public/textures/lola_dem.jpg`).

| Mode ID | Layer Name | Primary Instrument | Physical Range | Mission Planner Significance |
| :--- | :--- | :--- | :--- | :--- |
| `albedo` | **LROC True Albedo & Terminator** | LRO Wide Angle Camera (WAC) | $0.04 - 0.28$ reflectance | Contrasts smooth Ti-basalt maria against rugged anorthositic highlands + live day/night terminator & Earthshine. |
| `elevation` | **Topographic Elevation (LOLA DEM)** | LRO LOLA $1064\text{ nm}$ Altimeter | $-9.12\text{ km}$ to $+10.76\text{ km}$ | Identifies high-prominence polar peaks (Malapert, Leibnitz Beta) that clear surrounding horizon masks. |
| `temperature` | **Surface Bolometric Temperature** | LRO Diviner Radiometer (DLRE) | $25\text{ K}$ to $395\text{ K}$ | Flags cryogenic PSR cold traps ($<45\text{ K}$), night survival zones ($<95\text{ K}$), and hot subsolar noon ($395\text{ K}$). |
| `slope` | **Terrain Slope & Landing Hazard** | LOLA Multi-Beam Gradient | $0^\circ$ to $35^\circ+$ | Enforces $<8^\circ$ nominal touchdown Flight Rule and flags $>12^\circ$ crater-wall tip-over scarps. |
| `illumination` | **Solar Illumination Duty Cycle** | LOLA Horizon Ray Climatology | $0\%$ to $89\%$ | Maps "Peaks of Eternal Light" ($>80\%$ solar duty on $2\text{ m}$ vertical tracking masts) vs $0\%$ PSRs. |
| `ice` | **Water-Ice Equivalent ($\text{H}_2\text{O}$)** | LP Neutron & LRO LEND | $0.0$ to $5.5\text{ wt\%}$ | Pinpoints polar hydrogen/water-ice volatile cold traps ($T_{\max} < 110\text{ K}$) for ISRU prospecting. |
| `dte` | **Direct-to-Earth (DTE) Visibility** | JPL Libration + Terrain Mask | $-20^\circ$ to $+90^\circ$ El | Highlights the Near Side clear zone, Far Side permanent occultation, and the $\pm 6.7^\circ$ polar libration fringe. |

