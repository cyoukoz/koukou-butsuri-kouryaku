// 高校物理攻略 — 図描画シミュレータ（試作 v0.4：spring・pulley 追加）
// 方針：図は手書きの座標を直書きしない。入力は JSON の「物理データ」だけ。
// 描画側が角度・つり合いから矢印の向きと長さを計算する。
// だから mg sinθ が mg と同じ長さになる、θ が消える、ラベルが切れる、
// といった誤りが、計算で防げる。
//
// 入力データ（JSON）の例：content/mechanics/slope.json
//   { "type": "slope", "thetaDeg": 23.2, "mgPx": 60 }
// 描画側は thetaDeg から sinθ / cosθ を計算し、
//   重力 mg            = (0, +mgPx)
//   垂直抗力 N=mg cosθ = mgPx*cosθ × 斜面に垂直な単位ベクトル
//   摩擦力 f=mg sinθ   = mgPx*sinθ × 斜面に沿う単位ベクトル
//   mg sinθ（分解）    = 同じ長さ・斜面に沿って下向き
//   mg cosθ（分解）    = mgPx*cosθ × 斜面に垂直にめり込む単位ベクトル
// を出す。分解の2本の和が重力と一致すること（ベクトル和の検算）も
// validateScene() で確かめる。
//
// ラベルは SVG 内では短い名前だけ（「摩擦力」「重力 mg」など）。
// 長い説明は HTML の文章側に書く。これが文字切れの根本対策。
// それでもラベルが枠をはみ出しそうなら、描画側が自動で
// text-anchor を end にして枠内に収める。
//
// 3D への備え：このファイルは「データ（JSON）→ 描画（SVG）」を分離
// している。将来 Three.js などの 3D 描画に置き換えるときも、
// 入力 JSON の形（type / thetaDeg / mgPx / forces の意味）は変えず、
// 描画側だけを差し替えればよい。z 成分は forces の vector に
// 3番目の要素として足せる設計にしてある。

const SVGNS = 'http://www.w3.org/2000/svg';

function deg2rad(d) { return (d * Math.PI) / 180; }

// ---- 斜面：thetaDeg は斜面の傾き（度）。mgPx は重力 mg の矢印の長さ（px） ----
function slopeForces(thetaDeg, mgPx) {
  const t = deg2rad(thetaDeg);
  const s = Math.sin(t), c = Math.cos(t);
  // SVG は y が下向き。斜面は右上がり。
  // 斜面に沿って上向き：(cosθ, -sinθ)、斜面に垂直（外向き）：(-sinθ, -cosθ)
  const upSlope = [c, -s];
  const normalOut = [-s, -c];
  const downSlope = [-c, s];
  const intoSlope = [s, c];
  const mul = (v, k) => [v[0] * k, v[1] * k];
  return [
    { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, mgPx], dashed: false, labelDx: 6, labelDy: -6 },
    { id: 'normal', short: '垂直抗力', color: 'blue', vector: mul(normalOut, mgPx * c), dashed: false, labelDx: -6, labelDy: -10 },
    { id: 'friction', short: '摩擦力', color: 'purple', vector: mul(upSlope, mgPx * s), dashed: false, labelDx: 8, labelDy: -8 },
    { id: 'decompSin', short: 'mg sinθ', color: '#b00', vector: mul(downSlope, mgPx * s), dashed: true, labelDx: -8, labelDy: 16 },
    { id: 'decompCos', short: 'mg cosθ', color: '#b00', vector: mul(intoSlope, mgPx * c), dashed: true, labelDx: 8, labelDy: 14 },
  ];
}

