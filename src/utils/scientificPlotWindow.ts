import { RoverParams, RoverTraversePlan, TraverseWaypoint } from '../types/lunar';

export interface PlotConfig {
  roverName: string;
  maxInclineDeg: number;
  minReserveSocPct: number;
  startLabel: string;
  endLabel: string;
  checkpoints: { lat: number; lon: number; label?: string }[];
  xAxis: 'distance' | 'time' | 'index';
  quantities: string[];
  theme: 'publication-white' | 'scientific-dark';
  showGrid: boolean;
  showThresholds: boolean;
  showCheckpoints: boolean;
  openNativeMatplotlib: boolean;
  openWebWindow: boolean;
  range: {
    startDistKm: number;
    endDistKm: number;
  };
}

export function openScientificPlotWindow(
  plan: RoverTraversePlan,
  roverParams: RoverParams,
  config: PlotConfig
) {
  const newWin = window.open('', '_blank', 'width=1280,height=880,menubar=no,toolbar=no,location=no,status=no');
  if (!newWin) {
    alert('Pop-up was blocked by browser. Please allow pop-ups for this site to view the scientific plot.');
    return;
  }

  // Filter waypoints by selected range
  const rawWps = plan.waypoints;
  const filteredWps = rawWps.filter(
    (w) =>
      w.cumDistanceKm >= config.range.startDistKm &&
      w.cumDistanceKm <= config.range.endDistKm
  );
  const wps: TraverseWaypoint[] = filteredWps.length >= 2 ? filteredWps : rawWps;

  const htmlContent = buildScientificHtml(plan, roverParams, config, wps);
  newWin.document.open();
  newWin.document.write(htmlContent);
  newWin.document.close();
}

