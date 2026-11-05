# Selenographic Physics, Horizon Ray-Tracing & Orbital Mechanics

Related: [[00_SELENE_OPS_Challenge_Overview]] | [[03_Cislunar_Constellation_and_Relay_Access]] | [[06_Rover_Traverse_Planning_and_DEM_Resolution]]

---

## 1. Selenographic Coordinate Convention

Every point on the Moon of mean selenoid radius $R_{\mathbb{C}} = 1737.4\text{ km}$ at latitude $\phi \in [-90^\circ, +90^\circ]$ and East-positive longitude $\lambda \in [-180^\circ, +180^\circ]$ maps to 3D Cartesian coordinates aligned with NASA SVS LROC/LOLA equirectangular mosaics ($u = 0.5 \iff \lambda = 0^\circ$ Prime Meridian facing Earth along $+X$):

$$
\begin{aligned}
x &= r \cos\phi \cos\lambda \\
y &= r \sin\phi \\
z &= -r \cos\phi \sin\lambda
\end{aligned}
$$

---

## 2. Solar Illumination & Optical Libration of Earth

- **Sub-Solar Longitude & Seasonal Latitude:** Driven by the synodic month ($P_{\text{syn}} = 29.530589\text{ d}$) and the Moon's $1.5424^\circ$ axial obliquity to the ecliptic over the $346.62\text{ d}$ draconic year:
  $$\phi_{\odot}(t) = 1.5424^\circ \sin\!\left(\frac{2\pi (t - t_0)}{346.620\text{ d}}\right)$$
- **Optical Libration of Earth:** Because the Moon's orbit is eccentric ($e = 0.0549$, anomalistic month $27.55455\text{ d}$) and inclined ($i = 5.145^\circ$ to the ecliptic + $1.542^\circ$ equator tilt = $6.687^\circ$, draconic month $27.21222\text{ d}$), the Sub-Earth point traces a Lissajous figure around $(0^\circ, 0^\circ)$:
  $$\lambda_{\oplus}(t) \approx 6.29^\circ \sin M + 1.27^\circ \sin(2D - M), \qquad \phi_{\oplus}(t) \approx -6.68^\circ \sin F$$
  At South-Pole sites ($\phi \approx -85^\circ \text{ to } -89.5^\circ$), this $\pm 6.68^\circ$ latitude swing governs Direct-to-Earth (DTE) X-band visibility windows.

---

## 3. 360° Topographic Horizon Mask Ray-Marching

For an antenna/solar mast of height $h_{\text{mast}} = 2.0\text{ m}$ at surface radius $r_0 = R_{\mathbb{C}} + h(\phi_0, \lambda_0) + h_{\text{mast}}$, we ray-march across 36 azimuths ($\text{Az} = 0^\circ, 10^\circ, \dots, 350^\circ$) out to angular distance $\gamma = 4.2^\circ \approx 127\text{ km}$. At each step $(\phi_k, \lambda_k)$ with radius $r_k = R_{\mathbb{C}} + h(\phi_k, \lambda_k)$, exact spherical geometry gives the elevation angle above the local horizontal tangent plane:

$$\alpha_{\text{mask}}(\text{Az}) = \max_{k} \arctan\!\left(\frac{r_k \cos\gamma_k - r_0}{r_k \sin\gamma_k}\right)$$

Notice this naturally captures both **positive crater-rim obstruction** ($\alpha_{\text{mask}} > 0^\circ$) and **planetary horizon dip** ($\alpha_{\text{mask}} < 0^\circ$) atop towering massifs such as Malapert ($+4.95\text{ km}$).

---

## 4. Keplerian Satellite Propagation

Each cislunar spacecraft is propagated from selenocentric gravitational parameter $\mu_{\mathbb{C}} = 4902.8001\text{ km}^3/\text{s}^2$:
1. Mean motion $n = \sqrt{\mu_{\mathbb{C}} / a^3}$ and mean anomaly $M(t) = M_0 + n \Delta t$.
2. Newton-Raphson solution of Kepler's Equation $M = E - e\sin E$ (7 iterations, residual $< 10^{-11}\text{ rad}$).
3. Radius $r = a(1 - e\cos E)$, orbital speed $v = \sqrt{\mu_{\mathbb{C}}(2/r - 1/a)}$, and true anomaly $\nu = 2\arctan2(\sqrt{1-e^2}\sin(E/2), \dots)$.
4. Frozen South-Pole relays (**Queqiao-2**, **CAPSTONE NRHO**, **Lunar Pathfinder**) set argument of periselene $\omega = +90^\circ$ so aposelene ($\nu = 180^\circ \implies u = 270^\circ \implies \sin\phi = -\sin i$) dwells slowly high above the Southern Hemisphere.