// ---- 梯子：つり合いから計算する。mgPx は重力の長さ ----
// 梯子の両端 (80,80)-(280,260)、中心 (180,170)。
// 下端まわりのトルクのつり合いから、壁からの垂直抗力 = 摩擦力
//   = mg × (中心の水平距離 100) / (上端の高さ 180) = mg × 5/9
// 床からの垂直抗力 = mg。手書きで 60px にしていた壁・摩擦の矢印は
// 33px が正しい（従来は mg と同じ長さで、約1.8倍長すぎた）。
function ladderForces(mgPx) {
  const k = mgPx * (100 / 180);
  return [
    { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, mgPx], dashed: false, labelDx: 8, labelDy: -6 },
    { id: 'wall', short: '壁からの力', color: 'blue', vector: [k, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 80, y: 80 } },
    { id: 'floor', short: '床からの力', color: 'green', vector: [0, -mgPx], dashed: false, labelDx: 6, labelDy: -6, from: { x: 280, y: 260 } },
    { id: 'friction', short: '摩擦力', color: 'purple', vector: [-k, 0], dashed: false, labelDx: -8, labelDy: 14, from: { x: 280, y: 260 } },
  ];
}

// ---- 斜めに引く力：mgPx は重力の長さ、fPx は引く力 F の長さ ----
// 具体値（検算済み）：θ=30°, mg=60px, F=40px のとき
//   F cosθ ≈ 34.6, F sinθ = 20.0, N = mg − F sinθ = 40.0, 摩擦力 = F cosθ ≈ 34.6
// 力のつり合い：x 方向 34.6 − 34.6 = 0、y 方向 60 − 40 − 20 = 0。
// 旧 pull.html では矢印の長さが目安で、N は「少し短い」だけだった。
// ここでは N=40（mg の 2/3）と計算で出す。
function pullForces(thetaDeg, mgPx, fPx) {
  const t = deg2rad(thetaDeg);
  const s = Math.sin(t), c = Math.cos(t);
  const fCos = fPx * c, fSin = fPx * s;
  const nPx = mgPx - fSin;
  return [
    { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, mgPx], dashed: false, labelDx: 6, labelDy: -6 },
    { id: 'normal', short: '垂直抗力', color: 'blue', vector: [0, -nPx], dashed: false, labelDx: 6, labelDy: -6 },
    { id: 'pull', short: '引く力 F', color: '#d35400', vector: [fCos, -fSin], dashed: false, labelDx: 6, labelDy: -10 },
    { id: 'friction', short: '摩擦力', color: 'purple', vector: [-fCos, 0], dashed: false, labelDx: -8, labelDy: 14 },
    { id: 'decompCos', short: 'F cosθ', color: '#b00', vector: [fCos, 0], dashed: true, labelDx: 6, labelDy: 16 },
    // F sinθ は平行四辺形の形にするため、水平成分の先端から描く（ベクトルは [0, -fSin]）。
    { id: 'decompSin', short: 'F sinθ', color: '#b00', vector: [0, -fSin], dashed: true, labelDx: 6, labelDy: -6, from: { x: 200 + fCos, y: 215 } },
  ];
}