function buildScientificHtml(
  plan: RoverTraversePlan,
  roverParams: RoverParams,
  config: PlotConfig,
  wps: TraverseWaypoint[]
): string {
  const isDark = config.theme === 'scientific-dark';
  const bgColor = isDark ? '#0b0f19' : '#ffffff';
  const surfaceColor = isDark ? '#111827' : '#f8fafc';
  const textColor = isDark ? '#f3f4f6' : '#0f172a';
  const mutedColor = isDark ? '#9ca3af' : '#64748b';
  const borderColor = isDark ? '#374151' : '#cbd5e1';

  // Serialize waypoint data for interactive probing in the new window
  const wpsJson = JSON.stringify(
    wps.map((w) => ({
      d: Number(w.cumDistanceKm.toFixed(3)),
      t: Number(w.elapsedHours.toFixed(2)),
      idx: w.index,
      z: Math.round(w.elevationKm * 1000),
      s: Number(w.slopeDeg.toFixed(1)),
      g: Number(w.gradeDeg.toFixed(1)),
      v: Number(w.speedKmh.toFixed(2)),
      soc: Number(w.batterySocPct.toFixed(1)),
      wh: Math.round(w.netEnergyUsedWh),
      tracWh: Math.round(w.tractionEnergyWh),
      solWh: Math.round(w.solarHarvestWh),
      comm: w.commLinked ? 1 : 0,
      sun: w.sunVisible ? 1 : 0,
      lat: Number(w.lat.toFixed(4)),
      lon: Number(w.lon.toFixed(4)),
      st: w.slopeStatus,
    }))
  );

  const configJson = JSON.stringify(config);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SELENE OPS • Plot Data — Scientific Telemetry (${roverParams.name})</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: ${bgColor};
      color: ${textColor};
      padding: 14px;
      font-size: 12px;
      line-height: 1.4;
      overflow-x: hidden;
    }
    .header-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 12px;
      border-bottom: 1.5px solid ${borderColor};
      margin-bottom: 12px;
    }
    .title-group h1 {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-family: monospace, sans-serif;
    }
    .title-group p {
      font-size: 11px;
      color: ${mutedColor};
      margin-top: 2px;
      font-family: monospace;
    }
    .btn-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    button.sci-btn {
      background: ${surfaceColor};
      color: ${textColor};
      border: 1px solid ${borderColor};
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 11px;
      font-family: monospace;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    button.sci-btn:hover {
      background: ${isDark ? '#1f2937' : '#e2e8f0'};
      border-color: ${isDark ? '#60a5fa' : '#3b82f6'};
    }
    button.sci-btn-primary {
      background: #0284c7;
      color: #ffffff;
      border-color: #0369a1;
    }
    button.sci-btn-primary:hover {
      background: #0369a1;
    }
    .probe-card {
      background: ${surfaceColor};
      border: 1px solid ${borderColor};
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-family: monospace;
      font-size: 11px;
    }
    .probe-item span.lbl { color: ${mutedColor}; margin-right: 4px; }
    .probe-item span.val { font-weight: 700; color: ${textColor}; }
    .plot-container {
      background: ${surfaceColor};
      border: 1px solid ${borderColor};
      border-radius: 6px;
      padding: 10px;
      position: relative;
    }
    svg.sci-svg {
      width: 100%;
      height: auto;
      display: block;
      cursor: crosshair;
      user-select: none;
    }
    .footer-notes {
      margin-top: 10px;
      font-size: 10px;
      color: ${mutedColor};
      font-family: monospace;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="title-group">
      <h1>SELENE OPS // Scientific Telemetry Analysis (${roverParams.name})</h1>
      <p>Traverse: ${config.startLabel} → ${config.endLabel} | Range: ${config.range.startDistKm.toFixed(1)} to ${Math.min(config.range.endDistKm, plan.totalDistanceKm).toFixed(1)} km (${wps.length} samples)</p>
    </div>
    <div class="btn-toolbar">
      <button class="sci-btn" onclick="exportSvg()">Save Vector SVG</button>
      <button class="sci-btn" onclick="exportPng()">Save PNG (300 DPI)</button>
      <button class="sci-btn" onclick="exportCsv()">Download CSV</button>
      <button class="sci-btn sci-btn-primary" onclick="launchMatplotlibNative()">Open Python Matplotlib (TkAgg)</button>
      <button class="sci-btn" onclick="window.print()">Print</button>
    </div>
  </div>

  <!-- Live Hover Crosshair Telemetry Probe -->
  <div class="probe-card" id="probeCard">
    <div class="probe-item"><span class="lbl">Cursor Dist:</span><span class="val" id="prDist">Hover plot...</span></div>
    <div class="probe-item"><span class="lbl">Elapsed:</span><span class="val" id="prHours">--</span></div>
    <div class="probe-item"><span class="lbl">Elevation:</span><span class="val" id="prElev" style="color:#0284c7">--</span></div>
    <div class="probe-item"><span class="lbl">Slope:</span><span class="val" id="prSlope" style="color:#d97706">--</span></div>
    <div class="probe-item"><span class="lbl">SoC:</span><span class="val" id="prSoc" style="color:#10b981">--</span></div>
    <div class="probe-item"><span class="lbl">Speed:</span><span class="val" id="prSpeed">--</span></div>
    <div class="probe-item"><span class="lbl">Net Wh:</span><span class="val" id="prEnergy">--</span></div>
    <div class="probe-item"><span class="lbl">Comm/Sun:</span><span class="val" id="prComm">--</span></div>
  </div>

  <div class="plot-container">
    <svg id="sciSvg" class="sci-svg" viewBox="0 0 1100 ${Math.max(380, config.quantities.length * 145 + 50)}"></svg>
  </div>

  <div class="footer-notes">
    <span>NASA LOLA DEM 16-bit Topographic Ray-Tracing • Rover Mass: ${roverParams.massKg} kg • Limit Incline: ${config.maxInclineDeg}°</span>
    <span>Generated by SELENE OPS • Matplotlib & SVG Scientific Engine</span>
  </div>

  <script>
    const wps = ${wpsJson};
    const config = ${configJson};

    const quantities = config.quantities || ['elevation', 'slope', 'soc'];
    const totalPanels = quantities.length;
    const panelH = 135;
    const padTop = 20;
    const padBot = 40;
    const padLeft = 85;
    const padRight = 35;
    const W = 1100;
    const plotW = W - padLeft - padRight;
    const totalH = padTop + totalPanels * panelH + padBot;

    const svg = document.getElementById('sciSvg');
    svg.setAttribute('viewBox', \`0 0 \${W} \${totalH}\`);

    const xVals = wps.map(w => config.xAxis === 'time' ? w.t : (config.xAxis === 'index' ? w.idx : w.d));
    const minX = xVals[0];
    const maxX = xVals[xVals.length - 1] || 1;
    const xSpan = Math.max(1e-4, maxX - minX);

    function mapX(val) {
      return padLeft + ((val - minX) / xSpan) * plotW;
    }

    let svgHtml = '';

    // Quantity specifications
    const qtyDefs = {
      elevation: {
        label: 'Elevation z (m)',
        color: '${isDark ? '#38bdf8' : '#0284c7'}',
        getVal: w => w.z,
        unit: 'm',
        threshold: null
      },
      slope: {
        label: 'Slope θ (deg)',
        color: '${isDark ? '#f59e0b' : '#d97706'}',
        getVal: w => w.s,
        unit: '°',
        threshold: config.maxInclineDeg,
        thresholdLabel: 'Max Incline (' + config.maxInclineDeg + '°)'
      },
      grade: {
        label: 'Longitudinal Grade (%)',
        color: '#8b5cf6',
        getVal: w => w.g,
        unit: '%',
        threshold: 0,
        thresholdLabel: 'Zero Grade'
      },
      soc: {
        label: 'Battery SoC (%)',
        color: '#10b981',
        getVal: w => w.soc,
        unit: '%',
        threshold: config.minReserveSocPct,
        thresholdLabel: 'Reserve SoC Floor (' + config.minReserveSocPct + '%)'
      },
      energy: {
        label: 'Net Energy (Wh)',
        color: '#ea580c',
        getVal: w => w.wh,
        unit: 'Wh',
        threshold: null
      },
      speed: {
        label: 'Speed (km/h)',
        color: '#06b6d4',
        getVal: w => w.v,
        unit: 'km/h',
        threshold: null
      },
      comm: {
        label: 'Comms / Sun LOS',
        color: '#3b82f6',
        getVal: w => w.comm,
        unit: '',
        threshold: null
      }
    };

    // Render panels
    quantities.forEach((qId, pIdx) => {
      const def = qtyDefs[qId] || qtyDefs.elevation;
      const py0 = padTop + pIdx * panelH;
      const py1 = py0 + panelH - 18;
      const subH = py1 - py0;

      const vals = wps.map(def.getVal);
      let minV = Math.min(...vals);
      let maxV = Math.max(...vals);
      if (qId === 'soc') { minV = 0; maxV = 100; }
      if (qId === 'slope') { minV = 0; maxV = Math.max(maxV + 2, config.maxInclineDeg * 1.25); }
      if (qId === 'comm') { minV = 0; maxV = 1.1; }
      if (maxV === minV) maxV += 1;
      const vSpan = maxV - minV;

      function mapY(v) {
        return py1 - ((v - minV) / vSpan) * subH;
      }

      // Panel background & frame
      svgHtml += \`<rect x="\${padLeft}" y="\${py0}" width="\${plotW}" height="\${subH}" fill="${isDark ? '#090d16' : '#ffffff'}" stroke="${borderColor}" stroke-width="1"/>\`;

      // Horizontal gridlines (4 ticks per panel)
      for (let t = 0; t <= 4; t++) {
        const tv = minV + (t / 4) * vSpan;
        const ty = mapY(tv);
        svgHtml += \`<line x1="\${padLeft}" y1="\${ty}" x2="\${padLeft + plotW}" y2="\${ty}" stroke="${borderColor}" stroke-width="0.7" stroke-dasharray="3,3" opacity="0.6"/>\`;
        svgHtml += \`<text x="\${padLeft - 8}" y="\${ty + 3.5}" text-anchor="end" font-size="9" fill="${mutedColor}" font-family="monospace">\${tv.toFixed(qId === 'soc' || qId === 'elevation' || qId === 'energy' ? 0 : 1)}\${def.unit}</text>\`;
      }

      // Threshold line
      if (config.showThresholds && def.threshold !== null && def.threshold >= minV && def.threshold <= maxV) {
        const thY = mapY(def.threshold);
        svgHtml += \`<line x1="\${padLeft}" y1="\${thY}" x2="\${padLeft + plotW}" y2="\${thY}" stroke="#dc2626" stroke-width="1.3" stroke-dasharray="5,3"/>\`;
        svgHtml += \`<text x="\${padLeft + plotW - 6}" y="\${thY - 4}" text-anchor="end" font-size="8.5" fill="#dc2626" font-family="monospace" font-weight="bold">\${def.thresholdLabel}</text>\`;
      }

      // Curve polyline
      if (qId === 'comm') {
        // Step blocks for comms
        wps.forEach((w, wi) => {
          if (wi === wps.length - 1) return;
          const x0 = mapX(xVals[wi]);
          const x1 = mapX(xVals[wi + 1]);
          const bw = Math.max(1, x1 - x0);
          if (w.comm === 1) {
            svgHtml += \`<rect x="\${x0}" y="\${py0 + subH * 0.1}" width="\${bw}" height="\${subH * 0.45}" fill="#06b6d4" opacity="0.75"/>\`;
          } else {
            svgHtml += \`<rect x="\${x0}" y="\${py0 + subH * 0.1}" width="\${bw}" height="\${subH * 0.45}" fill="#ef4444" opacity="0.45"/>\`;
          }
          if (w.sun === 1) {
            svgHtml += \`<rect x="\${x0}" y="\${py0 + subH * 0.6}" width="\${bw}" height="\${subH * 0.3}" fill="#facc15" opacity="0.8"/>\`;
          } else {
            svgHtml += \`<rect x="\${x0}" y="\${py0 + subH * 0.6}" width="\${bw}" height="\${subH * 0.3}" fill="#334155" opacity="0.5"/>\`;
          }
        });
      } else {
        const pts = wps.map((w, wi) => \`\${mapX(xVals[wi]).toFixed(1)},\${mapY(vals[wi]).toFixed(1)}\`).join(' ');
        if (qId === 'elevation') {
          const areaPts = \`\${mapX(xVals[0])},\${py1} \${pts} \${mapX(xVals[xVals.length - 1])},\${py1}\`;
          svgHtml += \`<polygon points="\${areaPts}" fill="\${def.color}" fill-opacity="0.12"/>\`;
        }
        svgHtml += \`<polyline fill="none" stroke="\${def.color}" stroke-width="1.8" points="\${pts}"/>\`;
      }

      // Checkpoint vertical markers
      if (config.showCheckpoints && config.checkpoints && config.checkpoints.length > 0) {
        config.checkpoints.forEach((cp, ci) => {
          // find closest point
          let bestD = Infinity;
          let bestIdx = 0;
          wps.forEach((w, wi) => {
            const d = Math.hypot(w.lat - cp.lat, w.lon - cp.lon);
            if (d < bestD) { bestD = d; bestIdx = wi; }
          });
          const cpx = mapX(xVals[bestIdx]);
          svgHtml += \`<line x1="\${cpx}" y1="\${py0}" x2="\${cpx}" y2="\${py1}" stroke="#06b6d4" stroke-width="1" stroke-dasharray="4,2.5" opacity="0.6"/>\`;
          if (pIdx === 0) {
            svgHtml += \`<text x="\${cpx + 3}" y="\${py0 + 10}" font-size="8" fill="#06b6d4" font-family="monospace" font-weight="bold">\${cp.label || 'CP' + (ci+1)}</text>\`;
          }
        });
      }

      // Panel Y-Axis Label
      svgHtml += \`<text x="\${padLeft + 8}" y="\${py0 + 14}" font-size="10" font-weight="bold" fill="\${def.color}" font-family="monospace">\${def.label}</text>\`;
    });

    // Bottom X-Axis line and ticks
    const botY = padTop + totalPanels * panelH - 18;
    svgHtml += \`<line x1="\${padLeft}" y1="\${botY}" x2="\${padLeft + plotW}" y2="\${botY}" stroke="${textColor}" stroke-width="1.2"/>\`;

    const numXTicks = 8;
    for (let i = 0; i <= numXTicks; i++) {
      const frac = i / numXTicks;
      const xv = minX + frac * xSpan;
      const xx = mapX(xv);
      svgHtml += \`<line x1="\${xx}" y1="\${botY}" x2="\${xx}" y2="\${botY + 5}" stroke="${textColor}" stroke-width="1"/>\`;
      svgHtml += \`<text x="\${xx}" y="\${botY + 18}" text-anchor="middle" font-size="9.5" fill="${textColor}" font-family="monospace">\${xv.toFixed(1)}</text>\`;
    }

    const xTitle = config.xAxis === 'time'
      ? 'Mission Elapsed Time (Hours T+)'
      : (config.xAxis === 'index' ? 'Waypoint Sample Index' : 'Cumulative Traverse Distance (km)');
    svgHtml += \`<text x="\${padLeft + plotW / 2}" y="\${totalH - 8}" text-anchor="middle" font-size="11" font-weight="bold" fill="${textColor}" font-family="monospace">\${xTitle}</text>\`;

    // Crosshair line placeholder
    svgHtml += \`<line id="crosshairLine" x1="0" y1="\${padTop}" x2="0" y2="\${botY}" stroke="#eab308" stroke-width="1.2" stroke-dasharray="3,2" style="display:none; pointer-events:none;"/>\`;

    svg.innerHTML = svgHtml;

    // Interactive Hover Probing
    const crosshair = document.getElementById('crosshairLine');
    svg.addEventListener('mousemove', e => {
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const scale = W / rect.width;
      const svgX = mouseX * scale;

      if (svgX >= padLeft && svgX <= padLeft + plotW) {
        crosshair.style.display = 'block';
        crosshair.setAttribute('x1', svgX);
        crosshair.setAttribute('x2', svgX);

        // find closest sample
        const frac = (svgX - padLeft) / plotW;
        const targetX = minX + frac * xSpan;
        let closestIdx = 0;
        let minDiff = Infinity;
        xVals.forEach((xv, wi) => {
          const diff = Math.abs(xv - targetX);
          if (diff < minDiff) { minDiff = diff; closestIdx = wi; }
        });

        const cur = wps[closestIdx];
        if (cur) {
          document.getElementById('prDist').innerText = cur.d + ' km';
          document.getElementById('prHours').innerText = 'T+' + cur.t + 'h';
          document.getElementById('prElev').innerText = cur.z + ' m';
          document.getElementById('prSlope').innerText = cur.s + '°';
          document.getElementById('prSoc').innerText = cur.soc + '%';
          document.getElementById('prSpeed').innerText = cur.v + ' km/h';
          document.getElementById('prEnergy').innerText = cur.wh + ' Wh';
          document.getElementById('prComm').innerText = (cur.comm === 1 ? 'LOCKED' : 'OCCULTED') + ' / ' + (cur.sun === 1 ? 'SUN' : 'SHADOW');
        }
      } else {
        crosshair.style.display = 'none';
      }
    });

    svg.addEventListener('mouseleave', () => {
      crosshair.style.display = 'none';
    });

    // Export Utilities
    function exportSvg() {
      const clone = svg.cloneNode(true);
      const ch = clone.querySelector('#crosshairLine');
      if (ch) ch.remove();
      const serializer = new XMLSerializer();
      const source = serializer.serializeToString(clone);
      const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'selene_ops_telemetry_plot.svg';
      a.click();
      URL.revokeObjectURL(url);
    }

    function exportPng() {
      const clone = svg.cloneNode(true);
      const ch = clone.querySelector('#crosshairLine');
      if (ch) ch.remove();
      const serializer = new XMLSerializer();
      const source = serializer.serializeToString(clone);
      const img = new Image();
      const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = W * 2;
        canvas.height = totalH * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '${bgColor}';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'selene_ops_telemetry_plot_300dpi.png';
        a.click();
      };
      img.src = url;
    }

    function exportCsv() {
      const headers = ['index', 'cumDistanceKm', 'elapsedHours', 'elevationM', 'slopeDeg', 'gradeDeg', 'speedKmh', 'batterySocPct', 'netEnergyUsedWh', 'commLinked', 'sunVisible', 'lat', 'lon'];
      let csv = headers.join(',') + '\\n';
      wps.forEach(w => {
        csv += [w.idx, w.d, w.t, w.z, w.s, w.g, w.v, w.soc, w.wh, w.comm, w.sun, w.lat, w.lon].join(',') + '\\n';
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'selene_ops_telemetry_data.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    async function launchMatplotlibNative() {
      try {
        const payload = {
          ...config,
          waypoints: wps
        };
        const res = await fetch('/api/plot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const resJson = await res.json();
        if (resJson.success) {
          alert('Native Matplotlib GUI Window launched on Desktop!');
        } else {
          alert('Failed to launch Matplotlib: ' + (resJson.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Could not connect to /api/plot server endpoint: ' + err.message);
      }
    }
  </script>
</body>
</html>`;
}

