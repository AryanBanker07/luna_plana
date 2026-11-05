# Rover Traverse Planning, Terramechanics & DEM Resolution Analysis

Related: [[00_SELENE_OPS_Challenge_Overview]] | [[01_Selenographic_Physics_and_Ephemeris]] | [[05_Software_Architecture_and_ECC_Design_System]]

---

## 1. Is Global LOLA DEM Height Data High Enough Resolution for Rover Planning?

**Short Engineering Answer:**  
A standard web-grade 8-bit global lunar map (`1024 × 512`, $\sim 10.66\text{ km/px}$ horizontal, $78\text{ m}$ vertical quantization steps) is **not sufficient on its own** for local ($1\text{–}20\text{ km}$) rover slope and energy feasibility, because 8-bit vertical quantization creates artificial $78\text{ m}$ cliffs ("terracing") and $10\text{ km}$ pixels smooth out $20\text{–}500\text{ m}$ craters and ridge scarps. Conversely, raw $5\text{ m/px}$ South-Pole GeoTIFFs (`ldem_87s_5mpp.tif` $\approx 3.46\text{ GB}$) are too large to ship monolithic in a browser.

### Multi-Tier 16-Bit NASA LOLA Pyramid Implemented in `SELENE OPS`
To achieve genuine aerospace-grade rover traverse planning inside the browser, `SELENE OPS` upgrades to a **3-Tier Lossless 16-Bit RG-Packed DEM Pyramid** (`src/engine/selenography.ts`):

| DEM Tier | Asset File | Coverage | Horizontal Posting | Vertical Precision ($\Delta z$) | Rover Planning Fidelity |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Tier 3 (Meter-Scale Patch)** | `lola_site01_10mpp_16bit.png` | Artemis III Site 01 (Shackleton Connecting Ridge, $16 \times 16\text{ km}$) | **$10\text{ m} \times 10\text{ m}$** | **$0.10\text{ m}$ ($10\text{ cm}$)** | **True tactical hazard fidelity** — directly resolves $20\text{–}50\text{ m}$ craters and ridge scarps from NASA GSFC PGDA `Site01_final_adj_5mpp_surf.tif`. |
| **Tier 2 (Polar 16-ppd Cap)** | `lola_southpole_16bit.png` | Lunar South Pole ($80^\circ\text{S} - 90^\circ\text{S}$) | **$1,895\text{ m}$ N–S $\times$ $33\text{–}320\text{ m}$ E–W** | **$0.50\text{ m}$** | **Sub-km massif & crater-wall fidelity** across Malapert, Nobile, Haworth, Mons Mouton & Cabeus; paired with LOLA 5-spot Hurst micro-roughness. |
| **Tier 1 (Global 8-ppd 16-Bit)** | `lola_dem_16bit.png` | Full Moon ($90^\circ\text{N} - 90^\circ\text{S}$) | **$3,790\text{ m}$ N–S** | **$0.50\text{ m}$** | **Regional endurance traverse fidelity** — zero 8-bit staircasing; paired with Rosenburg et al. (2011) Hurst exponent ($H \approx 0.78$) sub-grid roughness synthesis. |

---

## 2. Singularity-Free Tangent-Plane A* Pathfinding

Near $-89.5^\circ\text{S}$, regular $(\phi, \lambda)$ grids pinch severely at the pole. `src/engine/roverPlanner.ts` constructs an orthonormal 3D tangent-plane frame $(\hat{e}_0, \hat{e}_x, \hat{e}_y)$ centered at the geodesic midpoint between Start $\mathbf{A}$ and Goal $\mathbf{B}$, generating a $43 \times 31$ ($1,333$-node) metric navigation mesh with 16-direction (8-neighbor + knight-move) transitions:
- Segments exceeding `maxInclineDeg` incur a quadratic soft-barrier penalty so **A\*** detours cleanly around steep crater walls and scarps while minimizing energy-weighted distance.
- Also computes the **Direct Geodesic ("Crow-Flies")** baseline simultaneously to quantify detour percentage and slope reduction.