// ---- 2本の糸でつるす三力のつり合い：角度と mg だけを JSON から受け取り、張力をつり合いから計算する ----
// 具体値（検算済み）：左 60°、右 30°、mg=60px のとき
//   T1 ≈ 51.96 → 約 52.0、T2 = 30.0
//   水平：T1 cos60° ≈ 26.0 ＝ T2 cos30° ≈ 26.0
//   鉛直：T1 sin60° = 45.0、T2 sin30° = 15.0、合計 60.0 = mg
// 解法：T1 cos a = T2 cos b、T1 sin a + T2 sin b = mg を連立する。
//   T1 = mg / (sin a + cos a · tan b)、T2 = T1 cos a / cos b
function hangForces(thetaLeftDeg, thetaRightDeg, mgPx) {
  const a = deg2rad(thetaLeftDeg), b = deg2rad(thetaRightDeg);
  const t1 = mgPx / (Math.sin(a) + Math.cos(a) * Math.tan(b));
  const t2 = (t1 * Math.cos(a)) / Math.cos(b);
  const c1x = t1 * Math.cos(a), c1y = t1 * Math.sin(a);
  const c2x = t2 * Math.cos(b), c2y = t2 * Math.sin(b);
  const cx = 180, cy = 180;
  return [
    { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, mgPx], dashed: false, labelDx: 6, labelDy: -6 },
    { id: 'tension1', short: '左の張力 T1', color: 'blue', vector: [-c1x, -c1y], dashed: false, labelDx: -8, labelDy: -8 },
    { id: 'tension2', short: '右の張力 T2', color: 'green', vector: [c2x, -c2y], dashed: false, labelDx: 6, labelDy: -10 },
    { id: 'decompT1x', short: 'T1 cos60°', color: '#b00', vector: [-c1x, 0], dashed: true, labelDx: -8, labelDy: 16 },
    { id: 'decompT1y', short: 'T1 sin60°', color: '#b00', vector: [0, -c1y], dashed: true, labelDx: -8, labelDy: -6, from: { x: cx - c1x, y: cy } },
    { id: 'decompT2x', short: 'T2 cos30°', color: '#b00', vector: [c2x, 0], dashed: true, labelDx: 6, labelDy: 16 },
    { id: 'decompT2y', short: 'T2 sin30°', color: '#b00', vector: [0, -c2y], dashed: true, labelDx: 6, labelDy: -6, from: { x: cx + c2x, y: cy } },
  ];
}

// ---- ばねのつり合い：mKg, k, g だけを JSON から受け取り、伸びをつり合いから計算する ----
// 具体値（検算済み）：m=2.0kg, g=10, k=100N/m のとき
//   mg = 20N、x0 = mg/k = 0.20m（20cm）、ばねの力 kx0 = 20N = mg でつり合う。
// 矢印の縮尺：重力 20N を 60px とする（3px/N）。ばねの力も 20N なので 60px。
// 伸びの図示：1m あたり 150px とすると、x0 は 30px。自然長の端を破線で示す。
// 角度はない（力はすべて鉛直）ので θ の弧はない。代わりに自然長の破線が原点の目印。
function springForces(mKg, k, g, mgPx, naturalPx, scalePxPerM) {
  const mgN = mKg * g;
  const x0m = mgN / k;
  const extPx = x0m * scalePxPerM;
  return [
    { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, mgPx], dashed: false, labelDx: 6, labelDy: -6 },
    // ばねの力はつり合い位置で mg と等しい（上向き、同じ長さ）。ラベルは左側に出す。
    { id: 'spring', short: 'ばねの力', color: 'blue', vector: [0, -mgPx], dashed: false, labelDx: -62, labelDy: -6 },
    // 伸び x0 は破線の矢印（力ではなく長さの目印）。自然長の端から物体の上端まで。
    { id: 'extension', short: '伸び x0', color: '#b00', vector: [0, extPx], dashed: true, labelDx: 8, labelDy: -4, from: { x: 272, y: 50 + naturalPx } },
  ];
}

