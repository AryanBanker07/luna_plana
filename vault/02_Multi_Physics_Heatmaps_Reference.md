# Multi-Physics Global Heatmaps Reference

Related: [[00_SELENE_OPS_Challenge_Overview]] | [[01_Selenographic_Physics_and_Ephemeris]] | [[06_Rover_Traverse_Planning_and_DEM_Resolution]]

All 7 selenographic heatmaps execute at 60 FPS inside the custom WebGL GLSL shader (`src/components/LunarGlobe3D.tsx`) backed by global NASA SVS CGI Moon Kit rasters (`lroc_color.jpg`, `lola_dem.jpg`) seamlessly fused with **3-Tier Official NASA LROC (WAC + NAC Controlled) & 16-Bit LOLA South Polar Stereographic Clipmaps** (`IAU2000:30162`, $0^\circ$ Prime Meridian Up, zero polar pinching across $90^\circ\text{S}$).

| Mode ID | Layer Name | Primary Instrument | Physical Range | Mission Planner Significance |
| :--- | :--- | :--- | :---: | :--- |
| `albedo` | **LROC True Albedo & Terminator** | LRO WAC + NAC South Polar Mosaics | $0.04 - 0.28$ reflectance | Contrasts smooth Ti-basalt maria against rugged highlands + multi-orbit South Pole NAC/WAC albedo (`35 m/px` inner, `75 m/px` Artemis) + active LOLA PSR-floor morphology. |
| `elevation` | **Topographic Elevation (LOLA DEM)** | LRO LOLA $1064\text{ nm}$ Altimeter (16-bit) | $-9.12\text{ km}$ to $+10.76\text{ km}$ | 16-bit $(R, G)$ bilinear GPU elevation (`0.30 m` vertical precision, fine $250\text{ m}$ polar contours) resolving Shackleton ($-4.2\text{ km}$), Haworth, Shoemaker & Malapert ($+4.5\text{ km}$). |
| `temperature` | **Surface Bolometric Temperature** | LRO Diviner Radiometer (DLRE) | $25\text{ K}$ to $395\text{ K}$ | Driven by 16-bit polar surface normals & horizon concavity — resolves cryogenic PSR cold traps ($25\text{–}45\text{ K}$), sunlit rims, and subsolar noon ($395\text{ K}$). |
| `slope` | **Terrain Slope & Landing Hazard** | LOLA Multi-Beam Adaptive Gradient | $0^\circ$ to $35^\circ+$ | Singularity-free tangent-frame finite differences ($6,200\text{ m} \to 900\text{ m} \to 240\text{ m} \to 65\text{ m}$ baseline) resolving inner Shackleton crater walls ($31^\circ$) vs $<8^\circ$ ridge flats. |
| `illumination` | **Solar Illumination Duty Cycle** | LOLA Polar Prominence & Rim Model | $0\%$ to $89\%$ | Maps "Peaks of Eternal Light" ($>80\%$ solar duty along Shackleton Connecting Ridge & Malapert summit) vs $0\%$ deep PSR interiors. |
| `ice` | **Water-Ice Equivalent ($\text{H}_2\text{O}$)** | LP Neutron & LRO LEND + Cold Traps | $0.0$ to $5.5\text{ wt\%}$ | Pinpoints cryogenic polar volatile cold traps ($T_{\max} < 110\text{ K}$) inside Shackleton, Shoemaker, Faustini, Haworth & Cabeus floors for ISRU prospecting. |
| `dte` | **Direct-to-Earth (DTE) Visibility** | JPL Libration + 16-Bit Terrain Mask | $-20^\circ$ to $+90^\circ$ El | Combines live Earth libration with high-res polar crater-wall horizon masking to flag Near-Side ridge links vs crater-floor occultation. |

---

## South Polar Stereographic Multi-Resolution Clipmap Pyramid (`IAU2000:30162`)