---

## 3. Lunar Terramechanics & Battery State-of-Charge Model

Along each waypoint segment $i$ of length $d_i$ and elevation change $\Delta h_i$ under lunar gravity $g_{\mathbb{C}} = 1.625\text{ m/s}^2$:

$$
E_{\text{traction}, i} = \frac{m g_{\mathbb{C}} \mu_r \kappa_{\text{slip}}(\theta_i) d_i \cos\theta_i}{\eta_{\text{drive}}} + \begin{cases}
\dfrac{m g_{\mathbb{C}} \Delta h_i}{\eta_{\text{drive}}}, & \Delta h_i > 0 \\[6pt]
-\eta_{\text{regen}} m g_{\mathbb{C}} |\Delta h_i|, & \Delta h_i < 0
\end{cases}
$$

- **Speed Derating:** $v_i = v_{\text{cruise}} \cdot \max\!\big(0.22,\, 1 - 0.62 (\theta_i / \theta_{\max})^2\big)$.
- **Net Battery Evolution:** Integrates traction load + continuous hotel/avionics power ($P_{\text{avionics}} \Delta t_i$) minus **live solar array generation** ($P_{\text{solar}}(t_i) \Delta t_i$), dynamically checking whether the Sun clears the local 36-azimuth LOLA crater-rim horizon at exact arrival timestamp $t_i = t_0 + \sum_{k \le i} \Delta t_k$.


---

## 4. Guided 6-Step Rover Mission Workflow (Plan Mission)

Entry point: the amber **Plan Mission** button in the top bar opens the Rover dock at Step 1. State machine: `RoverWorkflowStep = 'idle' | 'rover-setup' | 'select-start' | 'range-explore' | 'route-ready' | 'animating'` (`src/types/lunar.ts`).

| # | User Step | Workflow State | What Happens |
| :-: | :--- | :--- | :--- |
| 1 | Plan Mission button | `rover-setup` | Opens wizard, resets animation |
| 2 | Specify rover details | `rover-setup` | Preset or custom mass, max incline, battery Wh, reserve %, speed, avionics W, solar W, roughness. Live flat-range estimate via `estimateFlatRangeKm()` |
| 3 | Specify start point | `select-start` | Click 3D Moon (or a site beacon), pick curated site, or type lat/lon |
| 3.5 | Zoom into locality | `range-explore` | Camera preset `rover-locality` flies to Start [A], framed to the max reachable radius (OrbitControls `minDistance` lowered to 1.045, adaptive rotate speed) |
| 4 | Operational range + possible paths | `range-explore` | `computeRoverRangeEnvelope()` draws the reachability perimeter (emerald = energy/sortie-limited, amber = incline-blocked), a dashed 50% ring, and ≤12 branching Dijkstra corridors |
| 5 | Select end point | `range-explore` → `route-ready` | Click inside the range fan, click a corridor pill, choose a local auto-target / curated site, or type custom coordinates. A* feasibility review (GO / CAUTION / NO-GO) |
| 6 | Rover navigation animation | `animating` | 60 FPS interpolated rover (`roverAnimProgress ∈ [0,1]`, ~14 s at 1×; 1×/2×/4×), terrain-tangent orientation, gold driven trail, optional Chase Cam, live telemetry and synced elevation drawer cursor |