// ---- 滑車・連結体（アトウッド型）：2物体の質量だけを JSON から受け取り、加速度と張力を計算する ----
// 具体値（検算済み）：m1=3.0kg（左・重い）、m2=1.0kg（右・軽い）、g=10 のとき
//   a = (m1-m2)/(m1+m2)・g = 5.0 m/s²、T = m1(g-a) = m2(g+a) = 15N
//   m1 の式：m1g − T = 30 − 15 = 15 = m1a、m2 の式：T − m2g = 15 − 10 = 5 = m2a
// 矢印の縮尺：2px/N。m1 の重力 30N → 60px、m2 の重力 10N → 20px、張力 15N → 30px。
// 加速度の矢印は破線（力ではない）：a = 5.0 m/s² を 2px/(m/s²) で 10px。向きは m1 が下、m2 が上。
// 角度はない（糸はすべて鉛直）ので θ の弧はない。
function pulleyForces(m1Kg, m2Kg, g, scalePxPerN) {
  const a = ((m1Kg - m2Kg) / (m1Kg + m2Kg)) * g;
  const tN = m1Kg * (g - a);
  const c1 = { x: 140, y: 210 }, c2 = { x: 260, y: 210 };
  const aPx = a * 2;
  return [
    { id: 'gravity1', short: '重力 m1g', color: 'red', vector: [0, m1Kg * g * scalePxPerN], dashed: false, labelDx: 6, labelDy: -6, from: c1 },
    { id: 'gravity2', short: '重力 m2g', color: 'red', vector: [0, m2Kg * g * scalePxPerN], dashed: false, labelDx: 6, labelDy: -6, from: c2 },
    { id: 'tension1', short: '張力 T', color: 'blue', vector: [0, -tN * scalePxPerN], dashed: false, labelDx: 6, labelDy: -6, from: c1 },
    { id: 'tension2', short: '張力 T', color: 'green', vector: [0, -tN * scalePxPerN], dashed: false, labelDx: 6, labelDy: -6, from: c2 },
    // 加速度の矢印は破線（力ではない）。箱と重ならないよう、物体の横に描く。ラベルは「a」だけにする。
    { id: 'acc1', short: 'a', color: '#2a7d2a', vector: [0, aPx], dashed: true, labelDx: 8, labelDy: 4, from: { x: c1.x + 55, y: c1.y } },
    { id: 'acc2', short: 'a', color: '#2a7d2a', vector: [0, -aPx], dashed: true, labelDx: 8, labelDy: 4, from: { x: c2.x + 55, y: c2.y } },
  ];
}

function sceneFor(type, thetaDeg, mgPx, fPx, data) {
  if (type === 'spring') {
    const mKg = (data && data.mKg) || 2, k = (data && data.k) || 100, g = (data && data.g) || 10;
    const naturalPx = (data && data.naturalPx) || 100, scalePxPerM = (data && data.scalePxPerM) || 150;
    return {
      type, mgPx, mKg, k, g, naturalPx, scalePxPerM,
      center: { x: 200, y: 200 },
      forces: springForces(mKg, k, g, mgPx, naturalPx, scalePxPerM),
    };
  }
  if (type === 'pulley') {
    const m1Kg = (data && data.m1Kg) || 3, m2Kg = (data && data.m2Kg) || 1, g = (data && data.g) || 10;
    const scalePxPerN = (data && data.scalePxPerN) || 2;
    return {
      type, mgPx, m1Kg, m2Kg, g, scalePxPerN,
      center: { x: 200, y: 70 },
      forces: pulleyForces(m1Kg, m2Kg, g, scalePxPerN),
    };
  }
  if (type === 'hang') {
    const a = (data && data.thetaLeftDeg) || 60;
    const b = (data && data.thetaRightDeg) || 30;
    return {
      type, thetaLeftDeg: a, thetaRightDeg: b, mgPx,
      center: { x: 180, y: 180 },
      thetaArc: { cx: 180, cy: 180, r: 38 },
      forces: hangForces(a, b, mgPx),
    };
  }
  if (type === 'pull') {
    return {
      type, thetaDeg, mgPx, fPx,
      center: { x: 200, y: 215 },
      thetaArc: { cx: 200, cy: 215, r: 38 },
      forces: pullForces(thetaDeg, mgPx, fPx),
    };
  }
  if (type === 'slope') {
    return {
      type, thetaDeg, mgPx,
      center: { x: 200, y: 180 },
      thetaArc: { cx: 60, cy: 240, r: 38 },
      forces: slopeForces(thetaDeg, mgPx),
    };
  }
  if (type === 'ladder') {
    return {
      type, thetaDeg: 42.0, mgPx,
      center: { x: 180, y: 170 },
      forces: ladderForces(mgPx),
    };
  }
  throw new Error('unknown figure type: ' + type);
}

