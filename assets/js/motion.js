// 高校物理攻略 — 動きのシミュレータ（試作 v0.3：単振動 追加）
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

// --- 自由落下・鉛直投げ上げ（v0.2）---
// 自由落下：高さ h0 から初速度 0 で落とす。y は地面からの高さ、vy は上向き正。
function freeFallAt(h0, t) {
  return { y: h0 - 0.5 * G * t * t, vy: -G * t, t };
}
function fallTime(h0) { return Math.sqrt((2 * h0) / G); }
function impactSpeed(h0) { return Math.sqrt(2 * G * h0); }
// 鉛直投げ上げ：地面から初速度 v0 で真上に投げる。projectileAt(v0, 90°, t) と同じ式。
function verticalThrowAt(v0, t) {
  return { y: v0 * t - 0.5 * G * t * t, vy: v0 - G * t, t };
}
function verticalThrowTable(v0, dt) {
  const out = [];
  const T = (2 * v0) / G;
  for (let t = 0; t <= T + 1e-9; t += dt) out.push(verticalThrowAt(v0, t));
  return out;
}
function freeFallTable(h0, dt) {
  const out = [];
  const T = fallTime(h0);
  for (let t = 0; t <= T + 1e-9; t += dt) out.push(freeFallAt(h0, t));
  return out;
}

// --- 単振動（v0.3）---
// ばねの単振動：x = A cos ωt、v = −Aω sin ωt。t=0 で最大の変位、速さ 0。
function shmAt(omega, amplitudeM, t) {
  return { x: amplitudeM * Math.cos(omega * t), v: -amplitudeM * omega * Math.sin(omega * t), t };
}
function shmPeriod(omega) { return (2 * Math.PI) / omega; }
function shmTable(omega, amplitudeM, dt) {
  const out = [];
  const T = shmPeriod(omega);
  for (let t = 0; t <= T + 1e-9; t += dt) out.push(shmAt(omega, amplitudeM, t));
  return out;
}
// 単振り子（小さい振れ角）：θ = θ0 cos ωt、ω = √(g/L)。
function pendulumAt(lengthM, theta0Rad, t, g) {
  const gg = g || G;
  const omega = Math.sqrt(gg / lengthM);
  return { theta: theta0Rad * Math.cos(omega * t), omegaAngular: -theta0Rad * omega * Math.sin(omega * t), omega, t };
}
function pendulumPeriod(lengthM, g) { return 2 * Math.PI * Math.sqrt(lengthM / (g || G)); }

if (typeof module !== 'undefined') module.exports = { G, projectileAt, maxHeight, range, flightTime, trajectoryTable, freeFallAt, fallTime, impactSpeed, verticalThrowAt, verticalThrowTable, freeFallTable, shmAt, shmPeriod, shmTable, pendulumAt, pendulumPeriod };