### Operational Range Envelope Algorithm (`src/engine/roverPlanner.ts`)
1. Usable energy is $E_u = C_{bat}(1 - \text{reserve})$. Flat range is endurance (capped by sortie hours) × cruise speed, clamped to 1.2–85 km.
2. A singularity-free $41 \times 41$ tangent-plane grid centered on Start [A] (East/North basis) spans ±1.15 × flat range.
3. **Single-source Dijkstra** runs on a normalized resource cost $\max(E_{seg}/E_u,\ \Delta t/T_{sortie})$ using the same terramechanics model as the traverse simulator (rolling + climb − regen + avionics − solar at Start illumination). Edges steeper than `maxInclineDeg` are hard-blocked.
4. The farthest reachable node in each of 36 azimuth bins becomes the boundary ring (lightly smoothed). The farthest node in each of 12 compass sectors gives the candidate corridor (reconstructed via `cameFrom`, Chaikin-smoothed).
5. Auto targets: Local High Prominence, Low-Slope Safe Flats, Max-Range Frontier, plus the 6 nearest curated sites flagged IN RANGE / BEYOND.

> [!NOTE]
> The mission epoch is frozen when Start [A] is confirmed, so the live sim clock doesn't re-plan during review or animation. The current DEM tiers are adequate for rough locality planning; a higher-res local DEM can be dropped into the `sampleRoverElevationKm` tier pyramid without changing the workflow.

---

## 5. Automated Crater Characterization & Avoidance (<20s Compute Budget)

To prevent rovers from driving through steep, entrapment-prone crater bowls (as observed when optimizing purely for point-to-point elevation/slope), `SELENE OPS` implements **Automated DEM-Driven Crater Characterization** (`src/engine/craters.ts`) coupled with a **Hierarchical Binary-Heap A\* Pathfinding Engine** (`src/engine/roverPlanner.ts`).

### 5.1 Crater Detection & Morphometric Characterization
Across the tangent-plane elevation raster, a multi-radius geometric kernel tests concentric ring samples against local central depressions:
- **Ladder of Sample Radii:** $r \in [2, 3, 4, 5, 7, 10, 14, 20, 28, 40, 56]\text{ cells}$.
- **Depth-to-Diameter Ratio ($d/D$):**
  - $\ge 0.12$: **Fresh Simple Bowl** (severe walls, high rock hazard).
  - $0.07 \le d/D < 0.12$: **Mature Crater** (moderate degradation).
  - $< 0.07$: **Degraded / Subdued Basin** (traversable margins).
- **Wall Slope ($\theta_{\text{wall}}$):** $\arctan(\Delta z / (0.55 r)) \times 180^\circ / \pi$.
- **Bowl Convexity & Continuity Check:** Enforces that $\ge 14$ of 16 circumferential ring samples lie above the floor threshold ($z_{\text{floor}} + 0.35 \Delta z$) and non-maximum suppression prevents double-counting overlapping radii.
- **Endpoint Exemption:** If a mission Start [A] or Goal [B] lies inside a crater (e.g. Apollo/Artemis PSR landing site), the crater is classified as `status: 'endpoint'` and exempted from hard avoidance so departure/arrival remains feasible.

### 5.2 Traversal Cost Multiplier Field
The characterizer rasterizes two safety zones per detected crater:
1. **Interior Bowl ($d \le 0.88 r$):**
   - High severity ($d/D \ge 0.09$ or steep walls): **$40\times$ penalty** (`status: 'no-go'`).
   - Moderate severity: $1 + 8(0.35 + 0.65 \times \text{severity})$ penalty (`status: 'avoid'`).
2. **Blocky Ejecta Rim ($0.88 r < d \le 1.35 r$):**
   - $1 + 2.2(0.25 + 0.75 \times \text{severity})$ penalty to incentivize steering wide of loose ejecta blocks.