// 分解の検算：decompSin + decompCos == gravity（斜面）/ == pull（斜め引き）
// 斜め引きではさらに4本の力の和が 0 になること（つり合い）も確かめる。
function validateScene(scene) {
  const byId = Object.fromEntries(scene.forces.map((f) => [f.id, f]));
  if (scene.type === 'slope' && byId.decompSin && byId.decompCos && byId.gravity) {
    const sx = byId.decompSin.vector[0] + byId.decompCos.vector[0] - byId.gravity.vector[0];
    const sy = byId.decompSin.vector[1] + byId.decompCos.vector[1] - byId.gravity.vector[1];
    if (Math.hypot(sx, sy) > 0.5) return ['分解の和が重力と一致しません: (' + sx.toFixed(2) + ', ' + sy.toFixed(2) + ')'];
  }
  if (scene.type === 'pull' && byId.decompSin && byId.decompCos && byId.pull) {
    const sx = byId.decompSin.vector[0] + byId.decompCos.vector[0] - byId.pull.vector[0];
    const sy = byId.decompSin.vector[1] + byId.decompCos.vector[1] - byId.pull.vector[1];
    if (Math.hypot(sx, sy) > 0.5) return ['分解の和が引く力と一致しません: (' + sx.toFixed(2) + ', ' + sy.toFixed(2) + ')'];
    let tx = 0, ty = 0;
    for (const id of ['gravity', 'normal', 'pull', 'friction']) { tx += byId[id].vector[0]; ty += byId[id].vector[1]; }
    if (Math.hypot(tx, ty) > 0.5) return ['4本の力の和が 0 になりません: (' + tx.toFixed(2) + ', ' + ty.toFixed(2) + ')'];
  }
  if (scene.type === 'hang' && byId.decompT1x && byId.decompT1y && byId.tension1 && byId.decompT2x && byId.decompT2y && byId.tension2) {
    const s1x = byId.decompT1x.vector[0] + byId.decompT1y.vector[0] - byId.tension1.vector[0];
    const s1y = byId.decompT1x.vector[1] + byId.decompT1y.vector[1] - byId.tension1.vector[1];
    const s2x = byId.decompT2x.vector[0] + byId.decompT2y.vector[0] - byId.tension2.vector[0];
    const s2y = byId.decompT2x.vector[1] + byId.decompT2y.vector[1] - byId.tension2.vector[1];
    if (Math.hypot(s1x, s1y) > 0.5 || Math.hypot(s2x, s2y) > 0.5) return ['分解の和が張力と一致しません: (' + s1x.toFixed(2) + ', ' + s1y.toFixed(2) + ') / (' + s2x.toFixed(2) + ', ' + s2y.toFixed(2) + ')'];
    let tx = 0, ty = 0;
    for (const id of ['gravity', 'tension1', 'tension2']) { tx += byId[id].vector[0]; ty += byId[id].vector[1]; }
    if (Math.hypot(tx, ty) > 0.5) return ['3本の力の和が 0 になりません: (' + tx.toFixed(2) + ', ' + ty.toFixed(2) + ')'];
  }
  if (scene.type === 'spring' && byId.gravity && byId.spring) {
    // つり合い：重力 + ばねの力 = 0。ばねの力の長さは kx0 = mg と等しいはず。
    const tx = byId.gravity.vector[0] + byId.spring.vector[0];
    const ty = byId.gravity.vector[1] + byId.spring.vector[1];
    if (Math.hypot(tx, ty) > 0.5) return ['重力とばねの力の和が 0 になりません: (' + tx.toFixed(2) + ', ' + ty.toFixed(2) + ')'];
    const mgN = scene.mKg * scene.g;
    const x0m = mgN / scene.k;
    const extPx = x0m * scene.scalePxPerM;
    const ext = byId.extension;
    if (!ext || Math.abs(ext.vector[1] - extPx) > 0.5) return ['伸びの矢印が x0 = mg/k と一致しません'];
    if (Math.abs(ext.vector[1] + (50 + scene.naturalPx) - 180) > 0.5) return ['伸びの矢印の位置が自然長の端と一致しません'];
  }
  if (scene.type === 'pulley' && byId.gravity1 && byId.gravity2 && byId.tension1 && byId.tension2) {
    // 張力は両側で等しい。2本の運動方程式が同じ a, T で成り立つこと。
    const t1 = -byId.tension1.vector[1] / scene.scalePxPerN;
    const t2 = -byId.tension2.vector[1] / scene.scalePxPerN;
    if (Math.abs(t1 - t2) > 0.5) return ['両側の張力が等しくありません: ' + t1.toFixed(2) + ' / ' + t2.toFixed(2)];
    const a = ((scene.m1Kg - scene.m2Kg) / (scene.m1Kg + scene.m2Kg)) * scene.g;
    const tCalc = scene.m1Kg * (scene.g - a);
    if (Math.abs(t1 - tCalc) > 0.5) return ['張力が m1(g-a) と一致しません: ' + t1.toFixed(2) + ' / ' + tCalc.toFixed(2)];
    const eq1 = scene.m1Kg * scene.g - t1 - scene.m1Kg * a;
    const eq2 = t1 - scene.m2Kg * scene.g - scene.m2Kg * a;
    if (Math.abs(eq1) > 0.5 || Math.abs(eq2) > 0.5) return ['運動方程式が成り立ちません: m1側 ' + eq1.toFixed(2) + ' / m2側 ' + eq2.toFixed(2)];
    // 加速度の矢印の長さは両側で等しい。
    if (byId.acc1 && byId.acc2 && Math.abs(Math.abs(byId.acc1.vector[1]) - Math.abs(byId.acc2.vector[1])) > 0.5) return ['加速度の矢印の長さが両側で等しくありません'];
  }
  return [];
}

