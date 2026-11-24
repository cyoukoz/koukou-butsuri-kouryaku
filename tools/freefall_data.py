#!/usr/bin/env python3
"""UNIX ツール：自由落下・鉛直投げ上げのデータを計算して JSON / CSV に出す。

使い方:
  python3 tools/freefall_data.py --mode fall --h0 20 --dt 0.1
  python3 tools/freefall_data.py --mode throw --v0 10 --dt 0.1 --out /tmp/freefall.json
  python3 tools/freefall_data.py --mode fall --h0 20 --out /tmp/freefall.csv

サイトの motion.js と同じ式（g=9.8、空気抵抗なし）を使うので、
UNIX 側で作ったデータと、サイトで見せる動きが一致する。
出力した JSON は、サイトの「データを JSON で出す」と同じ形。
"""
import argparse, csv, json, math, sys

G = 9.8

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["fall", "throw"], default="fall")
    ap.add_argument("--h0", type=float, default=20)
    ap.add_argument("--v0", type=float, default=10)
    ap.add_argument("--dt", type=float, default=0.1)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    rows = []
    if args.mode == "fall":
        t_max = math.sqrt(2 * args.h0 / G)
        t = 0.0
        while t <= t_max + 1e-9:
            rows.append({
                "t": round(t, 3),
                "y": round(max(0.0, args.h0 - 0.5 * G * t * t), 3),
                "vy": round(-G * t, 3),
            })
            t += args.dt
        data = {
            "mode": "freeFall", "h0": args.h0, "g": G,
            "fallTime": round(t_max, 3),
            "impactSpeed": round(math.sqrt(2 * G * args.h0), 3),
            "points": rows,
        }
        summary = f"落下時間 {data['fallTime']} s、地面での速さ {data['impactSpeed']} m/s、{len(rows)} 点"
    else:
        t_max = 2 * args.v0 / G
        t = 0.0
        while t <= t_max + 1e-9:
            rows.append({
                "t": round(t, 3),
                "y": round(max(0.0, args.v0 * t - 0.5 * G * t * t), 3),
                "vy": round(args.v0 - G * t, 3),
            })
            t += args.dt
        data = {
            "mode": "verticalThrow", "v0": args.v0, "g": G,
            "maxHeight": round(args.v0 * args.v0 / (2 * G), 3),
            "flightTime": round(t_max, 3),
            "points": rows,
        }
        summary = f"最高点 {data['maxHeight']} m、滞空 {data['flightTime']} s、{len(rows)} 点"
    if args.out.endswith(".csv"):
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["t", "y", "vy"])
            w.writeheader(); w.writerows(rows)
    elif args.out:
        with open(args.out, "w") as f:
            json.dump(data, f, indent=2)
    else:
        json.dump(data, sys.stdout, indent=2)
    print(summary, file=sys.stderr)

if __name__ == "__main__":
    main()