### 5.3 Low-Compute Acceleration: MinHeap + Hierarchical Routing (<20s Execution)
- **Binary MinHeap Priority Queue (`MinHeap`):** Replaces linear $O(N)$ open-set scanning with $O(\log N)$ extraction. This speeds up the core A* traversal by $20\times\text{–}50\times$.
- **Hierarchical Long-Distance Solver:**
  - **Traverses $\le 70\text{ km}$:** Single fine grid ($\sim 120\text{ m/cell}$, $48\text{–}190$ cells). Resolves in $\sim 15\text{–}80\text{ ms}$.
  - **Traverses $> 70\text{ km}$ (Continental / Regional Sorties):** 
    1. Computes a coarse global tangent grid corridor ($110 \times 79$ cells).
    2. Resamples the macro-corridor into $\sim 30\text{ km}$ chunks.
    3. Solves fine-resolution local A* tangent grids sequentially along the corridor with an adaptive wall-clock budget (`ROUTE_BUDGET_MS = 12,000 ms = 12 s`).
    4. Slices and splices smooth Chaikin curves across all segments.
- **Result:** Global $1,600+\text{ km}$ lunar traverses compute in **under 3 to 12 seconds**—comfortably inside the 20-second budget—while completely skirting hazardous crater rims and providing explicit telemetry:
  - Number of crater bowls characterized.
  - Number of hazardous no-go bowls avoided.
  - Interior crossings (0 for safe A* vs. multiple on direct line).
  - Exact compute time in milliseconds.

---

## 6. Manual Checkpoint Specification & Multi-Leg Chained Routing

### 6.1 Order of Operations Architecture
Between Step 2 (Specify Start Point [A] & 3.5 Zoom to Locality) and Step 4 (Operational Range & Select End Point [B]), SELENE OPS provides an interactive **Checkpoint Management Stage (Step 3)**:

```
[1. Rover Setup] ──▶ [2. Start Point A + Locality Zoom] ──▶ [3. Intermediate Checkpoints (CP_1..CP_k)]
                                                                           │
                                                                           ▼
[6. 3D Navigation Animation] ◀── [5. Feasibility Review & Leg Breakdown] ◀── [4. Operational Range & Goal B]
```

### 6.2 Checkpoint Placement & Interaction Modes
1. **3D Moon Direct Click (`pick-checkpoint`):**
   - When active, clicking anywhere on the high-resolution 3D LOLA Moon sphere automatically projects the raycast intersection to selenographic coordinates $(\phi, \lambda)$ and appends a new via-point $CP_n$.
   - Interactive Cyan visual pins (`#06b6d4`) are rendered at the exact LOLA elevation with numbered badges (`CP 1`, `CP 2`, $\dots$).
2. **Manual Coordinate Entry:**
   - Planners can manually specify target Latitude, Longitude, and a descriptive label (e.g. *North Rim Overlook*, *Cold Trap Volatile Core*, *Communication Relay Ridge*).
3. **List Management & Reordering:**
   - Checkpoints can be moved Up ($\uparrow$) or Down ($\downarrow$) in the sequence, individually removed, or cleared completely.
   - Planners can proceed directly to End Point [B] if no via-points are required (*Zero-overhead optional skip*).

### 6.3 Multi-Leg Chained A* Traverse Solver
When $k$ checkpoints are designated ($CP_1, CP_2, \dots, CP_k$), the mission is decomposed into $k + 1$ sequential legs:
$$L_0 = (A \rightarrow CP_1), \quad L_1 = (CP_1 \rightarrow CP_2), \quad \dots, \quad L_k = (CP_k \rightarrow B)$$

- **A\* Optimal Avoidance:** Each leg is independently resolved through `computeAStarRoute(pA, pB, params)` with the MinHeap priority queue and crater penalty field, completely steering clear of no-go crater bowls and steep escarpments.
- **Continuous Terramechanics Simulation:** Spliced coordinates are simulated end-to-end via `simulatePathPhysics`:
  - Battery State of Charge (SoC) drains dynamically and recharges when traversing sunlit slopes.
  - Cumulative odometer mileage, total elapsed drive hours, elevation gain/loss, and comms line-of-sight are chained seamlessly.