function el(name, attrs) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function drawBase(svg, scene) {
  const defs = el('defs', {});
  const marker = el('marker', { id: 'fig-arrow', markerWidth: '8', markerHeight: '8', refX: '6', refY: '3', orient: 'auto' });
  marker.appendChild(el('path', { d: 'M0,0 L6,3 L0,6 Z', fill: '#333' }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  if (scene.type === 'pull') {
    svg.appendChild(el('line', { x1: 40, y1: 240, x2: 360, y2: 240, stroke: '#333', 'stroke-width': 3 }));
    const t1 = el('text', { x: 300, y: 265 }); t1.textContent = '床（粗い）'; svg.appendChild(t1);
    svg.appendChild(el('rect', { x: 160, y: 190, width: 80, height: 50, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    // θ の弧：中心から、床（右向き）と引く力のあいだ。θ が図にない、という誤りを防ぐために描画側が必ず描く。
    const a = scene.thetaArc;
    const rad = deg2rad(scene.thetaDeg);
    const x2 = a.cx + a.r * Math.cos(rad);
    const y2 = a.cy - a.r * Math.sin(rad);
    svg.appendChild(el('path', { d: `M ${a.cx + a.r} ${a.cy} A ${a.r} ${a.r} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
    const th = el('text', { x: a.cx + 44, y: a.cy - 4 }); th.textContent = 'θ'; svg.appendChild(th);
  } else if (scene.type === 'slope') {
    svg.appendChild(el('polygon', { points: '60,240 340,120 340,280 60,280', fill: '#eee' }));
    svg.appendChild(el('line', { x1: 60, y1: 240, x2: 340, y2: 120, stroke: '#333', 'stroke-width': 3 }));
    const t1 = el('text', { x: 300, y: 105 }); t1.textContent = '斜面（粗い）'; svg.appendChild(t1);
    const g = el('g', { transform: 'rotate(-23.2 200 180)' });
    g.appendChild(el('rect', { x: 160, y: 160, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(g);
    // θ の弧：床と斜面のあいだ。θ が図にない、という誤りを防ぐために描画側が必ず描く。
    const a = scene.thetaArc;
    const rad = deg2rad(scene.thetaDeg);
    const x2 = a.cx + a.r * Math.cos(rad);
    const y2 = a.cy - a.r * Math.sin(rad);
    svg.appendChild(el('path', { d: `M ${a.cx + a.r} ${a.cy} A ${a.r} ${a.r} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
    const th = el('text', { x: a.cx + 48, y: a.cy - 6 }); th.textContent = 'θ'; svg.appendChild(th);
  } else if (scene.type === 'hang') {
    const cx = scene.center.x, cy = scene.center.y, ceilY = 90;
    const a = deg2rad(scene.thetaLeftDeg), b = deg2rad(scene.thetaRightDeg);
    const lx = cx - (ceilY ? (cy - ceilY) / Math.tan(a) : 0);
    const rx = cx + (cy - ceilY) / Math.tan(b);
    svg.appendChild(el('line', { x1: 40, y1: ceilY, x2: 360, y2: ceilY, stroke: '#333', 'stroke-width': 3 }));
    const t0 = el('text', { x: 320, y: ceilY - 8 }); t0.textContent = '天井'; svg.appendChild(t0);
    svg.appendChild(el('line', { x1: lx.toFixed(1), y1: ceilY, x2: cx, y2: cy, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: rx.toFixed(1), y1: ceilY, x2: cx, y2: cy, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('rect', { x: 140, y: 160, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    // θ の弧：中心から水平方向と糸のあいだ。A命令の sweep の取り違えを避けるため、小さな線分で弧を描く。
    const arc = (fromDeg, toDeg) => {
      let d = '';
      for (let deg = fromDeg; deg <= toDeg; deg += 5) {
        const r = deg2rad(deg);
        const x = (cx + 38 * Math.cos(r)).toFixed(1), y = (cy + 38 * Math.sin(r)).toFixed(1);
        d += (d ? ' L ' : 'M ') + x + ' ' + y;
      }
      svg.appendChild(el('path', { d, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
    };
    arc(180, 240); // 左：水平（左向き）から左の糸（60°）まで
    arc(330, 360); // 右：右の糸（30°）から水平（右向き）まで
    const th1 = el('text', { x: cx - 52, y: cy - 26 }); th1.textContent = '60°'; svg.appendChild(th1);
    const th2 = el('text', { x: cx + 44, y: cy - 18 }); th2.textContent = '30°'; svg.appendChild(th2);
  } else if (scene.type === 'spring') {
    const ceilY = 50, attachY = 180, naturalEndY = ceilY + scene.naturalPx;
    svg.appendChild(el('line', { x1: 40, y1: ceilY, x2: 360, y2: ceilY, stroke: '#333', 'stroke-width': 3 }));
    const t0 = el('text', { x: 320, y: ceilY - 8 }); t0.textContent = '天井'; svg.appendChild(t0);
    // ばね：天井から物体の上端まで、コイルをジグザグで描く（長さは計算値から）。
    let d = 'M 200 ' + ceilY;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const y = ceilY + ((attachY - ceilY) * i) / steps;
      const x = i === steps ? 200 : (i % 2 === 1 ? 186 : 214);
      d += ' L ' + x + ' ' + y.toFixed(1);
    }
    svg.appendChild(el('path', { d, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('rect', { x: 160, y: 180, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    // 自然長の端：破線。ここが伸び x0 の原点（天井から測ると間違える）。
    svg.appendChild(el('line', { x1: 120, y1: naturalEndY, x2: 280, y2: naturalEndY, stroke: '#b00', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    const t1 = el('text', { x: 122, y: naturalEndY - 6, fill: '#b00' }); t1.textContent = '自然長'; svg.appendChild(t1);
  } else if (scene.type === 'pulley') {
    const px = 200, py = 70, r = 28;
    const c1 = { x: 140, y: 210 }, c2 = { x: 260, y: 210 };
    // 滑車：円と軸、糸は滑車の上を回る。
    svg.appendChild(el('circle', { cx: px, cy: py, r, fill: '#eee', stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: px - r, y1: py, x2: px - r, y2: c1.y - 20, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: px + r, y1: py, x2: px + r, y2: c2.y - 20, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('path', { d: `M ${px - r} ${py} A ${r} ${r} 0 0 1 ${px + r} ${py}`, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
    const t0 = el('text', { x: px + 36, y: py - 20 }); t0.textContent = '滑車'; svg.appendChild(t0);
    svg.appendChild(el('rect', { x: c1.x - 40, y: c1.y - 20, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('rect', { x: c2.x - 40, y: c2.y - 20, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    const t1 = el('text', { x: c1.x - 52, y: c1.y + 4 }); t1.textContent = 'm1'; svg.appendChild(t1);
    const t2 = el('text', { x: c2.x + 46, y: c2.y + 4 }); t2.textContent = 'm2'; svg.appendChild(t2);
  } else if (scene.type === 'ladder') {
    svg.appendChild(el('line', { x1: 80, y1: 20, x2: 80, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 80, y1: 260, x2: 380, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    const t1 = el('text', { x: 55, y: 40 }); t1.textContent = '壁'; svg.appendChild(t1);
    const t2 = el('text', { x: 300, y: 285 }); t2.textContent = '床'; svg.appendChild(t2);
    svg.appendChild(el('line', { x1: 80, y1: 80, x2: 280, y2: 260, stroke: '#b5651d', 'stroke-width': 6 }));
  }
  svg.appendChild(el('circle', { cx: scene.center.x, cy: scene.center.y, r: 4, fill: '#333' }));
}

function drawForce(svg, scene, force) {
  const from = force.from || scene.center;
  const to = { x: from.x + force.vector[0], y: from.y + force.vector[1] };
  const lineAttrs = { x1: from.x, y1: from.y, x2: to.x.toFixed(1), y2: to.y.toFixed(1), stroke: force.color, 'stroke-width': 2, 'marker-end': 'url(#fig-arrow)' };
  if (force.dashed) lineAttrs['stroke-dasharray'] = '5 4';
  svg.appendChild(el('line', lineAttrs));
  // ラベル：短い名前だけ。枠からはみ出さないよう、右端に寄りそうなら anchor を end にする。
  const lx = to.x + (force.labelDx || 6);
  const ly = to.y + (force.labelDy || -6);
  const estWidth = force.short.length * 9;
  const text = el('text', { x: lx.toFixed(1), y: ly.toFixed(1), fill: force.color });
  if (lx + estWidth > 395) { text.setAttribute('x', '395'); text.setAttribute('text-anchor', 'end'); }
  if (lx < 5) { text.setAttribute('x', '5'); text.setAttribute('text-anchor', 'start'); }
  text.textContent = force.short;
  svg.appendChild(text);
}

// svg: <svg class="fig" data-figure="slope" data-show="gravity,normal"> のような要素
// data: { type, thetaDeg, mgPx }（JSON から読む）
function renderFigure(svg, data, visibleIds) {
  const scene = sceneFor(data.type, data.thetaDeg, data.mgPx, data.fPx, data);
  const errors = validateScene(scene);
  if (errors.length) console.error('figure validation failed:', errors);
  svg.setAttribute('viewBox', '0 0 400 300');
  svg.innerHTML = '';
  drawBase(svg, scene);
  const byId = Object.fromEntries(scene.forces.map((f) => [f.id, f]));
  for (const id of visibleIds) {
    if (byId[id]) drawForce(svg, scene, byId[id]);
  }
  return scene;
}

// ページ内のすべての .fig を描く。data-show が空なら力は描かない。
function renderAllFigures() {
  document.querySelectorAll('svg.fig').forEach((svg) => {
    const dataEl = document.getElementById(svg.dataset.scene);
    const data = dataEl ? JSON.parse(dataEl.textContent) : { type: svg.dataset.figure, thetaDeg: 23.2, mgPx: 60 };
    const show = (svg.dataset.show || '').split(',').map((s) => s.trim()).filter(Boolean);
    renderFigure(svg, data, show);
  });
}

if (typeof module !== 'undefined') module.exports = { slopeForces, ladderForces, pullForces, hangForces, springForces, pulleyForces, sceneFor, validateScene };
