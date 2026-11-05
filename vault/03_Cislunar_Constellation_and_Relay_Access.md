# Active Cislunar Constellation & Relay Access

Related: [[00_SELENE_OPS_Challenge_Overview]] | [[01_Selenographic_Physics_and_Ephemeris]]

`SELENE OPS` propagates 5 operational & pathfinder lunar spacecraft to answer **what each satellite can access, at what link rate, and during which exact UTC windows**:

| Spacecraft | Agency | Orbit ($h_p \times h_a$, $i$, $T$) | Relay? | Peak Link | Primary Sensors & Access Capabilities |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **LRO** | NASA | $36 \times 64\text{ km}$, $89.7^\circ$, $1.88\text{ h}$ | Recon | $100\text{ Mbps}$ | LROC NAC ($0.5\text{ m/px}$ hazard imaging), LOLA altimetry, Diviner thermal IR, S/Ka ranging. |
| **Danuri (KPLO)** | KARI / NASA | $80 \times 100\text{ km}$, $89.9^\circ$, $1.96\text{ h}$ | DTN | $8.5\text{ Mbps}$ | **ShadowCam** ($200\times$ sensitivity PSR interior imaging), PolCam, KGRS gamma-ray, Space Internet DTN. |
| **Queqiao-2** | CNSA | $254 \times 16,941\text{ km}$, $54.8^\circ$, $24.0\text{ h}$ | **Yes** | $250\text{ Mbps}$ | $4.2\text{ m}$ X-band & UHF parabolic dish; frozen southern apolune provides $\sim 18\text{ h/day}$ South-Pole & Far-Side relay. |
| **CAPSTONE / NRHO** | NASA / AdvSpace | $1,550 \times 70,000\text{ km}$, $86.5^\circ$, $6.56\text{ d}$ | **Yes** | $64\text{ Mbps}$ | 9:2 resonant Southern Near-Rectilinear Halo Orbit (Gateway pathfinder); multi-day near-zenith South-Pole dwell & CAPS PNT. |
| **Lunar Pathfinder** | ESA / SSTL | $710 \times 5,740\text{ km}$, $57.7^\circ$, $8.0\text{ h}$ | **Yes** | $48\text{ Mbps}$ | Commercial CLPS/Moonlight UHF & S-band proximity link + X-band Earth trunk + NaviMoon PNT receiver. |