- **Dynamic Operational Range Fan:** When in Step 4, the 36-azimuth operational envelope and candidate corridor paths are automatically centered on the **last checkpoint** ($CP_k$), allowing planners to see reachable frontiers from their final science waypoint.
- **Per-Leg Feasibility Review:** Step 5 displays a granular breakdown table showing individual distance, drive duration, energy consumed (Wh), and peak slope encountered for every leg $L_i$.
- **3D Continuous Animation:** In Step 6, the articulated 3D lunar rover smoothly navigates through every via-point from Start $\rightarrow CP_1 \dots \rightarrow$ Goal [B] at 60 FPS.

---

## 7. Scientific Matplotlib Telemetry Engine & Publication Plotter

### 7.1 Order of Operations & Trigger Placement
To satisfy rigorous planetary mission feasibility reviews and publication-standard scientific reporting, SELENE OPS integrates a dedicated multivariable **Plot Data** engine:

```
[Traverse Elevation Drawer] ──▶ Click "[Plot Data]" Button (left of Dist)
                                         │
                                         ▼
                            [Movable "Plot Data" Modal]
                            ├── Draggable Floating Window (Pointer Grab, Re-center, Esc)
                            ├── Range (Presets with Clean Leg Labels / Custom km)
                            ├── Quantities (Elevation, Slope, SoC, Grade, Energy, Speed, Comm)
                            ├── Scientific Style (Theme, Grid, Reference Thresholds, Pins)
                            └── Display Targets (Python Matplotlib TkAgg GUI & Interactive Web Popout)
                                         │
                                         ▼
                     [High-Fidelity Scientific Plot in New Window]
                     ├── Python Matplotlib Window: Native TkAgg Toolbar (Pan, Box Zoom, Home, Save PNG/PDF)
                     └── Interactive Web Window: Synchronized Crosshair Telemetry Probe & SVG/300 DPI PNG Export
```

1. **Trigger Button:** Located directly to the left of `Dist: ...` in the header row of `RoverElevationDrawer` with distinct cyan styling, a line-chart icon, and labeled **"Plot Data"**.
2. **Movable Configuration Modal ("Plot Data"):** Opens an engineering-focused draggable dialog (`ScientificPlotModal`). The window can be dragged anywhere across the screen by its header bar to inspect the underlying 3D Moon or traverse route, includes a `Movable` badge, a `Reset Pos` button, and supports `Escape` key dismissal.
3. **Structured Traverse Legs Window:** In Step 5, multi-leg chained traverses are rendered in structured 2-row cards:
   - **Row 1:** Fixed-width `LEG k` cyan badge, clean waypoint names (`Start → CP 1`), and right-aligned distance in bold emerald.
   - **Row 2:** Subordinate full selenographic coordinates and telemetry chips (drive duration, slope hazard with chassis limit warning, and traction energy Wh).
   - Prevents awkward text-wrapping or split labels across narrow sidebar columns.
4. **Dedicated New Window Output:** Follows the "function over form" paradigm—opens standalone publication-quality interactive plots without dashboard clutter.

---

### 7.2 Configuration Modal Architecture
The configuration modal provides comprehensive control over the telemetry output:
1. **Analysis Distance Range:**
   - **Quick Presets:** Instant selection of the full traverse ($0 \rightarrow D_{\text{max}}\text{ km}$) or individual legs ($L_0, L_1, \dots$).
   - **Custom Extents:** Precise numerical inputs for start and end kilometers with live count of contained waypoints.
2. **Quantities to Plot (Subplots):**
   - **Elevation Profile ($z$ in meters & km):** LOLA topographic relief with annotated global minima and peak summits.
   - **Terrain Slope Hazard ($\theta$ in degrees):** Instantaneous slope with dashed red chassis slip threshold ($20^\circ$) and warning line ($16^\circ$).
   - **Longitudinal Grade ($\%$):** Signed climb/descent grade highlighting traction climb zones vs. downhill potential regenerative braking.
   - **Battery State of Charge ($\%$):** Dynamic SoC curve with red $15\%$ flight-rule emergency reserve floor.
   - **Cumulative Energy Balance ($\text{Wh}$):** Multi-curve comparison of net energy draw, gross traction draw, and solar photovoltaic harvest.
   - **Travel Speed ($\text{km/h}$):** Slope-derated locomotion speed profile across terrain variations.
   - **Communications & Solar LOS:** Discrete binary status tracking Direct-to-Earth / Lunar Relay line-of-sight and sunlit deck availability.
