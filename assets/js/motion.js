// 高校物理攻略 — 動きのシミュレータ（試作 v0.1：投げ上げ・斜方投射）
// 教科書では見られない、Web の優位性は「動き」そのもの。
// このファイルは物理の計算だけをする。描画は projectile.html 側。
// ループ再生：ボールが画面外に出るか、地面に戻ったら、最初から始める。
// g = 9.8 m/s^2、空気抵抗なし。
const G = 9.8;

function deg2rad(d) { return (d * Math.PI) / 180; }

// t 秒後の位置・速度。v0: m/s、angleDeg: 水平からの角度（90°で真上）。
function projectileAt(v0, angleDeg, t) {
  const a = deg2rad(angleDeg);
  const vx = v0 * Math.cos(a);
  const vy0 = v0 * Math.sin(a);
  return {
    x: vx * t,
    y: vy0 * t - 0.5 * G * t * t,
    vx,
    vy: vy0 - G * t,
    t,
  };
}

function maxHeight(v0, angleDeg) {
  const vy0 = v0 * Math.sin(deg2rad(angleDeg));
  return (vy0 * vy0) / (2 * G);
}

function range(v0, angleDeg) {
  return (v0 * v0 * Math.sin(2 * deg2rad(angleDeg))) / G;
}

function flightTime(v0, angleDeg) {
  return (2 * v0 * Math.sin(deg2rad(angleDeg))) / G;
}

// 軌跡の表を作る（UNIX ツールや JSON 出力と共通の計算）。
function trajectoryTable(v0, angleDeg, dt) {
  const out = [];
  const T = flightTime(v0, angleDeg);
  for (let t = 0; t <= T + 1e-9; t += dt) out.push(projectileAt(v0, angleDeg, t));
  return out;
}

if (typeof module !== 'undefined') module.exports = { G, projectileAt, maxHeight, range, flightTime, trajectoryTable };
