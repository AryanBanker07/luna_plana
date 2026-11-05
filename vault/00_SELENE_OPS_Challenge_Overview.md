# SELENE OPS — Lunar Landing Site Navigator (NASA Space Apps 2026)

**Challenge:** [Lunar Landing Site Navigator (CLPS & Artemis Mission Theme)](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/?tab=details)  
**System Name:** `SELENE OPS // 3D Selenographic Mission Readiness & Relay Console`  
**Workspace:** `c:\Users\banke\OneDrive\Desktop\nasa_spaceapps\Lunar landing navigator`

---

## 1. Executive Summary

Missions targeting the Lunar South Pole under NASA's **Commercial Lunar Payload Services (CLPS)** and **Artemis** programs confront extreme coupled environmental constraints:
- Grazing solar incidence ($\sim 0^\circ \text{ to } 3^\circ$ elevation) where a $2\text{ km}$ shift from a crater rim into a floor changes solar power duty from **86.5% ("Peak of Eternal Light")** to **0% (Permanently Shadowed Region at $28\text{ K}$)**.
- A **27.2-day optical libration cycle** in latitude ($\pm 6.68^\circ$) causing Earth to rise and set behind local South-Pole massifs, interrupting **Direct-to-Earth (DTE)** X-band communications for $\sim 13\text{ days}$ per month unless bridged by cislunar relay satellites.

**SELENE OPS** unifies real NASA Lunar Reconnaissance Orbiter (**LRO LROC** & **LOLA DEM**) global datasets, real-time GPU multi-physics shaders, 36-azimuth topographic horizon ray-tracing, Keplerian cislunar satellite tracking, and an onboard **SELENE-AI Flight Co-Pilot** into a single interactive 3D web workstation.

---

## 2. Vault Knowledge Graph

- [[01_Selenographic_Physics_and_Ephemeris]] — Optical libration, sub-solar ephemeris, LOLA spherical horizon ray-marching, Newton-Raphson Keplerian propagation, **Geocentric (`Moon Around Earth`) & Heliocentric (`Earth & Moon Around Sun`) 3D views**, and **Past/Future UTC Mission Epoch selection**.
- [[02_Multi_Physics_Heatmaps_Reference]] — GPU GLSL shader models and NASA instrument provenance for all 7 global lunar heatmaps.
- [[03_Cislunar_Constellation_and_Relay_Access]] — Orbital mechanics and access capabilities of **LRO**, **Danuri (ShadowCam)**, **Queqiao-2**, **CAPSTONE (NRHO)**, and **Lunar Pathfinder**.
- [[04_Candidate_Landing_Sites_Analysis]] — Benchmark comparison of 10 Artemis III, CLPS, ISRU, and historic landing ellipses.
- [[05_Software_Architecture_and_ECC_Design_System]] — Frontend architecture, ECC design tokens, and local/production build guide.
- [[06_Rover_Traverse_Planning_and_DEM_Resolution]] — Singularity-free A* rover pathfinding, lunar terramechanics energetics, and 3-tier 16-bit NASA LOLA DEM resolution audit (`10 m/px` Site 01 patch + `16 ppd` Polar + `8 ppd` Global).