3. **Scientific Formatting ("Function over Form"):**
   - **Independent X-Axis:** Cumulative Distance ($\text{km}$), Mission Elapsed Time ($\text{Hours } T+$), or Waypoint Index ($\#$).
   - **Color Palettes:** Publication White (IEEE/Nature paper print standard) or Scientific Dark (high-contrast console).
   - **Grid & Reference Overlays:** Major dashed and minor dotted grids, flight limit thresholds, and vertical checkpoint reference pins.
4. **Display Target Toggles:**
   - **Python Matplotlib Window:** Spawns a native Windows desktop GUI using Matplotlib's `TkAgg` backend with full interactive pan, box zoom, subplot config, and export tools.
   - **Interactive Popout Web Window:** Opens an unstyled, ultra-responsive standalone browser window (`window.open`) featuring an SVG rendering pipeline, synchronized vertical crosshair inspection probe, hover telemetry data card, and 300 DPI raster export.

---

### 7.3 Backend Python Matplotlib Engine (`scripts/plot_rover_telemetry.py`)
- **Execution Pipeline:**
  1. Frontend bundles the telemetry payload into JSON and posts to `/api/plot`.
  2. Vite development middleware writes the JSON to `temp/telemetry_<timestamp>.json` and spawns `python scripts/plot_rover_telemetry.py <json_path>` as a detached background process.
  3. Matplotlib initializes the `TkAgg` GUI backend, constructing $N$ vertically stacked subplots with shared X-axes and minor tick locators.
  4. The window pops up on the operator's desktop with full interactive toolbar capabilities (Pan, Zoom-to-Rect, Back, Forward, Subplot Margin adjustments, and Save to PNG/SVG/PDF).
- **Headless / CLI Support:**
  - Can be invoked independently via CLI for automated batch pipelines:
    ```bash
    python scripts/plot_rover_telemetry.py temp/telemetry.json --no-gui --save reports/traverse_telemetry.png
    ```

---

### 7.4 Standalone Web Popout Generator (`src/utils/scientificPlotWindow.ts`)
- **Zero-Dependency Vector Graphics:** Generates pristine SVG vector curves directly in a dedicated browser window.
- **Synchronized Telemetry Crosshair:** Moving the mouse across any subplot projects a vertical hairline across all stacked panels, updating an instant telemetry HUD displaying exact distance, time, elevation, slope, SoC, and grade.
- **Publication Export Suite:**
  - `Export SVG`: Downloads a resolution-independent vector graphic suitable for LaTeX/vector editors.
  - `Export PNG (300 DPI)`: Renders an ultra-high-resolution raster suitable for formal space agency technical reports.
  - `Export Telemetry CSV`: Downloads raw comma-separated values containing all waypoint states.
  - `Launch Python Matplotlib`: One-click button inside the popout to trigger the native desktop GUI on demand.

---

## 8. Coupled Past & Future Mission Epoch Planning
- Cross-reference: [[01_Selenographic_Physics_and_Ephemeris]]
- Rover traverse simulation (`roverMissionEpochMs`) is directly editable inside `RoverControlsPanel` (`Planned Mission Time (UTC)`) or via the movable `MissionEpochModal` (`Past/Future` button and top header UTC clock).
- Changing the planned epoch to any past or future UTC date/time dynamically recomputes solar array generation along every waypoint, Direct-to-Earth libration & cislunar relay visibility, operational range envelopes, and the synchronized **Lunar Surface**, **Moon Around Earth**, and **Earth & Moon Around Sun** 3D views.



