#!/usr/bin/env python3
"""高校物理攻略 — UNIX ツール：単振動と単振り子の表を JSON / CSV で出す。

site-starter/assets/js/motion.js の shmAt / pendulumAt と同じ計算。
ドリルの数字と一致することを確かめるための検算用。

使い方：
  python3 tools/shm_data.py [--json out.json] [--csv out.csv]
"""
import argparse
import csv
import json
import math
import sys


def shm_at(omega, amplitude_m, t):
    return {"t": t, "x": amplitude_m * math.cos(omega * t),
            "v": -amplitude_m * omega * math.sin(omega * t)}


def shm_table(omega, amplitude_m, dt):
    period = 2 * math.pi / omega
    out, t = [], 0.0
    while t <= period + 1e-9:
        out.append(shm_at(omega, amplitude_m, t))
        t += dt
    return out


def pendulum_period(length_m, g=10.0):
    return 2 * math.pi * math.sqrt(length_m / g)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None)
    ap.add_argument("--csv", default=None)
    args = ap.parse_args()

    # 第11問の数字：m=1.0 kg、k=100 N/m → ω=10 rad/s、T≈0.63 s
    omega = math.sqrt(100 / 1.0)
    data = {
        "spring": {
            "omega_rad_s": omega,
            "period_s": 2 * math.pi / omega,
            "freq_hz": omega / (2 * math.pi),
            "v_max_A010_ms": omega * 0.10,
            "v_max_A020_ms": omega * 0.20,
            "a_max_A010_ms2": omega * omega * 0.10,
            "points_A010_dt01": shm_table(omega, 0.10, 0.1),
        },
        "pendulum": {
            "length_m": 1.0,
            "g": 10.0,
            "omega_rad_s": math.sqrt(10.0 / 1.0),
            "period_s_g10": pendulum_period(1.0, 10.0),
            "period_s_g98": pendulum_period(1.0, 9.8),
            "theta0_deg": 5.0,
            "arc_m": 1.0 * math.radians(5.0),
            "v_max_ms": math.sqrt(10.0 / 1.0) * 1.0 * math.radians(5.0),
        },
    }
    # 検算（JS と同じ式のはず）：
    assert abs(data["spring"]["period_s"] - 0.6283185307179586) < 1e-9
    assert abs(data["pendulum"]["period_s_g10"] - 1.98691765315922) < 1e-9
    assert abs(data["spring"]["v_max_A010_ms"] - 1.0) < 1e-9
    assert abs(data["spring"]["v_max_A020_ms"] - 2.0) < 1e-9

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    if args.csv:
        with open(args.csv, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["t", "x", "v"])
            for p in data["spring"]["points_A010_dt01"]:
                w.writerow([f"{p['t']:.2f}", f"{p['x']:.4f}", f"{p['v']:.4f}"])
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "points_A010_dt01"}
                      for k, v in data.items()}, indent=2, ensure_ascii=False))
    print("points:", len(data["spring"]["points_A010_dt01"]), "(dt=0.1 s, 1 period)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
