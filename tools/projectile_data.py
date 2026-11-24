#!/usr/bin/env python3
"""UNIX ツールの例：投げ上げ運動の軌跡データを計算して JSON / CSV に出す。

使い方:
  python3 tools/projectile_data.py --v0 20 --angle 60 --dt 0.1
  python3 tools/projectile_data.py --v0 20 --angle 90 --dt 0.05 --out /tmp/projectile.csv

サイトの motion.js と同じ式（g=9.8、空気抵抗なし）を使うので、
UNIX 側で作ったデータと、サイトで見せる動きが一致する。
出力した JSON は、サイトの「軌跡を JSON で出す」と同じ形。
"""
import argparse, csv, json, math, sys

G = 9.8

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--v0", type=float, default=20)
    ap.add_argument("--angle", type=float, default=60)
    ap.add_argument("--dt", type=float, default=0.1)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    a = math.radians(args.angle)
    vx = args.v0 * math.cos(a)
    vy0 = args.v0 * math.sin(a)
    t_max = 2 * vy0 / G
    rows = []
    t = 0.0
    while t <= t_max + 1e-9:
        rows.append({
            "t": round(t, 3),
            "x": round(vx * t, 3),
            "y": round(max(0.0, vy0 * t - 0.5 * G * t * t), 3),
            "vx": round(vx, 3),
            "vy": round(vy0 - G * t, 3),
        })
        t += args.dt
    data = {
        "v0": args.v0, "angleDeg": args.angle, "g": G,
        "maxHeight": round(vy0 * vy0 / (2 * G), 3),
        "range": round(args.v0 * args.v0 * math.sin(2 * a) / G, 3),
        "flightTime": round(t_max, 3),
        "points": rows,
    }
    if args.out.endswith(".csv"):
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["t", "x", "y", "vx", "vy"])
            w.writeheader(); w.writerows(rows)
    elif args.out:
        with open(args.out, "w") as f:
            json.dump(data, f, indent=2)
    else:
        json.dump(data, sys.stdout, indent=2)
    print(f"最高点 {data['maxHeight']} m、飛距離 {data['range']} m、滞空 {data['flightTime']} s、{len(rows)} 点", file=sys.stderr)

if __name__ == "__main__":
    main()