---

## 5. Multi-Frame 3D Celestial Views (Geocentric & Heliocentric)

Implemented in `src/engine/celestialEphemeris.ts` and `src/components/CelestialSystem3D.tsx`, operators can switch seamlessly at any time between three coupled 3D reference frames:

1. **Lunar Surface View (`'lunar-globe'`):** Selenographic LROC/LOLA 3D Moon, 7 multi-physics heatmaps, 360° horizon ray-marching, cislunar relay constellation, and A* rover traverse planner.
2. **Moon Around Earth — Geocentric View (`'earth-moon'`):**
   - **Tilted Rotating 3D Earth:** $23.439^\circ$ J2000 axial obliquity, continuous Greenwich Mean Sidereal Time ($\text{GMST}$) rotation, custom GLSL procedural continents/oceans/clouds, Rayleigh atmospheric scattering rim, and nightside city lights.
   - **Inclined Eccentric Lunar Orbit:** Renders the Moon's $5.145^\circ$ inclined elliptical orbit ($a = 384{,}400\text{ km}$, $e = 0.0549$) with live **Perigee**, **Apogee**, **Ascending Node ($\Omega$)**, **Descending Node ($\mho$)** (with 18.61-year nodal regression), and Earth–Moon **EM-L1 / EM-L2** Lagrange relays.
   - **Tidally Locked 3D Moon & Live DTE Link:** Displays true world-space solar phase illumination + Earthshine, the selected landing site pin on the Moon, and a live emerald/rose **Direct-to-Earth (DTE)** comm beam. Includes a **Schematic Scale vs. True 1:1 Physical Scale ($60.3\,R_\oplus$)** toggle.
3. **Earth & Moon Around Sun — Heliocentric View (`'heliocentric'`):**
   - **Animated 3D Sun & Corona:** Dynamic solar granulation/limb-darkening photosphere + additive corona at the J2000 Ecliptic origin.
   - **1 AU Elliptical Orbit & Seasons:** Renders Earth's eccentric heliocentric orbit ($e_\oplus = 0.01671$) with stationary inertial **Perihelion (~Jan 3)**, **Aphelion (~Jul 4)**, **March/September Equinox**, and **June/December Solstice** markers.
   - **Coupled Earth–Moon Epicycle:** Displays the tilted Earth + orbiting Moon subsystem co-moving along the 1 AU orbit alongside a 90-day heliocentric lunar epicycle wave trail, with camera presets including co-moving `Follow Earth–Moon` and `Axial Tilt & Seasons`.

---

## 6. Past, Present & Future UTC Mission Epoch Planning

Implemented in `src/components/MissionEpochModal.tsx`, `src/engine/celestialEphemeris.ts`, and `src/components/RoverMissionPlanner.tsx`:
- **Arbitrary Past & Future Epochs (`1800`–`2300` UTC):** All analytical ephemerides (`computeCelestialSystemState`, `computeSunEarthSelenographic`, `propagateSatellite`, and `simulatePathPhysics`) evaluate continuous offsets from `J2000.0` (`2000-01-01T12:00:00Z`) with negative-modulo wrapping so past historical missions (e.g., **Apollo 11** `1969-07-20`, **Chandrayaan-3** `2023-08-23`), present real-time UTC (`Now`), and future **Artemis III / IV / Base Camp (`2027`–`2032+`)** windows propagate identically.
- **Movable Mission Epoch Selector & Inline Rover Epoch Card:** Operators can set exact Year, Month, Day, and `HH:MM` UTC from either the top header clock or directly inside the Rover Mission Planner without live-clock input clobbering, plus step by $\pm 6\text{h}$, $\pm 1\text{d}$, $\pm 1\text{ Lunation}$ ($29.53\text{ d}$), or $\pm 1\text{–}10\text{ Yr}$ and warp orbital playback up to `1d/s` and `15d/s`.


