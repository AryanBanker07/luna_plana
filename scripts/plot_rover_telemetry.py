"""
SELENE OPS — Scientific Matplotlib Rover Telemetry Plotter
NASA Space Apps 2026: Lunar Landing Site Navigator
Generates publication-grade, interactive scientific multi-panel plots
from lunar rover traverse simulation telemetry.
"""

import sys
import os
import json
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
from matplotlib.patches import Patch
from matplotlib.lines import Line2D

# Ensure TkAgg is preferred for interactive window, fallback to Qt or Agg if needed
try:
    matplotlib.use('TkAgg')
except Exception:
    pass

def load_telemetry(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def generate_scientific_plot(data, save_path=None, show_gui=True):
    waypoints = data.get('waypoints', [])
    if len(waypoints) < 2:
        print("[Plotter Error] Less than 2 waypoints provided.")
        return

    rover_name = data.get('roverName', 'Lunar Rover')
    max_incline = data.get('maxInclineDeg', 20.0)
    min_soc = data.get('minReserveSocPct', 15.0)
    start_label = data.get('startLabel', 'Start [A]')
    end_label = data.get('endLabel', 'Goal [B]')
    checkpoints = data.get('checkpoints', [])
    x_axis_mode = data.get('xAxis', 'distance') # 'distance' | 'time' | 'index'
    quantities = data.get('quantities', ['elevation', 'slope', 'soc'])
    theme = data.get('theme', 'publication-white') # 'publication-white' | 'scientific-dark'
    show_grid = data.get('showGrid', True)
    show_thresholds = data.get('showThresholds', True)
    show_checkpoints = data.get('showCheckpoints', True)

    # Filter by range if specified
    range_cfg = data.get('range', {})
    start_km = range_cfg.get('startDistKm', 0.0)
    end_km = range_cfg.get('endDistKm', float('inf'))
    
    filtered_wps = [w for w in waypoints if start_km <= w.get('cumDistanceKm', 0.0) <= end_km]
    if len(filtered_wps) < 2:
        filtered_wps = waypoints # fallback

    # Extract arrays
    dist_km = np.array([w.get('cumDistanceKm', 0.0) for w in filtered_wps])
    hours = np.array([w.get('elapsedHours', 0.0) for w in filtered_wps])
    indices = np.array([w.get('index', i) for i, w in enumerate(filtered_wps)])
    elev_m = np.array([w.get('elevationKm', 0.0) * 1000.0 for w in filtered_wps])
    elev_km = elev_m / 1000.0
    slope_deg = np.array([w.get('slopeDeg', 0.0) for w in filtered_wps])
    grade_deg = np.array([w.get('gradeDeg', 0.0) for w in filtered_wps])
    grade_pct = np.tan(np.radians(grade_deg)) * 100.0
    speed_kmh = np.array([w.get('speedKmh', 0.0) for w in filtered_wps])
    soc_pct = np.array([w.get('batterySocPct', 100.0) for w in filtered_wps])
    net_energy_wh = np.array([w.get('netEnergyUsedWh', 0.0) for w in filtered_wps])
    traction_wh = np.array([w.get('tractionEnergyWh', 0.0) for w in filtered_wps])
    solar_wh = np.array([w.get('solarHarvestWh', 0.0) for w in filtered_wps])
    comm_linked = np.array([1 if w.get('commLinked', False) else 0 for w in filtered_wps])
    sun_visible = np.array([1 if w.get('sunVisible', False) else 0 for w in filtered_wps])

    # X-Axis Data Selection
    if x_axis_mode == 'time':
        x_data = hours
        x_label = 'Mission Elapsed Time (Hours from Touchdown)'
    elif x_axis_mode == 'index':
        x_data = indices
        x_label = 'Waypoint Sample Index'
    else:
        x_data = dist_km
        x_label = 'Cumulative Traverse Distance (km)'

    # Theme Styling (Function over Form, High Contrast)
    is_dark = (theme == 'scientific-dark')
    bg_color = '#0b0f19' if is_dark else '#ffffff'
    fig_bg = '#070a10' if is_dark else '#f8fafc'
    text_color = '#f1f5f9' if is_dark else '#0f172a'
    grid_color = '#334155' if is_dark else '#cbd5e1'
    spine_color = '#64748b' if is_dark else '#475569'

    plt.rcParams['font.family'] = 'sans-serif'
    plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Arial', 'Helvetica']
    plt.rcParams['axes.edgecolor'] = spine_color
    plt.rcParams['axes.labelcolor'] = text_color
    plt.rcParams['xtick.color'] = text_color
    plt.rcParams['ytick.color'] = text_color

    num_panels = max(1, len(quantities))
    fig, axes = plt.subplots(
        num_panels, 1, 
        sharex=True, 
        figsize=(12, max(4.0, num_panels * 2.3 + 1.2)),
        dpi=110,
        facecolor=fig_bg
    )
    if num_panels == 1:
        axes = [axes]

    fig.suptitle(
        f"SELENE OPS • Traverse Telemetry & Terramechanics Feasibility\n"
        f"Rover: {rover_name} | Route: {start_label} → {end_label} ({dist_km[-1]:.2f} km, T+{hours[-1]:.1f}h)",
        fontsize=12,
        fontweight='bold',
        color=text_color,
        y=0.99
    )

    for i, qty in enumerate(quantities):
        ax = axes[i]
        ax.set_facecolor(bg_color)
        if show_grid:
            ax.grid(True, which='major', linestyle='--', linewidth=0.6, color=grid_color, alpha=0.7)
            ax.grid(True, which='minor', linestyle=':', linewidth=0.4, color=grid_color, alpha=0.4)
            ax.minorticks_on()

        if qty == 'elevation':
            # Elevation Profile
            line_color = '#0284c7' if not is_dark else '#38bdf8'
            fill_color = '#0284c7' if not is_dark else '#0284c7'
            ax.plot(x_data, elev_m, color=line_color, linewidth=1.8, label='LOLA Surface Elevation (m)')
            ax.fill_between(x_data, np.min(elev_m), elev_m, color=fill_color, alpha=0.15)
            ax.set_ylabel('Elevation\nz (meters)', fontweight='semibold')
            
            # Secondary Y axis for km
            sec_ax = ax.secondary_yaxis('right', functions=(lambda m: m/1000.0, lambda km: km*1000.0))
            sec_ax.set_ylabel('z (km)', color=spine_color)
            sec_ax.tick_params(colors=spine_color)
            
            # Min / Max annotations
            min_idx = np.argmin(elev_m)
            max_idx = np.argmax(elev_m)
            ax.scatter([x_data[min_idx], x_data[max_idx]], [elev_m[min_idx], elev_m[max_idx]], color='#ef4444', s=25, zorder=5)
            ax.annotate(f"Min: {elev_m[min_idx]:.0f}m", (x_data[min_idx], elev_m[min_idx]), textcoords="offset points", xytext=(0, -12), ha='center', fontsize=8, color=text_color)
            ax.annotate(f"Peak: +{elev_m[max_idx]:.0f}m", (x_data[max_idx], elev_m[max_idx]), textcoords="offset points", xytext=(0, 6), ha='center', fontsize=8, color=text_color)
            ax.legend(loc='upper right', framealpha=0.85, fontsize=8)

        elif qty == 'slope':
            # Terrain Slope Magnitude
            line_color = '#d97706' if not is_dark else '#f59e0b'
            ax.plot(x_data, slope_deg, color=line_color, linewidth=1.6, label='Terrain Slope Hazard (deg)')
            if show_thresholds:
                ax.axhline(max_incline, color='#dc2626', linestyle='--', linewidth=1.4, label=f'Max Chassis Limit ({max_incline}°)')
                ax.axhline(max_incline * 0.8, color='#f59e0b', linestyle=':', linewidth=1.1, label=f'Slip Warning ({max_incline * 0.8:.1f}°)')
                # Shade violations
                ax.fill_between(x_data, max_incline, slope_deg, where=(slope_deg > max_incline), color='#dc2626', alpha=0.35, label='Violation Zone')
            ax.set_ylabel('Slope\nθ (deg)', fontweight='semibold')
            ax.set_ylim(bottom=0, top=max(max_incline * 1.35, np.max(slope_deg) + 2))
            ax.legend(loc='upper right', framealpha=0.85, fontsize=8)

        elif qty == 'grade':
            # Signed Longitudinal Grade
            line_color = '#8b5cf6' if not is_dark else '#a78bfa'
            ax.plot(x_data, grade_pct, color=line_color, linewidth=1.5, label='Longitudinal Grade (%)')
            ax.axhline(0, color=spine_color, linestyle='-', linewidth=0.8, alpha=0.8)
            ax.fill_between(x_data, 0, grade_pct, where=(grade_pct > 0), color='#f59e0b', alpha=0.2, label='Uphill (+) Traction')
            ax.fill_between(x_data, 0, grade_pct, where=(grade_pct < 0), color='#10b981', alpha=0.2, label='Downhill (-) Potential Regen')
            ax.set_ylabel('Grade\n(%)', fontweight='semibold')
            ax.legend(loc='upper right', framealpha=0.85, fontsize=8)

        elif qty == 'soc':
            # Battery State of Charge
            line_color = '#10b981' if not is_dark else '#34d399'
            ax.plot(x_data, soc_pct, color=line_color, linewidth=1.8, label='Battery State of Charge (%)')
            if show_thresholds:
                ax.axhline(min_soc, color='#ef4444', linestyle='--', linewidth=1.3, label=f'Flight Reserve Floor ({min_soc}%)')
                ax.fill_between(x_data, 0, min_soc, color='#ef4444', alpha=0.12)
            ax.set_ylabel('Battery\nSoC (%)', fontweight='semibold')
            ax.set_ylim(0, 105)
            ax.legend(loc='upper right', framealpha=0.85, fontsize=8)

        elif qty == 'energy':
            # Cumulative Net vs Solar Energy
            ax.plot(x_data, net_energy_wh, color='#ea580c', linewidth=1.6, label='Net Energy Draw (Wh)')
            ax.plot(x_data, traction_wh, color='#64748b', linestyle=':', linewidth=1.2, label='Gross Traction (Wh)')
            if np.max(solar_wh) > 0:
                ax.plot(x_data, solar_wh, color='#eab308', linewidth=1.4, label='Solar Harvest (Wh)')
            ax.set_ylabel('Energy\n(Wh)', fontweight='semibold')
            ax.legend(loc='upper left', framealpha=0.85, fontsize=8)

        elif qty == 'speed':
            # Speed derating
            ax.plot(x_data, speed_kmh, color='#06b6d4', linewidth=1.6, label='Travel Speed (km/h)')
            ax.set_ylabel('Speed\n(km/h)', fontweight='semibold')
            ax.set_ylim(bottom=0, top=max(5.0, np.max(speed_kmh) * 1.25))
            ax.legend(loc='upper right', framealpha=0.85, fontsize=8)

        elif qty == 'comm':
            # Comms & Solar LOS status bars
            ax.fill_between(x_data, 0, 1, where=(comm_linked == 1), color='#06b6d4', alpha=0.6, step='mid', label='Comm Locked (DTE/Relay)')
            ax.fill_between(x_data, 0, 1, where=(comm_linked == 0), color='#dc2626', alpha=0.45, step='mid', label='Comm Occulted')
            ax.plot(x_data, sun_visible * 0.45 + 0.5, color='#facc15', linewidth=1.2, drawstyle='steps-mid', label='Sunlit Deck (1=Yes, 0=Shadow)')
            ax.set_ylabel('Link Status\nBinary', fontweight='semibold')
            ax.set_yticks([0.25, 0.75])
            ax.set_yticklabels(['Occulted', 'Locked'])
            ax.set_ylim(0, 1.05)
            ax.legend(loc='upper right', framealpha=0.85, fontsize=8)

        # Plot checkpoints as vertical dashed reference pins across all subplots
        if show_checkpoints and len(checkpoints) > 0:
            for cp_idx, cp in enumerate(checkpoints):
                cp_lat = cp.get('lat', 0)
                cp_lon = cp.get('lon', 0)
                # Find closest waypoint
                dists = [np.hypot(w.get('lat', 0) - cp_lat, w.get('lon', 0) - cp_lon) for w in filtered_wps]
                closest_w = np.argmin(dists)
                cp_x = x_data[closest_w]
                ax.axvline(cp_x, color='#06b6d4', linestyle='-.', linewidth=1.1, alpha=0.65)
                if i == 0:
                    cp_label = cp.get('label', f"CP {cp_idx+1}")
                    ax.text(cp_x, ax.get_ylim()[1], f" {cp_label}", rotation=90, verticalalignment='top', fontsize=7.5, color='#06b6d4', fontweight='bold')

    # Bottom Axis Configuration
    axes[-1].set_xlabel(x_label, fontweight='bold', fontsize=10)
    axes[-1].set_xlim(x_data[0], x_data[-1])

    fig.tight_layout(rect=[0, 0.02, 1, 0.95])

    # Save to disk if path requested
    if save_path:
        os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
        plt.savefig(save_path, dpi=200, bbox_inches='tight', facecolor=fig.get_facecolor())
        print(f"[Plotter] Figure successfully saved to: {save_path}")

    # Launch Native Matplotlib TkAgg Interactive Window
    if show_gui:
        try:
            print("[Plotter] Launching Native Matplotlib Interactive Window...")
            plt.show()
        except Exception as e:
            print(f"[Plotter Warning] Could not open GUI window: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python plot_rover_telemetry.py <telemetry_json_path> [--no-gui] [--save <output.png>]")
        sys.exit(1)

    json_path = sys.argv[1]
    if not os.path.exists(json_path):
        print(f"Error: file not found: {json_path}")
        sys.exit(1)

    data = load_telemetry(json_path)
    
    show_gui = '--no-gui' not in sys.argv
    save_path = None
    if '--save' in sys.argv:
        save_idx = sys.argv.index('--save') + 1
        if save_idx < len(sys.argv):
            save_path = sys.argv[save_idx]

    generate_scientific_plot(data, save_path=save_path, show_gui=show_gui)