To eliminate equirectangular UV pinching ($\cos\phi \to 0$ as $\phi \to -90^\circ$) and $\pm 180^\circ$ longitude mipmap seams, both `VERTEX_SHADER` and `FRAGMENT_SHADER` project unit-sphere coordinates $(x, y, z)$ algebraically onto the South Polar Stereographic plane:

$$
(X, Y)_{\text{m}} = \frac{2 R_{\mathbb{C}}}{1 - y}\,(-z,\, x), \qquad R_{\mathbb{C}} = 1,737,400\text{ m}
$$

- **Polar-Refined 3D Sphere Geometry (`createPolarRefinedSphereGeometry`):** Packs $120$ dedicated latitude rings across $78^\circ\text{S}\text{–}90^\circ\text{S}$ ($\sim 3.0\text{ km}$ vertex spacing) so 3D vertex displacement physically carves Shackleton, Shoemaker, Haworth, Faustini, and Malapert in silhouette.
- **3 Nested Optical + 16-Bit Elevation Clipmap Tiers (`public/textures/`):**
  1. **Wide Polar Cap ($\pm 365\text{ km}$, $78^\circ\text{S}\text{–}90^\circ\text{S}$):** `lroc_sp_wide.jpg` ($2048^2$) + `lola_sp_wide_16bit.png` ($1024^2$, MIT `LDEM_75S_240M`).
  2. **Artemis III Candidate Zone ($\pm 155\text{ km}$, $84.9^\circ\text{S}\text{–}90^\circ\text{S}$):** `lroc_sp_artemis_4k.jpg` ($4096^2$, $75\text{ m/px}$ ASU LROC WAC Summer Multi-Orbit + NAC Controlled) + `lola_sp_artemis_16bit.png` ($2048^2$, $151\text{ m/px}$, MIT `LDEM_85S_40M`).
  3. **Inner Shackleton & Connecting Ridge Core ($\pm 36\text{ km}$, $88.8^\circ\text{S}\text{–}90^\circ\text{S}$):** `lroc_sp_inner.jpg` ($2048^2$, $35\text{ m/px}$ LROC NAC 2m Controlled South Pole Mosaic) + `lola_sp_inner_16bit.png` ($2048^2$, $35\text{ m/px}$ MIT `LDEM_875S_20M` fused with $10\text{ m/px}$ NASA GSFC PGDA Artemis Site 01).
- **Dedicated Top-Menu `South Pole` Reference Frame (`src/App.tsx`):** Re-orients the camera up-vector to `0° Prime Meridian (+X → Earth)` at 12 o'clock UP (`minDistance = 1.012`), eliminating `OrbitControls` polar gimbal lock at $90^\circ\text{S}$ and providing instant sub-presets (`Polar Cap (90°S)`, `Shackleton & Ridge`, `Malapert & Haworth`, `de Gerlache & Shoemaker`, `Mons Mouton & Nobile`, `Focus Pin`, `Rover Locality`, `Rover Route`) plus cold-trap PSR callouts.
- **Altitude-Adaptive Dynamic Scaling Across All 3D Scene Elements & Rover Model:** All 3D points, waypoints (Start [A], CP 1..N, Goal [B], candidate corridor branch points), landing site beacons, custom pins, South Pole cold-trap landmarks, sub-solar/sub-earth ephemeris markers, orbital satellites, and the articulated 3D lunar rover model dynamically interpolate their scale based on camera distance $\text{camDist}$:
  $$\text{pointScale} = \operatorname{clamp}\left(\frac{\text{camDist} - 1.0}{1.35},\, 0.18,\, 1.0\right)$$
  When zoomed into the lunar surface ($\text{camDist} \le 1.25$), elements smoothly shrink to **20%** of their base size (preventing oversized 50 km spheres or giant rovers from obscuring fine crater floors and ridge crests). Full-size invisible hit targets ($r = 0.009$) and invariant screen-pixel HTML buttons (`-translate-y-*`) remain effortless to click and read at any zoom level, while the GPU shader radar ring and pulse shrink in exact 1:1 synchrony.
