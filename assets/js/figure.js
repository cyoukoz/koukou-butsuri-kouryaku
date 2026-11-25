// 高校物理攻略 — 図描画シミュレータ（試作 v2.1：組み合わせO コンデンサ＋ばね＋重力・組み合わせP 気体＋ピストン＋ばね＋サイクル 追加）
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
    { id: 'friction', short: '摩擦力', color: 'purple', vector: [-fCos, 0], dashed: false, labelDx: -70, labelDy: 14 },
    { id: 'decompCos', short: 'F cosθ', color: '#b00', vector: [fCos, 0], dashed: true, labelDx: 6, labelDy: 16 },
    // F sinθ は平行四辺形の形にするため、水平成分の先端から描く（ベクトルは [0, -fSin]）。
    // ラベルは引く力 F のラベルと重ならないよう、鉛直の破線の左側に出す。
    { id: 'decompSin', short: 'F sinθ', color: '#b00', vector: [0, -fSin], dashed: true, labelDx: -48, labelDy: 0, from: { x: 200 + fCos, y: 215 } },
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
    { id: 'decompT1x', short: 'T1 cos60°', color: '#b00', vector: [-c1x, 0], dashed: true, labelDx: -70, labelDy: 16 },
    { id: 'decompT1y', short: 'T1 sin60°', color: '#b00', vector: [0, -c1y], dashed: true, labelDx: 10, labelDy: 12, from: { x: cx - c1x, y: cy } },
    { id: 'decompT2x', short: 'T2 cos30°', color: '#b00', vector: [c2x, 0], dashed: true, labelDx: 6, labelDy: 16 },
    { id: 'decompT2y', short: 'T2 sin30°', color: '#b00', vector: [0, -c2y], dashed: true, labelDx: -48, labelDy: 12, from: { x: cx + c2x, y: cy } },
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

// ---- 斜面＋滑車＋摩擦（組み合わせA）：JSON の物理データだけから力を計算する ----
// 具体値（検算済み）：θ=37°(sinθ=0.60, cosθ=0.80)、mA=4.0kg、mB=5.0kg、μ=0.25、g=10 のとき
//   つながっている間：N=32N、f=8N、a=2.0 m/s²、T=40N
//     B側：50-40=10=5.0×2.0、A側：40-24-8=8=4.0×2.0
//   切れたあと：a'=g(sinθ+μcosθ)=8.0 m/s²、止まるまで 0.5s、さらに 1.0m 上がる
// 矢印の縮尺：1.5px/N。加速度の矢印は破線（力ではない）：5px/(m/s²)。
// sinθ / cosθ は JSON の慣用値（0.6 / 0.8）を使う。deg2rad(37) の厳密値を使うと
// a ≈ 1.99、T ≈ 40.0 となり丸めの範囲で一致するが、ページの数字は慣用値で統一する。
function slopePulleyForces(data) {
  const mA = data.mAKg, mB = data.mBKg, mu = data.mu, g = data.g || 10;
  const s = data.sinTheta, c = data.cosTheta; // 0.6 / 0.8（慣用値）
  const scale = data.scalePxPerN || 1.5;
  const phase = data.phase || 'connected';
  // 斜面に沿って上向き (0.8,-0.6)、斜面に垂直（外向き）(-0.6,-0.8)、
  // 斜面に沿って下向き (-0.8,0.6)、斜面にめり込む向き (0.6,0.8)。
  const upSlope = [c, -s];
  const normalOut = [-s, -c];
  const downSlope = [-c, s];
  const intoSlope = [s, c];
  const mul = (v, k) => [v[0] * k, v[1] * k];
  const cA = { x: 160, y: 160 }; // 物体 A の中心
  const cB = { x: 306, y: 180 }; // 物体 B の中心（つながっている間）
  const cBfall = { x: 306, y: 235 }; // 物体 B の中心（切れたあと・落下した位置）
  const mAgN = mA * g, mBgN = mB * g;
  const nN = mAgN * c;            // 32 N
  const fN = mu * nN;             // 8 N
  const decompSinN = mAgN * s;    // 24 N
  const forces = [
    { id: 'gravityA', short: '重力 mAg', color: 'red', vector: [0, mAgN * scale], dashed: false, labelDx: 6, labelDy: -6, from: cA },
    { id: 'normalA', short: '垂直抗力', color: 'blue', vector: mul(normalOut, nN * scale), dashed: false, labelDx: -6, labelDy: -10, from: cA },
    // 摩擦力は A の動き（上向き）と逆向き＝斜面沿い・下向き。つながっている間も切れたあとも同じ向き。
    { id: 'frictionA', short: '摩擦力', color: 'purple', vector: mul(downSlope, fN * scale), dashed: false, labelDx: -8, labelDy: 14, from: cA },
    { id: 'decompSinA', short: 'mAg sinθ', color: '#b00', vector: mul(downSlope, decompSinN * scale), dashed: true, labelDx: -8, labelDy: 16, from: cA },
    { id: 'decompCosA', short: 'mAg cosθ', color: '#b00', vector: mul(intoSlope, nN * scale), dashed: true, labelDx: 8, labelDy: 14, from: cA },
  ];
  if (phase === 'connected') {
    const a = (mBgN - decompSinN - fN) / (mA + mB); // 2.0 m/s²
    const tN = mB * (g - a);                        // 40 N
    forces.push(
      { id: 'tensionA', short: '張力 T', color: 'green', vector: mul(upSlope, tN * scale), dashed: false, labelDx: 6, labelDy: -10, from: cA },
      { id: 'gravityB', short: '重力 mBg', color: 'red', vector: [0, mBgN * scale], dashed: false, labelDx: 6, labelDy: -6, from: cB },
      { id: 'tensionB', short: '張力 T', color: 'green', vector: [0, -tN * scale], dashed: false, labelDx: 6, labelDy: -6, from: cB },
      // 加速度の矢印は破線（力ではない）。箱と重ならないよう、物体の横に描く。
      { id: 'accA', short: 'a', color: '#2a7d2a', vector: mul(upSlope, a * 5), dashed: true, labelDx: 8, labelDy: 4, from: { x: cA.x + 55, y: cA.y } },
      { id: 'accB', short: 'a', color: '#2a7d2a', vector: [0, a * 5], dashed: true, labelDx: 8, labelDy: 4, from: { x: cB.x + 55, y: cB.y } },
    );
  } else {
    // 切れたあと：張力はない。A は初速度 4.0 m/s で上がり続け、a' で減速する。
    const aAfter = g * (s + mu * c); // 8.0 m/s²（下向き）
    forces.push(
      { id: 'gravityB', short: '重力 mBg', color: 'red', vector: [0, mBgN * scale], dashed: false, labelDx: 6, labelDy: -6, from: cBfall },
      { id: 'accAfterA', short: "a'", color: '#2a7d2a', vector: mul(downSlope, aAfter * 5), dashed: true, labelDx: 8, labelDy: 4, from: { x: cA.x + 55, y: cA.y } },
    );
  }
  return forces;
}

// ---- 衝突＋ばね（組み合わせ問題B）：生の入力だけを JSON から受け取り、
// 衝突直後の速さ・振幅・周期を描画側で計算する ----
// 具体値（検算済み）：m1=2.0kg, m2=2.0kg, v0=4.0m/s, k=100N/m のとき
//   v' = m1 v0/(m1+m2) = 2.0 m/s、M = 4.0kg、ω = √(k/M) = 5.0 rad/s
//   A = v'/ω = 0.40 m、T = 2π/ω ≈ 1.26 s、kA = 40 N
//   衝突前の運動エネルギー 16 J → 衝突直後 8 J（8 J 失われる。完全非弾性）。
//   1/2 k A^2 = 8 J が衝突直後の運動エネルギーと一致する。
//   衝突前の 16 J とは一致しない（してはいけない）。
// 矢印の縮尺：速度 15px/(m/s)（v0→60、v'→30）、ばねの力 1.5px/N（40N→60）、
// 縮み 100px/m（A=0.40m→40）。ばねの自然長は 120px。
// 角度はない（力と速度はすべて水平）ので θ の弧はない。
function collisionSpringDerived(data) {
  const mTotal = data.m1Kg + data.m2Kg;
  const vPrime = (data.m1Kg * data.v0) / mTotal;          // 運動量保存
  const omega = Math.sqrt(data.k / mTotal);                // 単振動の角振動数
  const amplitudeM = vPrime / omega;                       // 1/2 M v'^2 = 1/2 k A^2
  return { mTotal, vPrime, omega, amplitudeM, periodS: 2 * Math.PI / omega, fMaxN: data.k * amplitudeM };
}

function collisionSpringLayout(data, phase) {
  const d = collisionSpringDerived(data);
  const shiftPx = phase === 'max' ? d.amplitudeM * data.xScalePxPerM : 0;
  const m2cx = 220 + shiftPx;
  const m1cx = phase === 'before' ? 110 : 180 + shiftPx;
  return {
    floorY: 240, wallX: 360, blockW: 40, blockH: 40,
    m1cx, m2cx, cy: 220,
    springFromX: m2cx + 20, springToX: 360,
    springLenPx: 360 - (m2cx + 20),
    naturalPx: data.naturalPx, shiftPx,
  };
}

function collisionSpringForces(data, phase) {
  const d = collisionSpringDerived(data);
  const L = collisionSpringLayout(data, phase);
  const forces = [];
  if (phase === 'before') {
    forces.push({ id: 'velocity1', short: 'v0', color: '#d35400', vector: [data.v0 * data.vScalePxPerMs, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: L.m1cx, y: 180 } });
  } else if (phase === 'after') {
    forces.push({ id: 'velocityAfter', short: "v'", color: '#d35400', vector: [d.vPrime * data.vScalePxPerMs, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 200, y: 180 } });
  } else if (phase === 'max') {
    forces.push({ id: 'springForce', short: 'ばねの力', color: 'blue', vector: [-d.fMaxN * data.fScalePxPerN, 0], dashed: false, labelDx: -8, labelDy: -6, from: { x: L.m2cx, y: L.cy } });
    forces.push({ id: 'compression', short: '縮み A', color: '#b00', vector: [d.amplitudeM * data.xScalePxPerM, 0], dashed: true, labelDx: 6, labelDy: -4, from: { x: 240, y: 262 } });
  }
  return { forces, derived: d, layout: L };
}

// ---- 荷電粒子＋円運動（組み合わせC）：一様な磁場に入った荷電粒子の半円軌道 ----
// 具体値（検算済み）：m=3.2e-26 kg、q=+1.6e-19 C、v=2.0e5 m/s、B=0.50 T（紙面の裏向き）のとき
//   r = mv/qB = 0.080 m（8.0 cm）、T = 2πm/qB ≈ 2.5e-6 s、f ≈ 4.0e5 Hz
//   ローレンツ力 qvB = 1.6e-14 N、向心力 mv²/r = 1.6e-14 N で一致。
//   運動量 p = mv = 6.4e-21 kg·m/s。r から質量を求めると m = qBr/v = 3.2e-26 kg。
// 図：磁場は × 印の領域。粒子は左から速さ v で入り、ローレンツ力で上向きに曲がり、
// 半円を描いて上から左向きに出ていく。中心は入射点の真上（半径の分だけ上）。
// 速度の矢印は破線（力ではない）。ローレンツ力はつねに中心向き。
// phase: 'entry'（入射直後）/ 'top'（半円の頂点）/ 'exit'（出ていく直前）。
function chargedCircleDerived(data) {
  const rM = (data.mKg * data.vMs) / (data.qC * data.bT);
  const periodS = (2 * Math.PI * data.mKg) / (data.qC * data.bT);
  const lorentzN = data.qC * data.vMs * data.bT;
  return { rM, periodS, freqHz: 1 / periodS, lorentzN, momentum: data.mKg * data.vMs };
}

function chargedCircleForces(data, phase) {
  const d = chargedCircleDerived(data);
  const rPx = d.rM * data.rScalePxPerM;
  const vPx = data.vMs * data.vScalePxPerMs;
  const fPx = d.lorentzN * data.fScalePxPerN;
  const entry = { x: 60, y: 200 };
  const center = { x: entry.x, y: entry.y - rPx };
  const top = { x: center.x + rPx, y: center.y };
  const exit = { x: entry.x, y: center.y - rPx };
  const pos = phase === 'top' ? top : phase === 'exit' ? exit : entry;
  // 各位置での速度（接線方向）とローレンツ力（中心向き）。
  const vel = phase === 'top' ? [0, -vPx] : phase === 'exit' ? [-vPx, 0] : [vPx, 0];
  const lor = phase === 'top' ? [-fPx, 0] : phase === 'exit' ? [0, fPx] : [0, -fPx];
  const rad = [center.x - pos.x, center.y - pos.y];
  return {
    forces: [
      { id: 'velocity', short: '速度 v', color: '#d35400', vector: vel, dashed: true, labelDx: 6, labelDy: -8, from: pos },
      { id: 'lorentz', short: 'ローレンツ力', color: 'blue', vector: lor, dashed: false, labelDx: 6, labelDy: -8, from: pos },
      { id: 'radius', short: '半径 r', color: '#666', vector: rad, dashed: true, labelDx: 6, labelDy: 6, from: pos },
    ],
    derived: d, center, entry, top, exit, rPx,
  };
}

// ---- LC回路＋単振動（組み合わせD）：コイルとコンデンサの電気振動 ----
// 具体値（検算済み）：L=0.10 H、C=100 μF、Q0=1.0e-3 C のとき
//   ω = 1/√(LC) ≈ 316 rad/s、T = 2π√(LC) ≈ 0.020 s（19.9 ms）、f ≈ 50 Hz
//   V0 = Q0/C = 10 V、I0 = ωQ0 ≈ 0.32 A
//   電気エネルギー (1/2)Q0²/C = 5.0 mJ、磁気エネルギー (1/2)LI0² = 5.0 mJ で一致。
//   対応：電荷 Q ↔ 変位 x、電流 I ↔ 速度 v、L ↔ 質量 m、1/C ↔ ばね定数 k。
// phase: 'qmax'（Q=+Q0、I=0）/ 'imax'（Q=0、I=+I0）/ 'qmin'（Q=−Q0、I=0）。
function lcDerived(data) {
  const omega = 1 / Math.sqrt(data.inductanceH * data.capacitanceF);
  const periodS = 2 * Math.PI * Math.sqrt(data.inductanceH * data.capacitanceF);
  const i0A = omega * data.charge0C;
  const v0V = data.charge0C / data.capacitanceF;
  const eElecJ = 0.5 * data.charge0C * data.charge0C / data.capacitanceF;
  const eMagJ = 0.5 * data.inductanceH * i0A * i0A;
  return { omega, periodS, freqHz: 1 / periodS, i0A, v0V, eElecJ, eMagJ };
}

function lcForces(data, phase) {
  const d = lcDerived(data);
  const iPx = 70; // 電流の矢印の長さ（向きだけを示す。電流の大きさの縮尺ではない）
  const forces = [];
  if (phase === 'imax') {
    // コンデンサが放電しきった瞬間：電流は最大で、上の導線を右向き、下の導線を左向きに流れる。
    forces.push({ id: 'currentTop', short: '電流 I', color: '#d35400', vector: [iPx, 0], dashed: true, labelDx: 6, labelDy: -10, from: { x: 150, y: 80 } });
    forces.push({ id: 'currentBottom', short: '電流 I', color: '#d35400', vector: [-iPx, 0], dashed: true, labelDx: 6, labelDy: 16, from: { x: 250, y: 220 } });
  }
  return { forces, derived: d };
}

// ---- 気体＋ピストン（T1/T2）：ピストンの力のつり合いと状態方程式 ----
// 具体値（検算済み）：p0=1.0e5 Pa、S=1.0e-2 m²、ピストン 50 kg、g=10、n=0.12 mol、T=300 K のとき
//   p = p0 + mg/S = 1.0e5 + 5.0e4 = 1.5e5 Pa
//   V = nRT/p ≈ 1.99e-3 m³（約 2.0 L）、h = V/S ≈ 0.20 m
//   375 K まで等圧加熱：V ≈ 2.49e-3 m³、h ≈ 0.25 m、W = pΔV ≈ 75 J、
//   ΔU = (3/2)nRΔT ≈ 112 J、Q = ΔU + W ≈ 187 J
// 力の矢印の縮尺：25 N/px。気体の力 pS=1500 N → 60px、大気圧の力 1000 N → 40px、
// 重力 mg=500 N → 20px。下向きの和 40+20=60 が上向きとつり合う。
// 高さの矢印の縮尺：400 px/m。h=0.20 m → 約 80px、0.25 m → 約 100px。
function gasPistonDerived(data) {
  const g = data.g || 10;
  const pPa = data.p0Pa + (data.pistonKg * g) / data.areaM2;
  const vM3 = (data.nMol * data.rGas * data.tK) / pPa;
  const hM = vM3 / data.areaM2;
  return {
    pPa, vM3, hM,
    gasForceN: pPa * data.areaM2,
    atmForceN: data.p0Pa * data.areaM2,
    mgN: data.pistonKg * g,
  };
}

function gasPistonForces(data, d, pistonY) {
  const fScale = 25; // N/px
  const hPx = d.hM * 400;
  return [
    { id: 'gasForce', short: '気体の力', color: '#d35400', vector: [0, -(d.gasForceN / fScale)], dashed: false, labelDx: 6, labelDy: -8, from: { x: 150, y: pistonY } },
    { id: 'atmForce', short: '大気圧の力', color: 'purple', vector: [0, d.atmForceN / fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 250, y: pistonY } },
    { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mgN / fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: pistonY } },
    // 高さ h は破線の矢印（力ではない）。シリンダーの底からピストンまで。
    { id: 'height', short: '高さ h', color: '#b00', vector: [0, -hPx], dashed: true, labelDx: 6, labelDy: -4, from: { x: 310, y: 260 } },
  ];
}

// ---- ヤングの干渉（W2）：二重スリット。光路差＝nλ、縞間隔 λL/d ----
// 具体値（検算済み）：λ=600 nm、d=0.20 mm、L=1.0 m のとき
//   縞間隔 Δx = λL/d = 3.0 mm、n=3 の明線の位置 x = 9.0 mm、
//   その点での光路差 = d・x/L = 1.8e-6 m = 3λ
// 図の縮尺：スリット間隔 40px、スクリーンまでの距離 200px、縞間隔 30px（10 px/mm）。
// 2本の光路の長さは三平方の定理から計算する（上 211.9px、下 228.3px、差 16.4px）。
// 光路差の目印は、下の光路上に「上の光路と同じ長さの点」を打つ（計算で求める）。
function youngDerived(data) {
  const lamM = data.lambdaNm * 1e-9, dM = data.dMm * 1e-3;
  const dxM = (lamM * data.lM) / dM;
  const xNM = data.n * dxM;
  const pathDiffM = (dM * xNM) / data.lM; // ≈ nλ
  return { lamM, dM, dxM, xNM, pathDiffM };
}

function youngLayout(data) {
  const d = youngDerived(data);
  const slitX = 140, screenX = 340, centerY = 150, slitSepPx = 40, fringePxPerMm = 10;
  const pointY = centerY - d.xNM * 1e3 * fringePxPerMm; // n=3 → 150-90=60
  const upperSlit = { x: slitX, y: centerY - slitSepPx / 2 };
  const lowerSlit = { x: slitX, y: centerY + slitSepPx / 2 };
  const point = { x: screenX, y: pointY };
  const ray1Px = Math.hypot(point.x - upperSlit.x, point.y - upperSlit.y);
  const ray2Px = Math.hypot(point.x - lowerSlit.x, point.y - lowerSlit.y);
  // 下の光路上の点：下のスリットから上の光路と同じ長さのところ（光路差の目印）。
  const tick = {
    x: lowerSlit.x + (ray1Px / ray2Px) * (point.x - lowerSlit.x),
    y: lowerSlit.y + (ray1Px / ray2Px) * (point.y - lowerSlit.y),
  };
  return { slitX, screenX, centerY, slitSepPx, fringePxPerMm, pointY, upperSlit, lowerSlit, point, ray1Px, ray2Px, tick, derived: d };
}

function youngForces(data) {
  const L = youngLayout(data);
  return [
    { id: 'ray1', short: '光路1', color: '#d35400', vector: [L.point.x - L.upperSlit.x, L.point.y - L.upperSlit.y], dashed: true, labelDx: 6, labelDy: -10, from: L.upperSlit },
    { id: 'ray2', short: '光路2', color: '#d35400', vector: [L.point.x - L.lowerSlit.x, L.point.y - L.lowerSlit.y], dashed: true, labelDx: -64, labelDy: 12, from: L.lowerSlit },
  ];
}

// ---- ヤングの干渉＋屈折（組み合わせH）：水に入ると波長が λ/n になり、縞間隔も狭くなる ----
// 具体値（検算済み）：λ=600 nm、d=0.20 mm、L=1.0 m、n=4/3 のとき
//   空気中：Δx = λL/d = 3.0 mm、3番目の明線 x = 9.0 mm。
//   水中：λ' = λ/n = 450 nm、Δx' = λ'L/d = 2.25 mm、3番目の明線 x' = 6.75 mm。
//   振動数 f = c/λ = 5.0×10¹⁴ Hz は変わらない。水中の速さ v = c/n = 2.25×10⁸ m/s。
//   青い光（空気中で 450 nm）：空気中で Δx = 2.25 mm、水中で λ' = 337.5 nm、Δx' ≈ 1.69 mm。
// 罠：波長が変わるのは媒質に入ったとき。振動数は変わらない。干渉の式の形は同じで、
//   λ だけが λ' になる。屈折角の式と混同しない（こちらは波長そのものが変わる話）。
// 光路図の幾何：スリット x=120、スクリーン x=330、中心 y=150、縞 10 px/mm（young と同じ配置）。
function youngWaterDerived(data) {
  const c = 3.0e8;
  const n = data.nWater;
  const lamNm = data.lambdaNm;
  const lamWaterNm = lamNm / n;
  const dMm = data.dMm, lM = data.lM;
  const dxAirMm = (lamNm * 1e-9 * lM) / (dMm * 1e-3) * 1e3;
  const dxWaterMm = (lamWaterNm * 1e-9 * lM) / (dMm * 1e-3) * 1e3;
  const x3AirMm = 3 * dxAirMm;
  const x3WaterMm = 3 * dxWaterMm;
  const freqHz = c / (lamNm * 1e-9);
  const vWaterMs = c / n;
  const lamBlueNm = data.lambdaBlueNm;
  const lamBlueWaterNm = lamBlueNm / n;
  const dxBlueAirMm = (lamBlueNm * 1e-9 * lM) / (dMm * 1e-3) * 1e3;
  const dxBlueWaterMm = (lamBlueWaterNm * 1e-9 * lM) / (dMm * 1e-3) * 1e3;
  const slitX = 120, screenX = 330, centerY = 150, slitSepPx = 40, fringePxPerMm = 10;
  const pointAir = { x: screenX, y: centerY - x3AirMm * fringePxPerMm };
  const pointWater = { x: screenX, y: centerY - x3WaterMm * fringePxPerMm };
  const upperSlit = { x: slitX, y: centerY - slitSepPx / 2 };
  const lowerSlit = { x: slitX, y: centerY + slitSepPx / 2 };
  return {
    c, n, lamNm, lamWaterNm, dxAirMm, dxWaterMm, x3AirMm, x3WaterMm,
    freqHz, vWaterMs, lamBlueNm, lamBlueWaterNm, dxBlueAirMm, dxBlueWaterMm,
    slitX, screenX, centerY, slitSepPx, fringePxPerMm, pointAir, pointWater, upperSlit, lowerSlit,
  };
}

function youngWaterForces(data) {
  const d = youngWaterDerived(data);
  if (data.phase === 'air' || data.phase === 'water') {
    const point = data.phase === 'air' ? d.pointAir : d.pointWater;
    return [
      { id: 'ray1', short: '光路1', color: '#d35400', vector: [point.x - d.upperSlit.x, point.y - d.upperSlit.y], dashed: true, labelDx: 6, labelDy: -10, from: d.upperSlit },
      { id: 'ray2', short: '光路2', color: '#d35400', vector: [point.x - d.lowerSlit.x, point.y - d.lowerSlit.y], dashed: true, labelDx: -64, labelDy: 12, from: d.lowerSlit },
    ];
  }
  return []; // compare・blue：縞の並びだけを描くので、光路の矢印はない。
}

// ---- コンデンサ（E2）：C=εS/d、Q=CV、U=½CV²。何が一定かがすべてを決める ----
// 具体値（検算済み）：S=0.020 m²、d=1.0 mm、V=10 V のとき
//   C = ε0S/d = 177 pF、Q = CV = 1.77 nC、U = ½CV² = 8.85 nJ
//   E = V/d = 1.0e4 V/m、極板間の引力 F = Q²/(2εS) = 8.85e-6 N
// 電池につないだまま d を 2 倍（V 一定）：C=88.5 pF、Q=0.885 nC、U=4.43 nJ、E=5.0e3 V/m、F=2.21e-6 N
// 切り離してから d を 2 倍（Q 一定）：C=88.5 pF、V=20 V、U=17.7 nJ、E=1.0e4 V/m（変わらない）、F=8.85e-6 N（変わらない）
// 矢印の縮尺：電場 0.004 px/(V/m)（1.0e4 → 40px、5.0e3 → 20px）。
// 引力 40px / 8.85e-6 N（8.85e-6 N → 40px、2.21e-6 N → 10px）。
// 極板間隔の図示：40 px/mm（d=1.0 mm → 40px、2.0 mm → 80px）。
function capacitorDerived(data) {
  const eps0 = data.eps0;
  const dM = data.dMm * 1e-3;
  const cF = (eps0 * data.areaM2) / dM;
  let qC, vV;
  if (data.phase === 'disconnected') { qC = data.q0C; vV = qC / cF; }
  else { vV = data.vV; qC = cF * vV; }
  const uJ = 0.5 * cF * vV * vV;
  const eVm = vV / dM;
  const fN = (qC * qC) / (2 * eps0 * data.areaM2);
  return { dM, cF, qC, vV, uJ, eVm, fN };
}

function capacitorForces(data) {
  const d = capacitorDerived(data);
  const topY = 110, dPx = data.dMm * 40;
  const ePx = d.eVm * 0.004;
  const fPx = d.fN * (40 / 8.85e-6);
  const forces = [];
  for (const [i, x] of [150, 200, 250].entries()) {
    forces.push({
      id: 'field' + (i + 1), short: i === 1 ? '電場 E' : '', color: 'blue',
      vector: [0, ePx], dashed: false, labelDx: 6, labelDy: -6, from: { x, y: topY + 8 },
    });
  }
  forces.push(
    { id: 'attractTop', short: '引く力', color: 'red', vector: [0, fPx], dashed: false, labelDx: -44, labelDy: -6, from: { x: 285, y: topY } },
    { id: 'attractBottom', short: '', color: 'red', vector: [0, -fPx], dashed: false, labelDx: 6, labelDy: -6, from: { x: 285, y: topY + dPx } },
  );
  return { forces, derived: d, dPx };
}

// ---- コンデンサ＋ばね＋単振動（組み合わせJ）：電池を切り離すと静電引力は一定になる ----
// 具体値（検算済み）：水平のコンデンサ。右の極板（m=0.50 kg、S=0.020 m²）はばね（k=50 N/m）につながる。
//   電池で Q=0.20 μC まで充電してから切り離す（Q 一定）。はじめの極板間隔 d=5.0 mm。
//   静電引力 F = Q²/(2ε0S) = (0.20e-6)²/(2×8.85e-12×0.020) ≈ 0.11 N
//     Q 一定なら、F は d によらない（C が変わっても Q²/(2ε0S) の形は変わらない）。
//   つり合いの伸び x0 = F/k ≈ 0.0023 m = 2.3 mm
//   単振動：ω = √(k/m) = 10 rad/s、周期 T = 2π/ω ≈ 0.63 s
//     振幅 A=1.0 mm のとき v_max = ωA = 0.010 m/s、a_max = ω²A = 0.10 m/s²
//   はじめの電気量：C0 = ε0S/d = 35.4 pF、V0 = Q/C0 ≈ 5650 V、U0 = Q²/(2C0) ≈ 0.56 mJ
//   d を半分の 2.5 mm に（Q 一定）：C=70.8 pF、V≈2820 V、U≈0.28 mJ（半分）。
//     静電気力のはたらき F×Δd = 0.11×0.0025 ≈ 0.28 mJ と一致する（エネルギーのつじつま）。
//   対比（電池につないだまま、V 一定）：d を半分にすると F = ε0SV²/(2d²) が 4 倍の約 0.45 N。
//     そのときのばねの力は k×(2.3+2.5)mm ≈ 0.24 N しかないので、極板は引き寄せられてしまう。
// 罠：V 一定では F は 1/d² で変わるが、Q 一定では F は一定。何が一定かで、単振動になるかどうかが決まる。
// 図の縮尺：横方向は 16 px/mm（d=5.0 mm → 80 px、つり合いの伸び 2.3 mm → 37 px）。
//   力の矢印は 200 px/N（0.11 N → 23 px、0.45 N → 90 px）。
function capSpringDerived(data) {
  const eps0 = data.eps0;
  const fN = (data.qC * data.qC) / (2 * eps0 * data.areaM2);
  const x0M = fN / data.kNm;
  const omega = Math.sqrt(data.kNm / data.mKg);
  const periodS = (2 * Math.PI) / omega;
  const d0M = data.dMm * 1e-3;
  const c0F = (eps0 * data.areaM2) / d0M;
  const v0V = data.qC / c0F;
  const u0J = (data.qC * data.qC) / (2 * c0F);
  const d1M = d0M / 2;
  const c1F = (eps0 * data.areaM2) / d1M;
  const v1V = data.qC / c1F;
  const u1J = (data.qC * data.qC) / (2 * c1F);
  const workJ = fN * (d0M - d1M);
  const fVFixedN = (eps0 * data.areaM2 * v0V * v0V) / (2 * d1M * d1M);
  const springVFixedN = data.kNm * (x0M + (d0M - d1M));
  const ampM = data.ampMm * 1e-3;
  const vMaxMs = omega * ampM;
  const aMaxMs2 = omega * omega * ampM;
  const leftPlateX = 100, dPxPerMm = 16, wallX = 340, plateY0 = 110, plateY1 = 190, plateY = 150;
  const plateX = (dMm) => leftPlateX + dMm * dPxPerMm;
  return {
    fN, x0M, omega, periodS, c0F, v0V, u0J, c1F, v1V, u1J, workJ,
    fVFixedN, springVFixedN, vMaxMs, aMaxMs2,
    leftPlateX, dPxPerMm, wallX, plateY0, plateY1, plateY, plateX,
    naturalPlateX: plateX(data.dMm + x0M * 1e3),
    eqPlateX: plateX(data.dMm),
    shmPlateX: plateX(data.dMm + data.ampMm),
    closePlateX: plateX(data.dMm / 2),
  };
}

function capSpringForces(data) {
  const d = capSpringDerived(data);
  const fScale = 200; // px/N
  if (data.phase === 'charged') {
    // つり合い：静電引力（左向き）とばねの力（右向き）が等しい。
    return [
      { id: 'elec', short: 'F=0.11 N', color: 'red', vector: [-d.fN * fScale, 0], dashed: false, labelDx: -60, labelDy: -42, from: { x: d.eqPlateX, y: d.plateY } },
      { id: 'spring', short: 'ばね 0.11 N', color: 'green', vector: [d.fN * fScale, 0], dashed: false, labelDx: 6, labelDy: -42, from: { x: d.eqPlateX, y: d.plateY } },
    ];
  }
  if (data.phase === 'shm') {
    // つり合い位置から右へ 1.0 mm ずれた瞬間：ばねの力が静電引力を上回り、合力は左向き。
    const springN = data.kNm * (d.x0M + data.ampMm * 1e-3);
    return [
      { id: 'elec', short: 'F=0.11 N', color: 'red', vector: [-d.fN * fScale, 0], dashed: false, labelDx: -60, labelDy: -42, from: { x: d.shmPlateX, y: d.plateY } },
      { id: 'spring', short: 'ばね 0.16 N', color: 'green', vector: [springN * fScale, 0], dashed: false, labelDx: 6, labelDy: -42, from: { x: d.shmPlateX, y: d.plateY } },
    ];
  }
  if (data.phase === 'energy') {
    // d が半分になっても Q 一定なら静電引力は変わらない。
    return [
      { id: 'elec', short: 'F=0.11 N', color: 'red', vector: [-d.fN * fScale, 0], dashed: false, labelDx: -60, labelDy: -42, from: { x: d.closePlateX, y: d.plateY } },
    ];
  }
  if (data.phase === 'contrast') {
    // V 一定で d が半分になると、静電引力は 4 倍になり、ばねでは支えきれない。
    return [
      { id: 'elec', short: 'F=0.45 N', color: 'red', vector: [-d.fVFixedN * fScale, 0], dashed: false, labelDx: 6, labelDy: -42, from: { x: d.closePlateX, y: d.plateY } },
      { id: 'spring', short: 'ばね 0.24 N', color: 'green', vector: [d.springVFixedN * fScale, 0], dashed: false, labelDx: 6, labelDy: -42, from: { x: d.closePlateX, y: d.plateY } },
    ];
  }
  return []; // base：充電する前は力ははたらかない。
}

// ---- 組み合わせO：コンデンサ＋ばね＋重力（E2+M8+M12、X1型・東大2024第2問型）----
// 具体値（検算済み）：上極板 m=0.020 kg がばね k=100 N/m でつるされ、下極板は固定。
//   極板面積 S=0.020 m²、電池 V=3000 V をつなぐ（V 一定）。ばねが自然長のとき板間隔 d_nat=6.0 mm。
//   静電気力（V 一定）は F = ε0SV²/(2d²) = C_e/d²、ただし C_e = ε0SV²/2 = 7.965×10⁻⁷ N·m²。
//   電池なし：ばねの伸び y0 = mg/k = 2.0 mm、d0 = 4.0 mm。ω0 = √(k/m) ≈ 71 rad/s、T0 ≈ 0.089 s。
//   電池あり：つり合いは k(d_nat−d) = mg + C_e/d² を解いて d1 ≈ 3.24 mm。
//     F1 ≈ 0.076 N、ばねの力 k(d_nat−d1) ≈ 0.28 N = mg + F1。
//     実効ばね定数 k_eff = k − 2C_e/d1³ ≈ 53 N/m（静電気力がばねを弱める）。
//     ω = √(k_eff/m) ≈ 52 rad/s、T ≈ 0.12 s（電池なしの 0.089 s より長くなる）。
//     電池をつないだ瞬間、板は d0=4.0 mm から動き出すので、振幅 A = d0−d1 ≈ 0.76 mm、
//     v_max = ωA ≈ 0.039 m/s。
//   安定性：正味の上向きの力 G(d) = k(d_nat−d) − mg − C_e/d² は、d1 ≈ 3.24 mm（安定）と
//     d_u ≈ 1.99 mm（不安定）で 0 になる。臨界は d_c = (2C_e/k)^(1/3) ≈ 2.52 mm。
//     V=4000 V にすると C_e = 1.416×10⁻⁶ N·m² になり、G(d_c) < 0 でつり合いがなくなる
//     （極板が吸いつく。プルイン）。
//   エネルギー（電池をつないだとき）：Q0 ≈ 0.133 μC → Q1 ≈ 0.164 μC、電池の仕事 VΔQ ≈ 9.3×10⁻⁵ J。
//     静電エネルギーの増加 ΔU = ½V²ΔC ≈ 4.7×10⁻⁵ J で、電池の仕事のちょうど半分。
//     残りは力学的エネルギーの増加（ばね +1.8×10⁻⁴ J、重力 −1.5×10⁻⁴ J）とジュール熱 ≈ 1.8×10⁻⁵ J。
// 罠：静電気力を「Q 一定の式」で計算すると、d が変わっても F が変わらないと思ってしまう。
//   電池につないだまま（V 一定）では F ∝ 1/d² で、板が近づくほど急に強くなる。
//   さらに電圧を上げすぎると、ばねでは支えきれず極板が吸いつく。
// 図の縮尺：力は 150 px/N（重力 0.20 N → 30 px、ばね 0.28 N → 42 px、静電気力 0.076 N → 11 px）。
//   板間隔は 10 px/mm（d=4.0 mm → 40 px）。下極板は y=200 に固定、上極板は y=200−10d。
function capSpringGravDerived(data) {
  const g = data.g || 10;
  const cE = (data.eps0 * data.areaM2 * data.voltV * data.voltV) / 2;
  const mgN = data.mKg * g;
  const y0M = mgN / data.kNm;
  const d0M = data.dNatMm * 1e-3 - y0M;
  const omega0 = Math.sqrt(data.kNm / data.mKg);
  const period0S = (2 * Math.PI) / omega0;
  // つり合い k(d_nat−d) = mg + C_e/d² を二分法で解く（d は m 単位）。
  // 正味の上向きの力 G(d) は、d_c（臨界）で正、d_nat の近くで負になる。
  // 安定なつり合い d1 は [d_c, d_nat) のあいだ、不安定なつり合いは (0, d_c) のあいだにある。
  const netUp = (d) => data.kNm * (data.dNatMm * 1e-3 - d) - mgN - cE / (d * d);
  const dCritM = Math.cbrt((2 * cE) / data.kNm);
  let lo = dCritM, hi = data.dNatMm * 1e-3 - 1e-4;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (netUp(mid) > 0) lo = mid; else hi = mid;
  }
  const d1M = (lo + hi) / 2;
  const f1N = cE / (d1M * d1M);
  const y1M = data.dNatMm * 1e-3 - d1M;
  const kEff = data.kNm - (2 * cE) / (d1M * d1M * d1M);
  const omega = Math.sqrt(kEff / data.mKg);
  const periodS = (2 * Math.PI) / omega;
  const ampM = d0M - d1M;
  const vMaxMs = omega * ampM;
  // 不安定なつり合い：G(d) は d=1 mm で負、d_c で正。
  let ulo = 1e-3, uhi = dCritM;
  for (let i = 0; i < 100; i++) {
    const mid = (ulo + uhi) / 2;
    if (netUp(mid) < 0) ulo = mid; else uhi = mid;
  }
  const dUnstableM = (ulo + uhi) / 2;
  // 罠の電圧ではつり合いがなくなることの検算用。
  const cTrap = (data.eps0 * data.areaM2 * data.voltTrapV * data.voltTrapV) / 2;
  const dCritTrapM = Math.cbrt((2 * cTrap) / data.kNm);
  const netUpTrap = (d) => data.kNm * (data.dNatMm * 1e-3 - d) - mgN - cTrap / (d * d);
  // エネルギー（電池をつないだときの変化）。
  const c0F = (data.eps0 * data.areaM2) / d0M;
  const c1F = (data.eps0 * data.areaM2) / d1M;
  const q0C = c0F * data.voltV;
  const q1C = c1F * data.voltV;
  const wBattJ = data.voltV * (q1C - q0C);
  const dUelecJ = 0.5 * data.voltV * data.voltV * (c1F - c0F);
  const dUspringJ = 0.5 * data.kNm * (y1M * y1M - y0M * y0M);
  const dUgravJ = -mgN * (y1M - y0M);
  const jouleJ = wBattJ - dUelecJ - dUspringJ - dUgravJ;
  // 図の配置：下極板 y=200 に固定。板間隔 10 px/mm。上極板 y = 200 − 10d(mm)。
  const lowerY = 200, pxPerMm = 10;
  const plateY = (dMm) => lowerY - dMm * pxPerMm;
  return {
    cE, mgN, y0M, d0M, omega0, period0S, d1M, f1N, y1M, kEff, omega, periodS,
    ampM, vMaxMs, dCritM, dUnstableM, cTrap, dCritTrapM, netUpTrap,
    c0F, c1F, q0C, q1C, wBattJ, dUelecJ, dUspringJ, dUgravJ, jouleJ,
    lowerY, pxPerMm, plateY,
    plateY0: plateY(d0M * 1e3), plateY1: plateY(d1M * 1e3),
    plateYNat: plateY(data.dNatMm),
  };
}

function capSpringGravForces(data) {
  const d = capSpringGravDerived(data);
  const fScale = 150; // px/N
  const plateY = data.phase === 'charge' || data.phase === 'shm' ? d.plateY1 : d.plateY0;
  if (data.phase === 'base') {
    // 電池なし：ばね（上向き）と重力（下向き）がつり合う。どちらも 0.20 N。
    return [
      { id: 'spring', short: 'ばね 0.20 N', color: 'green', vector: [0, -d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -8, from: { x: 180, y: plateY } },
      { id: 'gravity', short: '重力 0.20 N', color: 'red', vector: [0, d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 220, y: plateY } },
    ];
  }
  if (data.phase === 'charge') {
    // 電池あり：ばね 0.28 N（上）＝ 重力 0.20 N ＋ 静電気力 0.076 N（下）。
    return [
      { id: 'spring', short: 'ばね 0.28 N', color: 'green', vector: [0, -(d.mgN + d.f1N) * fScale], dashed: false, labelDx: 6, labelDy: -8, from: { x: 180, y: plateY } },
      { id: 'gravity', short: '重力 0.20 N', color: 'red', vector: [0, d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 220, y: plateY } },
      { id: 'elec', short: '静電気力 0.076 N', color: '#b00', vector: [0, d.f1N * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: plateY } },
    ];
  }
  if (data.phase === 'shm') {
    // 上端（d=d0）の瞬間：ばね 0.20 N、静電気力 C_e/d0²、重力 0.20 N。合力は下向き。
    const fTopN = d.cE / (d.d0M * d.d0M);
    return [
      { id: 'spring', short: 'ばね 0.20 N', color: 'green', vector: [0, -d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -8, from: { x: 180, y: d.plateY0 } },
      { id: 'gravity', short: '重力 0.20 N', color: 'red', vector: [0, d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 220, y: d.plateY0 } },
      { id: 'elec', short: '静電気力 0.050 N', color: '#b00', vector: [0, fTopN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: d.plateY0 } },
    ];
  }
  return []; // graph・trap：力の矢印はない。
}

// ---- 組み合わせK：斜面＋摩擦＋エネルギー（M5+M6+M9）----
// 具体値（検算済み）：m=2.0 kg、θ=30°、斜面の長さ L=5.0 m、μ=0.20、g=10 のとき
//   高さ h = L sinθ = 2.5 m、垂直抗力 N = mg cosθ ≈ 17.3 N、摩擦力 f = μN ≈ 3.5 N
//   重力の仕事 mgh = 50 J、摩擦の仕事 −fL ≈ −17.3 J、運動エネルギー = 50 − 17.3 ≈ 32.7 J
//   斜面下端の速さ v = √(2×32.7/2) ≈ 5.7 m/s（摩擦を無視すると √50 ≈ 7.1 m/s）
//   加速度 a = g(sinθ − μcosθ) ≈ 3.27 m/s²、滑る時間 t = v/a ≈ 1.75 s
//   斜面を出たあと、水平な粗い床（μ=0.20）では摩擦力 μmg = 4.0 N ではたらき、
//   止まるまでの距離 s = v²/(2μg) ≈ 8.2 m（摩擦の仕事 −4.0×8.2 ≈ −32.7 J = 運動エネルギー）
// 罠：摩擦があるのに力学的エネルギー保存を使うと v ≈ 7.1 m/s になってしまう。
//   摩擦の仕事は負で、力学的エネルギーを減らす。斜面と床では垂直抗力が違うので
//   摩擦力も違う（斜面では μmg cosθ、床では μmg）。
// 図の縮尺：力は 3 px/N（重力 20 N → 60 px、垂直抗力 17.3 N → 52 px、
//   斜面の摩擦力 3.5 N → 10 px、床の摩擦力 4.0 N → 12 px）。速度は 8 px/(m/s)。
//   斜面は (80,101)-(320,240)、θ=30°（横 240、高さ 240×tan30°）。
function slopeEnergyDerived(data) {
  const g = data.g || 10;
  const rad = (data.thetaDeg * Math.PI) / 180;
  const sinT = Math.sin(rad), cosT = Math.cos(rad);
  const hM = data.slopeLM * sinT;
  const normalN = data.mKg * g * cosT;
  const frictionN = data.mu * normalN;
  const wGravityJ = data.mKg * g * hM;
  const wFrictionJ = -frictionN * data.slopeLM;
  const keJ = wGravityJ + wFrictionJ;
  const vMs = Math.sqrt((2 * keJ) / data.mKg);
  const vNoFricMs = Math.sqrt((2 * wGravityJ) / data.mKg);
  const accelMs2 = g * (sinT - data.mu * cosT);
  const timeS = vMs / accelMs2;
  const floorFrictionN = data.mu * data.mKg * g;
  const stopM = (vMs * vMs) / (2 * data.mu * g);
  // 図の座標：斜面の下端 B=(320,240)、上端 A=(80, 240−240×tan30°)。
  const slopeB = { x: 320, y: 240 };
  const slopeA = { x: 80, y: 240 - 240 * Math.tan(rad) };
  const blockM = { x: (slopeA.x + slopeB.x) / 2, y: (slopeA.y + slopeB.y) / 2 };
  const floorStartX = 80, floorStopX = floorStartX + stopM * 25;
  return {
    g, sinT, cosT, hM, normalN, frictionN, wGravityJ, wFrictionJ, keJ,
    vMs, vNoFricMs, accelMs2, timeS, floorFrictionN, stopM,
    slopeA, slopeB, blockM, floorStartX, floorStopX,
    gravityN: data.mKg * g,
  };
}

function slopeEnergyForces(data) {
  const d = slopeEnergyDerived(data);
  const fScale = 3; // px/N
  const vScale = 8; // px/(m/s)
  const M = d.blockM;
  // 斜面に沿う単位ベクトル（下向き）(cosθ, sinθ)。
  // 斜面に垂直な単位ベクトル（外向き）(−sinθ, −cosθ)。
  // 重力のめり込む成分の向きは (−sinθ, +cosθ) = (perp.x, −perp.y)。
  const along = { x: d.cosT, y: d.sinT };
  const perp = { x: -d.sinT, y: -d.cosT };
  if (data.phase === 'forces') {
    return [
      // 重力のラベルは矢印の左下に出し、分解のラベルと重ならないようにする。
      { id: 'gravity', short: '重力 20 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: -90, labelDy: -6, from: M },
      { id: 'normal', short: 'N≈17 N', color: 'blue', vector: [perp.x * d.normalN * fScale, perp.y * d.normalN * fScale], dashed: false, labelDx: 6, labelDy: -16, from: M },
      // 摩擦力の矢印は短い（約 10 px）が、力の図示では長さどおりに描く。
      // ラベルは玉の左上に置き、玉と重ならないようにする。
      { id: 'friction', short: 'f≈3.5 N', color: '#d35400', vector: [-along.x * d.frictionN * fScale, -along.y * d.frictionN * fScale], dashed: false, labelDx: -70, labelDy: -2, from: M },
      // 重力の分解：斜面に沿う成分 mg sinθ と、斜面にめり込む成分 mg cosθ。
      // めり込む向きは (perp.x, −perp.y) = (−sinθ, +cosθ)。2本の和が重力になる。
      // ラベルは矢印の先の右に出し、玉や重力の矢印と重ならないようにする。
      { id: 'decompSin', short: 'mg sinθ', color: '#888', vector: [along.x * d.gravityN * d.sinT * fScale, along.y * d.gravityN * d.sinT * fScale], dashed: true, labelDx: 14, labelDy: -4, from: M },
      { id: 'decompCos', short: 'mg cosθ', color: '#888', vector: [perp.x * d.gravityN * d.cosT * fScale, -perp.y * d.gravityN * d.cosT * fScale], dashed: true, labelDx: 30, labelDy: -2, from: M },
    ];
  }
  if (data.phase === 'energy') {
    // 下端の玉の速度。ラベルは矢印の先の上に置き、玉と重ならないようにする。
    return [
      { id: 'velocity', short: 'v≈5.7 m/s', color: '#d35400', vector: [d.vMs * vScale, 0], dashed: true, labelDx: -40, labelDy: -24, from: { x: 300, y: 228 } },
    ];
  }
  if (data.phase === 'trap') {
    // 摩擦ありとなしを並べる：速さの違いがひと目でわかる。
    return [
      { id: 'velocityFric', short: 'v≈5.7 m/s', color: '#d35400', vector: [d.vMs * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 80, y: 150 } },
      { id: 'velocityNoFric', short: 'v≈7.1 m/s', color: '#888', vector: [d.vNoFricMs * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 80, y: 210 } },
    ];
  }
  if (data.phase === 'floor') {
    // 床の上の玉：速度は右向き、摩擦力は左向き（玉の左端から描く）。
    return [
      { id: 'velocity', short: 'v≈5.7 m/s', color: '#d35400', vector: [d.vMs * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 80, y: 228 } },
      { id: 'friction', short: 'f=4.0 N', color: '#d35400', vector: [-d.floorFrictionN * fScale, 0], dashed: false, labelDx: -50, labelDy: -8, from: { x: 65, y: 228 } },
    ];
  }
  return []; // base：力はまだ描かない。
}

// ---- 組み合わせL：誘導＋LC回路（E5+E7）----
// 具体値（検算済み）：コイル N=100 回、面積 S=0.010 m²、磁場 B が 0→0.40 T に 0.20 s で増える。
//   磁束 Φ = BS = 4.0×10⁻³ Wb、誘導起電力 V = NΔΦ/Δt = 100×4.0×10⁻³/0.20 = 2.0 V
//   コンデンサ C=100 μF にためる電荷 Q = CV = 200 μC、エネルギー U = ½CV² = 0.20 mJ
//   スイッチを切り替えてコイル L=0.10 H につなぐと LC 振動：ω = 1/√(LC) ≈ 316 rad/s
//   周期 T = 2π/ω ≈ 0.020 s、振動数 f ≈ 50 Hz、最大電流 I0 = V√(C/L) ≈ 63 mA
//   エネルギー：½LI0² = 0.20 mJ（コンデンサのエネルギーと一致）
//   T/4 ≈ 0.0050 s でコンデンサは空になり、電流が最大になる。
// 罠：B が変わらなくなると ΔΦ/Δt = 0 になり、誘導起電力は 0 になる。
//   Δt を半分（0.10 s）にすると V は 2 倍の 4.0 V、Q も 2 倍の 400 μC になる。
// 図の矢印：電流の矢印は方向だけの固定長 60 px（電流の大きさは数字で示す）。
function inductionLCDerived(data) {
  const phiWb = data.bMaxT * data.areaM2;
  const vIndV = (data.turnsN * phiWb) / data.dtS;
  const capF = data.capUF * 1e-6;
  const qC = capF * vIndV;
  const uJ = 0.5 * capF * vIndV * vIndV;
  const omega = 1 / Math.sqrt(data.indH * capF);
  const periodS = (2 * Math.PI) / omega;
  const freqHz = 1 / periodS;
  const i0A = vIndV * Math.sqrt(capF / data.indH);
  const uCoilJ = 0.5 * data.indH * i0A * i0A;
  const vDoubleV = (data.turnsN * phiWb) / (data.dtS / 2);
  const qDoubleC = capF * vDoubleV;
  const qAt = (t) => qC * Math.cos(omega * t);
  const iAt = (t) => -i0A * Math.sin(omega * t);
  return {
    phiWb, vIndV, capF, qC, uJ, omega, periodS, freqHz, i0A, uCoilJ,
    vDoubleV, qDoubleC, tQuarterS: periodS / 4, tHalfS: periodS / 2, qAt, iAt,
  };
}

function inductionLCForces(data) {
  // 電流の矢印は方向だけ（60 px 固定）。I0≈63 mA は数字で示す。
  if (data.phase === 'base' || data.phase === 'lc') {
    return [
      { id: 'current', short: 'I（誘導電流）', color: '#d35400', vector: [60, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 120, y: 80 } },
    ];
  }
  return []; // charge・graph・trap：電流の矢印はない。
}

// ---- 組み合わせM：気体＋共鳴管（T1/T3+W3）----
// 具体値（検算済み）：ヘリウム（単原子、γ=5/3、M=4.0 g/mol）を体積 V=1.0 L の管に封入。
//   はじめ p1=1.0×10⁵ Pa、T1=300 K。物質量 n = pV/RT ≈ 0.040 mol。
//   定積加熱で T2=600 K にすると p2=2.0×10⁵ Pa、W=0、ΔU=(3/2)nRΔT=150 J、Q=150 J。
//   音速 v=√(γRT/M)：300 K で約 1020 m/s、600 K で約 1440 m/s（√2 倍）。
//   両端閉管（長さ L=0.85 m）の共鳴振動数 f_n = nv/(2L)：
//     f1 = 600 Hz → 847 Hz、f2 = 1200 Hz → 1695 Hz。
//   応用：f1=1200 Hz なら v=2Lf=2040 m/s、T=300×(2040/1020)²≈1200 K。
// 罠：圧力を 2 倍にしても（温度が同じなら）音速は変わらない。v=√(γRT/M) に p はない。
//   両端閉管を片端閉管の式 f=v/(4L) で計算すると 300 Hz になってしまう。
// 図の矢印：M は力の矢印を使わない（音速・振動数は数字と棒グラフで示す）。
function gasResonanceDerived(data) {
  const nMol = (data.p1Pa * data.volM3) / (data.rGas * data.t1K);
  const p2Pa = data.p1Pa * (data.t2K / data.t1K);
  const dUJ = 1.5 * nMol * data.rGas * (data.t2K - data.t1K);
  const wJ = 0; // 定積変化なので仕事は 0。吸熱 Q = ΔU。
  const qJ = dUJ + wJ;
  const v1Ms = Math.sqrt((data.gamma * data.rGas * data.t1K) / data.molarMassKg);
  const v2Ms = Math.sqrt((data.gamma * data.rGas * data.t2K) / data.molarMassKg);
  const f1aHz = v1Ms / (2 * data.pipeLM);
  const f1bHz = v2Ms / (2 * data.pipeLM);
  const f2aHz = v1Ms / data.pipeLM;
  const f2bHz = v2Ms / data.pipeLM;
  const fWrongHz = v1Ms / (4 * data.pipeLM); // 片端閉管の式をまちがえて使った値
  // 応用：基本振動数 1200 Hz から温度を逆算する。
  const vAppMs = 2 * data.pipeLM * 1200;
  const tAppK = data.t1K * (vAppMs / v1Ms) * (vAppMs / v1Ms);
  return {
    nMol, p2Pa, dUJ, wJ, qJ, v1Ms, v2Ms, f1aHz, f1bHz, f2aHz, f2bHz,
    fWrongHz, vAppMs, tAppK,
  };
}

function gasResonanceForces(/* data */) {
  return []; // 力の矢印はない。音速・振動数は drawBase の棒グラフとラベルで示す。
}

// ---- 組み合わせN：レール＋コンデンサ＋コイル（E6+E2+E7、X7型）----
// 具体値（検算済み）：B=1.0 T（裏向き）、レール幅 L=1.0 m、棒 m=0.50 kg、v0=2.0 m/s、
//   コンデンサ C=0.50 F、コイル L=0.50 H。
//   はじめの誘導起電力 ε0 = BLv0 = 2.0 V。
//   棒がコンデンサを充電しながらすべる：力積と電荷の保存から決まる。
//     運動量の変化 m(v1−v0) = −BLQ、充電後の Q = CBLv1。
//     → v1 = mv0/(m + B²L²C) = 1.0 m/s（B²L²C = 0.50 kg が「効き目の質量」）。
//     Q = CBLv1 = 0.50 C、U = Q²/(2C) = 0.25 J。
//     エネルギー：はじめ ½mv0² = 1.0 J → あと ½mv1² + U = 0.25 + 0.25 = 0.50 J。
//     残りの 0.50 J は充電の瞬間の電流のジュール熱になる（エネルギー保存だけでは v1 は求まらない）。
//   スイッチを切り替えてコイルにつなぐと LC 振動：ω = 1/√(LC) = 2.0 rad/s、
//     T = 2π/ω ≈ 3.14 s、f ≈ 0.32 Hz、I0 = Qω = 1.0 A、½LI0² = 0.25 J（= U）。
//     T/4 ≈ 0.79 s で q=0、i は最大になる。
// 罠：エネルギー保存だけを使うと v1 = v0/√(1 + B²L²C/m) ≈ 1.41 m/s になってしまう。
//   充電の瞬間はジュール熱が出るので、エネルギーは保存されない。力積 BLQ を使う。
// 図の矢印：速度の矢印は 30 px/(m/s)、電流の矢印は方向だけの固定長 60 px。
function railCapCoilDerived(data) {
  const effMassKg = data.bT * data.bT * data.railLM * data.railLM * data.capF;
  const eps0V = data.bT * data.railLM * data.v0Ms;
  const v1Ms = (data.mKg * data.v0Ms) / (data.mKg + effMassKg);
  const qC = data.capF * data.bT * data.railLM * v1Ms;
  const uJ = (qC * qC) / (2 * data.capF);
  const ke0J = 0.5 * data.mKg * data.v0Ms * data.v0Ms;
  const ke1J = 0.5 * data.mKg * v1Ms * v1Ms;
  const jouleJ = ke0J - ke1J - uJ;
  const vEnergyWrongMs = data.v0Ms / Math.sqrt(1 + effMassKg / data.mKg);
  const omega = 1 / Math.sqrt(data.indH * data.capF);
  const periodS = (2 * Math.PI) / omega;
  const freqHz = 1 / periodS;
  const i0A = qC * omega;
  const uCoilJ = 0.5 * data.indH * i0A * i0A;
  const qAt = (t) => qC * Math.cos(omega * t);
  const iAt = (t) => -i0A * Math.sin(omega * t);
  return {
    effMassKg, eps0V, v1Ms, qC, uJ, ke0J, ke1J, jouleJ, vEnergyWrongMs,
    omega, periodS, freqHz, i0A, uCoilJ,
    tQuarterS: periodS / 4, tHalfS: periodS / 2, qAt, iAt,
  };
}

function railCapCoilForces(data) {
  const d = railCapCoilDerived(data);
  const vScale = 30; // px/(m/s)
  if (data.phase === 'base') {
    return [
      { id: 'velocity', short: 'v0=2.0 m/s', color: '#d35400', vector: [data.v0Ms * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 140, y: 150 } },
    ];
  }
  if (data.phase === 'charge') {
    return [
      { id: 'velocity', short: 'v=1.0 m/s', color: '#d35400', vector: [d.v1Ms * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 140, y: 150 } },
      // 充電電流は上の配線を右向きに流れる（矢印は方向だけ、60 px 固定）。
      { id: 'current', short: 'I（充電）', color: '#d35400', vector: [60, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 170, y: 90 } },
    ];
  }
  if (data.phase === 'lc') {
    return [
      { id: 'current', short: 'I', color: '#d35400', vector: [60, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 120, y: 80 } },
    ];
  }
  return []; // graph・trap：矢印はない。
}

// ---- 組み合わせP：気体＋ピストン＋ばね＋サイクル（T1/T3+M8、X6型・京大2026第3問型）----
// 具体値（検算済み）：縦シリンダー、ピストン面積 S=0.010 m²、質量 m=10 kg（mg=100 N）、
//   ばね k=1000 N/m がピストンの上にあり、自然長はピストン高さ h=0.20 m の位置。
//   外は大気圧 p0=1.0×10⁵ Pa。気体はヘリウム（単原子、Cv=(3/2)R）。
//   ピストンの力のつり合い：p(h) = p0 + mg/S + k(h−0.20)/S（h > 0.20 m でばねが縮む）。
//   状態A：h=0.20 m、p=1.10×10⁵ Pa、V=2.0 L、T=300 K。nR = pV/T = 0.733 J/K（n ≈ 0.088 mol）。
//   A→B（加熱、ばねが縮む）：h=0.30 m、p=1.20×10⁵ Pa、V=3.0 L、T=491 K。
//     仕事 W=(pA+pB)/2×ΔV=115 J（台形の面積。等圧ではないので pA×ΔV=110 J はまちがい）、
//     ΔU=(3/2)nRΔT=210 J、Q=325 J。
//   B→C（ピストンを固定して冷やす）：V=3.0 L のまま T=300 K まで冷やすと p=0.733×10⁵ Pa。
//     W=0、ΔU=−210 J、Q=−210 J。
//   C→A（等温圧縮）：ピストンを手で支えながらゆっくり戻し、冷やして T=300 K に保つ。
//     W=nRT ln(VA/VC)=−89.2 J、ΔU=0（等温）、Q=−89.2 J。
//   正味の仕事 W=115−89.2=25.8 J、効率 η=25.8/325≈7.9%（吸熱は A→B の 325 J だけ）。
// 罠：A→B はばねが縮むので圧力が上がる（等圧ではない）。B→C は体積一定なので仕事は 0。
//   C→A は等温なので内部エネルギーは変わらない。効率の分母は正味の熱ではなく吸熱だけ。
// 図の縮尺：力は 20 N/px（気体の力 1100 N → 55 px、大気圧 1000 N → 50 px、重力・ばね 100 N → 5 px）。
//   ピストン高さは 400 px/m（h=0.20 m → ピストン y=180、h=0.30 m → y=140）。
//   p–V 図：V=1.5〜4.0 L → x=60〜340 px、p=0.5〜1.3×10⁵ Pa → y=240〜60 px。
function gasSpringCycleDerived(data) {
  const g = data.g || 10;
  const mgN = data.pistonKg * g;
  const pBal = (hM) => data.p0Pa + mgN / data.areaM2 + (data.kNm * (hM - data.hNatM)) / data.areaM2;
  const hA = data.hNatM;
  const pAPa = pBal(hA);
  const vAM3 = data.areaM2 * hA;
  const nRJ = (pAPa * vAM3) / data.tAK;
  const hB = data.hBM;
  const pBPa = pBal(hB);
  const vBM3 = data.areaM2 * hB;
  const tBK = (pBPa * vBM3) / nRJ;
  const wABJ = ((pAPa + pBPa) / 2) * (vBM3 - vAM3);
  const dUABJ = 1.5 * nRJ * (tBK - data.tAK);
  const qABJ = dUABJ + wABJ;
  const pCPa = (nRJ * data.tAK) / vBM3;
  const dUBCJ = 1.5 * nRJ * (data.tAK - tBK);
  const qBCJ = dUBCJ; // 体積一定なので W=0、Q=ΔU。
  const wCAJ = nRJ * data.tAK * Math.log(vAM3 / vBM3);
  const qCAJ = wCAJ; // 等温なので ΔU=0、Q=W。
  const wNetJ = wABJ + wCAJ;
  const eta = wNetJ / qABJ;
  // 図の配置：ピストン y = 260 − 400h。p–V 図の座標変換。
  const pistonY = (hM) => 260 - hM * 400;
  const pvX = (vLM) => 60 + (vLM - 1.5) * (280 / 2.5);
  const pvY = (p1e5) => 240 - (p1e5 - 0.5) * (180 / 0.8);
  return {
    mgN, pAPa, vAM3, nRJ, nMol: nRJ / data.rGas, hB, pBPa, vBM3, tBK,
    wABJ, dUABJ, qABJ, pCPa, dUBCJ, qBCJ, wCAJ, qCAJ, wNetJ, eta,
    pistonY, pvX, pvY,
    pistonYA: pistonY(hA), pistonYB: pistonY(hB),
    pAt: (vM3) => (nRJ * data.tAK) / vM3, // 等温線（C→A）の圧力。
  };
}

function gasSpringCycleForces(data) {
  const d = gasSpringCycleDerived(data);
  const fScale = 20; // N/px
  const gasN = (pPa) => pPa * data.areaM2;
  if (data.phase === 'base') {
    // 状態A：気体 1100 N（上）＝ 大気圧 1000 N ＋ 重力 100 N（下）。ばねは自然長で力は 0。
    return [
      { id: 'gasForce', short: '気体の力', color: '#d35400', vector: [0, -(gasN(d.pAPa) / fScale)], dashed: false, labelDx: 6, labelDy: -8, from: { x: 150, y: d.pistonYA } },
      { id: 'atmForce', short: '大気圧の力', color: 'purple', vector: [0, (gasN(data.p0Pa) / fScale)], dashed: false, labelDx: 6, labelDy: -6, from: { x: 250, y: d.pistonYA } },
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mgN / fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: d.pistonYA } },
    ];
  }
  if (data.phase === 'expand') {
    // 状態B：気体 1200 N（上）＝ 大気圧 1000 N ＋ 重力 100 N ＋ ばね 100 N（下）。
    const springN = data.kNm * (d.hB - data.hNatM);
    return [
      { id: 'gasForce', short: '気体の力', color: '#d35400', vector: [0, -(gasN(d.pBPa) / fScale)], dashed: false, labelDx: 6, labelDy: -8, from: { x: 150, y: d.pistonYB } },
      { id: 'atmForce', short: '大気圧の力', color: 'purple', vector: [0, (gasN(data.p0Pa) / fScale)], dashed: false, labelDx: 6, labelDy: -6, from: { x: 250, y: d.pistonYB } },
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mgN / fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: d.pistonYB } },
      { id: 'spring', short: 'ばねの力', color: 'green', vector: [0, springN / fScale], dashed: false, labelDx: 6, labelDy: -22, from: { x: 220, y: d.pistonYB - 6 } },
    ];
  }
  if (data.phase === 'lock') {
    // 状態C：ピストンを固定。気体 733 N に対して大気圧＋重力＋ばね = 1200 N。
    // つり合っていない分（467 N）は留め具が支える。
    const springN = data.kNm * (d.hB - data.hNatM);
    return [
      { id: 'gasForce', short: '気体の力', color: '#d35400', vector: [0, -(gasN(d.pCPa) / fScale)], dashed: false, labelDx: 6, labelDy: -8, from: { x: 150, y: d.pistonYB } },
      { id: 'atmForce', short: '大気圧の力', color: 'purple', vector: [0, (gasN(data.p0Pa) / fScale)], dashed: false, labelDx: 6, labelDy: -6, from: { x: 250, y: d.pistonYB } },
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mgN / fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: d.pistonYB } },
      { id: 'spring', short: 'ばねの力', color: 'green', vector: [0, springN / fScale], dashed: false, labelDx: 6, labelDy: -22, from: { x: 220, y: d.pistonYB - 6 } },
    ];
  }
  return []; // return・trap：力の矢印はない。
}

// ---- 円運動（M11）：水平面内の円運動と、鉛直面内のループ ----
// 具体値（検算済み）：m=1.0 kg、g=10 のとき
//   水平：r=0.50 m、v=2.0 m/s → T = mv²/r = 8.0 N、ω = v/r = 4.0 rad/s、周期 ≈ 1.57 s
//   ループ：R=0.50 m → 頂点の最小の速さ v_top = √(gR) ≈ 2.24 m/s（このとき N=0、
//     重力 mg=10 N だけが向心力 mv²/R=10 N になる）
//     最下点の速さ v_bottom = √(v_top² + 4gR) = 5.0 m/s、N = mg + mv²/R = 60 N
// 向心力は新しい力ではない。水平では張力 T が、ループでは重力と垂直抗力の合力が
// その役割を果たす。「必要な向心力」の矢印は破線（力ではなく、要請の目印）。
// 力の縮尺：2.5 px/N。速度の矢印は 15 px/(m/s)。半径の図示：200 px/m。
function circleDerived(data) {
  const g = data.g || 10;
  const m = data.mKg || 1;
  const omega = data.vMs / data.rM;
  const tensionN = (m * data.vMs * data.vMs) / data.rM;
  const vTop = Math.sqrt(g * data.loopR);
  const vBottom = Math.sqrt(vTop * vTop + 4 * g * data.loopR);
  const nBottomN = m * g + (m * vBottom * vBottom) / data.loopR;
  return { g, m, omega, periodS: (2 * Math.PI) / omega, tensionN, vTop, vBottom, nBottomN, mgN: m * g };
}

function circleForces(data, phase) {
  const d = circleDerived(data);
  const fScale = data.fScalePxPerN || 2.5;
  const vScale = data.vScalePxPerMs || 15;
  const rPx = data.rM * (data.rScalePxPerM || 200);
  const center = { x: 200, y: 150 };
  if (phase === 'horizontal') {
    const pos = { x: center.x + rPx, y: center.y };
    return {
      forces: [
        { id: 'tension', short: '張力 T', color: 'blue', vector: [-d.tensionN * fScale, 0], dashed: false, labelDx: -8, labelDy: -8, from: pos },
        { id: 'velocity', short: '速度 v', color: '#d35400', vector: [0, -data.vMs * vScale], dashed: true, labelDx: 6, labelDy: -8, from: pos },
        { id: 'radius', short: '半径 r', color: '#666', vector: [-rPx, 0], dashed: true, labelDx: 6, labelDy: 14, from: pos },
      ],
      derived: d, center, pos, rPx,
    };
  }
  if (phase === 'top') {
    const pos = { x: center.x, y: center.y - rPx };
    return {
      forces: [
        { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: pos },
        { id: 'velocity', short: '速度 v', color: '#d35400', vector: [d.vTop * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: pos },
        // 必要な向心力は重力と等しい（破線）。垂直抗力は 0 なので矢印は描けない。
        { id: 'required', short: '必要な向心力', color: '#b00', vector: [0, d.mgN * fScale], dashed: true, labelDx: 6, labelDy: -6, from: { x: pos.x + 60, y: pos.y } },
      ],
      derived: d, center, pos, rPx,
    };
  }
  // bottom
  const pos = { x: center.x, y: center.y + rPx };
  return {
    forces: [
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: pos },
      { id: 'normal', short: '垂直抗力 N', color: 'blue', vector: [0, -d.nBottomN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: pos },
      { id: 'velocity', short: '速度 v', color: '#d35400', vector: [-data.vBottom * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: pos },
      { id: 'required', short: '必要な向心力', color: '#b00', vector: [0, -d.mgN * fScale], dashed: true, labelDx: 6, labelDy: -6, from: { x: pos.x + 60, y: pos.y } },
    ],
    derived: d, center, pos, rPx,
  };
}

// ---- 単振動・振り子（M12）：ばねの単振動と単振り子 ----
// 具体値（検算済み）：g=10 のとき
//   ばね：m=1.0 kg、k=100 N/m → ω = √(k/m) = 10 rad/s、T = 2π/ω ≈ 0.63 s、f ≈ 1.59 Hz
//     A=0.10 m → v_max = ωA = 1.0 m/s、a_max = ω²A = 10 m/s²、ばねの力の最大値 kA = 10 N
//     A=0.20 m → v_max = 2.0 m/s、a_max = 20 m/s²。周期は変わらない（振幅に依らない）。
//   振り子：L=1.0 m → ω = √(g/L) ≈ 3.16 rad/s、T = 2π√(L/g) ≈ 1.99 s（約 2.0 s）
//     振れ角 5°：弧の長さ Lθ ≈ 0.087 m、v_max = ωLθ ≈ 0.28 m/s
//     張力 T = mg cosθ ≈ 9.96 N、接線方向の復元力 mg sinθ ≈ 0.87 N
// 力の縮尺：6 px/N。変位の図示：400 px/m。速度の矢印は 30 px/(m/s)。
function shmDerived(data) {
  const g = data.g || 10;
  const omega = Math.sqrt(data.k / data.mKg);
  const omegaP = Math.sqrt(g / data.lengthM);
  const thetaRad = deg2rad(data.thetaDeg || 5);
  return {
    omega, periodS: (2 * Math.PI) / omega, freqHz: omega / (2 * Math.PI),
    vMaxMs: omega * data.amplitudeM, aMaxMs2: omega * omega * data.amplitudeM,
    fMaxN: data.k * data.amplitudeM, mgN: data.mKg * g,
    omegaP, periodPS: (2 * Math.PI) / omegaP,
    arcM: data.lengthM * thetaRad, vMaxPMs: omegaP * data.lengthM * thetaRad,
    tensionN: data.mKg * g * Math.cos(thetaRad), tangentialN: data.mKg * g * Math.sin(thetaRad),
  };
}

function shmForces(data, phase) {
  const d = shmDerived(data);
  const fScale = 6, vScale = 30, xScale = 400;
  const eqX = 200, cy = 180;
  if (phase === 'spring-max') {
    const pos = { x: eqX + d.amplitudeM * xScale, y: cy };
    return {
      forces: [
        { id: 'springForce', short: 'ばねの力', color: 'blue', vector: [-d.fMaxN * fScale, 0], dashed: false, labelDx: -8, labelDy: -8, from: pos },
        { id: 'amplitude', short: '振幅 A', color: '#b00', vector: [d.amplitudeM * xScale, 0], dashed: true, labelDx: 6, labelDy: -4, from: { x: eqX, y: cy + 40 } },
      ],
      derived: d, eqX, cy, pos,
    };
  }
  if (phase === 'spring-eq') {
    const pos = { x: eqX, y: cy };
    return {
      forces: [
        { id: 'velocity', short: '速度 v', color: '#d35400', vector: [d.vMaxMs * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: pos },
      ],
      derived: d, eqX, cy, pos,
    };
  }
  // pendulum：支点 (200,60)、糸の長さ 200px（L=1.0 m、200 px/m）。
  const pivot = { x: 200, y: 60 };
  const lenPx = data.lengthM * 200;
  const th = deg2rad(data.thetaDeg || 5);
  const pos = { x: pivot.x + lenPx * Math.sin(th), y: pivot.y + lenPx * Math.cos(th) };
  const along = [Math.sin(th), Math.cos(th)]; // 支点からおもりへの単位ベクトル
  const tangent = [Math.cos(th), -Math.sin(th)]; // 速さが増す向き（接線方向、戻る向きの逆）
  return {
    forces: [
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mgN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: pos },
      { id: 'tension', short: '張力', color: 'blue', vector: [-along[0] * d.tensionN * fScale, -along[1] * d.tensionN * fScale], dashed: false, labelDx: 6, labelDy: -10, from: pos },
      { id: 'tangential', short: 'mg sinθ', color: '#b00', vector: [-tangent[0] * d.tangentialN * fScale, -tangent[1] * d.tangentialN * fScale], dashed: true, labelDx: 6, labelDy: -6, from: pos },
    ],
    derived: d, pivot, lenPx, pos,
  };
}

// ---- 運動量・衝突（M10）：弾性衝突と非弾性衝突（合体） ----
// 具体値（検算済み）：m1=2.0 kg、v1=3.0 m/s、m2=1.0 kg（静止）、g は使わない。
//   弾性衝突：v1' = (m1−m2)/(m1+m2)・v1 = 1.0 m/s、v2' = 2m1/(m1+m2)・v1 = 4.0 m/s
//     運動量：2.0×3.0 = 6.0 → 2.0×1.0 + 1.0×4.0 = 6.0（保存）
//     運動エネルギー：9.0 J → 1.0 + 8.0 = 9.0 J（保存）
//   合体（完全非弾性）：v' = m1v1/(m1+m2) = 2.0 m/s
//     運動量：6.0 → 3.0×2.0 = 6.0（保存）
//     運動エネルギー：9.0 J → 6.0 J（3.0 J 失われる。熱や変形に使われた）
// 速度の矢印は 15 px/(m/s)。床はなめらか（外力の力積はない）とする。
function collisionDerived(data) {
  const mTotal = data.m1Kg + data.m2Kg;
  const v1p = ((data.m1Kg - data.m2Kg) / mTotal) * data.v1Ms;
  const v2p = ((2 * data.m1Kg) / mTotal) * data.v1Ms;
  const vStick = (data.m1Kg * data.v1Ms) / mTotal;
  const keBefore = 0.5 * data.m1Kg * data.v1Ms * data.v1Ms;
  return {
    mTotal, v1p, v2p, vStick,
    pBefore: data.m1Kg * data.v1Ms,
    pElastic: data.m1Kg * v1p + data.m2Kg * v2p,
    keBefore,
    keElastic: 0.5 * data.m1Kg * v1p * v1p + 0.5 * data.m2Kg * v2p * v2p,
    keStick: 0.5 * mTotal * vStick * vStick,
    keLost: keBefore - 0.5 * mTotal * vStick * vStick,
  };
}

function collisionForces(data, phase) {
  const d = collisionDerived(data);
  const vScale = data.vScalePxPerMs || 15;
  const cy = 220;
  const forces = [];
  if (phase === 'before') {
    forces.push(
      { id: 'velocity1', short: 'v1', color: '#d35400', vector: [data.v1Ms * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 110, y: 180 } },
    );
  } else if (phase === 'elastic') {
    forces.push(
      { id: 'velocity1p', short: "v1'", color: '#d35400', vector: [d.v1p * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 180, y: 180 } },
      { id: 'velocity2p', short: "v2'", color: '#d35400', vector: [d.v2p * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 260, y: 180 } },
    );
  } else {
    forces.push(
      { id: 'velocityStick', short: "v'", color: '#d35400', vector: [d.vStick * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 200, y: 180 } },
    );
  }
  return { forces, derived: d, cy };
}

// ---- 万有引力・人工衛星（M14）：地表の g0 と地球半径 R だけを JSON から受け取り、
// 軌道の速さ・周期・軌道上の重力を描画側で計算する ----
// 具体値（検算済み、g0=10 m/s²、R=6.4e6 m、GM=g0R²）：
//   低軌道 r=R：v=√(GM/r)=8000 m/s、T=2π√(r³/GM)≈5027 s（約84分）、g=10 m/s²
//   r=2R（高度 R）：v≈5657 m/s、T≈14217 s（約237分）、g=g0(R/r)²=2.5 m/s²
//   静止軌道 r≈6.66R（高度 3.62e7 m）：v≈3100 m/s、T≈86321 s（約24時間）、g≈0.23 m/s²
//   脱出速度 √(2g0R)≈11314 m/s（低軌道の速さの √2 倍）。
// 図の縮尺：軌道半径はつねに 120px（場面ごとに縮尺が変わる）。地球の半径は 120×R/r px。
// 速度の矢印は 0.01 px/(m/s)、重力の矢印は 6 px/(m/s²)。
// 地表の g=10 を軌道高度でも使うと、速さも周期も間違う——それがこの問題の罠。
function gravitationDerived(data) {
  const g0 = data.g0 || 10;
  const R = data.radiusM || 6.4e6;
  const GM = g0 * R * R;
  const r = R + (data.altitudeM || 0);
  const v = Math.sqrt(GM / r);
  const periodS = 2 * Math.PI * Math.sqrt((r * r * r) / GM);
  const g = g0 * (R / r) * (R / r);
  return { g0, R, GM, r, v, periodS, g };
}

function gravitationForces(data) {
  const d = gravitationDerived(data);
  const orbitPx = 120;
  const earthPx = orbitPx * (d.R / d.r);
  const sat = { x: 200, y: 150 - orbitPx };
  return {
    forces: [
      // ラベルは衛星の近くで重ならないよう、重力は左側、速度は矢印の下側に出す。
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.g * 6], dashed: false, labelDx: -60, labelDy: -6, from: sat },
      { id: 'velocity', short: '速度 v', color: '#d35400', vector: [d.v * 0.01, 0], dashed: true, labelDx: 6, labelDy: 16, from: sat },
    ],
    derived: d, orbitPx, earthPx, sat,
  };
}

// ---- 定常波・共鳴（W3）：弦の長さ・波の速さ・倍音の番号だけを JSON から受け取り、
// 振動数と節・腹の位置を描画側で計算する ----
// 具体値（検算済み）：
//   弦 L=1.0 m、v=200 m/s：f_n = nv/2L → n=1:100 Hz、n=2:200 Hz、n=3:300 Hz
//     節：n=1 は 0, 1.0 m / n=2 は 0, 0.50, 1.0 m / n=3 は 0, 0.33, 0.67, 1.0 m
//   開管 L=0.85 m、v=340 m/s：f_n = nv/2L → 200, 400, 600 Hz（両端が腹）
//   閉管 L=0.85 m、v=340 m/s：f_n = (2n−1)v/4L → 100, 300, 500 Hz（奇数倍音のみ）
//     閉じた端は節、開いた端は腹。閉管に nv/2L を使うと、偶数倍音を出してしまう罠。
// 図の縮尺：長さ 280px（x=60〜340）。波形は節・腹の位置から計算して描く。
function standingWaveDerived(data) {
  const L = data.lengthM, v = data.waveSpeedMs, n = data.n;
  let freqHz, harmonicM, nodes, antinodes;
  if (data.mode === 'closed') {
    harmonicM = 2 * n - 1;
    freqHz = (harmonicM * v) / (4 * L);
    nodes = [];
    for (let k = 0; k <= (harmonicM - 1) / 2; k++) nodes.push((2 * k / harmonicM) * L);
    antinodes = [];
    for (let k = 0; k < (harmonicM + 1) / 2; k++) antinodes.push(((2 * k + 1) / harmonicM) * L);
  } else {
    harmonicM = n;
    freqHz = (n * v) / (2 * L);
    if (data.mode === 'string') {
      nodes = [];
      for (let k = 0; k <= n; k++) nodes.push((k / n) * L);
      antinodes = [];
      for (let k = 0; k < n; k++) antinodes.push(((2 * k + 1) / (2 * n)) * L);
    } else { // open pipe：両端が腹
      antinodes = [];
      for (let k = 0; k <= n; k++) antinodes.push((k / n) * L);
      nodes = [];
      for (let k = 0; k < n; k++) nodes.push(((2 * k + 1) / (2 * n)) * L);
    }
  }
  return { freqHz, harmonicM, nodes, antinodes };
}

// ---- 光電効果（A1）：波長・仕事関数だけを JSON から受け取り、光子のエネルギーと
// 電子の最大の運動エネルギー・速さを描画側で計算する ----
// 具体値（検算済み、φ=2.0 eV、h=4.14e-15 eV·s、c=3.0e8 m/s）：
//   650 nm：f≈4.62e14 Hz、E=hf≈1.91 eV < φ → 電子は出ない（強くしても出ない）
//   400 nm：f=7.50e14 Hz、E=3.10 eV、Kmax=1.10 eV、v_max≈6.2e5 m/s
//   300 nm：f=1.00e15 Hz、E=4.14 eV、Kmax=2.14 eV、v_max≈8.7e5 m/s
//   限界振動数 f0=φ/h≈4.83e14 Hz、限界波長 λ0=c/f0≈621 nm
//   明るい光：光子の数が増えるだけで、1個の光子のエネルギーは変わらない。
//   だから Kmax（電子の速さ）は変わらず、電子の数だけが増える。
// 電子の矢印の縮尺：8.0e-5 px/(m/s)（6.22e5 m/s → 約 50px、8.68e5 m/s → 約 70px）。
function photoelectricDerived(data) {
  const fHz = data.cMs / (data.wavelengthNm * 1e-9);
  const energyEv = data.hEvS * fHz;
  const kMaxEv = Math.max(energyEv - data.workFunctionEv, 0);
  const emitted = energyEv > data.workFunctionEv;
  const eV = 1.602e-19, me = 9.11e-31;
  const vMaxMs = emitted ? Math.sqrt((2 * kMaxEv * eV) / me) : 0;
  const thresholdHz = data.workFunctionEv / data.hEvS;
  const thresholdNm = (data.cMs / thresholdHz) * 1e9;
  return { fHz, energyEv, kMaxEv, emitted, vMaxMs, thresholdHz, thresholdNm };
}

function photoelectricForces(data) {
  const d = photoelectricDerived(data);
  const plateX = 200;
  const lightCount = data.intensity || 1;
  const electronCount = d.emitted ? Math.min(lightCount, 2) : 0;
  const vScale = 8.0e-5; // px/(m/s)
  const forces = [];
  const lightYs = lightCount === 1 ? [180] : lightCount === 2 ? [150, 210] : [140, 180, 220];
  lightYs.forEach((y, i) => forces.push({
    id: 'light' + (i + 1), short: i === 0 ? '光' : '', color: '#d35400',
    vector: [100, 0], dashed: true, labelDx: -52, labelDy: -8, from: { x: 90, y },
  }));
  const elecYs = electronCount === 1 ? [180] : [150, 210];
  elecYs.forEach((y, i) => forces.push({
    id: 'electron' + (i + 1), short: i === 0 ? '電子' : '', color: 'blue',
    vector: [d.vMaxMs * vScale, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: plateX + 10, y },
  }));
  return { forces, derived: d, vScale, plateX };
}

// ---- 熱サイクル・熱機関（T3）：p–V図の長方形サイクル ----
// 具体値（検算済み）：単原子分子の理想気体 n≈0.040 mol、Cv=3R/2、Cp=5R/2、R=8.31
//   A(1.0e5 Pa, 1.0 L, 300 K) → D(3.0e5 Pa, 1.0 L, 900 K) 等積：ΔU=+300 J、W=0、Q=+300 J
//   D → C(3.0e5 Pa, 3.0 L, 2700 K) 等圧膨張：ΔU=+900 J、W=+600 J、Q=+1500 J
//   C → B(1.0e5 Pa, 3.0 L, 900 K) 等積：ΔU=−900 J、W=0、Q=−900 J
//   B → A 等圧圧縮：ΔU=−300 J、W=−200 J、Q=−500 J
//   1サイクル：W=+400 J、吸収した熱 Qin=1800 J、放出した熱 Qout=1400 J、効率 η=400/1800≈22%
//   カルノー効率 1−300/2700≈89% よりずっと小さい（このサイクルはカルノーサイクルではない）。
// 図の縮尺：V は 70 px/1.0×10⁻³ m³（1 L→70px）、p は 50 px/1.0×10⁵ Pa。
//   したがって p–V図の長方形の面積は 140×100=14000 px² で、1 px² あたり
//   (1.0e5/50)×(1.0e-3/70)=0.0286 J/px² だから、仕事は 14000×0.0286=400 J と一致する。
// 罠：等圧変化の Q は nCpΔT、等積変化の Q は nCvΔT。Cp と Cv を取り違えると
//   Q が 300 J ずつずれる。W の符号も、膨張が +、圧縮が −（外がした仕事は −W）。
function heatCycleDerived(data) {
  const rGas = data.rGas || 8.31;
  const nCv = data.nMol * (data.cvFactor || 1.5) * rGas; // J/K（≈0.50）
  const nCp = data.nMol * (data.cpFactor || 2.5) * rGas; // J/K（≈0.833）
  const tA = data.tAK; // 300 K
  const tD = tA * (data.p2Pa / data.p1Pa); // 等積で p が 3 倍 → 900 K
  const tC = tD * (data.v2M3 / data.v1M3); // 等圧で V が 3 倍 → 2700 K
  const tB = tC * (data.p1Pa / data.p2Pa); // 等積で p が 1/3 → 900 K
  const procs = [
    { id: 'processAD', name: 'A→D', kind: 'isochoric', pPa: data.p1Pa, dT: tD - tA, wJ: 0 },
    { id: 'processDC', name: 'D→C', kind: 'isobaric', pPa: data.p2Pa, dT: tC - tD, wJ: data.p2Pa * (data.v2M3 - data.v1M3) },
    { id: 'processCB', name: 'C→B', kind: 'isochoric', pPa: data.p2Pa, dT: tB - tC, wJ: 0 },
    { id: 'processBA', name: 'B→A', kind: 'isobaric', pPa: data.p1Pa, dT: tA - tB, wJ: data.p1Pa * (data.v1M3 - data.v2M3) },
  ];
  for (const p of procs) {
    p.dUJ = nCv * p.dT;
    p.qJ = p.dUJ + p.wJ;
  }
  const wNetJ = procs.reduce((s, p) => s + p.wJ, 0);
  const qInJ = procs.filter((p) => p.qJ > 0).reduce((s, p) => s + p.qJ, 0);
  const qOutJ = -procs.filter((p) => p.qJ < 0).reduce((s, p) => s + p.qJ, 0);
  const corners = {
    A: { x: 70 + (data.v1M3 / 1e-3) * 70, y: 250 - (data.p1Pa / 1e5) * 50 },
    D: { x: 70 + (data.v1M3 / 1e-3) * 70, y: 250 - (data.p2Pa / 1e5) * 50 },
    C: { x: 70 + (data.v2M3 / 1e-3) * 70, y: 250 - (data.p2Pa / 1e5) * 50 },
    B: { x: 70 + (data.v2M3 / 1e-3) * 70, y: 250 - (data.p1Pa / 1e5) * 50 },
  };
  return {
    tA, tD, tC, tB, nCv, nCp, procs, wNetJ, qInJ, qOutJ,
    eta: wNetJ / qInJ, carnotEta: 1 - tA / tC, corners,
    pxPerM3: 70 / 1e-3, pxPerPa: 50 / 1e5,
  };
}

function heatCycleForces(data) {
  const d = heatCycleDerived(data);
  const c = d.corners;
  const edge = (id, short, color, from, to, dx, dy) => ({
    id, short, color, vector: [to.x - from.x, to.y - from.y], dashed: false, labelDx: dx, labelDy: dy, from,
  });
  return [
    edge('processAD', 'A→D', 'red', c.A, c.D, 8, -6),
    // 過程ラベルは辺の中ほどに出し、角の点ラベル C・A と重ならないようにする。
    edge('processDC', 'D→C', 'red', c.D, c.C, -70, -10),
    edge('processCB', 'C→B', 'blue', c.C, c.B, 8, -6),
    edge('processBA', 'B→A', 'blue', c.B, c.A, 70, 16),
  ];
}

// ---- レール＋棒の電磁誘導（E6）：運動→磁束変化→誘導起電力→電流→磁場の力→終端速度 ----
// 具体値（検算済み）：B=0.40 T、レール間隔 L=0.50 m、抵抗 R=2.0 Ω、棒の質量 m=0.20 kg、
//   外から右向きに一定の力 F=0.080 N で引く。棒は静止から出発する。
//   BL=0.20 V/(m/s)、(BL)²/R=0.020 N・s/m、終端速度 v_t=F・R/(BL)²=4.0 m/s、時定数 τ=mR/(BL)²=10 s
//   v=2.0 m/s のとき：ε=BLv=0.40 V、I=ε/R=0.20 A、磁場の力 F_mag=BIL=0.040 N、
//     合力 0.040 N、加速度 a=0.20 m/s²、ジュール熱 I²R=0.080 W、外力の仕事率 Fv=0.16 W
//   終端速度 v=4.0 m/s のとき：ε=0.80 V、I=0.40 A、F_mag=0.080 N=F、a=0、
//     I²R=0.32 W=F・v_t（外力の仕事はすべてジュール熱になる）。
//   外力がなければ棒は止まる：初速 4.0 m/s なら、止まるまでに進む距離は v0・τ=40 m、
//   初めの運動エネルギー 1.6 J がすべてジュール熱になる。
// 罠：起電力は磁束そのものではなく磁束の「変化」で決まる（ε=BLv）。電流の向きは
//   レンツの法則で、磁場の力はつねに運動を妨げる向き。終端速度では合力が 0 になる。
// 矢印の縮尺：速度 15 px/(m/s)、電流 100 px/A、力 500 px/N。
function railRodDerived(data) {
  const bl = data.bT * data.railLengthM; // V/(m/s)
  const k = (bl * bl) / data.resistanceOhm; // N・s/m（制動の係数）
  const v = data.vMs || 0;
  const emfV = bl * v;
  const currentA = emfV / data.resistanceOhm;
  const fMagN = data.bT * currentA * data.railLengthM;
  const fNetN = data.extForceN - fMagN;
  const accelMs2 = fNetN / data.massKg;
  const pJouleW = currentA * currentA * data.resistanceOhm;
  const pExtW = data.extForceN * v;
  return {
    bl, k, v, emfV, currentA, fMagN, fNetN, accelMs2, pJouleW, pExtW,
    pKeW: pExtW - pJouleW, // 運動エネルギーの増加率（= F_net・v）
    vtMs: data.extForceN / k, tauS: data.massKg / k,
    xStopM: 4.0 * (data.massKg / k), ke0J: 0.5 * data.massKg * 16,
  };
}

function railRodForces(data) {
  const d = railRodDerived(data);
  return [
    { id: 'velocity', short: 'v', color: '#d35400', vector: [d.v * 15, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 200, y: 160 } },
    { id: 'current', short: 'I', color: 'blue', vector: [0, -d.currentA * 100], dashed: false, labelDx: 6, labelDy: -8, from: { x: 200, y: 200 } },
    // 「磁場の力」は矢印の下・左側に出して棒と重ならないようにする。「引く力」は矢印の左上に置く。
    { id: 'magForce', short: '磁場の力', color: 'purple', vector: [-d.fMagN * 500, 0], dashed: false, labelDx: -60, labelDy: 16, from: { x: 200, y: 160 } },
    { id: 'extForce', short: '引く力', color: 'green', vector: [data.extForceN * 500, 0], dashed: false, labelDx: -40, labelDy: -20, from: { x: 200, y: 130 } },
  ];
}

// ---- ドップラー効果（W4）：音源・観測者の移動と、うなり ----
// 具体値（検算済み）：音速 V=340 m/s、音源の振動数 f=440 Hz、音源の速さ vs=34 m/s（=V/10）、観測者の速さ vo=34 m/s
//   静止時の波長 λ=V/f≈0.77 m
//   音源が近づく：f'=f・V/(V−vs)=440×340/306≈489 Hz、波長 λ'=(V−vs)/f≈0.70 m（0.90 倍に縮む）
//   音源が遠ざかる：f'=f・V/(V+vs)=400 Hz、波長 λ'=0.85 m（1.10 倍に伸びる）
//   観測者が近づく：f'=f・(V+vo)/V=484 Hz（波長は変わらない）
//   観測者が遠ざかる：f'=f・(V−vo)/V=396 Hz
//   反射波（壁に近づく音源）：壁で受ける音は 489 Hz、壁が音源になって戻るともう1回シフトし、
//     f''=f・(V+vs)/(V−vs)≈538 Hz。1回だけだと 489 Hz と間違う（この問題の罠）。
//   うなり：440 Hz と 444 Hz → 4.0 Hz（0.25 s ごとに強くなる）。
// 図の縮尺：波長 0.77 m を 40 px とする（51.8 px/m）。近づく側の波の間隔は 0.90 倍の 36 px、
//   遠ざかる側は 1.10 倍の 44 px。うなりの周期 0.25 s は 280 px/s で 70 px。
// 罠：音源が動くときは波長が変わる（分母が変わる）が、観測者が動くときは波長は変わらない（分子が変わる）。
function dopplerDerived(data) {
  const V = data.soundSpeedMs, f = data.freqHz, vs = data.sourceSpeedMs, vo = data.observerSpeedMs;
  const lamM = V / f;
  const fApproach = (f * V) / (V - vs);
  const fRecede = (f * V) / (V + vs);
  const fObsApproach = (f * (V + vo)) / V;
  const fObsRecede = (f * (V - vo)) / V;
  const fReflect = (f * (V + vs)) / (V - vs); // 2回シフト
  const f2 = f + data.beatFreqHz;
  const beatPeriodS = 1 / data.beatFreqHz;
  const basePx = 40; // 静止時の波長 1 つ分の図示
  return {
    lamM, fApproach, fRecede, fObsApproach, fObsRecede, fReflect, f2, beatPeriodS,
    lamApproachM: (V - vs) / f, lamRecedeM: (V + vs) / f,
    basePx, approachPx: basePx * ((V - vs) / V), recedePx: basePx * ((V + vs) / V),
    beatPx: beatPeriodS * 280,
  };
}

function dopplerForces(data) {
  const moving = data.phase === 'approach' || data.phase === 'reflect';
  const obsMoving = data.phase === 'observer';
  return [
    { id: 'sourceVelocity', short: 'v_s', color: '#d35400', vector: [moving ? data.sourceSpeedMs * 1.5 : 0, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 200, y: 180 } },
    { id: 'observerVelocity', short: 'v_o', color: 'blue', vector: [obsMoving ? -data.observerSpeedMs * 1.5 : 0, 0], dashed: false, labelDx: -34, labelDy: -8, from: { x: 320, y: 180 } },
  ];
}

// ---- ドップラー＋単振動（組み合わせI）：ばねに載った音源の速度が周期的に変わる ----
// 具体値（検算済み）：ばね m=1.0 kg、k=100 N/m、振幅 A=0.20 m、音源 f=440 Hz、音速 V=340 m/s
//   ω = √(k/m) = 10 rad/s、周期 T = 2π/ω ≈ 0.63 s
//   音源の最大の速さ v_max = ωA = 2.0 m/s、最大の加速度 a_max = ω²A = 20 m/s²、ばねの力の最大値 kA = 20 N
//   音源の速度 v_s(t) = 2.0 cos(10t) m/s（つり合い位置で観測者へ向かうとき最大）
//   観測振動数 f'(t) = f・V/(V − v_s(t))
//     最大（近づくとき）：f' = 440×340/338 ≈ 442.6 Hz
//     最小（遠ざかるとき）：f' = 440×340/342 ≈ 437.4 Hz
//     折り返し点（v_s = 0）：f' = 440 Hz（シフトなし）
//   静止時の波長 λ = V/f ≈ 0.77 m
//   440 Hz の固定音源とのうなり：最大で |442.6 − 440| ≈ 2.6 Hz、うなりの周期 ≈ 0.38 s
// 罠：観測振動数は一定ではない。ばねの周期（約 0.63 s）で 442.6 Hz と 437.4 Hz の間を往復する。
//   折り返し点では音源が一番大きく変位しているのに、速度が 0 なのでドップラーシフトは 0 になる。
// 図の縮尺：振幅 0.20 m を 80 px（400 px/m）。速度の矢印は 20 px/(m/s)（2.0 m/s → 40 px）。
//   ばねの力の矢印は 2 px/N（20 N → 40 px）。f' のグラフは 30 px/Hz、うなりの包絡線は 140 px。
function dopplerShmDerived(data) {
  const omega = Math.sqrt(data.kNm / data.mKg);
  const periodS = (2 * Math.PI) / omega;
  const vMaxMs = omega * data.ampM;
  const aMaxMs2 = omega * omega * data.ampM;
  const fMaxN = data.kNm * data.ampM;
  const V = data.soundSpeedMs, f = data.freqHz;
  const lamM = V / f;
  const fMaxHz = (f * V) / (V - vMaxMs);
  const fMinHz = (f * V) / (V + vMaxMs);
  const beatMaxHz = fMaxHz - f;
  const beatMinHz = f - fMinHz;
  const beatPeriodS = 1 / beatMaxHz;
  const wallX = 40, eqX = 200, ampPx = data.ampM * 400, srcY = 150, obsX = 350;
  const fPrimeAt = (t) => (f * V) / (V - vMaxMs * Math.cos(omega * t));
  return {
    omega, periodS, vMaxMs, aMaxMs2, fMaxN, lamM, fMaxHz, fMinHz,
    beatMaxHz, beatMinHz, beatPeriodS, wallX, eqX, ampPx, srcY, obsX, fPrimeAt,
    turnX: eqX + ampPx,
  };
}

function dopplerShmForces(data) {
  const d = dopplerShmDerived(data);
  if (data.phase === 'approach') {
    // つり合い位置で観測者へ向かう：速度が最大、ばねの力は 0。
    return [
      { id: 'srcVel', short: 'v_s=2.0 m/s', color: '#d35400', vector: [d.vMaxMs * 20, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: d.eqX, y: d.srcY } },
    ];
  }
  if (data.phase === 'turn') {
    // 折り返し点：速度は 0、ばねの力は最大でつり合い位置向き（左向き）。
    return [
      { id: 'springForce', short: 'F=20 N', color: 'red', vector: [-d.fMaxN * 2, 0], dashed: false, labelDx: -6, labelDy: -30, from: { x: d.turnX, y: d.srcY } },
    ];
  }
  return []; // base・graph・beat：速度・力の矢印はない。
}

// ---- 直流回路（E3）：起電力・内部抵抗・直列・並列・電力 ----
// 具体値（検算済み）：電池 E=12 V、内部抵抗 r=1.0 Ω、R1=4.0 Ω と並列（R2=6.0 Ω、R3=12 Ω）の直列。
//   並列の合成抵抗 Rp=1/(1/6+1/12)=4.0 Ω、全抵抗 R=1+4+4=9.0 Ω、全電流 I=E/R≈1.33 A
//   端子電圧 V=E−Ir≈10.7 V、R1 の電圧 5.33 V、並列部の電圧 5.33 V
//   分流 I2=5.33/6≈0.89 A、I3=5.33/12≈0.44 A、I2+I3=I
//   電力：電池 EI=16 W = 内部抵抗 1.78 W + R1 7.11 W + R2 4.74 W + R3 2.37 W
//   外部を短絡すると I=E/r=12 A。R1 を外すと I=2.4 A、端子電圧 9.6 V。
// 罠：並列にすると合成抵抗は「増える」のではなく減る（逆数の和）。端子電圧は起電力そのものではなく、
//   内部抵抗での電圧降下 Ir だけ下がる。電流が大きいほど端子電圧は下がる。
// 図の縮尺：電流の矢印は 30 px/A（I≈1.33 A → 40 px、I2≈0.89 A → 27 px、I3≈0.44 A → 13 px）。
//   回路図の配線の位置は回路の形から決めるが、電流矢印の長さは電流から計算する。
function dcCircuitDerived(data) {
  const rPar = 1 / (1 / data.r2Ohm + 1 / data.r3Ohm);
  const rTotal = data.internalOhm + data.r1Ohm + rPar;
  const currentA = data.emfV / rTotal;
  const terminalV = data.emfV - currentA * data.internalOhm;
  const vR1 = currentA * data.r1Ohm;
  const vPar = currentA * rPar;
  const i2A = vPar / data.r2Ohm;
  const i3A = vPar / data.r3Ohm;
  const pBattW = data.emfV * currentA;
  const pRW = currentA * currentA * data.internalOhm;
  const p1W = currentA * currentA * data.r1Ohm;
  const p2W = (vPar * vPar) / data.r2Ohm;
  const p3W = (vPar * vPar) / data.r3Ohm;
  const noR1I = data.emfV / (data.internalOhm + rPar);
  return {
    rPar, rTotal, currentA, terminalV, vR1, vPar, i2A, i3A,
    pBattW, pRW, p1W, p2W, p3W,
    shortCurrentA: data.emfV / data.internalOhm,
    noR1CurrentA: noR1I,
    noR1TerminalV: data.emfV - noR1I * data.internalOhm,
  };
}

function dcCircuitForces(data) {
  const d = dcCircuitDerived(data);
  const s = 30; // px/A
  return [
    { id: 'mainCurrent', short: 'I', color: '#d35400', vector: [d.currentA * s, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 72, y: 120 } },
    { id: 'branchCurrent2', short: 'I2', color: 'blue', vector: [0, d.i2A * s], dashed: false, labelDx: 8, labelDy: 0, from: { x: 210, y: 130 } },
    { id: 'branchCurrent3', short: 'I3', color: 'green', vector: [0, d.i3A * s], dashed: false, labelDx: 8, labelDy: 0, from: { x: 280, y: 130 } },
  ];
}

// ---- 屈折・全反射・レンズ（W5）：スネルの法則・臨界角・レンズの公式 ----
// 具体値（検算済み）：ガラス n=1.50、入射角 60°（空気→ガラス）
//   屈折角 θ2：sinθ2=sin60°/1.5≈0.577 → θ2≈35.3°
//   臨界角（ガラス→空気）：sinθc=1/1.5 → θc≈41.8°。入射角 50° なら全反射する。
//   凸レンズ f=10 cm：物体距離 a=15 cm → 1/b=1/10−1/15=1/30 → b=30 cm、倍率 m=−2.0（倒立実像・2倍）
//   物体距離 a=5 cm（<f）→ 1/b=1/10−1/5=−1/10 → b=−10 cm、倍率 m=+2.0（正立虚像・2倍）
// 罠：レンズの公式で b が負になるのは「レンズの左側に像ができる＝虚像」という意味で、
//   計算ミスではない。実像は倒立、虚像は正立。符号を落とすと実像と虚像を取り違える。
// 図の縮尺：レンズは 6 px/cm（f=10 cm → 60 px、a=15 cm → 90 px、b=30 cm → 180 px）。
//   屈折の光線は長さ 110 px で、角度は sin/cos から計算する。
function refractionLensDerived(data) {
  const th2 = Math.asin(Math.sin(deg2rad(data.incidentDeg)) / data.n);
  const critical = Math.asin(1 / data.n);
  const bReal = 1 / (1 / data.focalCm - 1 / data.objRealCm);
  const mReal = -bReal / data.objRealCm;
  const bVirtual = 1 / (1 / data.focalCm - 1 / data.objVirtualCm);
  const mVirtual = -bVirtual / data.objVirtualCm;
  const pxPerCm = 6;
  const rayLen = 110;
  return {
    theta2Deg: (th2 * 180) / Math.PI, criticalDeg: (critical * 180) / Math.PI,
    bRealCm: bReal, mReal, bVirtualCm: bVirtual, mVirtual, pxPerCm, rayLen,
    objRealX: 200 - data.objRealCm * pxPerCm, imgRealX: 200 + bReal * pxPerCm,
    objVirtualX: 200 - data.objVirtualCm * pxPerCm, imgVirtualX: 200 + bVirtual * pxPerCm,
    focalX1: 200 - data.focalCm * pxPerCm, focalX2: 200 + data.focalCm * pxPerCm,
  };
}

function refractionLensForces(data) {
  const d = refractionLensDerived(data);
  const L = d.rayLen, ix = 200, iy = 180;
  const th1 = deg2rad(data.incidentDeg), th2 = deg2rad(d.theta2Deg);
  if (data.phase === 'refract') {
    return [
      // 入射光は空気側（左上）から境界面へ進む：始点は界面の左上、向きは右下。
      { id: 'incidentRay', short: '入射光', color: '#d35400', vector: [L * Math.sin(th1), L * Math.cos(th1)], dashed: false, labelDx: -64, labelDy: -8, from: { x: ix - L * Math.sin(th1), y: iy - L * Math.cos(th1) } },
      { id: 'refractedRay', short: '屈折光', color: 'blue', vector: [L * Math.sin(th2), L * Math.cos(th2)], dashed: false, labelDx: -70, labelDy: 4, from: { x: ix, y: iy } },
    ];
  }
  if (data.phase === 'total') {
    const th = deg2rad(data.totalIncidentDeg);
    return [
      // ガラス側（左下）から境界面へ進む入射光：始点は界面の左下、向きは右上。
      { id: 'incidentRay', short: '入射光', color: '#d35400', vector: [L * Math.sin(th), -L * Math.cos(th)], dashed: false, labelDx: -64, labelDy: 4, from: { x: ix - L * Math.sin(th), y: iy + L * Math.cos(th) } },
      { id: 'reflectedRay', short: '反射光', color: 'blue', vector: [L * Math.sin(th), L * Math.cos(th)], dashed: false, labelDx: 6, labelDy: -6, from: { x: ix, y: iy } },
    ];
  }
  return []; // レンズの場面：主光線は drawBase で計算して描く
}

// ---- ボーア模型・ド・ブロイ波長（A2）：水素の準位・スペクトル・物質波 ----
// 具体値（検算済み）：E_n=−13.6/n² eV（n=1: −13.6、n=2: −3.40、n=3: −1.51 eV）
//   3→2：ΔE=1.89 eV、λ=hc/ΔE=1240/1.89≈656 nm（バルマー Hα、赤）
//   2→1：ΔE=10.2 eV、λ≈122 nm（ライマン、紫外）
//   n=1 の電子の速さ v≈2.19×10⁶ m/s、ド・ブロイ波長 λ=h/mv≈0.33 nm、
//     円周 2πa0≈0.33 nm と一致する（波が 1 個ちょうど入る＝定常波の条件 2πr=nλ）
//   100 V で加速した電子：v≈5.93×10⁶ m/s、λ≈0.123 nm、
//     面間隔 d=0.20 nm の結晶でのブラッグ反射角 θ：sinθ=λ/2d → θ≈17.9°
// 罠：電子は原子核のまわりを「小さな惑星のように回っている」のではない。n=1 の軌道は、
//   ド・ブロイ波が円周にちょうど 1 個入る定常波として存在している。軌道の絵は、
//   波の腹がどこにあるかを示す目安であって、電子の通り道の地図ではない。
// 図の縮尺：準位図は 15 px/eV（E1=−13.6 eV → y=36、E=0 → y=240）。遷移の矢印の長さは ΔE×15 px。
function bohrDerived(data) {
  const R = data.rhydbergEv;
  const e = (n) => -R / (n * n);
  const e1 = e(1), e2 = e(2), e3 = e(3);
  const dE32 = e3 - e2; // 3→2 で放出するエネルギー（正）
  const dE21 = e2 - e1; // 2→1 で放出するエネルギー（正）
  const lam32Nm = data.hcEvNm / dE32;
  const lam21Nm = data.hcEvNm / dE21;
  const lambdaDbM = data.hJs / (data.meKg * data.v1Ms);
  const circumferenceM = 2 * Math.PI * data.a0M;
  const v100 = Math.sqrt((2 * 1.602e-19 * data.accelVoltageV) / data.meKg);
  const lambda100M = data.hJs / (data.meKg * v100);
  const braggDeg = (Math.asin(lambda100M / (2 * data.braggDM)) * 180) / Math.PI;
  return {
    e1, e2, e3, dE32, dE21, lam32Nm, lam21Nm,
    lambdaDbM, lambdaDbNm: lambdaDbM * 1e9, circumferenceM,
    orbitRatio: circumferenceM / lambdaDbM,
    v100Ms: v100, lambda100Nm: lambda100M * 1e9, braggDeg,
    yE: (ev) => 240 + ev * 15,
  };
}

function bohrForces(data) {
  const d = bohrDerived(data);
  const scale = 15; // px/eV
  if (data.phase === 'levels') {
    return [
      { id: 'trans32', short: '1.89 eV', color: '#b00', vector: [0, -(d.dE32 * scale)], dashed: false, labelDx: 8, labelDy: 4, from: { x: 140, y: d.yE(d.e3) } },
    ];
  }
  if (data.phase === 'lyman') {
    return [
      { id: 'trans21', short: '10.2 eV', color: '#b00', vector: [0, -(d.dE21 * scale)], dashed: false, labelDx: 8, labelDy: 4, from: { x: 140, y: d.yE(d.e2) } },
    ];
  }
  return []; // ド・ブロイの場面：波は drawBase で円周に沿って描く
}

// ---- 分子運動論（T4）：箱の中の分子の衝突が圧力をつくる ----
// 具体値（検算済み）：1辺 L=0.10 m の立方体の箱、V=1.0×10⁻³ m³、S=1.0×10⁻² m²、
//   N₂ 分子 n=0.040 mol（N=2.41×10²² 個）、M=0.028 kg/mol、T=300 K、R=8.31、k=1.38×10⁻²³
//   v_rms=√(3RT/M)≈517 m/s、v_x=v_rms/√3≈298 m/s、1分子の平均運動エネルギー (3/2)kT≈6.21×10⁻²¹ J
//   p=(2/3)(N/V)・KĒ≈1.0×10⁵ Pa（nRT/V とも、F/S とも一致）
//   1分子：壁への衝突で運動量変化 2mv_x≈2.78×10⁻²³ kg·m/s、衝突頻度 v_x/2L≈1492 回/s、
//     1分子の力 ≈4.14×10⁻²⁰ N、全体 F≈997 N、p=F/S≈1.0×10⁵ Pa
//   T=600 K（V一定）→ v_rms は√2 倍、p は 2 倍（≈2.0×10⁵ Pa）。
//   V を半分に（N, T 一定）→ p は 2 倍（≈2.0×10⁵ Pa）。圧力は分子の数だけでは決まらない。
// 罠：圧力は N/V と温度（平均運動エネルギー）の両方で決まる。数だけ見てはいけない。
//   また温度を 2 倍にしても速さは 2 倍ではなく √2 倍になる（速さは √T に比例）。
// 図の縮尺：箱の幅 240 px が L=0.10 m。速度の矢印は 0.10 px/(m/s)（v_x≈298 m/s → 約 30 px）。
function kineticTheoryDerived(data) {
  const L = data.boxLM, V = L * L * L, S = L * L;
  const N = data.nMol * data.nAvogadro;
  const m = data.molarMassKg / data.nAvogadro;
  const R = data.rGas, kB = data.kB, T = data.tempK;
  const vRms = Math.sqrt((3 * R * T) / data.molarMassKg);
  const vxRms = vRms / Math.sqrt(3);
  const meanKE_J = 1.5 * kB * T;
  const pressurePa = (2 / 3) * (N / V) * meanKE_J;
  const pIdealPa = (data.nMol * R * T) / V;
  const collFreq = vxRms / (2 * L);
  const dpPerHit = 2 * m * vxRms;
  const forcePerMolN = dpPerHit * collFreq;
  const totalForceN = N * forcePerMolN;
  const pFromForcePa = totalForceN / S;
  const vRmsHot = Math.sqrt((3 * R * 600) / data.molarMassKg);
  const pHotPa = (data.nMol * R * 600) / V;
  const pHalfPa = (data.nMol * R * T) / (V / 2);
  return {
    N, m, vRms, vxRms, meanKE_J, pressurePa, pIdealPa,
    collFreq, dpPerHit, forcePerMolN, totalForceN, pFromForcePa,
    vRmsHot, pHotPa, pHalfPa, boxV: V, boxS: S,
  };
}

function kineticTheoryForces(data) {
  const d = kineticTheoryDerived(data);
  const vScale = 0.10; // px/(m/s)
  const vxPx = d.vxRms * vScale;
  if (data.phase === 'one') {
    // 1個の分子が右の壁にぶつかる：来るとき v_x、跳ね返るとき −v_x。
    return [
      { id: 'vxIn', short: 'v_x', color: '#d35400', vector: [vxPx, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 260, y: 160 } },
      // 跳ね返りのラベルは矢印の下側に出し、来るときの v_x と重ならないようにする。
      { id: 'vxOut', short: '−v_x', color: 'blue', vector: [-vxPx, 0], dashed: false, labelDx: -30, labelDy: 16, from: { x: 290, y: 160 } },
    ];
  }
  return [];
}

// ---- 進行波・位相（W1）：波の式 y=A sin 2π(t/T − x/λ) ----
// 具体値（検算済み）：A=0.10 m、T=0.50 s、λ=2.0 m、v=λ/T=4.0 m/s、f=2.0 Hz
//   t=0 の波形 y=−A sin(2πx/λ)：x=0 で 0、x=0.50 m で −A、x=1.0 m で 0、x=1.5 m で +A
//   x=0 の振動 y=A sin(2πt/T)：t=0.125 s で +A、t=0.25 s で 0、t=0.375 s で −A
//   x=0.50 m の点は x=0 より位相が π/2（2πx/λ）遅れ、時間にすると 0.125 s 遅れる。
//   Δt=0.125 s で波は vΔt=0.50 m 右へ進む（y(0.5, 0.125)=y(0, 0)=0）。
// 罠：t を固定した式は「ある時刻の波形」、x を固定した式は「ある点の振動」。
//   波形の図と振動の図は同じ sin に見えるが、横軸が x か t かで意味がまるで違う。
//   また、波が進む速さ v と、媒質の点が振動する速さ（dy/dt）は別もの。
// 図の縮尺：x は 70 px/m（0〜4.0 m を 280 px）、振幅は 400 px/m（0.10 m → 40 px）。
//   振動の図の横軸は t で 280 px/s（0〜1.0 s を 280 px）。
function travellingWaveDerived(data) {
  const A = data.amplitudeM, T = data.periodS, lam = data.wavelengthM;
  const freqHz = 1 / T, speedMs = lam / T;
  const y = (x, t) => A * Math.sin(2 * Math.PI * (t / T - x / lam));
  const yAt = (x, t) => y(x, t);
  const phaseLag05 = (2 * Math.PI * data.xMarkM) / lam; // x=0.50 m の位相の遅れ
  const timeLag05 = data.xMarkM / speedMs;
  const moveDistM = speedMs * data.dtS;
  return {
    freqHz, speedMs, yAt,
    y00: y(0, 0), y05_0: y(0.5, 0), y10_0: y(1.0, 0), y15_0: y(1.5, 0),
    y0_0125: y(0, 0.125), y0_025: y(0, 0.25), y0_0375: y(0, 0.375),
    phaseLag05, timeLag05, moveDistM,
    x0Px: 60, spanPx: 280, yMid: 180, ampPx: A * 400, pxPerM: 70,
  };
}

function travellingWaveForces(data) {
  return []; // 波形は drawBase で式から描く。力の矢印はない。
}

// ---- クーロンの法則・電場（E1）：点電荷の電場・電気力・電位 ----
// 具体値（検算済み、k=9.0×10⁹ N·m²/C²、Q=+2.0 μC）：
//   r=0.10 m：E=kQ/r²=1.8×10⁶ N/C、r=0.20 m：E=4.5×10⁵ N/C（距離 2 倍で 1/4）
//   試験電荷 q=+1.0 μC を r=0.10 m に置くと F=qE=1.8 N。q を 2 倍にしても E は変わらず、F だけ 3.6 N になる。
//   双極子（+2.0 μC と −2.0 μC を 0.30 m 離す）の中点：
//     E1=E2=kQ/(0.15)²=8.0×10⁵ N/C、向きは両方とも +→−（右向き）で、合計 E=1.6×10⁶ N/C。
//     電位はスカラーの和：V1=+1.2×10⁵ V、V2=−1.2×10⁵ V、合計 V=0 V。電位は 0 でも電場は 0 ではない。
// 罠：電場 E は「置く電荷 q がなくても決まる量」で、電気力 F=qE は q をかけたもの。
//   q を変えても E は変わらない。電位はスカラー（和はただの足し算）、電場はベクトル（向きつきの和）。
// 図の縮尺：電場の矢印は 30 px/(1.0×10⁶ N/C)（1.8×10⁶ → 54 px、4.5×10⁵ → 13.5 px、1.6×10⁶ → 48 px）。
//   距離は 700 px/m（0.10 m → 70 px）。電気力の矢印は 20 px/N（1.8 N → 36 px）。
function coulombFieldDerived(data) {
  const k = data.kConst, Q1 = data.q1C, Q2 = data.q2C;
  const eNear = (k * Q1) / (data.r1M * data.r1M);
  const eFar = (k * Q1) / (data.r2M * data.r2M);
  const fTest = data.testQC * eNear;
  const fTest2 = 2 * data.testQC * eNear;
  const rMid = data.sepM / 2;
  const eMid1 = (k * Q1) / (rMid * rMid);
  const eMid2 = (k * Math.abs(Q2)) / (rMid * rMid);
  const eMidTotal = eMid1 + eMid2;
  const vMid1 = (k * Q1) / rMid;
  const vMid2 = (k * Q2) / rMid;
  const vMidTotal = vMid1 + vMid2;
  return {
    eNear, eFar, fTest, fTest2, rMid,
    eMid1, eMid2, eMidTotal, vMid1, vMid2, vMidTotal,
  };
}

function coulombFieldForces(data) {
  const d = coulombFieldDerived(data);
  const eScale = 30 / 1e6; // px/(N/C)
  if (data.phase === 'single') {
    // 2つの矢印が近いので、ラベルは上下にずらす（近いは上、遠いは下）。遠いのを上に置くと枠をはみ出す。
    return [
      { id: 'eNear', short: '1.8×10⁶', color: '#b00', vector: [d.eNear * eScale, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 210, y: 180 } },
      { id: 'eFar', short: '4.5×10⁵', color: '#b00', vector: [d.eFar * eScale, 0], dashed: false, labelDx: 6, labelDy: 16, from: { x: 280, y: 180 } },
    ];
  }
  if (data.phase === 'force') {
    return [
      { id: 'eField', short: 'E（qなし）', color: '#b00', vector: [d.eNear * eScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 210, y: 140 } },
      { id: 'fTest', short: 'F=qE=1.8 N', color: 'blue', vector: [d.fTest * 20, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 210, y: 180 } },
    ];
  }
  if (data.phase === 'dipole') {
    // E1・E2 は中点で同じ向き。重ねて描くと見えないので、少し上下にずらして描く。
    return [
      { id: 'e1', short: 'E1', color: '#b00', vector: [d.eMid1 * eScale, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 210, y: 165 } },
      { id: 'eTotal', short: 'E=1.6×10⁶', color: '#b00', vector: [d.eMidTotal * eScale, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 210, y: 180 } },
      // E2 のラベルは矢印の下側に出し、E（合計）の矢印と重ならないようにする。
      { id: 'e2', short: 'E2', color: '#b00', vector: [d.eMid2 * eScale, 0], dashed: false, labelDx: 6, labelDy: 16, from: { x: 210, y: 195 } },
    ];
  }
  return []; // 電気力線の場面：線は drawBase で描く
}

// ---- 熱量・比熱（T5）：Q=mcΔT、熱容量 C=mc、混合温度、潜熱 ----
// 具体値（検算済み）：水 0.20 kg、c=4200 J/(kg・K)、20°C→80°C で Q=50400 J、熱容量 C=840 J/K。
//   銅 0.50 kg、c=390、ΔT=50 K で Q=9750 J。同じ 9750 J を水に与えると ΔT≈11.6 K。
//   混合：80°C の水 0.20 kg と 20°C の水 0.30 kg → 44°C（失った熱 30240 J＝得た熱 30240 J）。
//   氷 0.10 kg（0°C）をとかすのに Q=33000 J（温度は変わらない）、とけた水を 20°C まで温めるのに 8400 J、合計 41400 J。
// 罠：熱と温度は別物。同じ熱量でも熱容量が違えば温度の上がり方は違う。潜熱では熱を与えても温度が変わらない。
// 矢印の縮尺：熱量の矢印は 1 px/1000 J。
function calorimetryDerived(data) {
  const qHeat = data.waterMassKg * data.waterC * (data.t2C - data.t1C);
  const heatCap = data.waterMassKg * data.waterC;
  const qCopper = data.copperMassKg * data.copperC * data.copperDT;
  const dTWaterSameQ = qCopper / heatCap;
  const mixT = (data.waterMassKg * data.t2C + data.mixMass2Kg * data.mixT2C) / (data.waterMassKg + data.mixMass2Kg);
  const qLost = data.waterMassKg * data.waterC * (data.t2C - mixT);
  const qGained = data.mixMass2Kg * data.waterC * (mixT - data.mixT2C);
  const qMelt = data.iceMassKg * data.latentJperKg;
  const qWarmMelt = data.iceMassKg * data.waterC * (20 - 0);
  const qTotalIce = qMelt + qWarmMelt;
  return { qHeat, heatCap, qCopper, dTWaterSameQ, mixT, qLost, qGained, qMelt, qWarmMelt, qTotalIce };
}

function calorimetryForces(data) {
  const d = calorimetryDerived(data);
  const qScale = 1 / 1000; // px/J
  if (data.phase === 'heat') {
    // 熱は上からビーカーに入る（下向きの矢印）。
    return [
      { id: 'heatIn', short: 'Q=5.0×10⁴ J', color: '#d35400', vector: [0, d.qHeat * qScale], dashed: false, labelDx: 6, labelDy: -8, from: { x: 240, y: 60 } },
    ];
  }
  if (data.phase === 'mix') {
    // 熱い水から冷たい水へ熱が流れる。
    return [
      { id: 'heatFlow', short: 'Q=3.0×10⁴ J', color: '#d35400', vector: [d.qLost * qScale, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 170, y: 120 } },
    ];
  }
  if (data.phase === 'latent') {
    // 氷をとかす熱。温度は 0°C のまま。
    return [
      { id: 'heatMelt', short: 'Q=3.3×10⁴ J', color: '#d35400', vector: [d.qMelt * qScale, 0], dashed: false, labelDx: 6, labelDy: -8, from: { x: 60, y: 80 } },
    ];
  }
  return []; // compare の場面：温度の棒は drawBase で描く
}

// ---- 空気抵抗・終端速度（M18）：F=kv、v(t)=v_t(1−e^(−t/τ)) ----
// 具体値（検算済み、g=10）：玉 m=0.50 kg、k=0.25 N・s/m、mg=5.0 N、終端速度 v_t=mg/k=20 m/s、時定数 τ=m/k=2.0 s。
//   t=2.0 s：v≈12.6 m/s、抵抗 kv≈3.16 N、合力≈1.84 N、加速度≈3.68 m/s²、落ちた距離≈14.7 m。
//   t=4.0 s：v≈17.3 m/s、抵抗≈4.32 N、加速度≈1.35 m/s²。終端速度では抵抗=重力で加速度 0。
//   重い玉 m=1.0 kg（同じ k）：v_t=40 m/s、τ=4.0 s、t=2.0 s で v≈15.7 m/s（軽い玉の 12.6 m/s より速い）。
//   真空なら t=2.0 s で v=gt=20 m/s（質量によらない）。
// 罠：真空なら重さによらず同じ速さだが、空気抵抗があると重い玉のほうが終端速度が大きい。
// 矢印の縮尺：力は 10 px/N（重力の矢印はつねに 50 px）、速度は 2 px/(m/s)。
function dragDerived(data) {
  const mg = data.massKg * data.g;
  const vt = mg / data.dragK;
  const tau = data.massKg / data.dragK;
  const tMid = data.tMidS;
  const vMid = vt * (1 - Math.exp(-tMid / tau));
  const fDragMid = data.dragK * vMid;
  const aMid = (mg - fDragMid) / data.massKg;
  const xMid = vt * (tMid - tau * (1 - Math.exp(-tMid / tau)));
  const vtHeavy = (data.heavyMassKg * data.g) / data.dragK;
  const tauHeavy = data.heavyMassKg / data.dragK;
  const vHeavyMid = vtHeavy * (1 - Math.exp(-tMid / tauHeavy));
  const vVacMid = data.g * tMid;
  return { mg, vt, tau, vMid, fDragMid, aMid, xMid, vtHeavy, tauHeavy, vHeavyMid, vVacMid };
}

function dragForces(data) {
  const d = dragDerived(data);
  const fScale = 10; // px/N
  const vScale = 2; // px/(m/s)
  if (data.phase === 'start') {
    return [
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mg * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: 120 } },
    ];
  }
  if (data.phase === 'mid') {
    return [
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mg * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: 120 } },
      { id: 'drag', short: '空気抵抗', color: 'purple', vector: [0, -d.fDragMid * fScale], dashed: false, labelDx: -70, labelDy: -6, from: { x: 200, y: 120 } },
      { id: 'velocity', short: 'v=' + d.vMid.toFixed(1) + ' m/s', color: '#d35400', vector: [0, d.vMid * vScale], dashed: false, labelDx: 6, labelDy: -8, from: { x: 270, y: 120 } },
    ];
  }
  if (data.phase === 'terminal') {
    return [
      { id: 'gravity', short: '重力 mg', color: 'red', vector: [0, d.mg * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: 120 } },
      { id: 'drag', short: '空気抵抗', color: 'purple', vector: [0, -d.mg * fScale], dashed: false, labelDx: -70, labelDy: -6, from: { x: 200, y: 120 } },
      { id: 'velocity', short: 'v=20 m/s', color: '#d35400', vector: [0, d.vt * vScale], dashed: false, labelDx: 6, labelDy: -8, from: { x: 270, y: 120 } },
    ];
  }
  return []; // heavy の場面：2 本の v–t 曲線は drawBase で描く
}

// ---- 放射性崩壊（A3）：N=N0・(1/2)^(t/T)、放射能 A=λN、年代測定 ----
// 具体値（検算済み）：ヨウ素131、半減期 T=8.0 日、λ=ln2/T≈0.0866 /日、N0=1.0×10⁶ 個。
//   はじめの放射能 A0=λN0≈1.0 Bq。8 日後：N=5.0×10⁵ 個、A≈0.50 Bq。16 日後：N=2.5×10⁵ 個、A≈0.25 Bq。
//   24 日後：N=1.25×10⁵ 個、A≈0.13 Bq。32 日後：N=6.25×10⁴ 個、A≈0.063 Bq。
//   年代測定（¹⁴C、T=5730 年）：残りが 1/8 なら 3 半減期 → 17190 年前。1/4 なら 2 半減期 → 11460 年前。
// 罠：減り方は直線ではなく指数関数的。2 半減期で 1/4 残る（0 にはならない）。1 個の原子核がいつ崩壊するかは予測できない。
function decayDerived(data) {
  const lambda = Math.LN2 / data.halfLifeDays; // /日
  const fracs = [1, 0.5, 0.25, 0.125, 0.0625];
  const nAt = fracs.map((f) => data.n0 * f);
  const actBq = fracs.map((f) => (lambda * data.n0 * f) / 86400);
  const halfLives = -Math.log2(data.measuredFraction);
  const ageYr = halfLives * data.carbonHalfLifeYr;
  return { lambda, fracs, nAt, actBq, halfLives, ageYr };
}

function decayForces(data) {
  return []; // 崩壊曲線と年代の棒は drawBase で式から描く。力の矢印はない。
}

// ---- 剛体のモーメント（M15）：てこのつり合い。モーメント = 力 × 支点からの距離 ----
// 具体値（検算済み）：板の長さ 4.0 m、質量 10 kg（重さ 100 N）、支点は左端から 1.5 m。
//   子ども 20 kg（200 N）が左端にのる。板の重心は支点から右へ 0.5 m、右端は支点から 2.5 m。
//   子どものモーメント 200×1.5=300 N·m（反時計回り）、板の重さのモーメント 100×0.5=50 N·m（時計回り）。
//   つり合うには右端で F×2.5=300−50=250 → F=100 N（下向き）。
//   支点の垂直抗力 N=200+100+100=400 N（上向き）。
// 罠：力の大きさだけでは決まらない。支点からの距離（うで）がモーメントを決める。
//   子どもが支点に近づけば、同じ 200 N でもモーメントは小さくなる。
function momentDerived(data) {
  const g = data.g;
  const childN = data.childMassKg * g;
  const boardN = data.boardMassKg * g;
  const childArmM = data.pivotFromLeftM;
  const boardArmM = data.boardLengthM / 2 - data.pivotFromLeftM;
  const rightArmM = data.boardLengthM - data.pivotFromLeftM;
  const momentChild = childN * childArmM;
  const momentBoard = boardN * boardArmM;
  const netMoment = momentChild - momentBoard;
  const fN = netMoment / rightArmM;
  const normalN = childN + boardN + fN;
  return { childN, boardN, childArmM, boardArmM, rightArmM, momentChild, momentBoard, netMoment, fN, normalN };
}

function momentForces(data) {
  const d = momentDerived(data);
  const fScale = 0.25; // px/N
  return [
    { id: 'child', short: '200 N', color: '#d35400', vector: [0, d.childN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 60, y: 210 } },
    { id: 'board', short: '100 N', color: 'red', vector: [0, d.boardN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 200, y: 210 } },
    { id: 'push', short: 'F=100 N', color: 'blue', vector: [0, d.fN * fScale], dashed: false, labelDx: -70, labelDy: -6, from: { x: 340, y: 210 } },
    { id: 'normal', short: 'N=400 N', color: 'green', vector: [0, -d.normalN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: { x: 165, y: 210 } },
  ];
}

// ---- ソレノイド・コイルの磁場（E8）：B=μ0nI、1 巻きのコイルの中心 B=μ0I/2r ----
// 具体値（検算済み、μ0=4π×10⁻⁷）：巻き数密度 n=1000 /m（全 200 回、長さ 0.20 m）、I=2.0 A。
//   ソレノイド内部 B=μ0nI≈2.5×10⁻³ T（2.5 mT）。電流を 4.0 A にすると B≈5.0 mT（2 倍）。
//   1 巻きのコイル（r=0.050 m）の中心 B=μ0I/2r≈2.5×10⁻⁵ T（25 μT）。ソレノイドは約 100 倍強い。
// 罠：B は巻き数そのものではなく、単位長さあたりの巻き数 n で決まる。長さを 2 倍にして
//   巻き数を同じにすると n は半分になり、B も半分になる。
function solenoidDerived(data) {
  const mu0 = 4 * Math.PI * 1e-7;
  const bT = mu0 * data.turnsPerM * data.currentA;
  const nFromTotal = data.totalTurns / data.lengthM;
  const bDoubleI = mu0 * data.turnsPerM * (2 * data.currentA);
  const coilB = mu0 * data.currentA / (2 * data.coilRadiusM);
  const ratio = bT / coilB;
  return { mu0, bT, nFromTotal, bDoubleI, coilB, ratio };
}

function solenoidForces(data) {
  const d = solenoidDerived(data);
  const bScale = 30000; // px/T（2.5 mT → 約 75 px）
  // 電流 4.0 A の場面では矢印が長く、矢印の先のラベルが「I=4.0 A」と重なるので、
  // ラベルを矢印の根元側へずらす。
  const labelDx = data.phase === 'current' ? -80 : 6;
  return [
    { id: 'field', short: 'B≈' + (d.bT * 1000).toFixed(1) + ' mT', color: '#b00', vector: [d.bT * bScale, 0], dashed: false, labelDx, labelDy: -50, from: { x: 120, y: 150 } },
  ];
}

// ---- RL・RC 回路の過渡現象（E7）：時定数 τ=RC・L/R、指数関数的な変化 ----
// 具体値（検算済み）：RC は E=10 V、R=1000 Ω、C=100 μF → τ=RC=0.10 s。充電：
//   Vc(τ)=10(1−1/e)≈6.3 V、Vc(2τ)≈8.6 V、Vc(3τ)≈9.5 V。放電：Vc(τ)=10/e≈3.7 V。
//   充電のはじめの電流 I0=E/R=10 mA（コンデンサの電圧は 0 なので、全部 R にかかる）。
//   RL は E=10 V、R=10 Ω、L=1.0 H → τ=L/R=0.10 s。最終電流 I∞=E/R=1.0 A。
//   I(τ)≈0.63 A、I(2τ)≈0.86 A、I(3τ)≈0.95 A。RC と RL で τ が同じなので、曲線の形も同じ。
// 罠：コンデンサの電圧は急に変わらない（スイッチを入れた瞬間 Vc=0）。コイルの電流も
//   急に変わらない（スイッチを入れた瞬間 I=0）。「τ で 63%」は、e^-1≈0.37 が残ること。
function transientDerived(data) {
  const tauRC = data.rOhm * data.cF;
  const tauRL = data.lH / data.rlROhm;
  const vcTau = data.emfV * (1 - Math.exp(-1));
  const vc2Tau = data.emfV * (1 - Math.exp(-2));
  const vc3Tau = data.emfV * (1 - Math.exp(-3));
  const vdTau = data.emfV * Math.exp(-1);
  const vd2Tau = data.emfV * Math.exp(-2);
  const iInf = data.emfV / data.rlROhm;
  const iTau = iInf * (1 - Math.exp(-1));
  const i2Tau = iInf * (1 - Math.exp(-2));
  const i3Tau = iInf * (1 - Math.exp(-3));
  const i0RC = data.emfV / data.rOhm;
  return { tauRC, tauRL, vcTau, vc2Tau, vc3Tau, vdTau, vd2Tau, iInf, iTau, i2Tau, i3Tau, i0RC };
}

function transientForces(data) {
  return []; // 回路図と指数曲線は drawBase で式から描く。力の矢印はない。
}

// ---- 二体問題・重心・相対運動（M13）：重心の位置・速度、相対速度、重心系での衝突 ----
// 具体値（検算済み）：m1=2.0 kg（A、v1=3.0 m/s、x1=0）、m2=3.0 kg（B、v2=1.0 m/s、x2=5.0 m）。
//   重心 x_G=(2×0+3×5)/5=3.0 m、V_G=(2×3+3×1)/5=1.8 m/s。相対速度 v2−v1=−2.0 m/s、
//   追いつくまで (5.0−0)/(3.0−1.0)=2.5 s。重心系では A は 1.2 m/s、B は −0.8 m/s。
//   弾性衝突では重心系で速度が反転し、地面系では v1′=2×1.8−3.0=0.60 m/s、v2′=2×1.8−1.0=2.6 m/s。
//   運動量は 9.0 kg·m/s、運動エネルギーは 10.5 J で、衝突の前後で保存する。
//   衝突点 x=7.5 m は、t=2.5 s における重心の位置 x_G+V_G×2.5=3.0+4.5=7.5 m と一致する。
// 罠：重心は外力がなければ等速直線運動する。衝突しても重心の動きは変わらない。
//   重心系で見ると、弾性衝突は「速度が反転するだけ」になって簡単になる。
function twoBodyDerived(data) {
  const mTotal = data.m1Kg + data.m2Kg;
  const xG = (data.m1Kg * data.x1M + data.m2Kg * data.x2M) / mTotal;
  const vG = (data.m1Kg * data.v1Ms + data.m2Kg * data.v2Ms) / mTotal;
  const vRel = data.v2Ms - data.v1Ms;
  const tCatch = (data.x2M - data.x1M) / (data.v1Ms - data.v2Ms);
  const v1cm = data.v1Ms - vG;
  const v2cm = data.v2Ms - vG;
  const v1p = 2 * vG - data.v1Ms;
  const v2p = 2 * vG - data.v2Ms;
  const pTotal = data.m1Kg * data.v1Ms + data.m2Kg * data.v2Ms;
  const keBefore = 0.5 * data.m1Kg * data.v1Ms * data.v1Ms + 0.5 * data.m2Kg * data.v2Ms * data.v2Ms;
  const keAfter = 0.5 * data.m1Kg * v1p * v1p + 0.5 * data.m2Kg * v2p * v2p;
  const xGAtCatch = xG + vG * tCatch;
  return { mTotal, xG, vG, vRel, tCatch, v1cm, v2cm, v1p, v2p, pTotal, keBefore, keAfter, xGAtCatch };
}

function twoBodyForces(data) {
  const d = twoBodyDerived(data);
  const vScale = 30; // px/(m/s)
  if (data.phase === 'velocity') {
    // 速度の矢印：A の上（y=230）、B の上（y=230）、重心の矢印はその上（y=200）。
    return [
      { id: 'velocity1', short: 'v1=3.0 m/s', color: '#b00', vector: [data.v1Ms * vScale, 0], dashed: false, labelDx: 6, labelDy: -6, from: { x: 60, y: 230 } },
      { id: 'velocity2', short: 'v2=1.0 m/s', color: '#b00', vector: [data.v2Ms * vScale, 0], dashed: false, labelDx: 6, labelDy: -6, from: { x: 260, y: 230 } },
      { id: 'velocityG', short: 'V_G=1.8 m/s', color: 'blue', vector: [d.vG * vScale, 0], dashed: false, labelDx: 6, labelDy: -6, from: { x: 180, y: 200 } },
    ];
  }
  if (data.phase === 'relative') {
    // B から見た相対速度：B から A へ向かう左向きの矢印。ラベルは上に逃がす。
    return [
      { id: 'relVel', short: 'v2−v1=−2.0 m/s', color: '#d35400', vector: [d.vRel * vScale, 0], dashed: false, labelDx: -140, labelDy: -40, from: { x: 260, y: 230 } },
    ];
  }
  if (data.phase === 'collision') {
    // 重心系の2段：上段が衝突前、下段が衝突後。弾性衝突では速度が反転するだけ。
    return [
      { id: 'v1cmBefore', short: '1.2 m/s', color: '#b00', vector: [d.v1cm * vScale, 0], dashed: false, labelDx: 6, labelDy: -20, from: { x: 100, y: 110 } },
      { id: 'v2cmBefore', short: '0.8 m/s', color: '#b00', vector: [d.v2cm * vScale, 0], dashed: false, labelDx: -60, labelDy: 16, from: { x: 280, y: 110 } },
      // 衝突後の A のラベルは、箱の左上の「A」と重ならないよう、箱の右上に出す。
      { id: 'v1cmAfter', short: '1.2 m/s', color: '#b00', vector: [-d.v1cm * vScale, 0], dashed: false, labelDx: 56, labelDy: -20, from: { x: 100, y: 210 } },
      { id: 'v2cmAfter', short: '0.8 m/s', color: '#b00', vector: [-d.v2cm * vScale, 0], dashed: false, labelDx: 6, labelDy: -6, from: { x: 280, y: 210 } },
    ];
  }
  if (data.phase === 'summary') {
    // 重心の動き：t=0 から t=2.5 s まで、V_G=1.8 m/s で 4.5 m 進む。
    return [
      { id: 'velocityG', short: 'V_G=1.8 m/s', color: 'blue', vector: [d.vG * vScale, 0], dashed: false, labelDx: 6, labelDy: -6, from: { x: 80, y: 200 } },
    ];
  }
  return []; // base：物体と重心の位置だけ。矢印はない。
}

// ---- 電磁誘導（E5）：磁束 Φ=BS、ファラデーの法則 V=NΔΦ/Δt、レンツの法則 ----
// 具体値（検算済み）：コイル N=100 回、面積 S=0.010 m²、B が 0→0.20 T に 0.10 s で増える。
//   磁束 Φ=0.20×0.010=2.0×10⁻³ Wb。起電力 V=100×2.0×10⁻³/0.10=2.0 V。
//   抵抗 R=10 Ω なら誘導電流 I=2.0/10=0.20 A。
//   外の磁場（紙面の裏向き）が増えるので、誘導電流は表向きの磁場をつくる＝反時計回り。
// 罠：磁場が大きくても、変わらなければ起電力は 0（B=0.50 T 一定 → V=0）。
//   Δt が半分（0.050 s）なら V は 2 倍の 4.0 V。コイルを 60° 傾けると Φ=BS cos60°=1.0×10⁻³ Wb。
function inductionDerived(data) {
  const phiWb = data.b1T * data.areaM2;
  const dPhiWb = (data.b1T - data.b0T) * data.areaM2;
  const emfV = data.turnsN * dPhiWb / data.dtS;
  const currentA = emfV / data.resistanceOhm;
  const phiTiltWb = data.b1T * data.areaM2 * Math.cos((data.tiltDeg * Math.PI) / 180);
  const emfFastV = data.turnsN * dPhiWb / 0.050;
  return { phiWb, dPhiWb, emfV, currentA, phiTiltWb, emfFastV };
}

function inductionForces(data) {
  return []; // ×印の磁場・誘導電流の円矢印・B–t グラフは drawBase で式から描く。直線の力の矢印はない。
}

// ---- 弾道振り子（組み合わせE：衝突＋振り子・エネルギー）----
// 具体値（検算済み）：弾丸 m=0.010 kg、v0=400 m/s、おもり M=1.99 kg（合計 2.00 kg）、
//   糸の長さ L=1.0 m、g=10 のとき
//   運動量 p = mv0 = 4.0 kg·m/s。衝突直後（完全非弾性）は v' = p/(m+M) = 2.0 m/s。
//   運動エネルギー：衝突前 1/2 mv0² = 800 J → 衝突直後 1/2 (m+M)v'² = 4.0 J（796 J 失われる）。
//   振り上がりの最大の高さ h = v'²/(2g) = 0.20 m。cosθ = 1 − h/L = 0.80、θ ≈ 36.9°。
//   最下点の張力 T = (m+M)g + (m+M)v'²/L = 20 + 8 = 28 N。
//   最大の高さでの張力 T = (m+M)g cosθ = 20 × 0.80 = 16 N（ここでは速さ 0）。
//   周期 T = 2π√(L/g) ≈ 1.99 s。最下点から最大の高さまで T/4 ≈ 0.50 s。
// 罠：エネルギー保存を衝突の瞬間をまたいで使ってはいけない（800 J と 4.0 J は別物）。
//   衝突では運動量保存だけ、その後の振り上がりではエネルギー保存だけを使う。
// 矢印の縮尺：力は 2 px/N（重力 20 N → 40、張力 28 N → 56）。衝突直後の速さは
//   30 px/(m/s)（v'=2.0 → 60）。弾丸の速さ v0=400 m/s は v' の 200 倍で同じ縮尺では
//   描けないので、弾丸の速度矢印は方向だけの固定長 60 px とし、ページに明記する。
// 図の配置：支点 (200,60)、糸の長さ 140 px（1.0 m）、最下点のおもりの中心 (200,200)。
function ballisticDerived(data) {
  const mTotal = data.mBulletKg + data.bobMassKg;
  const momentum = data.mBulletKg * data.v0Ms;
  const vPrime = momentum / mTotal;
  const keBefore = 0.5 * data.mBulletKg * data.v0Ms * data.v0Ms;
  const keAfter = 0.5 * mTotal * vPrime * vPrime;
  const keLost = keBefore - keAfter;
  const hMaxM = (vPrime * vPrime) / (2 * data.g);
  const cosTheta = 1 - hMaxM / data.lengthM;
  const thetaDeg = (Math.acos(cosTheta) * 180) / Math.PI;
  const tensionBottomN = mTotal * data.g + (mTotal * vPrime * vPrime) / data.lengthM;
  const tensionMaxN = mTotal * data.g * cosTheta;
  const periodS = 2 * Math.PI * Math.sqrt(data.lengthM / data.g);
  const stringPx = data.lengthM * 140;
  const pivot = { x: 200, y: 60 };
  const bobBottom = { x: 200, y: pivot.y + stringPx };
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  const bobMax = { x: pivot.x + stringPx * sinTheta, y: pivot.y + stringPx * cosTheta };
  return {
    mTotal, momentum, vPrime, keBefore, keAfter, keLost, hMaxM, cosTheta, thetaDeg,
    tensionBottomN, tensionMaxN, periodS, tToMaxS: periodS / 4,
    stringPx, pivot, bobBottom, bobMax, sinTheta,
    gravityN: mTotal * data.g,
  };
}

function ballisticForces(data) {
  const d = ballisticDerived(data);
  const fScale = 2; // px/N
  const vScale = 30; // px/(m/s)：衝突直後の速さ用
  if (data.phase === 'before') {
    return [
      // 弾丸の速度矢印は方向だけ（固定長 60 px）。v0=400 m/s は v' の 200 倍で同じ縮尺では描けない。
      { id: 'velocity0', short: 'v0', color: '#d35400', vector: [60, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: 78, y: 200 } },
    ];
  }
  if (data.phase === 'impact') {
    const bob = d.bobBottom;
    return [
      { id: 'velocityAfter', short: "v'=2.0 m/s", color: '#d35400', vector: [d.vPrime * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: { x: bob.x + 18, y: bob.y } },
      { id: 'gravity', short: '重力 20 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: bob },
      { id: 'tension', short: '張力 28 N', color: 'blue', vector: [0, -d.tensionBottomN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: bob },
    ];
  }
  if (data.phase === 'max') {
    const bob = d.bobMax;
    // 張力は支点向き（糸に沿う）。重力は鉛直下向き。
    const tPx = d.tensionMaxN * fScale;
    return [
      { id: 'gravity', short: '重力 20 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: bob },
      // 張力のラベルは糸と重ならないよう、矢印の先の左側に出す。
      { id: 'tension', short: '張力 16 N', color: 'blue', vector: [-d.sinTheta * tPx, -d.cosTheta * tPx], dashed: false, labelDx: -110, labelDy: -8, from: bob },
    ];
  }
  return [];
}

// ---- ループ・ザ・ループ（組み合わせF：エネルギー＋円運動）----
// 具体値（検算済み）：m=1.0 kg、ループの半径 R=0.50 m、g=10 のとき
//   h=2.0 m から静かに落とすと、最下点 v = √(2gh) ≈ 6.3 m/s、N = mg + mv²/R = 90 N。
//   頂点 v = √(2g(h−2R)) ≈ 4.5 m/s、N = mv²/R − mg = 30 N。
//   頂点をちょうど回れる最小の高さ h = 2.5R = 1.25 m。そのとき v_top = √(gR) ≈ 2.2 m/s、N = 0。
//   h=1.0 m では頂点まで届かず、cosφ = 2(h−R)/(3R) = 0.67、φ ≈ 48° の点でレールから離れる。
//   その点の高さ y = R + R cosφ ≈ 0.83 m、速さ v = √(2g(h−y)) ≈ 1.8 m/s。
// 罠：「向心力」は新しい力ではない。重力と垂直抗力の合力が向心力の役目をする。
//   N = 0 になる点が、レールから離れる点。離れたあとは斜方投射になる。
// 矢印の縮尺：速度 10 px/(m/s)、力 1 px/N（最下点の N=90 N → 90 px）。
// 図の配置：ループの中心 (200,220)、半径 60 px（0.50 m → 120 px/m）。最下点 y=280 が地面。
// 高さも同じ 120 px/m で描く（h=2.0 m → 地面から 240 px 上の y=40）。
function loopDerived(data) {
  const g = data.g || 10;
  const m = data.mKg, r = data.loopRM, h = data.hM;
  const vBottom = Math.sqrt(2 * g * h);
  const vTop = Math.sqrt(Math.max(0, 2 * g * (h - 2 * r)));
  const nBottom = m * g + (m * vBottom * vBottom) / r;
  const nTop = (m * vTop * vTop) / r - m * g;
  const hMinM = 2.5 * r;
  const vTopMin = Math.sqrt(g * r);
  // h < 2.5R のときだけ、レールから離れる点がある（cosφ = 2(h−R)/(3R)）。
  const fallCos = h < 2.5 * r ? (2 * (h - r)) / (3 * r) : null;
  const fallPhiDeg = fallCos === null ? null : (Math.acos(fallCos) * 180) / Math.PI;
  const fallYM = fallCos === null ? null : r + r * fallCos;
  const fallV = fallYM === null ? null : Math.sqrt(2 * g * (h - fallYM));
  const center = { x: 200, y: 220 };
  const rPx = r * 120;
  const fallSin = fallCos === null ? null : Math.sqrt(1 - fallCos * fallCos);
  const fallPos = fallCos === null ? null : { x: center.x + rPx * fallSin, y: center.y - rPx * fallCos };
  return {
    vBottom, vTop, nBottom, nTop, hMinM, vTopMin,
    fallCos, fallPhiDeg, fallYM, fallV, center, rPx, fallSin, fallPos,
    gravityN: m * g,
  };
}

function loopForces(data) {
  const d = loopDerived(data);
  const vScale = 10; // px/(m/s)
  const fScale = 1; // px/N
  if (data.phase === 'bottom') {
    const ball = { x: 200, y: 270 };
    return [
      { id: 'velocity', short: 'v=' + d.vBottom.toFixed(1) + ' m/s', color: '#d35400', vector: [d.vBottom * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: ball },
      // 垂直抗力のラベルは、矢印の先の右側（ループの外）に出す。
      { id: 'normal', short: 'N=' + d.nBottom.toFixed(0) + ' N', color: 'blue', vector: [0, -d.nBottom * fScale], dashed: false, labelDx: 54, labelDy: -6, from: ball },
      // 重力の矢印は 10 px と短いので、ラベルは地面の下に出す。
      { id: 'gravity', short: '重力 10 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: 6, labelDy: 16, from: ball },
    ];
  }
  if (data.phase === 'top') {
    const ball = { x: 200, y: 170 };
    return [
      { id: 'velocity', short: 'v=' + d.vTop.toFixed(1) + ' m/s', color: '#d35400', vector: [-d.vTop * vScale, 0], dashed: true, labelDx: -80, labelDy: -8, from: ball },
      // 重力と垂直抗力はどちらも下向き。矢印が重ならないよう、中心から左右に 6 px ずらす。
      // ラベルはループの弧と重ならないよう、重力は玉の左上、垂直抗力は矢印の先の右側に出す。
      { id: 'gravity', short: '重力 10 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: -70, labelDy: -40, from: { x: ball.x - 6, y: ball.y } },
      { id: 'normal', short: 'N=' + d.nTop.toFixed(0) + ' N', color: 'blue', vector: [0, d.nTop * fScale], dashed: false, labelDx: 54, labelDy: -6, from: { x: ball.x + 6, y: ball.y } },
    ];
  }
  if (data.phase === 'fall' && d.fallPos) {
    const ball = d.fallPos;
    // 離れる点での速度は、接線方向（左上向き）。成分は (−cosφ, −sinφ) × v。
    const vx = -d.fallCos * d.fallV * vScale, vy = -d.fallSin * d.fallV * vScale;
    return [
      { id: 'velocity', short: 'v=' + d.fallV.toFixed(1) + ' m/s', color: '#d35400', vector: [vx, vy], dashed: true, labelDx: 10, labelDy: -20, from: ball },
      { id: 'gravity', short: '重力 10 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: ball },
    ];
  }
  return []; // drop：静かに落とすので、速度の矢印はない。
}

// ---- 斜方投射＋エネルギー（組み合わせG）：エネルギーで速さ、斜方投射で時間・飛距離・向き ----
// 具体値（検算済み）：m=0.50 kg、v0=10 m/s、30°、高さ h0=5.0 m、g=10 のとき
//   v0x = 10cos30° ≈ 8.66 m/s、v0y = 5.0 m/s。
//   最高点 H = h0 + v0y²/(2g) = 6.25 m、頂点まで 0.50 s。
//   滞空時間 t = (v0y + √(v0y²+2gh0))/g ≈ 1.62 s、飛距離 R = v0x・t ≈ 14.0 m。
//   着地の速さ v = √(v0²+2gh0) ≈ 14.1 m/s、着地の鉛直成分 vy = √(v0y²+2gh0) ≈ 11.2 m/s、着地角 ≈ 52°。
//   下向き 30° に投げても着地の速さは同じ 14.1 m/s だが、t ≈ 0.62 s、R ≈ 5.4 m と短い。
//   速さだけでは飛距離は決まらない。向き（成分）が必要。
// 図の縮尺：位置 16 px/m（地面 y=260、発射点 (60,180)）。速度 6 px/(m/s)、重力 10 px/N（mg=5.0 N → 50 px、つねに同じ長さ）。
function projEnergyDerived(data) {
  const g = data.g || 10;
  const rad = (data.angleDeg * Math.PI) / 180;
  const v0x = data.v0Ms * Math.cos(rad);
  const v0y = data.v0Ms * Math.sin(rad);
  const hMaxM = data.h0M + (v0y * v0y) / (2 * g);
  const tTopS = v0y / g;
  const tFlightS = (v0y + Math.sqrt(v0y * v0y + 2 * g * data.h0M)) / g;
  const rangeM = v0x * tFlightS;
  const vGroundMs = Math.sqrt(data.v0Ms * data.v0Ms + 2 * g * data.h0M);
  const vyGroundMs = Math.sqrt(v0y * v0y + 2 * g * data.h0M);
  const landAngleDeg = (Math.atan2(vyGroundMs, v0x) * 180) / Math.PI;
  // 下向きに投げた場合：初速度の鉛直成分が −v0y。
  const tDownS = (Math.sqrt(v0y * v0y + 2 * g * data.h0M) - v0y) / g;
  const rangeDownM = v0x * tDownS;
  const xScale = 16, groundY = 260, originX = 60;
  const launch = { x: originX, y: groundY - data.h0M * xScale };
  const top = { x: originX + v0x * tTopS * xScale, y: groundY - hMaxM * xScale };
  const landing = { x: originX + rangeM * xScale, y: groundY };
  const landingDown = { x: originX + rangeDownM * xScale, y: groundY };
  return {
    g, v0x, v0y, hMaxM, tTopS, tFlightS, rangeM, vGroundMs, vyGroundMs, landAngleDeg,
    tDownS, rangeDownM, xScale, groundY, originX, launch, top, landing, landingDown,
    gravityN: data.mKg * g,
  };
}

function projEnergyForces(data) {
  const d = projEnergyDerived(data);
  const vScale = 6; // px/(m/s)
  const fScale = 10; // px/N
  if (data.phase === 'base') {
    return [
      { id: 'velocity', short: 'v0=10 m/s', color: '#d35400', vector: [d.v0x * vScale, -d.v0y * vScale], dashed: true, labelDx: 6, labelDy: -8, from: d.launch },
      { id: 'gravity', short: '重力 5.0 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: d.launch },
    ];
  }
  if (data.phase === 'top') {
    return [
      { id: 'velocity', short: 'v=8.66 m/s', color: '#d35400', vector: [d.v0x * vScale, 0], dashed: true, labelDx: 6, labelDy: -8, from: d.top },
      // 最高点では重力ラベルを矢印の左に出し、「H=6.25 m」と重ならないようにする。
      { id: 'gravity', short: '重力 5.0 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: -70, labelDy: -6, from: d.top },
    ];
  }
  if (data.phase === 'ground') {
    // 着地の速さの三角形：原点 (70,70) から水平成分・鉛直成分・合成を描く。
    // 鉛直成分のラベルは左へ逃がし、合成のラベルと重ならないようにする。
    const o = { x: 70, y: 70 };
    return [
      { id: 'vx', short: 'vx=8.66 m/s', color: '#666', vector: [d.v0x * vScale, 0], dashed: true, labelDx: 0, labelDy: -8, from: o },
      { id: 'vy', short: 'vy≈11.2 m/s', color: '#666', vector: [0, d.vyGroundMs * vScale], dashed: true, labelDx: -70, labelDy: -6, from: o },
      { id: 'v', short: 'v≈14.1 m/s', color: '#d35400', vector: [d.v0x * vScale, d.vyGroundMs * vScale], dashed: true, labelDx: 6, labelDy: -8, from: o },
    ];
  }
  if (data.phase === 'down') {
    return [
      { id: 'velocity', short: 'v0=10 m/s', color: '#d35400', vector: [d.v0x * vScale, d.v0y * vScale], dashed: true, labelDx: 6, labelDy: -8, from: d.launch },
      { id: 'gravity', short: '重力 5.0 N', color: 'red', vector: [0, d.gravityN * fScale], dashed: false, labelDx: 6, labelDy: -6, from: d.launch },
    ];
  }
  return []; // time：飛距離の注釈だけを描くので、矢印はない。
}

function sceneFor(type, thetaDeg, mgPx, fPx, data) {
  if (type === 'dcCircuit') {
    const d = dcCircuitDerived(data);
    return {
      type, phase: data.phase || 'base',
      emfV: data.emfV, internalOhm: data.internalOhm,
      r1Ohm: data.r1Ohm, r2Ohm: data.r2Ohm, r3Ohm: data.r3Ohm,
      derived: d,
      center: { x: 200, y: 160 }, centerDot: false,
      forces: dcCircuitForces(data),
    };
  }
  if (type === 'refractionLens') {
    const d = refractionLensDerived(data);
    return {
      type, phase: data.phase || 'refract',
      n: data.n, incidentDeg: data.incidentDeg, totalIncidentDeg: data.totalIncidentDeg,
      focalCm: data.focalCm, objRealCm: data.objRealCm, objVirtualCm: data.objVirtualCm,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: refractionLensForces(data),
    };
  }
  if (type === 'bohr') {
    const d = bohrDerived(data);
    return {
      type, phase: data.phase || 'levels',
      rhydbergEv: data.rhydbergEv, a0M: data.a0M, hJs: data.hJs, meKg: data.meKg,
      v1Ms: data.v1Ms, hcEvNm: data.hcEvNm, accelVoltageV: data.accelVoltageV, braggDM: data.braggDM,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: bohrForces(data),
    };
  }
  if (type === 'kineticTheory') {
    const d = kineticTheoryDerived(data);
    return {
      type, phase: data.phase || 'one',
      boxLM: data.boxLM, nMol: data.nMol, molarMassKg: data.molarMassKg,
      tempK: data.tempK, rGas: data.rGas, kB: data.kB, nAvogadro: data.nAvogadro,
      derived: d,
      center: { x: 200, y: 160 }, centerDot: false,
      forces: kineticTheoryForces(data),
    };
  }
  if (type === 'travellingWave') {
    const d = travellingWaveDerived(data);
    return {
      type, phase: data.phase || 'shape',
      amplitudeM: data.amplitudeM, periodS: data.periodS, wavelengthM: data.wavelengthM,
      xMarkM: data.xMarkM, tS: data.tS || 0, dtS: data.dtS || 0.125,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: travellingWaveForces(data),
    };
  }
  if (type === 'coulombField') {
    const d = coulombFieldDerived(data);
    return {
      type, phase: data.phase || 'single',
      kConst: data.kConst, q1C: data.q1C, q2C: data.q2C, sepM: data.sepM,
      r1M: data.r1M, r2M: data.r2M, testQC: data.testQC,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: coulombFieldForces(data),
    };
  }
  if (type === 'calorimetry') {
    const d = calorimetryDerived(data);
    return {
      type, phase: data.phase || 'heat',
      waterMassKg: data.waterMassKg, waterC: data.waterC, t1C: data.t1C, t2C: data.t2C,
      copperMassKg: data.copperMassKg, copperC: data.copperC, copperDT: data.copperDT,
      mixMass2Kg: data.mixMass2Kg, mixT2C: data.mixT2C, iceMassKg: data.iceMassKg, latentJperKg: data.latentJperKg,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: calorimetryForces(data),
    };
  }
  if (type === 'drag') {
    const d = dragDerived(data);
    return {
      type, phase: data.phase || 'start',
      massKg: data.massKg, dragK: data.dragK, g: data.g, heavyMassKg: data.heavyMassKg, tMidS: data.tMidS,
      derived: d,
      center: { x: 200, y: 120 }, centerDot: false,
      forces: dragForces(data),
    };
  }
  if (type === 'decay') {
    const d = decayDerived(data);
    return {
      type, phase: data.phase || 'curve',
      halfLifeDays: data.halfLifeDays, n0: data.n0, carbonHalfLifeYr: data.carbonHalfLifeYr, measuredFraction: data.measuredFraction,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: decayForces(data),
    };
  }
  if (type === 'moment') {
    const d = momentDerived(data);
    return {
      type, phase: data.phase || 'base',
      childMassKg: data.childMassKg, boardMassKg: data.boardMassKg, g: data.g,
      pivotFromLeftM: data.pivotFromLeftM, boardLengthM: data.boardLengthM,
      derived: d,
      center: { x: 200, y: 210 }, centerDot: false,
      forces: momentForces(data),
    };
  }
  if (type === 'solenoid') {
    const d = solenoidDerived(data);
    return {
      type, phase: data.phase || 'base',
      turnsPerM: data.turnsPerM, currentA: data.currentA, coilRadiusM: data.coilRadiusM,
      totalTurns: data.totalTurns, lengthM: data.lengthM,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: solenoidForces(data),
    };
  }
  if (type === 'transient') {
    const d = transientDerived(data);
    return {
      type, phase: data.phase || 'circuit',
      emfV: data.emfV, rOhm: data.rOhm, cF: data.cF, lH: data.lH, rlROhm: data.rlROhm,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: transientForces(data),
    };
  }
  if (type === 'twoBody') {
    const d = twoBodyDerived(data);
    return {
      type, phase: data.phase || 'base',
      m1Kg: data.m1Kg, m2Kg: data.m2Kg, v1Ms: data.v1Ms, v2Ms: data.v2Ms,
      x1M: data.x1M, x2M: data.x2M,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: twoBodyForces(data),
    };
  }
  if (type === 'induction') {
    const d = inductionDerived(data);
    return {
      type, phase: data.phase || 'base',
      turnsN: data.turnsN, areaM2: data.areaM2, b0T: data.b0T, b1T: data.b1T,
      dtS: data.dtS, resistanceOhm: data.resistanceOhm, tiltDeg: data.tiltDeg,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: inductionForces(data),
    };
  }
  if (type === 'heatCycle') {
    const d = heatCycleDerived(data);
    return {
      type, phase: data.phase || 'path',
      p1Pa: data.p1Pa, p2Pa: data.p2Pa, v1M3: data.v1M3, v2M3: data.v2M3,
      tAK: data.tAK, nMol: data.nMol, rGas: data.rGas || 8.31,
      derived: d, corners: d.corners,
      center: { x: 210, y: 150 }, centerDot: false,
      forces: heatCycleForces(data),
    };
  }
  if (type === 'railRod') {
    const d = railRodDerived(data);
    return {
      type, phase: data.phase || 'base',
      bT: data.bT, railLengthM: data.railLengthM, resistanceOhm: data.resistanceOhm,
      massKg: data.massKg, extForceN: data.extForceN, vMs: data.vMs || 0,
      derived: d,
      center: { x: 200, y: 160 },
      forces: railRodForces(data),
    };
  }
  if (type === 'doppler') {
    const d = dopplerDerived(data);
    return {
      type, phase: data.phase || 'base',
      soundSpeedMs: data.soundSpeedMs, freqHz: data.freqHz,
      sourceSpeedMs: data.sourceSpeedMs, observerSpeedMs: data.observerSpeedMs,
      beatFreqHz: data.beatFreqHz,
      derived: d,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: dopplerForces(data),
    };
  }
  if (type === 'gravitation') {
    const r = gravitationForces(data);
    return {
      type, phase: data.phase,
      g0: data.g0 || 10, radiusM: data.radiusM || 6.4e6, altitudeM: data.altitudeM || 0,
      derived: r.derived, orbitPx: r.orbitPx, earthPx: r.earthPx,
      center: { x: 200, y: 150 }, sat: r.sat,
      forces: r.forces,
    };
  }
  if (type === 'standingWave') {
    const d = standingWaveDerived(data);
    const x0 = 60, spanPx = 280;
    return {
      type, mode: data.mode, n: data.n, lengthM: data.lengthM, waveSpeedMs: data.waveSpeedMs,
      derived: d, x0, spanPx, yMid: 180, ampPx: 30,
      nodesPx: d.nodes.map((x) => x0 + (x / data.lengthM) * spanPx),
      antinodesPx: d.antinodes.map((x) => x0 + (x / data.lengthM) * spanPx),
      center: { x: 200, y: 180 }, centerDot: false,
      forces: [],
    };
  }
  if (type === 'photoelectric') {
    const r = photoelectricForces(data);
    return {
      type, phase: data.phase,
      wavelengthNm: data.wavelengthNm, workFunctionEv: data.workFunctionEv,
      hEvS: data.hEvS, cMs: data.cMs, intensity: data.intensity || 1,
      derived: r.derived, vScale: r.vScale, plateX: r.plateX,
      center: { x: 200, y: 180 }, centerDot: false,
      forces: r.forces,
    };
  }
  if (type === 'circle') {
    const phase = (data && data.phase) || 'horizontal';
    const r = circleForces(data, phase);
    return {
      type, phase,
      mKg: data.mKg || 1, rM: data.rM || 0.5, vMs: data.vMs || 2.0,
      loopR: data.loopR || 0.5, vBottom: data.vBottom || 5.0, g: data.g || 10,
      fScalePxPerN: data.fScalePxPerN || 2.5, vScalePxPerMs: data.vScalePxPerMs || 15,
      rScalePxPerM: data.rScalePxPerM || 200,
      derived: r.derived,
      center: r.center, pos: r.pos, rPx: r.rPx,
      forces: r.forces,
    };
  }
  if (type === 'shm') {
    const phase = (data && data.phase) || 'spring-max';
    const r = shmForces(data, phase);
    return {
      type, phase,
      mKg: data.mKg || 1, k: data.k || 100, amplitudeM: data.amplitudeM || 0.1,
      lengthM: data.lengthM || 1.0, thetaDeg: data.thetaDeg || 5, g: data.g || 10,
      derived: r.derived,
      center: r.pos || { x: 200, y: 180 },
      pivot: r.pivot, lenPx: r.lenPx, eqX: r.eqX, cy: r.cy, pos: r.pos,
      forces: r.forces,
    };
  }
  if (type === 'collision') {
    const phase = (data && data.phase) || 'before';
    const r = collisionForces(data, phase);
    return {
      type, phase,
      m1Kg: data.m1Kg || 2, m2Kg: data.m2Kg || 1, v1Ms: data.v1Ms || 3.0,
      vScalePxPerMs: data.vScalePxPerMs || 15,
      derived: r.derived,
      center: { x: 200, y: 220 }, centerDot: false, cy: r.cy,
      forces: r.forces,
    };
  }
  if (type === 'gas-piston') {
    const phase = (data && data.phase) || 'before';
    const d = gasPistonDerived(data);
    const hPx = d.hM * 400;
    const pistonY = 260 - hPx;
    return {
      type, phase,
      p0Pa: data.p0Pa, areaM2: data.areaM2, pistonKg: data.pistonKg, g: data.g || 10,
      nMol: data.nMol, rGas: data.rGas, tK: data.tK,
      pPa: d.pPa, vM3: d.vM3, hM: d.hM, hPx, pistonY,
      center: { x: 200, y: pistonY },
      forces: gasPistonForces(data, d, pistonY),
    };
  }
  if (type === 'young') {
    const L = youngLayout(data);
    return {
      type, n: data.n,
      lambdaNm: data.lambdaNm, dMm: data.dMm, lM: data.lM,
      derived: L.derived, layout: L,
      center: { x: L.point.x, y: L.point.y }, centerDot: false,
      forces: youngForces(data),
    };
  }
  if (type === 'capacitor') {
    const phase = (data && data.phase) || 'initial';
    const r = capacitorForces(data);
    const dPx = r.dPx;
    return {
      type, phase,
      eps0: data.eps0, areaM2: data.areaM2, dMm: data.dMm, vV: data.vV, q0C: data.q0C,
      derived: r.derived, dPx,
      center: { x: 200, y: 110 + dPx / 2 }, centerDot: false,
      forces: r.forces,
    };
  }
  if (type === 'charged-circle') {
    const phase = (data && data.phase) || 'entry';
    const r = chargedCircleForces(data, phase);
    return {
      type, phase,
      mKg: data.mKg, qC: data.qC, vMs: data.vMs, bT: data.bT, rM: data.rM,
      rScalePxPerM: data.rScalePxPerM, vScalePxPerMs: data.vScalePxPerMs, fScalePxPerN: data.fScalePxPerN,
      derived: r.derived,
      center: r.center, entry: r.entry, top: r.top, exit: r.exit, rPx: r.rPx,
      forces: r.forces,
    };
  }
  if (type === 'lc') {
    const phase = (data && data.phase) || 'qmax';
    const r = lcForces(data, phase);
    return {
      type, phase,
      inductanceH: data.inductanceH, capacitanceF: data.capacitanceF, charge0C: data.charge0C,
      derived: r.derived,
      center: { x: 80, y: 140 },
      forces: r.forces,
    };
  }
  if (type === 'ballistic') {
    const d = ballisticDerived(data);
    return {
      type, phase: (data && data.phase) || 'before',
      mBulletKg: data.mBulletKg, v0Ms: data.v0Ms, bobMassKg: data.bobMassKg,
      lengthM: data.lengthM, g: (data && data.g) || 10,
      derived: d,
      center: { x: 200, y: 200 }, centerDot: false,
      forces: ballisticForces(data),
    };
  }
  if (type === 'loop') {
    const d = loopDerived(data);
    return {
      type, phase: (data && data.phase) || 'drop',
      mKg: data.mKg, loopRM: data.loopRM, hM: data.hM, g: (data && data.g) || 10,
      derived: d,
      center: { x: 200, y: 170 }, centerDot: false,
      forces: loopForces(data),
    };
  }
  if (type === 'projEnergy') {
    const d = projEnergyDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      mKg: data.mKg, v0Ms: data.v0Ms, angleDeg: data.angleDeg, h0M: data.h0M, g: (data && data.g) || 10,
      derived: d,
      center: { x: 200, y: 200 }, centerDot: false,
      forces: projEnergyForces(data),
    };
  }
  if (type === 'youngWater') {
    const d = youngWaterDerived(data);
    return {
      type, phase: (data && data.phase) || 'air',
      lambdaNm: data.lambdaNm, lambdaBlueNm: data.lambdaBlueNm, nWater: data.nWater,
      dMm: data.dMm, lM: data.lM,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: youngWaterForces(data),
    };
  }
  if (type === 'dopplerShm') {
    const d = dopplerShmDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      mKg: data.mKg, kNm: data.kNm, ampM: data.ampM,
      freqHz: data.freqHz, soundSpeedMs: data.soundSpeedMs, g: (data && data.g) || 10,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: dopplerShmForces(data),
    };
  }
  if (type === 'capSpring') {
    const d = capSpringDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      mKg: data.mKg, kNm: data.kNm, areaM2: data.areaM2, qC: data.qC,
      dMm: data.dMm, ampMm: data.ampMm, eps0: data.eps0, g: (data && data.g) || 10,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: capSpringForces(data),
    };
  }
  if (type === 'slopeEnergy') {
    const d = slopeEnergyDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      mKg: data.mKg, thetaDeg: data.thetaDeg, slopeLM: data.slopeLM,
      mu: data.mu, g: (data && data.g) || 10,
      derived: d,
      center: { x: 200, y: 170 }, centerDot: false,
      thetaArc: { cx: 320, cy: 240, r: 30 },
      forces: slopeEnergyForces(data),
    };
  }
  if (type === 'inductionLC') {
    const d = inductionLCDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      turnsN: data.turnsN, areaM2: data.areaM2, bMaxT: data.bMaxT,
      dtS: data.dtS, capUF: data.capUF, indH: data.indH,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: inductionLCForces(data),
    };
  }
  if (type === 'gasResonance') {
    const d = gasResonanceDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      p1Pa: data.p1Pa, volM3: data.volM3, t1K: data.t1K, t2K: data.t2K,
      gamma: data.gamma, rGas: data.rGas, molarMassKg: data.molarMassKg,
      pipeLM: data.pipeLM,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: gasResonanceForces(data),
    };
  }
  if (type === 'railCapCoil') {
    const d = railCapCoilDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      bT: data.bT, railLM: data.railLM, mKg: data.mKg, v0Ms: data.v0Ms,
      capF: data.capF, indH: data.indH,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: railCapCoilForces(data),
    };
  }
  if (type === 'capSpringGrav') {
    const d = capSpringGravDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      eps0: data.eps0, areaM2: data.areaM2, voltV: data.voltV, voltTrapV: data.voltTrapV,
      mKg: data.mKg, kNm: data.kNm, dNatMm: data.dNatMm, g: data.g || 10,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: capSpringGravForces(data),
    };
  }
  if (type === 'gasSpringCycle') {
    const d = gasSpringCycleDerived(data);
    return {
      type, phase: (data && data.phase) || 'base',
      p0Pa: data.p0Pa, areaM2: data.areaM2, pistonKg: data.pistonKg,
      kNm: data.kNm, hNatM: data.hNatM, hBM: data.hBM,
      rGas: data.rGas, tAK: data.tAK, g: data.g || 10,
      derived: d,
      center: { x: 200, y: 150 }, centerDot: false,
      forces: gasSpringCycleForces(data),
    };
  }
  if (type === 'slopePulley') {
    return {
      type, phase: (data && data.phase) || 'connected',
      thetaDeg: (data && data.thetaDeg) || 37,
      sinTheta: (data && data.sinTheta) || 0.6,
      cosTheta: (data && data.cosTheta) || 0.8,
      mAKg: (data && data.mAKg) || 4, mBKg: (data && data.mBKg) || 5,
      mu: (data && data.mu) || 0.25, g: (data && data.g) || 10,
      scalePxPerN: (data && data.scalePxPerN) || 1.5,
      center: { x: 160, y: 160 },
      thetaArc: { cx: 40, cy: 250, r: 38 },
      forces: slopePulleyForces(data),
    };
  }
  if (type === 'collision-spring') {
    const phase = (data && data.phase) || 'before';
    const m1Kg = (data && data.m1Kg) || 2, m2Kg = (data && data.m2Kg) || 2;
    const v0 = (data && data.v0) || 4, k = (data && data.k) || 100, g = (data && data.g) || 10;
    const naturalPx = (data && data.naturalPx) || 120;
    const vScalePxPerMs = (data && data.vScalePxPerMs) || 15;
    const fScalePxPerN = (data && data.fScalePxPerN) || 1.5;
    const xScalePxPerM = (data && data.xScalePxPerM) || 100;
    const full = { type, phase, m1Kg, m2Kg, v0, k, g, naturalPx, vScalePxPerMs, fScalePxPerN, xScalePxPerM };
    const r = collisionSpringForces(full, phase);
    return {
      type, phase, m1Kg, m2Kg, v0, k, g, naturalPx, vScalePxPerMs, fScalePxPerN, xScalePxPerM,
      derived: r.derived, layout: r.layout,
      center: { x: 220, y: 220 },
      forces: r.forces,
    };
  }
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
  if (scene.type === 'circle') {
    const d = scene.derived;
    // 水平：張力 = mv²/r、角速度 ω = v/r、周期 T = 2π/ω。
    if (scene.phase === 'horizontal' && byId.tension) {
      if (Math.abs(d.tensionN - (d.m * scene.vMs * scene.vMs) / scene.rM) > 0.01) return ['張力が mv²/r と一致しません'];
      if (Math.abs(Math.hypot(byId.tension.vector[0], byId.tension.vector[1]) - d.tensionN * scene.fScalePxPerN) > 0.5) return ['張力の矢印が T の縮尺と一致しません'];
      if (Math.abs(d.omega - scene.vMs / scene.rM) > 1e-9) return ['角速度が v/r と一致しません'];
      if (Math.abs(d.periodS - (2 * Math.PI) / d.omega) > 1e-9) return ['周期が 2π/ω と一致しません'];
      if (byId.radius && Math.abs(Math.hypot(byId.radius.vector[0], byId.radius.vector[1]) - scene.rPx) > 0.5) return ['半径の矢印が r の図示と一致しません'];
    }
    if (scene.phase === 'top' && byId.gravity && byId.required) {
      // 頂点の最小の速さ：v_top² = gR。このとき重力だけが向心力になる（N = 0）。
      if (Math.abs(d.vTop * d.vTop - d.g * scene.loopR) > 1e-9) return ['頂点の速さが √(gR) と一致しません'];
      if (Math.abs((d.m * d.vTop * d.vTop) / scene.loopR - d.mgN) > 0.01) return ['頂点で重力が向心力と一致しません'];
      if (Math.abs(Math.hypot(byId.required.vector[0], byId.required.vector[1]) - d.mgN * scene.fScalePxPerN) > 0.5) return ['必要な向心力の矢印が mg と一致しません'];
    }
    if (scene.phase === 'bottom' && byId.gravity && byId.normal) {
      // エネルギー保存：v_bottom² = v_top² + 4gR。最下点：N − mg = mv²/R。
      if (Math.abs(d.vBottom * d.vBottom - (d.vTop * d.vTop + 4 * d.g * scene.loopR)) > 1e-9) return ['最下点の速さがエネルギー保存と一致しません'];
      if (Math.abs(d.nBottomN - (d.mgN + (d.m * d.vBottom * d.vBottom) / scene.loopR)) > 0.01) return ['最下点の垂直抗力が mg + mv²/R と一致しません'];
      if (Math.abs(-byId.normal.vector[1] - d.nBottomN * scene.fScalePxPerN) > 0.5) return ['垂直抗力の矢印が N の縮尺と一致しません'];
    }
  }
  if (scene.type === 'shm') {
    const d = scene.derived;
    // ばね：ω = √(k/m)、T = 2π/ω、v_max = ωA、a_max = ω²A、ばねの力の最大値 kA。
    if (scene.phase === 'spring-max' && byId.springForce && byId.amplitude) {
      if (Math.abs(d.omega - Math.sqrt(scene.k / scene.mKg)) > 1e-9) return ['角振動数が √(k/m) と一致しません'];
      if (Math.abs(d.periodS - (2 * Math.PI) / d.omega) > 1e-9) return ['周期が 2π/ω と一致しません'];
      if (Math.abs(d.fMaxN - scene.k * scene.amplitudeM) > 1e-9) return ['ばねの力の最大値が kA と一致しません'];
      if (Math.abs(-byId.springForce.vector[0] - d.fMaxN * 6) > 0.5) return ['ばねの力の矢印が kA の縮尺と一致しません'];
      if (Math.abs(byId.amplitude.vector[0] - scene.amplitudeM * 400) > 0.5) return ['振幅の矢印が A の図示と一致しません'];
    }
    if (scene.phase === 'spring-eq' && byId.velocity) {
      if (Math.abs(d.vMaxMs - d.omega * scene.amplitudeM) > 1e-9) return ['つり合い位置の速さが ωA と一致しません'];
      if (Math.abs(byId.velocity.vector[0] - d.vMaxMs * 30) > 0.5) return ['速度の矢印が v_max の縮尺と一致しません'];
    }
    if (scene.phase === 'pendulum' && byId.gravity && byId.tension && byId.tangential) {
      // 振り子：T = 2π√(L/g)、張力 = mg cosθ、接線方向の力 = mg sinθ。
      if (Math.abs(d.periodPS - 2 * Math.PI * Math.sqrt(scene.lengthM / (scene.g || 10))) > 1e-9) return ['振り子の周期が 2π√(L/g) と一致しません'];
      if (Math.abs(d.tensionN - d.mgN * Math.cos(deg2rad(scene.thetaDeg))) > 0.01) return ['張力が mg cosθ と一致しません'];
      if (Math.abs(d.tangentialN - d.mgN * Math.sin(deg2rad(scene.thetaDeg))) > 0.01) return ['接線方向の力が mg sinθ と一致しません'];
      if (Math.abs(Math.hypot(byId.tension.vector[0], byId.tension.vector[1]) - d.tensionN * 6) > 0.5) return ['張力の矢印が T の縮尺と一致しません'];
      if (Math.abs(Math.hypot(byId.tangential.vector[0], byId.tangential.vector[1]) - d.tangentialN * 6) > 0.5) return ['接線方向の矢印が mg sinθ の縮尺と一致しません'];
      // 重力の分解：張力方向の成分 + 接線方向の成分 = 重力（ベクトル和）。
      const tx = byId.tension.vector[0] + byId.tangential.vector[0];
      const ty = byId.tension.vector[1] + byId.tangential.vector[1];
      // 張力は重力の支点向き成分と逆向きなので、重力 = −張力方向成分 + 接線成分。
      // 検算は大きさで：|張力|² + |接線|² = |重力|²（直交する2成分）。
      const tLen = Math.hypot(byId.tension.vector[0], byId.tension.vector[1]);
      const gLen = Math.hypot(byId.gravity.vector[0], byId.gravity.vector[1]);
      const tanLen = Math.hypot(byId.tangential.vector[0], byId.tangential.vector[1]);
      if (Math.abs(tLen * tLen + tanLen * tanLen - gLen * gLen) > 1.0) return ['重力の分解が直角三角形になっていません'];
      void tx; void ty;
    }
  }
  if (scene.type === 'collision') {
    const d = scene.derived;
    // 運動量保存：衝突前後で p が変わらない（弾性・合体の両方）。
    if (Math.abs(d.pBefore - d.pElastic) > 1e-9) return ['弾性衝突で運動量が保存していません'];
    if (Math.abs(d.pBefore - scene.mTotal * d.vStick) > 1e-9) return ['合体で運動量が保存していません'];
    // エネルギー：弾性では保存、合体では失われる（失われた分は 3.0 J）。
    if (Math.abs(d.keBefore - d.keElastic) > 1e-9) return ['弾性衝突で運動エネルギーが保存していません'];
    if (Math.abs(d.keStick - 0.5 * scene.mTotal * d.vStick * d.vStick) > 1e-9) return ['合体後の運動エネルギーが一致しません'];
    if (d.keLost <= 0) return ['合体で運動エネルギーが失われていません'];
    // 弾性衝突の公式：v1' = (m1−m2)/(m1+m2)・v1、v2' = 2m1/(m1+m2)・v1。
    if (Math.abs(d.v1p - ((scene.m1Kg - scene.m2Kg) / scene.mTotal) * scene.v1Ms) > 1e-9) return ["v1' の公式が一致しません"];
    if (Math.abs(d.v2p - ((2 * scene.m1Kg) / scene.mTotal) * scene.v1Ms) > 1e-9) return ["v2' の公式が一致しません"];
    // 矢印の長さが速度の縮尺どおりか（場面ごと）。
    if (scene.phase === 'before' && byId.velocity1 && Math.abs(byId.velocity1.vector[0] - scene.v1Ms * scene.vScalePxPerMs) > 0.5) return ['v1 の矢印が速度の縮尺と一致しません'];
    if (scene.phase === 'elastic') {
      if (byId.velocity1p && Math.abs(byId.velocity1p.vector[0] - d.v1p * scene.vScalePxPerMs) > 0.5) return ["v1' の矢印が速度の縮尺と一致しません"];
      if (byId.velocity2p && Math.abs(byId.velocity2p.vector[0] - d.v2p * scene.vScalePxPerMs) > 0.5) return ["v2' の矢印が速度の縮尺と一致しません"];
    }
    if (scene.phase === 'stick' && byId.velocityStick && Math.abs(byId.velocityStick.vector[0] - d.vStick * scene.vScalePxPerMs) > 0.5) return ["v' の矢印が速度の縮尺と一致しません"];
  }
  if (scene.type === 'gas-piston' && byId.gasForce && byId.atmForce && byId.gravity && byId.height) {
    // 力のつり合い：上向きの気体の力 ＝ 下向きの大気圧の力＋重力。
    const up = -byId.gasForce.vector[1];
    const down = byId.atmForce.vector[1] + byId.gravity.vector[1];
    if (Math.abs(up - down) > 0.5) return ['ピストンの力のつり合いが成り立ちません: 上 ' + up.toFixed(2) + ' / 下 ' + down.toFixed(2)];
    // 圧力の定義：p = p0 + mg/S。矢印の長さが各力の縮尺（25 N/px）と一致すること。
    const pCalc = scene.p0Pa + (scene.pistonKg * scene.g) / scene.areaM2;
    if (Math.abs(scene.pPa - pCalc) > 1) return ['圧力が p0 + mg/S と一致しません'];
    if (Math.abs(up - scene.pPa * scene.areaM2 / 25) > 0.5) return ['気体の力の矢印が pS と一致しません'];
    if (Math.abs(byId.atmForce.vector[1] - scene.p0Pa * scene.areaM2 / 25) > 0.5) return ['大気圧の力の矢印が p0S と一致しません'];
    if (Math.abs(byId.gravity.vector[1] - scene.pistonKg * scene.g / 25) > 0.5) return ['重力の矢印が mg と一致しません'];
    // 状態方程式：pV = nRT。高さの矢印が h = V/S と一致すること。
    if (Math.abs(scene.pPa * scene.vM3 - scene.nMol * scene.rGas * scene.tK) > 0.01) return ['状態方程式 pV = nRT が成り立ちません'];
    if (Math.abs(-byId.height.vector[1] - scene.hM * 400) > 0.5) return ['高さの矢印が V/S と一致しません'];
  }
  if (scene.type === 'young' && byId.ray1 && byId.ray2) {
    const d = scene.derived, L = scene.layout;
    // 縞間隔：Δx = λL/d。n 番目の明線の位置：x = nΔx。光路差：d・x/L = nλ。
    if (Math.abs(d.dxM - (d.lamM * scene.lM) / d.dM) > 1e-12) return ['縞間隔が λL/d と一致しません'];
    if (Math.abs(d.xNM - scene.n * d.dxM) > 1e-12) return ['明線の位置が nΔx と一致しません'];
    if (Math.abs(d.pathDiffM - scene.n * d.lamM) / d.lamM > 1e-9) return ['光路差が nλ と一致しません'];
    // 図の光路の長さが三平方の定理どおりか。光路差の目印が下の光路上にあり、
    // 下のスリットからの距離が上の光路の長さと等しいこと。
    const r1 = Math.hypot(byId.ray1.vector[0], byId.ray1.vector[1]);
    const r2 = Math.hypot(byId.ray2.vector[0], byId.ray2.vector[1]);
    if (Math.abs(r1 - L.ray1Px) > 0.5 || Math.abs(r2 - L.ray2Px) > 0.5) return ['光路の矢印の長さが幾何と一致しません'];
    if (r2 <= r1) return ['下の光路が上の光路より長くなっていません'];
    const tickDist = Math.hypot(L.tick.x - L.lowerSlit.x, L.tick.y - L.lowerSlit.y);
    if (Math.abs(tickDist - r1) > 0.5) return ['光路差の目印の位置が上の光路の長さと一致しません'];
  }
  if (scene.type === 'capacitor' && byId.field2 && byId.attractTop) {
    const d = scene.derived;
    // C = εS/d。Q と U の関係：電池接続時 Q=CV、切り離し時 V=Q0/C。U = ½CV²。
    const cCalc = (scene.eps0 * scene.areaM2) / d.dM;
    if (Math.abs(d.cF - cCalc) / cCalc > 1e-9) return ['電気容量が εS/d と一致しません'];
    if (scene.phase === 'disconnected') {
      if (Math.abs(d.qC - scene.q0C) > 1e-15) return ['切り離し後の電荷が Q0 と一致しません'];
      if (Math.abs(d.vV - scene.q0C / d.cF) > 1e-9) return ['切り離し後の電圧が Q0/C と一致しません'];
    } else {
      if (Math.abs(d.qC - d.cF * d.vV) > 1e-15) return ['電荷が CV と一致しません'];
    }
    if (Math.abs(d.uJ - 0.5 * d.cF * d.vV * d.vV) > 1e-15) return ['静電エネルギーが ½CV² と一致しません'];
    // 電場 E = V/d、引力 F = Q²/(2εS)。矢印の長さが各縮尺と一致すること。
    if (Math.abs(d.eVm - d.vV / d.dM) > 1e-9) return ['電場が V/d と一致しません'];
    const fCalc = (d.qC * d.qC) / (2 * scene.eps0 * scene.areaM2);
    if (Math.abs(d.fN - fCalc) / fCalc > 1e-9) return ['極板間の引力が Q²/(2εS) と一致しません'];
    if (Math.abs(byId.field2.vector[1] - d.eVm * 0.004) > 0.5) return ['電場の矢印が E の縮尺と一致しません'];
    if (Math.abs(byId.attractTop.vector[1] - d.fN * (40 / 8.85e-6)) > 0.5) return ['引力の矢印が F の縮尺と一致しません'];
    // 極板間隔の図示：40 px/mm。
    if (Math.abs(scene.dPx - scene.dMm * 40) > 0.5) return ['極板間隔の図示が d の縮尺と一致しません'];
  }
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
  if (scene.type === 'slopePulley' && byId.gravityA && byId.normalA && byId.frictionA && byId.decompSinA && byId.decompCosA) {
    const s = scene.sinTheta, c = scene.cosTheta, g = scene.g, scale = scene.scalePxPerN;
    const mAgN = scene.mAKg * g, mBgN = scene.mBKg * g;
    // 垂直抗力と摩擦力の長さが N = mAg cosθ、f = μN と一致すること。
    const nPx = Math.hypot(byId.normalA.vector[0], byId.normalA.vector[1]);
    const fPx = Math.hypot(byId.frictionA.vector[0], byId.frictionA.vector[1]);
    if (Math.abs(nPx - mAgN * c * scale) > 0.5) return ['垂直抗力の長さが mAg cosθ と一致しません: ' + nPx.toFixed(2)];
    if (Math.abs(fPx - scene.mu * mAgN * c * scale) > 0.5) return ['摩擦力の長さが μN と一致しません: ' + fPx.toFixed(2)];
    // 分解の2本の和が A の重力と一致すること。
    const sx = byId.decompSinA.vector[0] + byId.decompCosA.vector[0] - byId.gravityA.vector[0];
    const sy = byId.decompSinA.vector[1] + byId.decompCosA.vector[1] - byId.gravityA.vector[1];
    if (Math.hypot(sx, sy) > 0.5) return ['分解の和が A の重力と一致しません: (' + sx.toFixed(2) + ', ' + sy.toFixed(2) + ')'];
    if (scene.phase === 'connected' && byId.tensionA && byId.tensionB && byId.accA && byId.accB) {
      // 張力は両側で等しい。2本の運動方程式が同じ a, T で成り立つこと。
      const tA = Math.hypot(byId.tensionA.vector[0], byId.tensionA.vector[1]) / scale;
      const tB = -byId.tensionB.vector[1] / scale;
      if (Math.abs(tA - tB) > 0.5) return ['両側の張力が等しくありません: ' + tA.toFixed(2) + ' / ' + tB.toFixed(2)];
      const a = (mBgN - mAgN * s - scene.mu * mAgN * c) / (scene.mAKg + scene.mBKg);
      const tCalc = scene.mBKg * (g - a);
      if (Math.abs(tA - tCalc) > 0.5) return ['張力が mB(g-a) と一致しません: ' + tA.toFixed(2) + ' / ' + tCalc.toFixed(2)];
      const eqA = tA - mAgN * s - scene.mu * mAgN * c - scene.mAKg * a;
      const eqB = mBgN - tA - scene.mBKg * a;
      if (Math.abs(eqA) > 0.5 || Math.abs(eqB) > 0.5) return ['運動方程式が成り立ちません: A側 ' + eqA.toFixed(2) + ' / B側 ' + eqB.toFixed(2)];
      // 加速度の矢印の長さは両側で等しい。
      if (Math.abs(Math.hypot(byId.accA.vector[0], byId.accA.vector[1]) - Math.abs(byId.accB.vector[1])) > 0.5) return ['加速度の矢印の長さが両側で等しくありません'];
    }
    if (scene.phase === 'after' && byId.accAfterA) {
      // 切れたあとの減速：a' = g(sinθ + μcosθ)。重力の斜面成分と摩擦力がどちらも下向き。
      const aAfter = g * (s + scene.mu * c);
      const accPx = Math.hypot(byId.accAfterA.vector[0], byId.accAfterA.vector[1]);
      if (Math.abs(accPx - aAfter * 5) > 0.5) return ["切れたあとの減速の矢印が a' と一致しません: " + accPx.toFixed(2)];
      // 張力がないこと（after の forces に tensionA / tensionB が含まれていないこと）。
      if (byId.tensionA || byId.tensionB) return ['切れたあとの図に張力が残っています'];
    }
  }
  if (scene.type === 'ballistic') {
    const d = scene.derived;
    const m = scene.mBulletKg, M = scene.bobMassKg, g = scene.g;
    // 運動量保存：v' = mv0/(m+M)。衝突直後の運動エネルギーは衝突前より小さいこと。
    if (Math.abs(d.momentum - m * scene.v0Ms) > 1e-9) return ['運動量が mv0 と一致しません'];
    if (Math.abs(d.vPrime - (m * scene.v0Ms) / (m + M)) > 1e-9) return ['衝突直後の速さが運動量保存と一致しません'];
    if (Math.abs(d.keBefore - 0.5 * m * scene.v0Ms * scene.v0Ms) > 1e-9) return ['衝突前の運動エネルギーが一致しません'];
    if (Math.abs(d.keAfter - 0.5 * (m + M) * d.vPrime * d.vPrime) > 1e-9) return ['衝突直後の運動エネルギーが一致しません'];
    if (!(d.keLost > 0)) return ['完全非弾性衝突なのに運動エネルギーが失われていません'];
    // 振り上がり：h = v'²/(2g)、cosθ = 1 − h/L、sin²θ + cos²θ = 1。
    if (Math.abs(d.hMaxM - (d.vPrime * d.vPrime) / (2 * g)) > 1e-9) return ['最大の高さが v\'²/(2g) と一致しません'];
    if (Math.abs(d.cosTheta - (1 - d.hMaxM / scene.lengthM)) > 1e-9) return ['cosθ が 1 − h/L と一致しません'];
    if (Math.abs(d.sinTheta * d.sinTheta + d.cosTheta * d.cosTheta - 1) > 1e-9) return ['sin²θ + cos²θ が 1 になりません'];
    // 張力：最下点 (m+M)(g + v'²/L)、最大の高さ (m+M)g cosθ。
    if (Math.abs(d.tensionBottomN - (m + M) * (g + (d.vPrime * d.vPrime) / scene.lengthM)) > 1e-9) return ['最下点の張力が一致しません'];
    if (Math.abs(d.tensionMaxN - (m + M) * g * d.cosTheta) > 1e-9) return ['最大の高さの張力が一致しません'];
    // 周期：T = 2π√(L/g)。最大の高さまでの時間は T/4。
    if (Math.abs(d.periodS - 2 * Math.PI * Math.sqrt(scene.lengthM / g)) > 1e-9) return ['周期が 2π√(L/g) と一致しません'];
    if (Math.abs(d.tToMaxS - d.periodS / 4) > 1e-9) return ['最大の高さまでの時間が T/4 と一致しません'];
    // 矢印の長さが縮尺どおりか。重力 20 N → 40、張力（最下点 28 N → 56、最大 16 N → 32）。
    if (byId.velocityAfter && Math.abs(Math.hypot(byId.velocityAfter.vector[0], byId.velocityAfter.vector[1]) - d.vPrime * 30) > 0.5) return ['衝突直後の速度の矢印が v\' の縮尺と一致しません'];
    if (byId.gravity && Math.abs(Math.hypot(byId.gravity.vector[0], byId.gravity.vector[1]) - d.gravityN * 2) > 0.5) return ['重力の矢印が mg の縮尺と一致しません'];
    if (scene.phase === 'impact' && byId.tension && Math.abs(Math.hypot(byId.tension.vector[0], byId.tension.vector[1]) - d.tensionBottomN * 2) > 0.5) return ['最下点の張力の矢印が T の縮尺と一致しません'];
    if (scene.phase === 'max' && byId.tension && Math.abs(Math.hypot(byId.tension.vector[0], byId.tension.vector[1]) - d.tensionMaxN * 2) > 0.5) return ['最大の高さの張力の矢印が T の縮尺と一致しません'];
    // 最大の高さのおもりの位置が、支点から糸の長さだけ離れていること。
    if (scene.phase === 'max') {
      const dx = d.bobMax.x - d.pivot.x, dy = d.bobMax.y - d.pivot.y;
      if (Math.abs(Math.hypot(dx, dy) - d.stringPx) > 0.5) return ['最大の高さのおもりが糸の長さだけ支点から離れていません'];
      if (Math.abs(d.bobMax.y - (d.bobBottom.y - d.hMaxM * 140)) > 0.5) return ['最大の高さのおもりの上がり方が h と一致しません'];
    }
  }
  if (scene.type === 'loop') {
    const d = scene.derived;
    const m = scene.mKg, r = scene.loopRM, h = scene.hM, g = scene.g;
    // エネルギー保存：最下点 v² = 2gh、頂点 v² = 2g(h−2R)。
    if (Math.abs(d.vBottom * d.vBottom - 2 * g * h) > 1e-9) return ['最下点の速さがエネルギー保存と一致しません'];
    if (Math.abs(d.vTop * d.vTop - Math.max(0, 2 * g * (h - 2 * r))) > 1e-9) return ['頂点の速さがエネルギー保存と一致しません'];
    // 垂直抗力：最下点 N = mg + mv²/R、頂点 N = mv²/R − mg。
    if (Math.abs(d.nBottom - (m * g + (m * d.vBottom * d.vBottom) / r)) > 1e-9) return ['最下点の垂直抗力が一致しません'];
    if (Math.abs(d.nTop - ((m * d.vTop * d.vTop) / r - m * g)) > 1e-9) return ['頂点の垂直抗力が一致しません'];
    // 最小の高さ h = 2.5R、そのときの頂点の速さ √(gR) と N = 0。
    if (Math.abs(d.hMinM - 2.5 * r) > 1e-9) return ['最小の高さが 2.5R と一致しません'];
    if (Math.abs(d.vTopMin * d.vTopMin - g * r) > 1e-9) return ['最小の頂点の速さが √(gR) と一致しません'];
    // 矢印の長さが縮尺どおりか。速度 10 px/(m/s)、力 1 px/N。
    if (scene.phase === 'bottom' && byId.velocity && Math.abs(Math.hypot(byId.velocity.vector[0], byId.velocity.vector[1]) - d.vBottom * 10) > 0.5) return ['最下点の速度の矢印が v の縮尺と一致しません'];
    if (scene.phase === 'bottom' && byId.normal && Math.abs(Math.hypot(byId.normal.vector[0], byId.normal.vector[1]) - d.nBottom) > 0.5) return ['最下点の垂直抗力の矢印が N の縮尺と一致しません'];
    if (scene.phase === 'top' && byId.velocity && Math.abs(Math.hypot(byId.velocity.vector[0], byId.velocity.vector[1]) - d.vTop * 10) > 0.5) return ['頂点の速度の矢印が v の縮尺と一致しません'];
    if (scene.phase === 'top' && byId.normal && Math.abs(Math.hypot(byId.normal.vector[0], byId.normal.vector[1]) - Math.abs(d.nTop)) > 0.5) return ['頂点の垂直抗力の矢印が N の縮尺と一致しません'];
    if (scene.phase === 'top' && byId.gravity && byId.normal) {
      // 頂点では重力と垂直抗力の合力が向心力：N + mg = mv²/R。
      if (Math.abs(d.nTop + m * g - (m * d.vTop * d.vTop) / r) > 1e-9) return ['頂点で N + mg が向心力と一致しません'];
    }
    // 離れる点（h < 2.5R のとき）：cosφ = 2(h−R)/(3R)、その点で mv²/R = mg cosφ。
    if (scene.phase === 'fall' && d.fallCos !== null) {
      if (Math.abs(d.fallCos - (2 * (h - r)) / (3 * r)) > 1e-9) return ['離れる点の cosφ が一致しません'];
      if (Math.abs(d.fallYM - (r + r * d.fallCos)) > 1e-9) return ['離れる点の高さが一致しません'];
      if (Math.abs(d.fallV * d.fallV - 2 * g * (h - d.fallYM)) > 1e-9) return ['離れる点の速さがエネルギー保存と一致しません'];
      if (Math.abs((m * d.fallV * d.fallV) / r - m * g * d.fallCos) > 1e-9) return ['離れる点で mv²/R が mg cosφ と一致しません'];
      if (byId.velocity && Math.abs(Math.hypot(byId.velocity.vector[0], byId.velocity.vector[1]) - d.fallV * 10) > 0.5) return ['離れる点の速度の矢印が v の縮尺と一致しません'];
    }
  }
  if (scene.type === 'projEnergy') {
    const d = scene.derived;
    const rad = (scene.angleDeg * Math.PI) / 180;
    // 初速度の成分：v0x = v0cosθ、v0y = v0sinθ。
    if (Math.abs(d.v0x - scene.v0Ms * Math.cos(rad)) > 1e-9) return ['水平成分が v0cosθ と一致しません'];
    if (Math.abs(d.v0y - scene.v0Ms * Math.sin(rad)) > 1e-9) return ['鉛直成分が v0sinθ と一致しません'];
    // 最高点 H = h0 + v0y²/(2g)、頂点まで t = v0y/g。
    if (Math.abs(d.hMaxM - (scene.h0M + (d.v0y * d.v0y) / (2 * d.g))) > 1e-9) return ['最高点の高さが一致しません'];
    if (Math.abs(d.tTopS - d.v0y / d.g) > 1e-9) return ['頂点までの時間が v0y/g と一致しません'];
    // 滞空時間と飛距離：R = v0x・t。
    if (Math.abs(d.tFlightS - (d.v0y + Math.sqrt(d.v0y * d.v0y + 2 * d.g * scene.h0M)) / d.g) > 1e-9) return ['滞空時間が一致しません'];
    if (Math.abs(d.rangeM - d.v0x * d.tFlightS) > 1e-9) return ['飛距離が vx・t と一致しません'];
    // 着地の速さはエネルギー保存：v² = v0² + 2gh0。成分の合成とも一致すること。
    if (Math.abs(d.vGroundMs * d.vGroundMs - (scene.v0Ms * scene.v0Ms + 2 * d.g * scene.h0M)) > 1e-9) return ['着地の速さがエネルギー保存と一致しません'];
    if (Math.abs(d.vyGroundMs * d.vyGroundMs - (d.v0y * d.v0y + 2 * d.g * scene.h0M)) > 1e-9) return ['着地の鉛直成分が一致しません'];
    if (Math.abs(d.vGroundMs * d.vGroundMs - (d.v0x * d.v0x + d.vyGroundMs * d.vyGroundMs)) > 1e-9) return ['着地の速さが成分の合成と一致しません'];
    // 下向きに投げた場合：着地の速さは同じだが、滞空時間と飛距離は短い。
    if (Math.abs(d.tDownS - (Math.sqrt(d.v0y * d.v0y + 2 * d.g * scene.h0M) - d.v0y) / d.g) > 1e-9) return ['下向きに投げた滞空時間が一致しません'];
    if (Math.abs(d.rangeDownM - d.v0x * d.tDownS) > 1e-9) return ['下向きに投げた飛距離が一致しません'];
    if (!(d.rangeDownM < d.rangeM)) return ['下向きに投げた飛距離が上向きより短くなっていません'];
    // 矢印の長さが縮尺どおりか。速度 6 px/(m/s)、重力 10 px/N。
    if (scene.phase === 'base' && byId.velocity && Math.abs(Math.hypot(byId.velocity.vector[0], byId.velocity.vector[1]) - scene.v0Ms * 6) > 0.5) return ['初速度の矢印が v0 の縮尺と一致しません'];
    if (scene.phase === 'top' && byId.velocity && Math.abs(byId.velocity.vector[0] - d.v0x * 6) > 0.5) return ['頂点の速度の矢印が vx の縮尺と一致しません'];
    if (scene.phase === 'ground' && byId.vx && byId.vy && byId.v) {
      if (Math.abs(byId.vx.vector[0] - d.v0x * 6) > 0.5) return ['水平成分の矢印が vx の縮尺と一致しません'];
      if (Math.abs(byId.vy.vector[1] - d.vyGroundMs * 6) > 0.5) return ['鉛直成分の矢印が vy の縮尺と一致しません'];
      if (Math.abs(Math.hypot(byId.v.vector[0], byId.v.vector[1]) - d.vGroundMs * 6) > 0.5) return ['着地の速度の矢印が v の縮尺と一致しません'];
    }
    if (byId.gravity && Math.abs(Math.hypot(byId.gravity.vector[0], byId.gravity.vector[1]) - d.gravityN * 10) > 0.5) return ['重力の矢印が mg の縮尺と一致しません'];
  }
  if (scene.type === 'youngWater') {
    const d = scene.derived;
    // 水中の波長 λ' = λ/n。振動数は変わらないので λ' = v水/f。
    if (Math.abs(d.lamWaterNm - scene.lambdaNm / scene.nWater) > 1e-9) return ['水中の波長が λ/n と一致しません'];
    if (Math.abs(d.freqHz - d.c / (scene.lambdaNm * 1e-9)) > 1e3) return ['振動数が c/λ と一致しません'];
    if (Math.abs(d.vWaterMs - d.c / scene.nWater) > 1) return ['水中の光の速さが c/n と一致しません'];
    if (Math.abs(d.lamWaterNm * 1e-9 - d.vWaterMs / d.freqHz) > 1e-12) return ['水中の波長が v/f と一致しません'];
    // 縞間隔 Δx = λL/d（空気中と水中）、3番目の明線 x = 3Δx。
    if (Math.abs(d.dxAirMm - (scene.lambdaNm * 1e-9 * scene.lM) / (scene.dMm * 1e-3) * 1e3) > 1e-9) return ['空気中の縞間隔が λL/d と一致しません'];
    if (Math.abs(d.dxWaterMm - (d.lamWaterNm * 1e-9 * scene.lM) / (scene.dMm * 1e-3) * 1e3) > 1e-9) return ['水中の縞間隔が λ′L/d と一致しません'];
    if (Math.abs(d.x3AirMm - 3 * d.dxAirMm) > 1e-9 || Math.abs(d.x3WaterMm - 3 * d.dxWaterMm) > 1e-9) return ['3番目の明線の位置が 3Δx と一致しません'];
    // 青い光：水中ではさらに波長が短く、縞間隔も狭くなる。
    if (Math.abs(d.lamBlueWaterNm - scene.lambdaBlueNm / scene.nWater) > 1e-9) return ['青い光の水中の波長が λ/n と一致しません'];
    if (Math.abs(d.dxBlueWaterMm - (d.lamBlueWaterNm * 1e-9 * scene.lM) / (scene.dMm * 1e-3) * 1e3) > 1e-9) return ['青い光の水中の縞間隔が λ′L/d と一致しません'];
    // 光路の矢印の長さが幾何と一致すること（air/water の場面）。
    if ((scene.phase === 'air' || scene.phase === 'water') && byId.ray1 && byId.ray2) {
      const point = scene.phase === 'air' ? d.pointAir : d.pointWater;
      const r1 = Math.hypot(point.x - d.upperSlit.x, point.y - d.upperSlit.y);
      const r2 = Math.hypot(point.x - d.lowerSlit.x, point.y - d.lowerSlit.y);
      if (Math.abs(Math.hypot(byId.ray1.vector[0], byId.ray1.vector[1]) - r1) > 0.5) return ['光路1の矢印の長さが幾何と一致しません'];
      if (Math.abs(Math.hypot(byId.ray2.vector[0], byId.ray2.vector[1]) - r2) > 0.5) return ['光路2の矢印の長さが幾何と一致しません'];
      if (r2 <= r1) return ['下の光路が上の光路より長くなっていません'];
    }
  }
  if (scene.type === 'dopplerShm') {
    const d = scene.derived;
    // 単振動：ω = √(k/m)、T = 2π/ω、v_max = ωA、a_max = ω²A、F_max = kA。
    if (Math.abs(d.omega - Math.sqrt(scene.kNm / scene.mKg)) > 1e-9) return ['角振動数が √(k/m) と一致しません'];
    if (Math.abs(d.periodS - (2 * Math.PI) / d.omega) > 1e-9) return ['周期が 2π/ω と一致しません'];
    if (Math.abs(d.vMaxMs - d.omega * scene.ampM) > 1e-9) return ['音源の最大の速さが ωA と一致しません'];
    if (Math.abs(d.aMaxMs2 - d.omega * d.omega * scene.ampM) > 1e-9) return ['音源の最大の加速度が ω²A と一致しません'];
    if (Math.abs(d.fMaxN - scene.kNm * scene.ampM) > 1e-9) return ['ばねの力の最大値が kA と一致しません'];
    // ドップラーシフト：近づくとき f・V/(V−v_max)、遠ざかるとき f・V/(V+v_max)。
    if (Math.abs(d.fMaxHz - (scene.freqHz * scene.soundSpeedMs) / (scene.soundSpeedMs - d.vMaxMs)) > 1e-9) return ['近づくときの観測振動数が一致しません'];
    if (Math.abs(d.fMinHz - (scene.freqHz * scene.soundSpeedMs) / (scene.soundSpeedMs + d.vMaxMs)) > 1e-9) return ['遠ざかるときの観測振動数が一致しません'];
    if (!(d.fMinHz < scene.freqHz && scene.freqHz < d.fMaxHz)) return ['観測振動数が 440 Hz をはさんで変化していません'];
    // 折り返し点では v_s = 0 なので f'(T/4) = 440 Hz になること。
    if (Math.abs(d.fPrimeAt(d.periodS / 4) - scene.freqHz) > 1e-9) return ['折り返し点の観測振動数が 440 Hz になっていません'];
    if (Math.abs(d.fPrimeAt(0) - d.fMaxHz) > 1e-9 || Math.abs(d.fPrimeAt(d.periodS / 2) - d.fMinHz) > 1e-9) return ['観測振動数の時間変化が最大・最小と一致しません'];
    // うなり：最大のずれと、その周期。
    if (Math.abs(d.beatMaxHz - (d.fMaxHz - scene.freqHz)) > 1e-9) return ['うなりの最大の振動数差が一致しません'];
    if (Math.abs(d.beatPeriodS - 1 / d.beatMaxHz) > 1e-9) return ['うなりの周期が 1/Δf と一致しません'];
    // 波長は変わらない（静止時）：λ = V/f。
    if (Math.abs(d.lamM - scene.soundSpeedMs / scene.freqHz) > 1e-9) return ['波長が V/f と一致しません'];
    // 矢印の長さが縮尺どおりか。速度 20 px/(m/s)、ばねの力 2 px/N。
    if (byId.srcVel && Math.abs(byId.srcVel.vector[0] - d.vMaxMs * 20) > 0.5) return ['音源の速度の矢印が v_max の縮尺と一致しません'];
    if (byId.springForce && Math.abs(-byId.springForce.vector[0] - d.fMaxN * 2) > 0.5) return ['ばねの力の矢印が kA の縮尺と一致しません'];
  }
  if (scene.type === 'capSpring') {
    const d = scene.derived;
    // 静電引力 F = Q²/(2ε0S)。Q 一定なら d によらない。
    if (Math.abs(d.fN - (scene.qC * scene.qC) / (2 * scene.eps0 * scene.areaM2)) > 1e-12) return ['静電引力が Q²/(2ε0S) と一致しません'];
    // つり合いの伸び x0 = F/k。単振動：ω = √(k/m)、T = 2π/ω。
    if (Math.abs(d.x0M - d.fN / scene.kNm) > 1e-12) return ['つり合いの伸びが F/k と一致しません'];
    if (Math.abs(d.omega - Math.sqrt(scene.kNm / scene.mKg)) > 1e-9) return ['角振動数が √(k/m) と一致しません'];
    if (Math.abs(d.periodS - (2 * Math.PI) / d.omega) > 1e-9) return ['周期が 2π/ω と一致しません'];
    // 電気量：C0 = ε0S/d、V0 = Q/C0、U0 = Q²/(2C0)。
    if (Math.abs(d.c0F - (scene.eps0 * scene.areaM2) / (scene.dMm * 1e-3)) > 1e-15) return ['はじめの静電容量が ε0S/d と一致しません'];
    if (Math.abs(d.v0V - scene.qC / d.c0F) > 1e-6) return ['はじめの電圧が Q/C と一致しません'];
    if (Math.abs(d.u0J - (scene.qC * scene.qC) / (2 * d.c0F)) > 1e-12) return ['はじめの静電エネルギーが Q²/(2C) と一致しません'];
    // d を半分に（Q 一定）：C は 2 倍、V は半分、U は半分。静電気力のはたらきと一致すること。
    if (Math.abs(d.c1F - 2 * d.c0F) > 1e-15) return ['d を半分にした静電容量が 2 倍になっていません'];
    if (Math.abs(d.v1V - d.v0V / 2) > 1e-6) return ['d を半分にした電圧が半分になっていません'];
    if (Math.abs(d.u1J - d.u0J / 2) > 1e-12) return ['d を半分にした静電エネルギーが半分になっていません'];
    if (Math.abs(d.workJ - (d.u0J - d.u1J)) > 1e-12) return ['静電気力のはたらきがエネルギーの減少と一致しません'];
    // 対比（V 一定）：d を半分にすると静電引力は 4 倍になり、ばねの力を上回ること。
    if (Math.abs(d.fVFixedN - 4 * d.fN) > 1e-9) return ['V 一定で d を半分にした静電引力が 4 倍になっていません'];
    if (!(d.fVFixedN > d.springVFixedN)) return ['V 一定で d を半分にしたとき静電引力がばねの力を上回っていません'];
    // 単振動の速さ・加速度：v_max = ωA、a_max = ω²A。
    if (Math.abs(d.vMaxMs - d.omega * scene.ampMm * 1e-3) > 1e-12) return ['単振動の最大の速さが ωA と一致しません'];
    if (Math.abs(d.aMaxMs2 - d.omega * d.omega * scene.ampMm * 1e-3) > 1e-12) return ['単振動の最大の加速度が ω²A と一致しません'];
    // 矢印の長さが縮尺どおりか。力は 200 px/N。
    if (byId.elec && scene.phase !== 'contrast' && Math.abs(-byId.elec.vector[0] - d.fN * 200) > 0.5) return ['静電引力の矢印が F の縮尺と一致しません'];
    if (byId.elec && scene.phase === 'contrast' && Math.abs(-byId.elec.vector[0] - d.fVFixedN * 200) > 0.5) return ['V 一定の静電引力の矢印が F の縮尺と一致しません'];
    if (byId.spring && scene.phase === 'charged' && Math.abs(byId.spring.vector[0] - d.fN * 200) > 0.5) return ['つり合いのばねの力の矢印が F の縮尺と一致しません'];
    if (byId.spring && scene.phase === 'contrast' && Math.abs(byId.spring.vector[0] - d.springVFixedN * 200) > 0.5) return ['V 一定のばねの力の矢印が縮尺と一致しません'];
  }
  if (scene.type === 'slopeEnergy') {
    const d = scene.derived;
    const m = scene.mKg, g = scene.g;
    // 高さ h = L sinθ、垂直抗力 N = mg cosθ、摩擦力 f = μN。
    if (Math.abs(d.hM - scene.slopeLM * d.sinT) > 1e-9) return ['高さが L sinθ と一致しません'];
    if (Math.abs(d.normalN - m * g * d.cosT) > 1e-9) return ['垂直抗力が mg cosθ と一致しません'];
    if (Math.abs(d.frictionN - scene.mu * d.normalN) > 1e-9) return ['摩擦力が μN と一致しません'];
    // 仕事：重力 mgh、摩擦 −fL、運動エネルギー = mgh − fL。
    if (Math.abs(d.wGravityJ - m * g * d.hM) > 1e-9) return ['重力の仕事が mgh と一致しません'];
    if (Math.abs(d.wFrictionJ + d.frictionN * scene.slopeLM) > 1e-9) return ['摩擦の仕事が −fL と一致しません'];
    if (Math.abs(d.keJ - (d.wGravityJ + d.wFrictionJ)) > 1e-9) return ['運動エネルギーが仕事の和と一致しません'];
    // 速さ：v² = 2KE/m、摩擦なしなら v² = 2gh。加速度 a = g(sinθ − μcosθ)、v² = 2aL。
    if (Math.abs(d.vMs * d.vMs - (2 * d.keJ) / m) > 1e-9) return ['速さがエネルギーと一致しません'];
    if (Math.abs(d.vNoFricMs * d.vNoFricMs - 2 * g * d.hM) > 1e-9) return ['摩擦なしの速さが √(2gh) と一致しません'];
    if (!(d.vMs < d.vNoFricMs)) return ['摩擦がある速さが摩擦なしより遅くなっていません'];
    if (Math.abs(d.accelMs2 - g * (d.sinT - scene.mu * d.cosT)) > 1e-9) return ['加速度が g(sinθ−μcosθ) と一致しません'];
    if (Math.abs(d.vMs * d.vMs - 2 * d.accelMs2 * scene.slopeLM) > 1e-9) return ['速さが 2aL と一致しません'];
    if (Math.abs(d.timeS - d.vMs / d.accelMs2) > 1e-9) return ['滑る時間が v/a と一致しません'];
    // 床：摩擦力 μmg、止まるまでの距離 s = v²/(2μg)、摩擦の仕事 = −運動エネルギー。
    if (Math.abs(d.floorFrictionN - scene.mu * m * g) > 1e-9) return ['床の摩擦力が μmg と一致しません'];
    if (Math.abs(d.stopM - (d.vMs * d.vMs) / (2 * scene.mu * g)) > 1e-9) return ['止まるまでの距離が v²/(2μg) と一致しません'];
    if (Math.abs(d.floorFrictionN * d.stopM - d.keJ) > 1e-9) return ['床の摩擦の仕事が運動エネルギーと一致しません'];
    // 矢印の長さが縮尺どおりか。力は 3 px/N、速度は 8 px/(m/s)。
    if (byId.gravity && Math.abs(Math.hypot(byId.gravity.vector[0], byId.gravity.vector[1]) - d.gravityN * 3) > 0.5) return ['重力の矢印が mg の縮尺と一致しません'];
    if (byId.normal && Math.abs(Math.hypot(byId.normal.vector[0], byId.normal.vector[1]) - d.normalN * 3) > 0.5) return ['垂直抗力の矢印が N の縮尺と一致しません'];
    if (byId.friction && scene.phase === 'forces' && Math.abs(Math.hypot(byId.friction.vector[0], byId.friction.vector[1]) - d.frictionN * 3) > 0.5) return ['摩擦力の矢印が f の縮尺と一致しません'];
    if (byId.decompSin && byId.decompCos && byId.gravity) {
      // 分解の和が重力と一致すること（ベクトル和）。
      const sx = byId.decompSin.vector[0] + byId.decompCos.vector[0] - byId.gravity.vector[0];
      const sy = byId.decompSin.vector[1] + byId.decompCos.vector[1] - byId.gravity.vector[1];
      if (Math.hypot(sx, sy) > 0.5) return ['分解の和が重力と一致しません'];
    }
    if (scene.phase === 'energy' && byId.velocity && Math.abs(Math.hypot(byId.velocity.vector[0], byId.velocity.vector[1]) - d.vMs * 8) > 0.5) return ['下端の速度の矢印が v の縮尺と一致しません'];
    if (scene.phase === 'trap' && byId.velocityFric && byId.velocityNoFric) {
      if (Math.abs(byId.velocityFric.vector[0] - d.vMs * 8) > 0.5) return ['摩擦ありの速度の矢印が v の縮尺と一致しません'];
      if (Math.abs(byId.velocityNoFric.vector[0] - d.vNoFricMs * 8) > 0.5) return ['摩擦なしの速度の矢印が v の縮尺と一致しません'];
    }
    if (scene.phase === 'floor' && byId.velocity && Math.abs(byId.velocity.vector[0] - d.vMs * 8) > 0.5) return ['床の速度の矢印が v の縮尺と一致しません'];
    if (scene.phase === 'floor' && byId.friction && Math.abs(-byId.friction.vector[0] - d.floorFrictionN * 3) > 0.5) return ['床の摩擦力の矢印が f の縮尺と一致しません'];
    // 止まる位置の図示：25 px/m。
    if (scene.phase === 'floor' && Math.abs(d.floorStopX - (d.floorStartX + d.stopM * 25)) > 0.5) return ['止まる位置の図示が距離と一致しません'];
  }
  if (scene.type === 'inductionLC') {
    const d = scene.derived;
    // 磁束 Φ = BS、誘導起電力 V = NΔΦ/Δt。
    if (Math.abs(d.phiWb - scene.bMaxT * scene.areaM2) > 1e-12) return ['磁束が BS と一致しません'];
    if (Math.abs(d.vIndV - (scene.turnsN * d.phiWb) / scene.dtS) > 1e-9) return ['誘導起電力が NΔΦ/Δt と一致しません'];
    // コンデンサ：Q = CV、U = ½CV²。
    if (Math.abs(d.qC - d.capF * d.vIndV) > 1e-12) return ['電荷が CV と一致しません'];
    if (Math.abs(d.uJ - 0.5 * d.capF * d.vIndV * d.vIndV) > 1e-15) return ['静電エネルギーが ½CV² と一致しません'];
    // LC 振動：ω = 1/√(LC)、T = 2π/ω、f = 1/T、I0 = V√(C/L)。
    if (Math.abs(d.omega - 1 / Math.sqrt(scene.indH * d.capF)) > 1e-9) return ['角振動数が 1/√(LC) と一致しません'];
    if (Math.abs(d.periodS - (2 * Math.PI) / d.omega) > 1e-12) return ['周期が 2π/ω と一致しません'];
    if (Math.abs(d.freqHz - 1 / d.periodS) > 1e-9) return ['振動数が 1/T と一致しません'];
    if (Math.abs(d.i0A - d.vIndV * Math.sqrt(d.capF / scene.indH)) > 1e-9) return ['最大電流が V√(C/L) と一致しません'];
    // エネルギー：½LI0² = ½CV²（コンデンサのエネルギーがコイルに移る）。
    if (Math.abs(d.uCoilJ - d.uJ) > 1e-15) return ['コイルのエネルギーがコンデンサのエネルギーと一致しません'];
    // q(t) = Q cos ωt、i(t) = −I0 sin ωt。T/4 で q=0、i は最大。
    if (Math.abs(d.qAt(0) - d.qC) > 1e-15) return ['t=0 の電荷が Q と一致しません'];
    if (Math.abs(d.qAt(d.tQuarterS)) > 1e-12) return ['T/4 の電荷が 0 になっていません'];
    if (Math.abs(d.iAt(d.tQuarterS) + d.i0A) > 1e-12) return ['T/4 の電流が最大になっていません'];
    if (Math.abs(d.qAt(d.tHalfS) + d.qC) > 1e-12) return ['T/2 の電荷が −Q になっていません'];
    // 罠：Δt を半分にすると V は 2 倍、Q も 2 倍。
    if (Math.abs(d.vDoubleV - 2 * d.vIndV) > 1e-9) return ['Δt を半分にした誘導起電力が 2 倍になっていません'];
    if (Math.abs(d.qDoubleC - 2 * d.qC) > 1e-12) return ['Δt を半分にした電荷が 2 倍になっていません'];
    // 矢印の長さが縮尺どおりか。電流の矢印は方向だけ（60 px 固定）。
    if (byId.current && Math.abs(Math.hypot(byId.current.vector[0], byId.current.vector[1]) - 60) > 0.5) return ['電流の矢印が固定長 60 px と一致しません'];
  }
  if (scene.type === 'gasResonance') {
    const d = scene.derived;
    // 物質量 n = pV/RT、定積加熱で p2 = p1×T2/T1。
    if (Math.abs(d.nMol - (scene.p1Pa * scene.volM3) / (scene.rGas * scene.t1K)) > 1e-9) return ['物質量が pV/RT と一致しません'];
    if (Math.abs(d.p2Pa - scene.p1Pa * (scene.t2K / scene.t1K)) > 1e-9) return ['加熱後の圧力が p1×T2/T1 と一致しません'];
    // 内部エネルギーの増加 ΔU = (3/2)nRΔT、定積なので W=0、Q=ΔU。
    if (Math.abs(d.dUJ - 1.5 * d.nMol * scene.rGas * (scene.t2K - scene.t1K)) > 1e-9) return ['内部エネルギーの増加が (3/2)nRΔT と一致しません'];
    if (Math.abs(d.wJ) > 1e-12) return ['定積変化なのに仕事が 0 になっていません'];
    if (Math.abs(d.qJ - d.dUJ) > 1e-9) return ['吸熱が ΔU と一致しません'];
    // 音速 v=√(γRT/M)、温度が 2 倍なら √2 倍。
    if (Math.abs(d.v1Ms - Math.sqrt((scene.gamma * scene.rGas * scene.t1K) / scene.molarMassKg)) > 1e-9) return ['音速が √(γRT/M) と一致しません'];
    if (Math.abs(d.v2Ms - d.v1Ms * Math.sqrt(scene.t2K / scene.t1K)) > 1e-9) return ['600 K の音速が 300 K の √2 倍になっていません'];
    // 両端閉管 f_n = nv/(2L)。基本振動数と 2 倍音。
    if (Math.abs(d.f1aHz - d.v1Ms / (2 * scene.pipeLM)) > 1e-9) return ['基本振動数が v/(2L) と一致しません'];
    if (Math.abs(d.f1bHz - d.v2Ms / (2 * scene.pipeLM)) > 1e-9) return ['600 K の基本振動数が v/(2L) と一致しません'];
    if (Math.abs(d.f2aHz - 2 * d.f1aHz) > 1e-9) return ['2 倍音が基本振動数の 2 倍になっていません'];
    if (Math.abs(d.f2bHz - 2 * d.f1bHz) > 1e-9) return ['600 K の 2 倍音が基本振動数の 2 倍になっていません'];
    // 罠の値：片端閉管の式 v/(4L) は基本振動数の半分になる。
    if (Math.abs(d.fWrongHz - d.f1aHz / 2) > 1e-9) return ['片端閉管の式の値が基本振動数の半分になっていません'];
    // 応用：f1=1200 Hz なら v=2Lf、T=T1×(v/v1)²。
    if (Math.abs(d.vAppMs - 2 * scene.pipeLM * 1200) > 1e-9) return ['応用の音速が 2Lf と一致しません'];
    if (Math.abs(d.tAppK - scene.t1K * (d.vAppMs / d.v1Ms) * (d.vAppMs / d.v1Ms)) > 1e-9) return ['応用の温度が T1×(v/v1)² と一致しません'];
  }
  if (scene.type === 'railCapCoil') {
    const d = scene.derived;
    // はじめの誘導起電力 ε0 = BLv0。
    if (Math.abs(d.eps0V - scene.bT * scene.railLM * scene.v0Ms) > 1e-9) return ['はじめの誘導起電力が BLv0 と一致しません'];
    // 「効き目の質量」B²L²C と、力積から決まる充電後の速さ v1 = mv0/(m + B²L²C)。
    if (Math.abs(d.effMassKg - scene.bT * scene.bT * scene.railLM * scene.railLM * scene.capF) > 1e-12) return ['効き目の質量が B²L²C と一致しません'];
    if (Math.abs(d.v1Ms - (scene.mKg * scene.v0Ms) / (scene.mKg + d.effMassKg)) > 1e-9) return ['充電後の速さが mv0/(m+B²L²C) と一致しません'];
    if (!(d.v1Ms < scene.v0Ms)) return ['充電後の速さがはじめより遅くなっていません'];
    // 電荷 Q = CBLv1、エネルギー U = Q²/(2C)。
    if (Math.abs(d.qC - scene.capF * scene.bT * scene.railLM * d.v1Ms) > 1e-12) return ['電荷が CBLv1 と一致しません'];
    if (Math.abs(d.uJ - (d.qC * d.qC) / (2 * scene.capF)) > 1e-15) return ['静電エネルギーが Q²/(2C) と一致しません'];
    // エネルギーの行き先：KE0 = KE1 + U + ジュール熱。ジュール熱は正でなければならない。
    if (Math.abs(d.ke0J - 0.5 * scene.mKg * scene.v0Ms * scene.v0Ms) > 1e-9) return ['はじめの運動エネルギーが (1/2)mv0² と一致しません'];
    if (Math.abs(d.ke1J - 0.5 * scene.mKg * d.v1Ms * d.v1Ms) > 1e-9) return ['あとの運動エネルギーが (1/2)mv1² と一致しません'];
    if (Math.abs(d.jouleJ - (d.ke0J - d.ke1J - d.uJ)) > 1e-9) return ['ジュール熱が KE0−KE1−U と一致しません'];
    if (!(d.jouleJ > 0)) return ['ジュール熱が正になっていません'];
    // 罠の値：エネルギー保存だけを使うと v0/√(1 + B²L²C/m) になる（正しい v1 より速い）。
    if (Math.abs(d.vEnergyWrongMs - scene.v0Ms / Math.sqrt(1 + d.effMassKg / scene.mKg)) > 1e-9) return ['エネルギー保存だけの速さが v0/√(1+B²L²C/m) と一致しません'];
    if (!(d.vEnergyWrongMs > d.v1Ms)) return ['エネルギー保存だけの速さが正しい速さより速くなっていません'];
    // LC 振動：ω = 1/√(LC)、T = 2π/ω、I0 = Qω、½LI0² = U。
    if (Math.abs(d.omega - 1 / Math.sqrt(scene.indH * scene.capF)) > 1e-9) return ['角振動数が 1/√(LC) と一致しません'];
    if (Math.abs(d.periodS - (2 * Math.PI) / d.omega) > 1e-12) return ['周期が 2π/ω と一致しません'];
    if (Math.abs(d.freqHz - 1 / d.periodS) > 1e-9) return ['振動数が 1/T と一致しません'];
    if (Math.abs(d.i0A - d.qC * d.omega) > 1e-9) return ['最大電流が Qω と一致しません'];
    if (Math.abs(d.uCoilJ - d.uJ) > 1e-15) return ['コイルのエネルギーがコンデンサのエネルギーと一致しません'];
    // q(t) = Q cos ωt、i(t) = −I0 sin ωt。T/4 で q=0、i は最大。
    if (Math.abs(d.qAt(0) - d.qC) > 1e-15) return ['t=0 の電荷が Q と一致しません'];
    if (Math.abs(d.qAt(d.tQuarterS)) > 1e-12) return ['T/4 の電荷が 0 になっていません'];
    if (Math.abs(d.iAt(d.tQuarterS) + d.i0A) > 1e-12) return ['T/4 の電流が最大になっていません'];
    if (Math.abs(d.qAt(d.tHalfS) + d.qC) > 1e-12) return ['T/2 の電荷が −Q になっていません'];
    // 矢印の長さが縮尺どおりか。速度は 30 px/(m/s)、電流は方向だけ（60 px 固定）。
    if (byId.velocity && scene.phase === 'base' && Math.abs(byId.velocity.vector[0] - scene.v0Ms * 30) > 0.5) return ['はじめの速度の矢印が v0 の縮尺と一致しません'];
    if (byId.velocity && scene.phase === 'charge' && Math.abs(byId.velocity.vector[0] - d.v1Ms * 30) > 0.5) return ['充電後の速度の矢印が v1 の縮尺と一致しません'];
    if (byId.current && Math.abs(Math.hypot(byId.current.vector[0], byId.current.vector[1]) - 60) > 0.5) return ['電流の矢印が固定長 60 px と一致しません'];
  }
  if (scene.type === 'capSpringGrav') {
    const d = scene.derived;
    // 静電気力の係数 C_e = ε0SV²/2、重力 mg。
    if (Math.abs(d.cE - (scene.eps0 * scene.areaM2 * scene.voltV * scene.voltV) / 2) > 1e-15) return ['静電気力の係数が ε0SV²/2 と一致しません'];
    if (Math.abs(d.mgN - scene.mKg * (scene.g || 10)) > 1e-9) return ['重力が mg と一致しません'];
    // 電池なし：伸び y0 = mg/k、板間隔 d0 = d_nat − y0、ω0 = √(k/m)、T0 = 2π/ω0。
    if (Math.abs(d.y0M - d.mgN / scene.kNm) > 1e-12) return ['電池なしのばねの伸びが mg/k と一致しません'];
    if (Math.abs(d.d0M - (scene.dNatMm * 1e-3 - d.y0M)) > 1e-12) return ['電池なしの板間隔が d_nat−y0 と一致しません'];
    if (Math.abs(d.omega0 - Math.sqrt(scene.kNm / scene.mKg)) > 1e-9) return ['電池なしの角振動数が √(k/m) と一致しません'];
    if (Math.abs(d.period0S - (2 * Math.PI) / d.omega0) > 1e-12) return ['電池なしの周期が 2π/ω0 と一致しません'];
    // 電池あり：つり合いの残差 |k(d_nat−d1) − mg − C_e/d1²| がほぼ 0。
    if (Math.abs(scene.kNm * (scene.dNatMm * 1e-3 - d.d1M) - d.mgN - d.f1N) > 0.005) return ['電池ありのつり合いが成り立っていません'];
    if (Math.abs(d.f1N - d.cE / (d.d1M * d.d1M)) > 1e-9) return ['つり合いの静電気力が C_e/d1² と一致しません'];
    if (!(d.d1M < d.d0M)) return ['電池をつないだ板間隔が電池なしより狭くなっていません'];
    // 実効ばね定数 k_eff = k − 2C_e/d1³、ω = √(k_eff/m)、T = 2π/ω。
    if (Math.abs(d.kEff - (scene.kNm - (2 * d.cE) / (d.d1M * d.d1M * d.d1M))) > 1e-9) return ['実効ばね定数が k−2C_e/d1³ と一致しません'];
    if (!(d.kEff < scene.kNm)) return ['実効ばね定数がばね定数より小さくなっていません'];
    if (Math.abs(d.omega - Math.sqrt(d.kEff / scene.mKg)) > 1e-9) return ['角振動数が √(k_eff/m) と一致しません'];
    if (Math.abs(d.periodS - (2 * Math.PI) / d.omega) > 1e-12) return ['周期が 2π/ω と一致しません'];
    if (!(d.periodS > d.period0S)) return ['電池ありの周期が電池なしより長くなっていません'];
    // 振幅 A = d0 − d1、v_max = ωA。
    if (Math.abs(d.ampM - (d.d0M - d.d1M)) > 1e-12) return ['振幅が d0−d1 と一致しません'];
    if (Math.abs(d.vMaxMs - d.omega * d.ampM) > 1e-9) return ['最大の速さが ωA と一致しません'];
    // 安定性：臨界 d_c = (2C_e/k)^(1/3)。d_c ではまだ正味の力が上向き（安定なつり合いがある）。
    if (Math.abs(d.dCritM - Math.cbrt((2 * d.cE) / scene.kNm)) > 1e-12) return ['臨界の板間隔が (2C_e/k)^(1/3) と一致しません'];
    if (!(d.dUnstableM < d.dCritM && d.dCritM < d.d1M)) return ['不安定なつり合い・臨界・安定なつり合いの順序がおかしいです'];
    // 罠の電圧：臨界点でも正味の力が下向きで、つり合いがなくなる。
    if (Math.abs(d.cTrap - (scene.eps0 * scene.areaM2 * scene.voltTrapV * scene.voltTrapV) / 2) > 1e-15) return ['罠の電圧の係数が ε0SV²/2 と一致しません'];
    if (!(d.netUpTrap(d.dCritTrapM) < 0)) return ['罠の電圧でもつり合いが残ってしまっています'];
    // エネルギー：電池の仕事 VΔQ は静電エネルギーの増加の 2 倍。ジュール熱は正。
    if (Math.abs(d.wBattJ - 2 * d.dUelecJ) > 1e-9) return ['電池の仕事が静電エネルギーの増加の 2 倍になっていません'];
    if (Math.abs(d.jouleJ - (d.wBattJ - d.dUelecJ - d.dUspringJ - d.dUgravJ)) > 1e-12) return ['ジュール熱がエネルギー収支と一致しません'];
    if (!(d.jouleJ > 0)) return ['ジュール熱が正になっていません'];
    // 矢印の長さが縮尺（150 px/N）どおりか。
    if (byId.spring && scene.phase === 'base' && Math.abs(-byId.spring.vector[1] - d.mgN * 150) > 0.5) return ['電池なしのばねの矢印が mg の縮尺と一致しません'];
    if (byId.spring && scene.phase === 'charge' && Math.abs(-byId.spring.vector[1] - (d.mgN + d.f1N) * 150) > 0.5) return ['電池ありのばねの矢印が mg+F の縮尺と一致しません'];
    if (byId.elec && scene.phase === 'charge' && Math.abs(byId.elec.vector[1] - d.f1N * 150) > 0.5) return ['静電気力の矢印が F の縮尺と一致しません'];
    if (byId.gravity && Math.abs(byId.gravity.vector[1] - d.mgN * 150) > 0.5) return ['重力の矢印が mg の縮尺と一致しません'];
  }
  if (scene.type === 'gasSpringCycle') {
    const d = scene.derived;
    // 力のつり合い：p(h) = p0 + mg/S + k(h−h_nat)/S。
    if (Math.abs(d.pAPa - (scene.p0Pa + d.mgN / scene.areaM2)) > 1) return ['状態Aの圧力が p0+mg/S と一致しません'];
    if (Math.abs(d.pBPa - (scene.p0Pa + d.mgN / scene.areaM2 + (scene.kNm * (d.hB - scene.hNatM)) / scene.areaM2)) > 1) return ['状態Bの圧力が p0+mg/S+k(h−h_nat)/S と一致しません'];
    if (!(d.pBPa > d.pAPa)) return ['加熱で圧力が上がっていません'];
    // 状態方程式：T = pV/nR。nR = pA·VA/TA。
    if (Math.abs(d.nRJ - (d.pAPa * d.vAM3) / scene.tAK) > 1e-9) return ['nR が pA·VA/TA と一致しません'];
    if (Math.abs(d.tBK - (d.pBPa * d.vBM3) / d.nRJ) > 1e-9) return ['状態Bの温度が pB·VB/nR と一致しません'];
    // A→B：仕事は台形の面積 (pA+pB)/2×ΔV、ΔU=(3/2)nRΔT、Q=ΔU+W。
    if (Math.abs(d.wABJ - ((d.pAPa + d.pBPa) / 2) * (d.vBM3 - d.vAM3)) > 1e-9) return ['A→B の仕事が台形の面積と一致しません'];
    if (Math.abs(d.dUABJ - 1.5 * d.nRJ * (d.tBK - scene.tAK)) > 1e-9) return ['A→B の内部エネルギーの増加が (3/2)nRΔT と一致しません'];
    if (Math.abs(d.qABJ - (d.dUABJ + d.wABJ)) > 1e-9) return ['A→B の吸熱が ΔU+W と一致しません'];
    // B→C：体積一定なので W=0、pC = nRT/VB、ΔU=(3/2)nRΔT。
    if (Math.abs(d.pCPa - (d.nRJ * scene.tAK) / d.vBM3) > 1e-9) return ['状態Cの圧力が nRT/VB と一致しません'];
    if (!(d.pCPa < scene.p0Pa)) return ['状態Cの圧力が大気圧より低くなっていません'];
    if (Math.abs(d.dUBCJ - 1.5 * d.nRJ * (scene.tAK - d.tBK)) > 1e-9) return ['B→C の内部エネルギーの変化が (3/2)nRΔT と一致しません'];
    // C→A：等温圧縮 W=nRT ln(VA/VB)、ΔU=0、Q=W。
    if (Math.abs(d.wCAJ - d.nRJ * scene.tAK * Math.log(d.vAM3 / d.vBM3)) > 1e-9) return ['C→A の仕事が nRT ln(VA/VB) と一致しません'];
    if (!(d.wCAJ < 0)) return ['C→A の仕事が負になっていません'];
    // サイクル全体：正味の仕事 = 吸熱 − 放熱、効率は正味の仕事/吸熱。
    if (Math.abs(d.wNetJ - (d.wABJ + d.wCAJ)) > 1e-9) return ['正味の仕事が W_AB+W_CA と一致しません'];
    if (Math.abs(d.wNetJ - (d.qABJ + d.qBCJ + d.qCAJ)) > 1e-9) return ['正味の仕事が熱の合計と一致しません'];
    if (!(d.wNetJ > 0)) return ['正味の仕事が正になっていません'];
    if (Math.abs(d.eta - d.wNetJ / d.qABJ) > 1e-12) return ['効率が正味の仕事/吸熱と一致しません'];
    if (!(d.eta > 0 && d.eta < 1)) return ['効率が 0〜1 のあいだにありません'];
    // 等温線：C→A の各点で pV = nRT（p = nRT/V）。
    if (Math.abs(d.pAt(d.vAM3) - d.pAPa) > 1) return ['等温線が状態Aを通っていません'];
    if (Math.abs(d.pAt(d.vBM3) - d.pCPa) > 1) return ['等温線が状態Cを通っていません'];
    // 矢印の長さが縮尺（20 N/px）どおりか。
    if (byId.gasForce && Math.abs(-byId.gasForce.vector[1] - (scene.phase === 'base' ? d.pAPa : scene.phase === 'expand' ? d.pBPa : d.pCPa) * scene.areaM2 / 20) > 0.5) return ['気体の力の矢印が pS の縮尺と一致しません'];
    if (byId.atmForce && Math.abs(byId.atmForce.vector[1] - scene.p0Pa * scene.areaM2 / 20) > 0.5) return ['大気圧の力の矢印が p0S の縮尺と一致しません'];
    if (byId.gravity && Math.abs(byId.gravity.vector[1] - d.mgN / 20) > 0.5) return ['重力の矢印が mg の縮尺と一致しません'];
    if (byId.spring && Math.abs(byId.spring.vector[1] - (scene.kNm * (d.hB - scene.hNatM)) / 20) > 0.5) return ['ばねの力の矢印が k(h−h_nat) の縮尺と一致しません'];
  }
  if (scene.type === 'charged-circle') {
    const d = scene.derived;
    // 半径が r = mv/qB と一致すること（JSON の rM と計算値の照合）。
    if (Math.abs(d.rM - scene.rM) > 1e-9) return ['半径が mv/qB と一致しません: ' + d.rM.toFixed(4) + ' / ' + scene.rM];
    // ローレンツ力と向心力が一致すること（qvB = mv²/r）。
    const centripetalN = scene.mKg * scene.vMs * scene.vMs / d.rM;
    if (Math.abs(d.lorentzN - centripetalN) / d.lorentzN > 1e-9) return ['ローレンツ力と向心力が一致しません'];
    // 周期が T = 2πm/qB と一致すること。
    if (Math.abs(d.periodS - (2 * Math.PI * scene.mKg) / (scene.qC * scene.bT)) > 1e-12) return ['周期が 2πm/qB と一致しません'];
    // 図の矢印の長さが縮尺どおりか。半径の矢印は rPx、速度は vPx、ローレンツ力は fPx。
    if (byId.radius && Math.abs(Math.hypot(byId.radius.vector[0], byId.radius.vector[1]) - scene.rPx) > 0.5) return ['半径の矢印が r の縮尺と一致しません'];
    if (byId.velocity && Math.abs(Math.hypot(byId.velocity.vector[0], byId.velocity.vector[1]) - scene.vMs * scene.vScalePxPerMs) > 0.5) return ['速度の矢印が v の縮尺と一致しません'];
    if (byId.lorentz && Math.abs(Math.hypot(byId.lorentz.vector[0], byId.lorentz.vector[1]) - d.lorentzN * scene.fScalePxPerN) > 0.5) return ['ローレンツ力の矢印が qvB の縮尺と一致しません'];
    // ローレンツ力はつねに中心向き：速度と直角であること。
    if (byId.velocity && byId.lorentz) {
      const dot = byId.velocity.vector[0] * byId.lorentz.vector[0] + byId.velocity.vector[1] * byId.lorentz.vector[1];
      if (Math.abs(dot) > 0.5) return ['ローレンツ力が速度と直角になっていません'];
    }
  }
  if (scene.type === 'lc') {
    const d = scene.derived;
    // 角振動数が ω = 1/√(LC) と一致すること。
    if (Math.abs(d.omega - 1 / Math.sqrt(scene.inductanceH * scene.capacitanceF)) > 1e-9) return ['角振動数が 1/√(LC) と一致しません'];
    // 最大電流が I0 = ωQ0 と一致すること。
    if (Math.abs(d.i0A - d.omega * scene.charge0C) > 1e-12) return ['最大電流が ωQ0 と一致しません'];
    // エネルギーの交換：電気エネルギーの最大値と磁気エネルギーの最大値が等しいこと。
    if (Math.abs(d.eElecJ - d.eMagJ) / d.eElecJ > 1e-9) return ['電気エネルギーの最大値と磁気エネルギーの最大値が一致しません'];
    // 周期が T = 2π√(LC) と一致すること。
    if (Math.abs(d.periodS - 2 * Math.PI * Math.sqrt(scene.inductanceH * scene.capacitanceF)) > 1e-12) return ['周期が 2π√(LC) と一致しません'];
    // 初期電圧が V0 = Q0/C と一致すること。
    if (Math.abs(d.v0V - scene.charge0C / scene.capacitanceF) > 1e-9) return ['初期電圧が Q0/C と一致しません'];
  }
  if (scene.type === 'gravitation') {
    const d = scene.derived;
    // 円軌道の条件：v² = GM/r。ケプラーの第三法則：T² = 4π²r³/GM。
    if (Math.abs(d.v * d.v - d.GM / d.r) / d.v > 1e-9) return ['速さが √(GM/r) と一致しません'];
    if (Math.abs(d.periodS * d.periodS - (4 * Math.PI * Math.PI * d.r * d.r * d.r) / d.GM) / (d.periodS * d.periodS) > 1e-9) return ['周期がケプラーの第三法則と一致しません'];
    // 軌道上の重力：g = g0(R/r)²。地表の g0 をそのまま使うと間違う。
    if (Math.abs(d.g - d.g0 * (d.R / d.r) * (d.R / d.r)) > 1e-9) return ['軌道上の重力が g0(R/r)² と一致しません'];
    // 図の縮尺：地球の半径は 120×R/r px、速度は 0.01 px/(m/s)、重力は 6 px/(m/s²)。
    if (Math.abs(scene.earthPx - scene.orbitPx * (d.R / d.r)) > 0.5) return ['地球の半径の図示が R/r と一致しません'];
    if (byId.velocity && Math.abs(byId.velocity.vector[0] - d.v * 0.01) > 0.5) return ['速度の矢印が v の縮尺と一致しません'];
    if (byId.gravity && Math.abs(byId.gravity.vector[1] - d.g * 6) > 0.5) return ['重力の矢印が g の縮尺と一致しません'];
  }
  if (scene.type === 'standingWave') {
    const d = scene.derived;
    // 振動数の公式：弦・開管は nv/2L、閉管は (2n−1)v/4L。
    const expectedF = scene.mode === 'closed'
      ? ((2 * scene.n - 1) * scene.waveSpeedMs) / (4 * scene.lengthM)
      : (scene.n * scene.waveSpeedMs) / (2 * scene.lengthM);
    if (Math.abs(d.freqHz - expectedF) > 1e-9) return ['振動数が公式と一致しません: ' + d.freqHz.toFixed(2)];
    // 境界条件：弦は両端が節、開管は両端が腹、閉管は左端が節・右端が腹。
    if (scene.mode === 'string' && (Math.abs(d.nodes[0]) > 1e-9 || Math.abs(d.nodes[d.nodes.length - 1] - scene.lengthM) > 1e-9)) return ['弦の両端が節になっていません'];
    if (scene.mode === 'string' && d.nodes.length !== scene.n + 1) return ['弦の節の数が n+1 になっていません'];
    if (scene.mode === 'open' && (Math.abs(d.antinodes[0]) > 1e-9 || Math.abs(d.antinodes[d.antinodes.length - 1] - scene.lengthM) > 1e-9)) return ['開管の両端が腹になっていません'];
    if (scene.mode === 'closed' && (Math.abs(d.nodes[0]) > 1e-9 || Math.abs(d.antinodes[d.antinodes.length - 1] - scene.lengthM) > 1e-9)) return ['閉管の左端が節・右端が腹になっていません'];
    if (scene.mode === 'closed' && d.antinodes.length !== scene.n) return ['閉管の腹の数が n になっていません'];
    // 図の節・腹の位置が計算値と一致すること。
    if (scene.nodesPx.length !== d.nodes.length || scene.antinodesPx.length !== d.antinodes.length) return ['図の節・腹の数が計算値と一致しません'];
    for (let i = 0; i < d.nodes.length; i++) {
      if (Math.abs(scene.nodesPx[i] - (scene.x0 + (d.nodes[i] / scene.lengthM) * scene.spanPx)) > 0.5) return ['図の節の位置が計算値と一致しません'];
    }
  }
  if (scene.type === 'photoelectric') {
    const d = scene.derived;
    // 光子のエネルギー E = hf。最大の運動エネルギー Kmax = hf − φ（出ないときは 0）。
    if (Math.abs(d.energyEv - scene.hEvS * d.fHz) > 1e-9) return ['光子のエネルギーが hf と一致しません'];
    if (d.emitted && Math.abs(d.kMaxEv - (d.energyEv - scene.workFunctionEv)) > 1e-9) return ['最大の運動エネルギーが hf − φ と一致しません'];
    if (!d.emitted && d.kMaxEv !== 0) return ['出ないはずの電子に運動エネルギーがあります'];
    // 限界振動数 f0 = φ/h、限界波長 λ0 = c/f0。
    if (Math.abs(d.thresholdHz - scene.workFunctionEv / scene.hEvS) > 1) return ['限界振動数が φ/h と一致しません'];
    if (Math.abs(d.thresholdNm - (scene.cMs / d.thresholdHz) * 1e9) > 0.5) return ['限界波長が c/f0 と一致しません'];
    // 電子の矢印の長さが速さの縮尺どおりか（出る場合）。
    if (d.emitted && byId.electron1 && Math.abs(byId.electron1.vector[0] - d.vMaxMs * scene.vScale) > 0.5) return ['電子の矢印が速さの縮尺と一致しません'];
    // 明るくしても電子の速さは変わらない（Kmax が変わらない）。
    if (d.emitted && byId.electron2 && byId.electron1 && Math.abs(byId.electron2.vector[0] - byId.electron1.vector[0]) > 0.5) return ['明るくしても電子の速さが変わっています'];
  }
  if (scene.type === 'collision-spring') {
    const d = scene.derived, L = scene.layout;
    // 運動量保存：m1 v0 = (m1+m2) v'
    if (Math.abs(scene.m1Kg * scene.v0 - d.mTotal * d.vPrime) > 1e-9) return ['運動量保存が成り立ちません'];
    // 衝突後のエネルギー：1/2 M v'^2 = 1/2 k A^2
    if (Math.abs(0.5 * d.mTotal * d.vPrime * d.vPrime - 0.5 * scene.k * d.amplitudeM * d.amplitudeM) > 1e-9) return ['衝突後のエネルギーが一致しません'];
    // 衝突をまたいだエネルギー保存の禁止：衝突前の運動エネルギーと
    // ばねの最大の弾性エネルギーが一致したら、誤った使い方をしている。
    const kBefore = 0.5 * scene.m1Kg * scene.v0 * scene.v0;
    if (Math.abs(kBefore - 0.5 * scene.k * d.amplitudeM * d.amplitudeM) < 0.5) return ['衝突をまたいでエネルギー保存を使っていませんか'];
    // 周期：T = 2π√(M/k)
    if (Math.abs(d.periodS - 2 * Math.PI * Math.sqrt(d.mTotal / scene.k)) > 1e-9) return ['周期が 2π√(M/k) と一致しません'];
    // 矢印の長さが縮尺どおりか（場面ごと）
    if (scene.phase === 'before' && byId.velocity1 && Math.abs(byId.velocity1.vector[0] - scene.v0 * scene.vScalePxPerMs) > 0.5) return ['v0 の矢印が速度の縮尺と一致しません'];
    if (scene.phase === 'after' && byId.velocityAfter && Math.abs(byId.velocityAfter.vector[0] - d.vPrime * scene.vScalePxPerMs) > 0.5) return ["v' の矢印が速度の縮尺と一致しません"];
    if (scene.phase === 'max') {
      if (Math.abs(L.springLenPx - (scene.naturalPx - d.amplitudeM * scene.xScalePxPerM)) > 0.5) return ['最大の縮みでのばねの長さが自然長−A と一致しません'];
      if (Math.abs(L.shiftPx - d.amplitudeM * scene.xScalePxPerM) > 0.5) return ['物体の移動量が A と一致しません'];
      if (byId.springForce && Math.abs(-byId.springForce.vector[0] - d.fMaxN * scene.fScalePxPerN) > 0.5) return ['ばねの力の矢印が kA と一致しません'];
      if (byId.compression && Math.abs(byId.compression.vector[0] - d.amplitudeM * scene.xScalePxPerM) > 0.5) return ['縮みの矢印が A と一致しません'];
    }
  }
  if (scene.type === 'heatCycle') {
    const d = scene.derived;
    // 角の温度：等積では T∝p、等圧では T∝V。
    if (Math.abs(d.tD - scene.tAK * (scene.p2Pa / scene.p1Pa)) > 1e-9) return ['D の温度が等積の比例と一致しません'];
    if (Math.abs(d.tC - d.tD * (scene.v2M3 / scene.v1M3)) > 1e-9) return ['C の温度が等圧の比例と一致しません'];
    if (Math.abs(d.tB - d.tC * (scene.p1Pa / scene.p2Pa)) > 1e-9) return ['B の温度が等積の比例と一致しません'];
    // 各過程：Q = ΔU + W。等積では W=0、等圧では W=pΔV。
    for (const p of d.procs) {
      if (Math.abs(p.qJ - (p.dUJ + p.wJ)) > 0.5) return [p.name + ' で Q = ΔU + W が成り立ちません'];
      if (p.kind === 'isochoric' && Math.abs(p.wJ) > 1e-9) return [p.name + '（等積）で仕事が 0 になっていません'];
    }
    if (Math.abs(d.procs[1].wJ - scene.p2Pa * (scene.v2M3 - scene.v1M3)) > 0.5) return ['等圧膨張の仕事が pΔV と一致しません'];
    if (Math.abs(d.procs[3].wJ - scene.p1Pa * (scene.v1M3 - scene.v2M3)) > 0.5) return ['等圧圧縮の仕事が pΔV と一致しません'];
    // 1サイクル：内部エネルギーの和は 0、仕事は吸収した熱−放出した熱、効率は W/Qin。
    const dUSum = d.procs.reduce((s, p) => s + p.dUJ, 0);
    if (Math.abs(dUSum) > 0.5) return ['1サイクルで内部エネルギーの和が 0 になっていません: ' + dUSum.toFixed(2)];
    if (Math.abs(d.wNetJ - (d.qInJ - d.qOutJ)) > 0.5) return ['仕事が Qin − Qout と一致しません'];
    if (Math.abs(d.eta - d.wNetJ / d.qInJ) > 1e-9) return ['効率が W/Qin と一致しません'];
    if (Math.abs(d.carnotEta - (1 - d.tA / d.tC)) > 1e-9) return ['カルノー効率が 1−Tmin/Tmax と一致しません'];
    // 図の角の位置が V・p の縮尺どおりか。長方形の面積が仕事と一致すること。
    const c = d.corners;
    if (Math.abs(c.A.x - (70 + (scene.v1M3 / 1e-3) * 70)) > 0.5 || Math.abs(c.A.y - (250 - (scene.p1Pa / 1e5) * 50)) > 0.5) return ['A の位置が V・p の縮尺と一致しません'];
    if (Math.abs(c.C.x - (70 + (scene.v2M3 / 1e-3) * 70)) > 0.5 || Math.abs(c.C.y - (250 - (scene.p2Pa / 1e5) * 50)) > 0.5) return ['C の位置が V・p の縮尺と一致しません'];
    const areaPx2 = Math.abs(c.C.x - c.A.x) * Math.abs(c.A.y - c.C.y);
    const jPerPx2 = (1e5 / 50) * (1e-3 / 70);
    if (Math.abs(areaPx2 * jPerPx2 - d.wNetJ) > 0.5) return ['p–V図の面積が 1 サイクルの仕事と一致しません'];
    // 過程の矢印の長さが辺の長さと一致すること。
    if (byId.processAD && Math.abs(Math.abs(byId.processAD.vector[1]) - Math.abs(c.D.y - c.A.y)) > 0.5) return ['A→D の矢印が辺の長さと一致しません'];
    if (byId.processDC && Math.abs(byId.processDC.vector[0] - (c.C.x - c.D.x)) > 0.5) return ['D→C の矢印が辺の長さと一致しません'];
  }
  if (scene.type === 'railRod') {
    const d = scene.derived;
    // 誘導起電力 ε=BLv、電流 I=ε/R、磁場の力 F=BIL。
    if (Math.abs(d.emfV - d.bl * d.v) > 1e-9) return ['誘導起電力が BLv と一致しません'];
    if (Math.abs(d.currentA - d.emfV / scene.resistanceOhm) > 1e-9) return ['電流が ε/R と一致しません'];
    if (Math.abs(d.fMagN - scene.bT * d.currentA * scene.railLengthM) > 1e-9) return ['磁場の力が BIL と一致しません'];
    // 運動方程式：m・a = F − F_mag。終端速度では F_mag=F で a=0。
    if (Math.abs(d.accelMs2 - d.fNetN / scene.massKg) > 1e-9) return ['加速度が (F−F_mag)/m と一致しません'];
    if (Math.abs(d.vtMs - scene.extForceN * scene.resistanceOhm / (d.bl * d.bl)) > 1e-9) return ['終端速度が F・R/(BL)² と一致しません'];
    if (Math.abs(d.tauS - scene.massKg * scene.resistanceOhm / (d.bl * d.bl)) > 1e-9) return ['時定数が mR/(BL)² と一致しません'];
    // エネルギー：外力の仕事率 = ジュール熱 + 運動エネルギーの増加率。
    if (Math.abs(d.pExtW - (d.pJouleW + d.pKeW)) > 1e-9) return ['外力の仕事率がジュール熱と運動エネルギーの和と一致しません'];
    // 矢印の長さが縮尺どおりか。
    if (byId.velocity && Math.abs(byId.velocity.vector[0] - d.v * 15) > 0.5) return ['速度の矢印が v の縮尺と一致しません'];
    if (byId.current && Math.abs(-byId.current.vector[1] - d.currentA * 100) > 0.5) return ['電流の矢印が I の縮尺と一致しません'];
    if (byId.magForce && Math.abs(-byId.magForce.vector[0] - d.fMagN * 500) > 0.5) return ['磁場の力の矢印が BIL の縮尺と一致しません'];
    if (byId.extForce && Math.abs(byId.extForce.vector[0] - scene.extForceN * 500) > 0.5) return ['引く力の矢印が F の縮尺と一致しません'];
    // 終端速度の場面：磁場の力＝外力、加速度 0、ジュール熱＝外力の仕事率。
    if (scene.phase === 'terminal') {
      if (Math.abs(d.fMagN - scene.extForceN) > 1e-9) return ['終端速度で磁場の力が外力と等しくなっていません'];
      if (Math.abs(d.accelMs2) > 1e-9) return ['終端速度で加速度が 0 になっていません'];
      if (Math.abs(d.pJouleW - d.pExtW) > 1e-9) return ['終端速度でジュール熱が外力の仕事率と一致しません'];
    }
  }
  if (scene.type === 'doppler') {
    const d = scene.derived;
    const V = scene.soundSpeedMs, f = scene.freqHz, vs = scene.sourceSpeedMs, vo = scene.observerSpeedMs;
    // 音源が動くときは分母、観測者が動くときは分子が変わる。
    if (Math.abs(d.fApproach - (f * V) / (V - vs)) > 1e-9) return ['近づく音源の振動数が f・V/(V−vs) と一致しません'];
    if (Math.abs(d.fRecede - (f * V) / (V + vs)) > 1e-9) return ['遠ざかる音源の振動数が f・V/(V+vs) と一致しません'];
    if (Math.abs(d.fObsApproach - (f * (V + vo)) / V) > 1e-9) return ['近づく観測者の振動数が f・(V+vo)/V と一致しません'];
    if (Math.abs(d.fObsRecede - (f * (V - vo)) / V) > 1e-9) return ['遠ざかる観測者の振動数が f・(V−vo)/V と一致しません'];
    // 反射波は 2 回シフトする：壁で受ける音（1回目）に、壁が音源になった分のシフト（2回目）をかける。
    if (Math.abs(d.fReflect - d.fApproach * ((V + vs) / V)) > 1e-9) return ['反射波の振動数が 2 回のシフトと一致しません'];
    if (Math.abs(d.fReflect - (f * (V + vs)) / (V - vs)) > 1e-9) return ['反射波の振動数が f・(V+vs)/(V−vs) と一致しません'];
    // 波長：音源が動くときだけ変わる。近づく側は 0.90 倍、遠ざかる側は 1.10 倍。
    if (Math.abs(d.lamApproachM - (V - vs) / f) > 1e-9) return ['近づく側の波長が (V−vs)/f と一致しません'];
    if (Math.abs(d.lamRecedeM - (V + vs) / f) > 1e-9) return ['遠ざかる側の波長が (V+vs)/f と一致しません'];
    if (Math.abs(d.approachPx - d.basePx * ((V - vs) / V)) > 0.5) return ['近づく側の波の間隔が 0.90 倍と一致しません'];
    if (Math.abs(d.recedePx - d.basePx * ((V + vs) / V)) > 0.5) return ['遠ざかる側の波の間隔が 1.10 倍と一致しません'];
    // うなり：振動数の差がうなりの回数、周期はその逆数。
    if (Math.abs(d.f2 - (f + scene.beatFreqHz)) > 1e-9) return ['うなりの 2 つ目の振動数が一致しません'];
    if (Math.abs(d.beatPeriodS - 1 / scene.beatFreqHz) > 1e-9) return ['うなりの周期が 1/Δf と一致しません'];
    if (Math.abs(d.beatPx - d.beatPeriodS * 280) > 0.5) return ['うなりの図示の間隔が周期と一致しません'];
    // 速度の矢印の長さが縮尺どおりか（動いている場面だけ）。
    if ((scene.phase === 'approach' || scene.phase === 'reflect') && byId.sourceVelocity && Math.abs(byId.sourceVelocity.vector[0] - vs * 1.5) > 0.5) return ['音源の速度の矢印が vs の縮尺と一致しません'];
    if (scene.phase === 'observer' && byId.observerVelocity && Math.abs(-byId.observerVelocity.vector[0] - vo * 1.5) > 0.5) return ['観測者の速度の矢印が vo の縮尺と一致しません'];
  }
  if (scene.type === 'dcCircuit') {
    const d = scene.derived;
    // 並列の合成抵抗は逆数の和。並列にすると合成抵抗は減る（増えない）。
    if (Math.abs(d.rPar - 1 / (1 / scene.r2Ohm + 1 / scene.r3Ohm)) > 1e-9) return ['並列の合成抵抗が逆数の和と一致しません'];
    if (d.rPar >= Math.min(scene.r2Ohm, scene.r3Ohm)) return ['並列の合成抵抗が小さい方の抵抗より小さくなっていません'];
    // 全抵抗と全電流、端子電圧。
    if (Math.abs(d.rTotal - (scene.internalOhm + scene.r1Ohm + d.rPar)) > 1e-9) return ['全抵抗が内部抵抗＋直列＋並列の和と一致しません'];
    if (Math.abs(d.currentA - scene.emfV / d.rTotal) > 1e-9) return ['全電流が E/R と一致しません'];
    if (Math.abs(d.terminalV - (scene.emfV - d.currentA * scene.internalOhm)) > 1e-9) return ['端子電圧が E−Ir と一致しません'];
    // 電圧の分配：R1 と並列部の電圧の和が端子電圧になる。
    if (Math.abs(d.vR1 + d.vPar - d.terminalV) > 1e-9) return ['R1 と並列部の電圧の和が端子電圧と一致しません'];
    // 分流：並列部の電圧は共通で、2つの電流の和が全電流になる。
    if (Math.abs(d.i2A - d.vPar / scene.r2Ohm) > 1e-9) return ['I2 が並列部の電圧/R2 と一致しません'];
    if (Math.abs(d.i3A - d.vPar / scene.r3Ohm) > 1e-9) return ['I3 が並列部の電圧/R3 と一致しません'];
    if (Math.abs(d.i2A + d.i3A - d.currentA) > 1e-9) return ['分流の和が全電流と一致しません'];
    // 電力の保存：電池が出す電力＝4つのジュール熱の和。
    if (Math.abs(d.pBattW - (d.pRW + d.p1W + d.p2W + d.p3W)) > 1e-9) return ['電力の和が電池の出力と一致しません'];
    // 電流矢印の長さが 30 px/A の縮尺どおりか。
    if (byId.mainCurrent && Math.abs(byId.mainCurrent.vector[0] - d.currentA * 30) > 0.5) return ['全電流の矢印が 30 px/A の縮尺と一致しません'];
    if (byId.branchCurrent2 && Math.abs(byId.branchCurrent2.vector[1] - d.i2A * 30) > 0.5) return ['I2 の矢印が 30 px/A の縮尺と一致しません'];
    if (byId.branchCurrent3 && Math.abs(byId.branchCurrent3.vector[1] - d.i3A * 30) > 0.5) return ['I3 の矢印が 30 px/A の縮尺と一致しません'];
  }
  if (scene.type === 'refractionLens') {
    const d = scene.derived;
    // スネルの法則：sinθ1 = n・sinθ2。臨界角：sinθc = 1/n。
    if (Math.abs(Math.sin(deg2rad(scene.incidentDeg)) - scene.n * Math.sin(deg2rad(d.theta2Deg))) > 1e-9) return ['屈折角がスネルの法則と一致しません'];
    if (Math.abs(Math.sin(deg2rad(d.criticalDeg)) - 1 / scene.n) > 1e-9) return ['臨界角が sinθc=1/n と一致しません'];
    if (!(scene.totalIncidentDeg > d.criticalDeg)) return ['全反射の入射角が臨界角より大きくなっていません'];
    // レンズの公式：1/f = 1/a + 1/b。倍率 m = −b/a。
    if (Math.abs(1 / scene.focalCm - (1 / scene.objRealCm + 1 / d.bRealCm)) > 1e-9) return ['実像の像距離がレンズの公式と一致しません'];
    if (Math.abs(1 / scene.focalCm - (1 / scene.objVirtualCm + 1 / d.bVirtualCm)) > 1e-9) return ['虚像の像距離がレンズの公式と一致しません'];
    if (Math.abs(d.mReal - (-d.bRealCm / scene.objRealCm)) > 1e-9) return ['実像の倍率が −b/a と一致しません'];
    if (Math.abs(d.mVirtual - (-d.bVirtualCm / scene.objVirtualCm)) > 1e-9) return ['虚像の倍率が −b/a と一致しません'];
    if (!(d.bRealCm > 0 && d.mReal < 0)) return ['実像が b>0・m<0（倒立）になっていません'];
    if (!(d.bVirtualCm < 0 && d.mVirtual > 0)) return ['虚像が b<0・m>0（正立）になっていません'];
    // 図の位置が 6 px/cm の縮尺どおりか。
    if (Math.abs(d.objRealX - (200 - scene.objRealCm * 6)) > 0.5) return ['実像の物体の位置が縮尺と一致しません'];
    if (Math.abs(d.imgRealX - (200 + d.bRealCm * 6)) > 0.5) return ['実像の位置が縮尺と一致しません'];
    if (Math.abs(d.imgVirtualX - (200 + d.bVirtualCm * 6)) > 0.5) return ['虚像の位置が縮尺と一致しません'];
    // 光線の矢印の長さが 110 px で、角度が入射角・屈折角どおりか。
    if (scene.phase === 'refract' && byId.incidentRay) {
      if (Math.abs(Math.hypot(byId.incidentRay.vector[0], byId.incidentRay.vector[1]) - 110) > 0.5) return ['入射光の矢印の長さが 110 px と一致しません'];
      if (Math.abs(Math.atan2(byId.incidentRay.vector[0], byId.incidentRay.vector[1]) - deg2rad(scene.incidentDeg)) > 1e-9) return ['入射光の角度が入射角と一致しません'];
    }
    if (scene.phase === 'refract' && byId.refractedRay) {
      if (Math.abs(Math.hypot(byId.refractedRay.vector[0], byId.refractedRay.vector[1]) - 110) > 0.5) return ['屈折光の矢印の長さが 110 px と一致しません'];
      if (Math.abs(Math.atan2(byId.refractedRay.vector[0], byId.refractedRay.vector[1]) - deg2rad(d.theta2Deg)) > 1e-9) return ['屈折光の角度が屈折角と一致しません'];
    }
  }
  if (scene.type === 'bohr') {
    const d = scene.derived;
    // 準位：E_n = −13.6/n² eV。
    if (Math.abs(d.e1 - (-scene.rhydbergEv)) > 1e-9) return ['E1 が −13.6 eV と一致しません'];
    if (Math.abs(d.e2 - (-scene.rhydbergEv / 4)) > 1e-9) return ['E2 が −13.6/4 eV と一致しません'];
    if (Math.abs(d.e3 - (-scene.rhydbergEv / 9)) > 1e-9) return ['E3 が −13.6/9 eV と一致しません'];
    // スペクトル：λ = hc/ΔE。
    if (Math.abs(d.lam32Nm - scene.hcEvNm / d.dE32) > 1e-9) return ['バルマー線の波長が hc/ΔE と一致しません'];
    if (Math.abs(d.lam21Nm - scene.hcEvNm / d.dE21) > 1e-9) return ['ライマン線の波長が hc/ΔE と一致しません'];
    if (Math.abs(d.dE32 - (d.e3 - d.e2)) > 1e-9) return ['3→2 の遷移エネルギーが E3−E2 と一致しません'];
    // ド・ブロイ波長：λ = h/mv。n=1 の円周に波が 1 個ちょうど入る。
    if (Math.abs(d.lambdaDbM - scene.hJs / (scene.meKg * scene.v1Ms)) > 1e-12) return ['ド・ブロイ波長が h/mv と一致しません'];
    if (Math.abs(d.orbitRatio - 1) > 0.01) return ['n=1 の円周とド・ブロイ波長の比が 1 になっていません'];
    // 100 V の電子：v = √(2eV/m)、ブラッグ条件 sinθ = λ/2d。
    if (Math.abs(d.v100Ms - Math.sqrt((2 * 1.602e-19 * scene.accelVoltageV) / scene.meKg)) > 1e-9) return ['100 V の電子の速さが √(2eV/m) と一致しません'];
    if (Math.abs(Math.sin(deg2rad(d.braggDeg)) - (d.lambda100Nm * 1e-9) / (2 * scene.braggDM)) > 1e-9) return ['ブラッグの角度が sinθ=λ/2d と一致しません'];
    // 遷移の矢印の長さが ΔE×15 px どおりか。
    if (byId.trans32 && Math.abs(-byId.trans32.vector[1] - d.dE32 * 15) > 0.5) return ['3→2 の矢印が ΔE×15 px と一致しません'];
    if (byId.trans21 && Math.abs(-byId.trans21.vector[1] - d.dE21 * 15) > 0.5) return ['2→1 の矢印が ΔE×15 px と一致しません'];
  }
  if (scene.type === 'kineticTheory') {
    const d = scene.derived;
    // 二乗平均速度：v_rms=√(3RT/M)、x 成分は v_rms/√3。
    if (Math.abs(d.vRms - Math.sqrt((3 * scene.rGas * scene.tempK) / scene.molarMassKg)) > 1e-9) return ['二乗平均速度が √(3RT/M) と一致しません'];
    if (Math.abs(d.vxRms - d.vRms / Math.sqrt(3)) > 1e-9) return ['x 成分の速度が v_rms/√3 と一致しません'];
    // 1分子の平均運動エネルギー：(3/2)kT。
    if (Math.abs(d.meanKE_J - 1.5 * scene.kB * scene.tempK) > 1e-30) return ['平均運動エネルギーが (3/2)kT と一致しません'];
    // 圧力の 3 通りの計算が一致する：(2/3)(N/V)KĒ、nRT/V、F/S。
    if (Math.abs(d.pressurePa - d.pIdealPa) / d.pIdealPa > 0.001) return ['圧力が (2/3)(N/V)KĒ と nRT/V で一致しません'];
    if (Math.abs(d.pFromForcePa - d.pIdealPa) / d.pIdealPa > 0.001) return ['圧力が F/S と nRT/V で一致しません'];
    // 1分子の力：運動量変化 2mv_x × 衝突頻度 v_x/2L。
    if (Math.abs(d.collFreq - d.vxRms / (2 * scene.boxLM)) > 1e-9) return ['衝突頻度が v_x/2L と一致しません'];
    if (Math.abs(d.dpPerHit - 2 * d.m * d.vxRms) > 1e-30) return ['1回の衝突の運動量変化が 2mv_x と一致しません'];
    if (Math.abs(d.forcePerMolN - d.dpPerHit * d.collFreq) > 1e-30) return ['1分子の力が 2mv_x×頻度と一致しません'];
    if (Math.abs(d.totalForceN - d.N * d.forcePerMolN) / d.totalForceN > 1e-9) return ['全体の力が N×1分子の力と一致しません'];
    // T を 2 倍にすると p は 2 倍、v_rms は √2 倍。V を半分にすると p は 2 倍。
    if (Math.abs(d.pHotPa - 2 * d.pIdealPa) / d.pIdealPa > 0.001) return ['600 K の圧力が 300 K の 2 倍になっていません'];
    if (Math.abs(d.vRmsHot - d.vRms * Math.sqrt(2)) > 1e-9) return ['600 K の速さが √2 倍になっていません'];
    if (Math.abs(d.pHalfPa - 2 * d.pIdealPa) / d.pIdealPa > 0.001) return ['体積を半分にした圧力が 2 倍になっていません'];
    // 速度の矢印の長さが 0.10 px/(m/s) どおりか。
    if (byId.vxIn && Math.abs(byId.vxIn.vector[0] - d.vxRms * 0.10) > 0.5) return ['v_x の矢印が縮尺と一致しません'];
    if (byId.vxOut && Math.abs(-byId.vxOut.vector[0] - d.vxRms * 0.10) > 0.5) return ['跳ね返りの矢印が縮尺と一致しません'];
  }
  if (scene.type === 'travellingWave') {
    const d = scene.derived;
    // 波の速さ v=λ/T、振動数 f=1/T。
    if (Math.abs(d.speedMs - scene.wavelengthM / scene.periodS) > 1e-9) return ['波の速さが λ/T と一致しません'];
    if (Math.abs(d.freqHz - 1 / scene.periodS) > 1e-9) return ['振動数が 1/T と一致しません'];
    // t=0 の波形の値：y=A sin(−2πx/λ)。
    if (Math.abs(d.y05_0 - (-scene.amplitudeM)) > 1e-9) return ['x=0.50 m・t=0 の変位が −A と一致しません'];
    if (Math.abs(d.y10_0) > 1e-9) return ['x=1.0 m・t=0 の変位が 0 と一致しません'];
    if (Math.abs(d.y15_0 - scene.amplitudeM) > 1e-9) return ['x=1.5 m・t=0 の変位が +A と一致しません'];
    // x=0 の振動の値：y=A sin(2πt/T)。
    if (Math.abs(d.y0_0125 - scene.amplitudeM) > 1e-9) return ['x=0・t=0.125 s の変位が +A と一致しません'];
    if (Math.abs(d.y0_025) > 1e-9) return ['x=0・t=0.25 s の変位が 0 と一致しません'];
    if (Math.abs(d.y0_0375 - (-scene.amplitudeM)) > 1e-9) return ['x=0・t=0.375 s の変位が −A と一致しません'];
    // 位相の遅れ：2πx/λ、時間の遅れ：x/v。
    if (Math.abs(d.phaseLag05 - (2 * Math.PI * scene.xMarkM) / scene.wavelengthM) > 1e-9) return ['位相の遅れが 2πx/λ と一致しません'];
    if (Math.abs(d.timeLag05 - scene.xMarkM / d.speedMs) > 1e-9) return ['時間の遅れが x/v と一致しません'];
    // Δt 後の移動距離：vΔt。
    if (Math.abs(d.moveDistM - d.speedMs * scene.dtS) > 1e-9) return ['波の移動距離が vΔt と一致しません'];
  }
  if (scene.type === 'coulombField') {
    const d = scene.derived;
    // 点電荷の電場：E=kQ/r²。距離 2 倍で 1/4。
    if (Math.abs(d.eNear - (scene.kConst * scene.q1C) / (scene.r1M * scene.r1M)) > 1e-9) return ['r=0.10 m の電場が kQ/r² と一致しません'];
    if (Math.abs(d.eFar - (scene.kConst * scene.q1C) / (scene.r2M * scene.r2M)) > 1e-9) return ['r=0.20 m の電場が kQ/r² と一致しません'];
    if (Math.abs(d.eFar / d.eNear - 0.25) > 1e-9) return ['距離 2 倍の電場が 1/4 になっていません'];
    // 電気力：F=qE。q を 2 倍にしても E は変わらず、F だけ 2 倍。
    if (Math.abs(d.fTest - scene.testQC * d.eNear) > 1e-9) return ['電気力が qE と一致しません'];
    if (Math.abs(d.fTest2 - 2 * d.fTest) > 1e-9) return ['q を 2 倍にした電気力が 2 倍になっていません'];
    // 双極子の中点：電場はベクトル和（両方とも +→− で 2 倍）、電位はスカラー和で 0。
    if (Math.abs(d.eMid1 - (scene.kConst * scene.q1C) / (d.rMid * d.rMid)) > 1e-9) return ['中点の E1 が kQ/r² と一致しません'];
    if (Math.abs(d.eMidTotal - (d.eMid1 + d.eMid2)) > 1e-9) return ['中点の電場が E1+E2 と一致しません'];
    if (Math.abs(d.vMidTotal) > 1e-9) return ['中点の電位が 0 になっていません'];
    // 電場の矢印の長さが 30 px/(1.0×10⁶ N/C) どおりか。
    if (byId.eNear && Math.abs(byId.eNear.vector[0] - d.eNear * 30 / 1e6) > 0.5) return ['近くの電場の矢印が縮尺と一致しません'];
    if (byId.eFar && Math.abs(byId.eFar.vector[0] - d.eFar * 30 / 1e6) > 0.5) return ['遠くの電場の矢印が縮尺と一致しません'];
    if (byId.eTotal && Math.abs(byId.eTotal.vector[0] - d.eMidTotal * 30 / 1e6) > 0.5) return ['中点の電場の矢印が縮尺と一致しません'];
    if (byId.fTest && Math.abs(byId.fTest.vector[0] - d.fTest * 20) > 0.5) return ['電気力の矢印が 20 px/N の縮尺と一致しません'];
  }
  if (scene.type === 'calorimetry') {
    const d = scene.derived;
    // 熱量：Q=mcΔT、熱容量 C=mc。
    if (Math.abs(d.qHeat - scene.waterMassKg * scene.waterC * (scene.t2C - scene.t1C)) > 1e-9) return ['水を温める熱量が mcΔT と一致しません'];
    if (Math.abs(d.heatCap - scene.waterMassKg * scene.waterC) > 1e-9) return ['熱容量が mc と一致しません'];
    if (Math.abs(d.qCopper - scene.copperMassKg * scene.copperC * scene.copperDT) > 1e-9) return ['銅を温める熱量が mcΔT と一致しません'];
    if (Math.abs(d.dTWaterSameQ - d.qCopper / d.heatCap) > 1e-9) return ['同じ熱量での水の温度上昇が Q/C と一致しません'];
    // 混合：熱量保存（失った熱＝得た熱）。
    if (Math.abs(d.mixT - ((scene.waterMassKg * scene.t2C + scene.mixMass2Kg * scene.mixT2C) / (scene.waterMassKg + scene.mixMass2Kg))) > 1e-9) return ['混合温度が熱量保存と一致しません'];
    if (Math.abs(d.qLost - d.qGained) > 1e-9) return ['失った熱量と得た熱量が一致しません'];
    // 潜熱：Q=mL、とけた水を温める分を足す。
    if (Math.abs(d.qMelt - scene.iceMassKg * scene.latentJperKg) > 1e-9) return ['氷をとかす熱量が mL と一致しません'];
    if (Math.abs(d.qTotalIce - (d.qMelt + d.qWarmMelt)) > 1e-9) return ['氷から 20°C の水までの熱量が合計と一致しません'];
    // 熱量の矢印の長さが 1 px/1000 J どおりか。
    if (byId.heatIn && Math.abs(byId.heatIn.vector[1] - d.qHeat / 1000) > 0.5) return ['加熱の矢印が Q/1000 px と一致しません'];
    if (byId.heatFlow && Math.abs(byId.heatFlow.vector[0] - d.qLost / 1000) > 0.5) return ['熱の流れの矢印が Q/1000 px と一致しません'];
    if (byId.heatMelt && Math.abs(byId.heatMelt.vector[0] - d.qMelt / 1000) > 0.5) return ['融解の矢印が Q/1000 px と一致しません'];
  }
  if (scene.type === 'drag') {
    const d = scene.derived;
    // 終端速度 v_t=mg/k、時定数 τ=m/k。
    if (Math.abs(d.vt - (d.mg / scene.dragK)) > 1e-9) return ['終端速度が mg/k と一致しません'];
    if (Math.abs(d.tau - scene.massKg / scene.dragK) > 1e-9) return ['時定数が m/k と一致しません'];
    // t=2.0 s の値：v=v_t(1−e^(−t/τ))、抵抗 kv、加速度 (mg−kv)/m。
    if (Math.abs(d.vMid - d.vt * (1 - Math.exp(-scene.tMidS / d.tau))) > 1e-9) return ['t=2.0 s の速さが v_t(1−e^(−t/τ)) と一致しません'];
    if (Math.abs(d.fDragMid - scene.dragK * d.vMid) > 1e-9) return ['t=2.0 s の空気抵抗が kv と一致しません'];
    if (Math.abs(d.aMid - (d.mg - d.fDragMid) / scene.massKg) > 1e-9) return ['t=2.0 s の加速度が (mg−kv)/m と一致しません'];
    // 重い玉：終端速度が大きく、t=2.0 s でも軽い玉より速い。真空なら gt。
    if (Math.abs(d.vtHeavy - (scene.heavyMassKg * scene.g) / scene.dragK) > 1e-9) return ['重い玉の終端速度が mg/k と一致しません'];
    if (Math.abs(d.vHeavyMid - d.vtHeavy * (1 - Math.exp(-scene.tMidS / d.tauHeavy))) > 1e-9) return ['重い玉の t=2.0 s の速さが一致しません'];
    if (Math.abs(d.vVacMid - scene.g * scene.tMidS) > 1e-9) return ['真空での速さが gt と一致しません'];
    // 重力の矢印はつねに同じ長さ（mg×10 px）、速度の矢印は速さで変わる。
    if (byId.gravity && Math.abs(byId.gravity.vector[1] - d.mg * 10) > 0.5) return ['重力の矢印が mg×10 px と一致しません'];
    if (byId.drag) {
      const expect = scene.phase === 'terminal' ? d.mg * 10 : d.fDragMid * 10;
      if (Math.abs(-byId.drag.vector[1] - expect) > 0.5) return ['空気抵抗の矢印が縮尺と一致しません'];
    }
    if (byId.velocity) {
      const expect = scene.phase === 'terminal' ? d.vt * 2 : d.vMid * 2;
      if (Math.abs(byId.velocity.vector[1] - expect) > 0.5) return ['速度の矢印が縮尺と一致しません'];
    }
  }
  if (scene.type === 'decay') {
    const d = scene.derived;
    // 崩壊定数 λ=ln2/T、半減期ごとの残り（1/2、1/4…）。
    if (Math.abs(d.lambda - Math.LN2 / scene.halfLifeDays) > 1e-12) return ['崩壊定数が ln2/T と一致しません'];
    if (Math.abs(d.nAt[1] - scene.n0 / 2) > 1e-9) return ['1 半減期後の数が N0/2 と一致しません'];
    if (Math.abs(d.nAt[2] - scene.n0 / 4) > 1e-9) return ['2 半減期後の数が N0/4 と一致しません'];
    // 放射能 A=λN。半減期ごとに半分になる。
    if (Math.abs(d.actBq[0] - (d.lambda * scene.n0) / 86400) > 1e-9) return ['はじめの放射能が λN0 と一致しません'];
    if (Math.abs(d.actBq[1] / d.actBq[0] - 0.5) > 1e-9) return ['1 半減期後の放射能が半分になっていません'];
    // 年代測定：残った割合から半減期の回数を数える。
    if (Math.abs(d.halfLives - (-Math.log2(scene.measuredFraction))) > 1e-9) return ['残った割合からの半減期の回数が一致しません'];
    if (Math.abs(d.ageYr - d.halfLives * scene.carbonHalfLifeYr) > 1e-9) return ['年代が半減期の回数×5730 年と一致しません'];
  }
  if (scene.type === 'moment') {
    const d = scene.derived;
    // 子どものモーメント 200×1.5=300 N·m、板の重さのモーメント 100×0.5=50 N·m。
    if (Math.abs(d.momentChild - d.childN * d.childArmM) > 1e-9) return ['子どものモーメントが一致しません'];
    if (Math.abs(d.momentBoard - d.boardN * d.boardArmM) > 1e-9) return ['板の重さのモーメントが一致しません'];
    // つり合い：F×2.5=300−50=250。力のつり合い：N=200+100+100=400。
    if (Math.abs(d.fN * d.rightArmM - (d.momentChild - d.momentBoard)) > 1e-9) return ['F のモーメントがつり合っていません'];
    if (Math.abs(d.normalN - (d.childN + d.boardN + d.fN)) > 1e-9) return ['支点の垂直抗力が力のつり合いと一致しません'];
    // 矢印の長さ：0.25 px/N。
    if (byId.child && Math.abs(byId.child.vector[1] - d.childN * 0.25) > 0.5) return ['子どもの重さの矢印が長さと一致しません'];
    if (byId.push && Math.abs(byId.push.vector[1] - d.fN * 0.25) > 0.5) return ['F の矢印が長さと一致しません'];
    if (byId.normal && Math.abs(-byId.normal.vector[1] - d.normalN * 0.25) > 0.5) return ['垂直抗力の矢印が長さと一致しません'];
  }
  if (scene.type === 'solenoid') {
    const d = scene.derived;
    // ソレノイド内部 B=μ0nI、1 巻きのコイルの中心 B=μ0I/2r、比は 100。
    if (Math.abs(d.bT - d.mu0 * scene.turnsPerM * scene.currentA) / d.bT > 1e-9) return ['ソレノイドの磁場が μ0nI と一致しません'];
    if (Math.abs(d.nFromTotal - scene.totalTurns / scene.lengthM) > 1e-9) return ['巻き数密度が全巻き数/長さと一致しません'];
    if (Math.abs(d.bDoubleI - 2 * d.bT) > 1e-12) return ['電流 2 倍の磁場が 2 倍になっていません'];
    if (Math.abs(d.coilB - d.mu0 * scene.currentA / (2 * scene.coilRadiusM)) / d.coilB > 1e-9) return ['1 巻きコイルの磁場が μ0I/2r と一致しません'];
    if (Math.abs(d.ratio - 100) > 1e-9) return ['ソレノイドと 1 巻きコイルの磁場の比が 100 になっていません'];
    // 磁場の矢印の長さ：30000 px/T。
    if (byId.field && Math.abs(byId.field.vector[0] - d.bT * 30000) > 0.5) return ['磁場の矢印が B の縮尺と一致しません'];
  }
  if (scene.type === 'transient') {
    const d = scene.derived;
    // 時定数 τ=RC と τ=L/R。どちらも 0.10 s。
    if (Math.abs(d.tauRC - scene.rOhm * scene.cF) > 1e-12) return ['RC の時定数が RC と一致しません'];
    if (Math.abs(d.tauRL - scene.lH / scene.rlROhm) > 1e-12) return ['RL の時定数が L/R と一致しません'];
    // 充電：τ で 63%、2τ で 86%、3τ で 95%。放電：τ で 37%。
    if (Math.abs(d.vcTau - scene.emfV * (1 - Math.exp(-1))) > 1e-9) return ['充電 τ 後の電圧が一致しません'];
    if (Math.abs(d.vc2Tau - scene.emfV * (1 - Math.exp(-2))) > 1e-9) return ['充電 2τ 後の電圧が一致しません'];
    if (Math.abs(d.vc3Tau - scene.emfV * (1 - Math.exp(-3))) > 1e-9) return ['充電 3τ 後の電圧が一致しません'];
    if (Math.abs(d.vdTau - scene.emfV * Math.exp(-1)) > 1e-9) return ['放電 τ 後の電圧が一致しません'];
    // RL：最終電流 1.0 A、τ で 0.63 A。充電のはじめの電流 10 mA。
    if (Math.abs(d.iInf - scene.emfV / scene.rlROhm) > 1e-9) return ['RL の最終電流が E/R と一致しません'];
    if (Math.abs(d.iTau - d.iInf * (1 - Math.exp(-1))) > 1e-9) return ['RL τ 後の電流が一致しません'];
    if (Math.abs(d.i0RC - scene.emfV / scene.rOhm) > 1e-9) return ['充電のはじめの電流が E/R と一致しません'];
  }
  if (scene.type === 'twoBody') {
    const d = scene.derived;
    // 重心：x_G = (m1x1+m2x2)/(m1+m2)、V_G = (m1v1+m2v2)/(m1+m2)。
    if (Math.abs(d.xG - (scene.m1Kg * scene.x1M + scene.m2Kg * scene.x2M) / d.mTotal) > 1e-9) return ['重心の位置が (m1x1+m2x2)/(m1+m2) と一致しません'];
    if (Math.abs(d.vG - (scene.m1Kg * scene.v1Ms + scene.m2Kg * scene.v2Ms) / d.mTotal) > 1e-9) return ['重心の速度が (m1v1+m2v2)/(m1+m2) と一致しません'];
    // 相対速度と、追いつくまでの時間。
    if (Math.abs(d.vRel - (scene.v2Ms - scene.v1Ms)) > 1e-9) return ['相対速度が v2−v1 と一致しません'];
    if (Math.abs(d.tCatch - (scene.x2M - scene.x1M) / (scene.v1Ms - scene.v2Ms)) > 1e-9) return ['追いつくまでの時間が一致しません'];
    // 重心系での速度と、弾性衝突での反転（v′ = 2V_G − v）。
    if (Math.abs(d.v1cm - (scene.v1Ms - d.vG)) > 1e-9) return ['重心系での A の速度が一致しません'];
    if (Math.abs(d.v2cm - (scene.v2Ms - d.vG)) > 1e-9) return ['重心系での B の速度が一致しません'];
    if (Math.abs(d.v1p - (2 * d.vG - scene.v1Ms)) > 1e-9) return ["衝突後の v1' が一致しません"];
    if (Math.abs(d.v2p - (2 * d.vG - scene.v2Ms)) > 1e-9) return ["衝突後の v2' が一致しません"];
    // 運動量と運動エネルギーの保存。衝突点はその時刻の重心の位置と一致する。
    if (Math.abs(d.pTotal - (scene.m1Kg * scene.v1Ms + scene.m2Kg * scene.v2Ms)) > 1e-9) return ['運動量が一致しません'];
    if (Math.abs(d.keBefore - d.keAfter) > 1e-9) return ['弾性衝突で運動エネルギーが保存していません'];
    if (Math.abs(d.xGAtCatch - (d.xG + d.vG * d.tCatch)) > 1e-9) return ['衝突点がその時刻の重心の位置と一致しません'];
    // 矢印の長さが速度の縮尺（30 px/(m/s)）どおりか。
    if (scene.phase === 'velocity') {
      if (byId.velocity1 && Math.abs(byId.velocity1.vector[0] - scene.v1Ms * 30) > 0.5) return ['v1 の矢印が速度の縮尺と一致しません'];
      if (byId.velocity2 && Math.abs(byId.velocity2.vector[0] - scene.v2Ms * 30) > 0.5) return ['v2 の矢印が速度の縮尺と一致しません'];
      if (byId.velocityG && Math.abs(byId.velocityG.vector[0] - d.vG * 30) > 0.5) return ['V_G の矢印が速度の縮尺と一致しません'];
    }
    if (scene.phase === 'relative' && byId.relVel && Math.abs(byId.relVel.vector[0] - d.vRel * 30) > 0.5) return ['相対速度の矢印が速度の縮尺と一致しません'];
    if (scene.phase === 'collision') {
      if (byId.v1cmBefore && Math.abs(byId.v1cmBefore.vector[0] - d.v1cm * 30) > 0.5) return ['重心系の A の矢印が速度の縮尺と一致しません'];
      if (byId.v2cmBefore && Math.abs(byId.v2cmBefore.vector[0] - d.v2cm * 30) > 0.5) return ['重心系の B の矢印が速度の縮尺と一致しません'];
      if (byId.v1cmAfter && Math.abs(byId.v1cmAfter.vector[0] + d.v1cm * 30) > 0.5) return ['衝突後の A の矢印が反転していません'];
      if (byId.v2cmAfter && Math.abs(byId.v2cmAfter.vector[0] + d.v2cm * 30) > 0.5) return ['衝突後の B の矢印が反転していません'];
    }
  }
  if (scene.type === 'induction') {
    const d = scene.derived;
    // 磁束 Φ = BS、起電力 V = NΔΦ/Δt、電流 I = V/R、傾けたコイル Φ = BS cosθ。
    if (Math.abs(d.phiWb - scene.b1T * scene.areaM2) > 1e-12) return ['磁束が BS と一致しません'];
    if (Math.abs(d.dPhiWb - (scene.b1T - scene.b0T) * scene.areaM2) > 1e-12) return ['磁束の変化が ΔB・S と一致しません'];
    if (Math.abs(d.emfV - scene.turnsN * d.dPhiWb / scene.dtS) > 1e-9) return ['誘導起電力が NΔΦ/Δt と一致しません'];
    if (Math.abs(d.currentA - d.emfV / scene.resistanceOhm) > 1e-9) return ['誘導電流が V/R と一致しません'];
    if (Math.abs(d.phiTiltWb - scene.b1T * scene.areaM2 * Math.cos(deg2rad(scene.tiltDeg))) > 1e-12) return ['傾けたコイルの磁束が BS cosθ と一致しません'];
    if (Math.abs(d.emfFastV - scene.turnsN * d.dPhiWb / 0.050) > 1e-9) return ['Δt を半分にしたときの起電力が一致しません'];
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
    // 「30°」は右の張力 T2 のラベルと重ならないよう、右上へずらす。
    const th2 = el('text', { x: cx + 62, y: cy - 38 }); th2.textContent = '30°'; svg.appendChild(th2);
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
  } else if (scene.type === 'slopePulley') {
    // 斜面：(40,250)-(280,70)。横 240、高さ 180 の 3:4:5 なので傾きは 36.87° ≈ 37°。
    svg.appendChild(el('polygon', { points: '40,250 280,70 280,290 40,290', fill: '#eee' }));
    svg.appendChild(el('line', { x1: 40, y1: 250, x2: 280, y2: 70, stroke: '#333', 'stroke-width': 3 }));
    // 「斜面（粗い）」は「滑車」ラベルと重ならないよう、左へずらす。
    const t1 = el('text', { x: 150, y: 55 }); t1.textContent = '斜面（粗い）'; svg.appendChild(t1);
    // θ の弧：斜面の下端 (40,250) を中心に、水平と斜面のあいだ。必ず描く。
    const a = scene.thetaArc;
    const rad = deg2rad(scene.thetaDeg);
    const x2 = a.cx + a.r * Math.cos(rad);
    const y2 = a.cy - a.r * Math.sin(rad);
    svg.appendChild(el('path', { d: `M ${a.cx + a.r} ${a.cy} A ${a.r} ${a.r} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
    const th = el('text', { x: a.cx + 48, y: a.cy - 6 }); th.textContent = 'θ'; svg.appendChild(th);
    // 物体 A：斜面の中点 (160,160) に、斜面に沿って −36.87° 回転させて載せる。
    const gA = el('g', { transform: 'rotate(-36.87 160 160)' });
    gA.appendChild(el('rect', { x: 120, y: 140, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(gA);
    const tA = el('text', { x: 96, y: 166 }); tA.textContent = 'A'; svg.appendChild(tA);
    // 滑車：中心 (288,62)、半径 18。
    svg.appendChild(el('circle', { cx: 288, cy: 62, r: 18, fill: '#eee', stroke: '#333', 'stroke-width': 2 }));
    const tP = el('text', { x: 312, y: 46 }); tP.textContent = '滑車'; svg.appendChild(tP);
    if (scene.phase === 'connected') {
      // 糸：A から斜面に沿って滑車まで、滑車の上を回って x=306 で鉛直に B まで。
      svg.appendChild(el('line', { x1: 160, y1: 160, x2: 276, y2: 74, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('path', { d: 'M 276 74 A 18 18 0 0 1 306 62', fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 306, y1: 62, x2: 306, y2: 160, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: 266, y: 160, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const tB = el('text', { x: 352, y: 184 }); tB.textContent = 'B'; svg.appendChild(tB);
    } else {
      // 切れたあと：糸は描かない。B は落下した位置（中心 306,235）に描く。
      svg.appendChild(el('rect', { x: 266, y: 215, width: 80, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const tB = el('text', { x: 352, y: 239 }); tB.textContent = 'B'; svg.appendChild(tB);
    }
  } else if (scene.type === 'collision-spring') {
    const L = scene.layout;
    // 床と壁
    svg.appendChild(el('line', { x1: 40, y1: L.floorY, x2: 380, y2: L.floorY, stroke: '#333', 'stroke-width': 3 }));
    const tf = el('text', { x: 300, y: L.floorY + 22 }); tf.textContent = '床（なめらか）'; svg.appendChild(tf);
    svg.appendChild(el('line', { x1: L.wallX, y1: 120, x2: L.wallX, y2: L.floorY, stroke: '#333', 'stroke-width': 3 }));
    const tw = el('text', { x: L.wallX - 34, y: 112 }); tw.textContent = '壁'; svg.appendChild(tw);
    // ばね：B の右端から壁まで、コイルをジグザグで描く（長さは計算値から）。
    let d = 'M ' + L.springFromX + ' ' + L.cy;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = L.springFromX + ((L.springToX - L.springFromX) * i) / steps;
      const y = i === steps ? L.cy : (i % 2 === 1 ? L.cy - 12 : L.cy + 12);
      d += ' L ' + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    svg.appendChild(el('path', { d, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
    // 2つの物体の箱（幅は模式図。縮尺を持つのは矢印とばねの長さの変化だけ）
    svg.appendChild(el('rect', { x: L.m1cx - L.blockW / 2, y: L.cy - L.blockH / 2, width: L.blockW, height: L.blockH, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('rect', { x: L.m2cx - L.blockW / 2, y: L.cy - L.blockH / 2, width: L.blockW, height: L.blockH, fill: '#ffe1c2', stroke: '#333', 'stroke-width': 2 }));
    const t1 = el('text', { x: L.m1cx - 6, y: L.cy + 5 }); t1.textContent = 'A'; svg.appendChild(t1);
    const t2 = el('text', { x: L.m2cx - 6, y: L.cy + 5 }); t2.textContent = 'B'; svg.appendChild(t2);
    // 静止している物体の上には「v = 0」と書く（矢印の長さ 0 は描けないため）。
    if (scene.phase === 'before') {
      const tz = el('text', { x: L.m2cx - 14, y: 180 }); tz.textContent = 'v = 0'; svg.appendChild(tz);
    } else if (scene.phase === 'max') {
      const tz = el('text', { x: 186, y: 180 }); tz.textContent = 'v = 0'; svg.appendChild(tz);
    }
  } else if (scene.type === 'charged-circle') {
    const c = scene.center, rPx = scene.rPx, e = scene.entry;
    // 磁場の領域：× 印を格子状に並べる（紙面の裏向きの磁場）。
    svg.appendChild(el('rect', { x: 50, y: 30, width: 330, height: 250, fill: '#f2f6ff', stroke: '#999', 'stroke-width': 1 }));
    for (let gx = 70; gx <= 360; gx += 40) {
      for (let gy = 50; gy <= 260; gy += 40) {
        const t = el('text', { x: gx, y: gy, fill: '#888', 'font-size': 16 }); t.textContent = '×'; svg.appendChild(t);
      }
    }
    const tb = el('text', { x: 300, y: 46, fill: '#555' }); tb.textContent = '磁場 B（裏向き）'; svg.appendChild(tb);
    // 軌道：半円。φ=90°（入射点）から φ=−90°（出射点）まで、小さな線分で描く。
    let d = '';
    for (let deg = 90; deg >= -90; deg -= 5) {
      const rad = deg2rad(deg);
      const x = (c.x + rPx * Math.cos(rad)).toFixed(1), y = (c.y + rPx * Math.sin(rad)).toFixed(1);
      d += (d ? ' L ' : 'M ') + x + ' ' + y;
    }
    svg.appendChild(el('path', { d, fill: 'none', stroke: '#333', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
    // 入射してくる粒子を示す：磁場の左端から入射点まで、水平な点線。
    svg.appendChild(el('line', { x1: 50, y1: e.y, x2: e.x, y2: e.y, stroke: '#333', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    // 中心の印：「中心」と書く（scene.center の黒点は drawBase の最後に描かれる）。
    const tc = el('text', { x: c.x + 8, y: c.y - 8 }); tc.textContent = '中心'; svg.appendChild(tc);
    // 粒子：現在の位置に丸を描く（入射点・頂点・出射点のいずれか）。
    const pos = scene.phase === 'top' ? scene.top : scene.phase === 'exit' ? scene.exit : e;
    svg.appendChild(el('circle', { cx: pos.x, cy: pos.y, r: 7, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
    const tp = el('text', { x: pos.x + 10, y: pos.y + 4 }); tp.textContent = '+'; svg.appendChild(tp);
  } else if (scene.type === 'lc') {
    // LC回路のループ：左辺にコンデンサ、右辺にコイル、上下は導線。
    const topY = 80, botY = 220, leftX = 80, rightX = 320;
    svg.appendChild(el('line', { x1: leftX, y1: topY, x2: rightX, y2: topY, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: leftX, y1: botY, x2: rightX, y2: botY, stroke: '#333', 'stroke-width': 2 }));
    // コンデンサ：左辺の2枚の極板（y=140 と y=160）。上板と下板のあいだはすき間。
    svg.appendChild(el('line', { x1: leftX, y1: topY, x2: leftX, y2: 140, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: leftX, y1: botY, x2: leftX, y2: 160, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: 58, y1: 140, x2: 102, y2: 140, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 58, y1: 160, x2: 102, y2: 160, stroke: '#333', 'stroke-width': 3 }));
    const tc = el('text', { x: 108, y: 146 }); tc.textContent = 'コンデンサ C'; svg.appendChild(tc);
    // コイル：右辺のジグザグ（y=110 から y=190）。
    let d = 'M ' + rightX + ' ' + topY;
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const y = topY + ((190 - topY) * i) / steps;
      const x = i === steps ? rightX : (i % 2 === 1 ? rightX - 14 : rightX + 14);
      d += ' L ' + x + ' ' + y.toFixed(1);
    }
    d += ' L ' + rightX + ' ' + botY;
    svg.appendChild(el('path', { d, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
    const tl = el('text', { x: rightX + 18, y: 150 }); tl.textContent = 'コイル L'; svg.appendChild(tl);
    // 電荷の符号：上板が + のとき qmax、下板が + のとき qmin。imax では電荷は 0（符号なし）。
    if (scene.phase === 'qmax' || scene.phase === 'qmin') {
      const topSign = scene.phase === 'qmax' ? '+' : '−';
      const botSign = scene.phase === 'qmax' ? '−' : '+';
      const s1 = el('text', { x: 40, y: 132, fill: '#b00', 'font-size': 18 }); s1.textContent = topSign; svg.appendChild(s1);
      const s2 = el('text', { x: 40, y: 172, fill: '#b00', 'font-size': 18 }); s2.textContent = botSign; svg.appendChild(s2);
    }
    // エネルギーの状態を図の下に書く（数字は HTML の文章側にもある）。
    const st = el('text', { x: 120, y: 260, fill: '#555' });
    st.textContent = scene.phase === 'qmax' ? '電気エネルギー最大・磁気エネルギー 0'
      : scene.phase === 'imax' ? '電気エネルギー 0・磁気エネルギー最大'
      : '電気エネルギー最大（向きが逆）・磁気エネルギー 0';
    svg.appendChild(st);
  } else if (scene.type === 'gas-piston') {
    const pistonY = scene.pistonY;
    // シリンダー：左右の壁と底。ピストンは厚い板（気体の上端）。
    svg.appendChild(el('line', { x1: 120, y1: 40, x2: 120, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 280, y1: 40, x2: 280, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 120, y1: 260, x2: 280, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('rect', { x: 120, y: pistonY, width: 160, height: 260 - pistonY, fill: '#e8f4ff', stroke: 'none' }));
    svg.appendChild(el('rect', { x: 116, y: pistonY - 6, width: 168, height: 12, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    const tP = el('text', { x: 288, y: pistonY + 4 }); tP.textContent = 'ピストン'; svg.appendChild(tP);
    const tG = el('text', { x: 180, y: 252 }); tG.textContent = '気体'; svg.appendChild(tG);
    const tA = el('text', { x: 180, y: 32 }); tA.textContent = '大気圧 p0'; svg.appendChild(tA);
    // 加熱後の場面では、ピストンが上がったことが分かるよう「加熱後」と書く。
    if (scene.phase === 'after') {
      const tH = el('text', { x: 40, y: 32, fill: '#b00' }); tH.textContent = '加熱後'; svg.appendChild(tH);
    }
  } else if (scene.type === 'young') {
    const L = scene.layout;
    // 光源（左）と中心軸（破線）。
    svg.appendChild(el('circle', { cx: 50, cy: L.centerY, r: 8, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
    const tS = el('text', { x: 30, y: L.centerY + 26 }); tS.textContent = '光源'; svg.appendChild(tS);
    for (const yy of [L.centerY - 10, L.centerY, L.centerY + 10]) {
      svg.appendChild(el('line', { x1: 62, y1: yy, x2: L.slitX - 4, y2: yy, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    }
    svg.appendChild(el('line', { x1: L.slitX, y1: L.centerY, x2: L.screenX, y2: L.centerY, stroke: '#888', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    // 二重スリット：縦の板に2つのすき間（すき間の位置は計算値から）。
    svg.appendChild(el('line', { x1: L.slitX, y1: 40, x2: L.slitX, y2: L.upperSlit.y - 8, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: L.slitX, y1: L.upperSlit.y + 8, x2: L.slitX, y2: L.lowerSlit.y - 8, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: L.slitX, y1: L.lowerSlit.y + 8, x2: L.slitX, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    const tSl = el('text', { x: 96, y: 30 }); tSl.textContent = '二重スリット'; svg.appendChild(tSl);
    // スクリーンと明線の目印（縞間隔 30px ごと、n=-3..3）。
    svg.appendChild(el('line', { x1: L.screenX, y1: 40, x2: L.screenX, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    const tSc = el('text', { x: 306, y: 30 }); tSc.textContent = 'スクリーン'; svg.appendChild(tSc);
    for (let k = -3; k <= 3; k++) {
      const y = L.centerY + k * 30;
      svg.appendChild(el('line', { x1: L.screenX - 8, y1: y, x2: L.screenX + 8, y2: y, stroke: '#b00', 'stroke-width': 2.5 }));
    }
    const tC = el('text', { x: L.screenX + 12, y: L.centerY + 4, fill: '#b00' }); tC.textContent = '明線'; svg.appendChild(tC);
    const tN = el('text', { x: L.screenX + 12, y: L.point.y + 4, fill: '#b00' }); tN.textContent = 'n=3'; svg.appendChild(tN);
    // 光路差の目印：下の光路上の点に、光路と直角な短い線を引く（位置は計算値から）。
    const dx = L.point.x - L.lowerSlit.x, dy = L.point.y - L.lowerSlit.y;
    const len = Math.hypot(dx, dy);
    const px = -dy / len, py = dx / len;
    svg.appendChild(el('line', {
      x1: (L.tick.x - px * 7).toFixed(1), y1: (L.tick.y - py * 7).toFixed(1),
      x2: (L.tick.x + px * 7).toFixed(1), y2: (L.tick.y + py * 7).toFixed(1),
      stroke: '#b00', 'stroke-width': 2,
    }));
    // 「光路差 3λ」は右端で切れないよう、目印の左側に右寄せで出す。
    const tD = el('text', { x: L.tick.x - 10, y: L.tick.y + 16, fill: '#b00', 'text-anchor': 'end' }); tD.textContent = '光路差 3λ'; svg.appendChild(tD);
  } else if (scene.type === 'youngWater') {
    const d = scene.derived;
    if (scene.phase === 'compare') {
      // 縞の並びを比べる：空気の縞（上）と水の縞（下）。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '縞を比べる：水では縞が狭くなる'; svg.appendChild(tH);
      const tA = el('text', { x: 40, y: 88, fill: '#555' }); tA.textContent = '空気：縞間隔 3.0 mm'; svg.appendChild(tA);
      for (let k = -2; k <= 2; k++) {
        svg.appendChild(el('line', { x1: 200 + k * 45, y1: 100, x2: 200 + k * 45, y2: 140, stroke: '#b00', 'stroke-width': 2.5 }));
      }
      const tW = el('text', { x: 40, y: 188, fill: '#555' }); tW.textContent = '水：縞間隔 2.25 mm'; svg.appendChild(tW);
      for (let k = -2; k <= 2; k++) {
        svg.appendChild(el('line', { x1: 200 + k * 33.75, y1: 200, x2: 200 + k * 33.75, y2: 240, stroke: '#b00', 'stroke-width': 2.5 }));
      }
    } else if (scene.phase === 'blue') {
      // 青い光の縞：空気（上）と水中（下）。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '青い光：水中ではさらに縞が狭い'; svg.appendChild(tH);
      const tA = el('text', { x: 40, y: 88, fill: '#555' }); tA.textContent = '青い光（空気）：縞間隔 2.25 mm'; svg.appendChild(tA);
      for (let k = -4; k <= 4; k++) {
        svg.appendChild(el('line', { x1: 200 + k * 22.5, y1: 100, x2: 200 + k * 22.5, y2: 140, stroke: 'blue', 'stroke-width': 2.5 }));
      }
      const tW = el('text', { x: 40, y: 188, fill: '#555' }); tW.textContent = '青い光（水中）：縞間隔 1.69 mm'; svg.appendChild(tW);
      for (let k = -5; k <= 5; k++) {
        svg.appendChild(el('line', { x1: 200 + k * 16.875, y1: 200, x2: 200 + k * 16.875, y2: 240, stroke: 'blue', 'stroke-width': 2.5 }));
      }
    } else {
      // 光路図（young と同じ配置）。water の場面では水槽を先に描く。
      const isWater = scene.phase === 'water';
      const point = isWater ? d.pointWater : d.pointAir;
      if (isWater) {
        svg.appendChild(el('rect', { x: d.slitX, y: 40, width: 220, height: 220, fill: '#dceeff', stroke: '#88aacc', 'stroke-width': 1.5 }));
        const tW = el('text', { x: 200, y: 58, fill: '#336699' }); tW.textContent = '水 n=4/3'; svg.appendChild(tW);
      }
      // 場面の説明は下に出す（上に置くと「二重スリット」「スクリーン」と重なる）。
      const tH = el('text', { x: 40, y: 290, fill: '#555' });
      tH.textContent = isWater ? '水中：λ′=450 nm、縞間隔 2.25 mm' : '空気中：λ=600 nm、縞間隔 3.0 mm';
      svg.appendChild(tH);
      svg.appendChild(el('circle', { cx: 50, cy: d.centerY, r: 8, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tS = el('text', { x: 30, y: d.centerY + 26 }); tS.textContent = '光源'; svg.appendChild(tS);
      svg.appendChild(el('line', { x1: d.slitX, y1: d.centerY, x2: d.screenX, y2: d.centerY, stroke: '#888', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
      svg.appendChild(el('line', { x1: d.slitX, y1: 40, x2: d.slitX, y2: d.upperSlit.y - 8, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: d.slitX, y1: d.upperSlit.y + 8, x2: d.slitX, y2: d.lowerSlit.y - 8, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: d.slitX, y1: d.lowerSlit.y + 8, x2: d.slitX, y2: 260, stroke: '#333', 'stroke-width': 3 }));
      const tSl = el('text', { x: 96, y: 30 }); tSl.textContent = '二重スリット'; svg.appendChild(tSl);
      svg.appendChild(el('line', { x1: d.screenX, y1: 40, x2: d.screenX, y2: 260, stroke: '#333', 'stroke-width': 3 }));
      const tSc = el('text', { x: 286, y: 30 }); tSc.textContent = 'スクリーン'; svg.appendChild(tSc);
      // 明線の目印：縞間隔（空気 30 px、水 22.5 px）ごとに引く。
      const spacing = isWater ? 22.5 : 30;
      for (let k = -3; k <= 3; k++) {
        const y = d.centerY + k * spacing;
        svg.appendChild(el('line', { x1: d.screenX - 8, y1: y, x2: d.screenX + 8, y2: y, stroke: '#b00', 'stroke-width': 2.5 }));
      }
      const tC = el('text', { x: d.screenX + 12, y: d.centerY + 4, fill: '#b00' }); tC.textContent = '明線'; svg.appendChild(tC);
      // 「n=3」は「光路1」のラベルと接しないよう、点から少し下へ出す。
      const tN = el('text', { x: d.screenX + 12, y: point.y + 18, fill: '#b00' }); tN.textContent = 'n=3'; svg.appendChild(tN);
    }
  } else if (scene.type === 'dopplerShm') {
    const d = scene.derived;
    if (scene.phase === 'graph') {
      // 観測振動数 f'(t) のグラフ：1周期（約 0.63 s）で 442.6 Hz と 437.4 Hz の間を往復する。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '観測振動数 f′ の時間変化（1周期）'; svg.appendChild(tH);
      const x0 = 60, x1 = 340, y0 = 240;
      const yOf = (f) => y0 - (f - 437) * 30;
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: 60, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      // 440 Hz の破線（シフトなしの線）。
      svg.appendChild(el('line', { x1: x0, y1: yOf(440), x2: x1, y2: yOf(440), stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      const t440 = el('text', { x: 296, y: yOf(440) - 8, fill: '#555' }); t440.textContent = '440 Hz'; svg.appendChild(t440);
      let p = '';
      for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * d.periodS;
        const x = x0 + (t / d.periodS) * (x1 - x0);
        const y = yOf(d.fPrimeAt(t));
        p += (p ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      const tMax = el('text', { x: 70, y: 64, fill: '#b00' }); tMax.textContent = '最大 442.6 Hz'; svg.appendChild(tMax);
      const tMin = el('text', { x: 206, y: 242, fill: '#b00' }); tMin.textContent = '最小 437.4 Hz'; svg.appendChild(tMin);
      const t0 = el('text', { x: 56, y: 258, fill: '#555' }); t0.textContent = '0'; svg.appendChild(t0);
      const tT = el('text', { x: 296, y: 258, fill: '#555' }); tT.textContent = 'T≈0.63 s'; svg.appendChild(tT);
      const tF = el('text', { x: 36, y: 64 }); tF.textContent = 'f′'; svg.appendChild(tF);
    } else if (scene.phase === 'beat') {
      // うなりの包絡線：2つの音の重ね合わせの強さが、約 0.38 s ごとに強くなったり弱くなったりする。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = 'うなり：440 Hz と 442.6 Hz の音を重ねる'; svg.appendChild(tH);
      const x0 = 60, x1 = 340, y0 = 240, tEnd = 0.77;
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: 80, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      let p = '';
      for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * tEnd;
        const amp = Math.abs(Math.cos(Math.PI * d.beatMaxHz * t));
        const x = x0 + (t / tEnd) * (x1 - x0);
        const y = y0 - amp * 140;
        p += (p ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      const tS1 = el('text', { x: 66, y: 92, fill: '#b00' }); tS1.textContent = '強'; svg.appendChild(tS1);
      const tS2 = el('text', { x: 196, y: 92, fill: '#b00' }); tS2.textContent = '強'; svg.appendChild(tS2);
      // うなりの周期のラベルは、x 軸の目盛りラベルと重ならないよう、上へ出す。
      const tB = el('text', { x: 150, y: 64, fill: '#555' }); tB.textContent = 'うなりの周期 ≈0.38 s'; svg.appendChild(tB);
      const t0 = el('text', { x: 56, y: 258, fill: '#555' }); t0.textContent = '0'; svg.appendChild(t0);
      const tE = el('text', { x: 296, y: 258, fill: '#555' }); tE.textContent = '0.77 s'; svg.appendChild(tE);
    } else {
      // ばねについた音源と観測者。壁・ばね・音源・観測者を描く。
      const tH = el('text', { x: 40, y: 36, fill: '#555' });
      tH.textContent = scene.phase === 'approach' ? '音源が観測者へ向かう：v_s = 2.0 m/s'
        : scene.phase === 'turn' ? '折り返し点：速さ 0、ばねの力は最大'
        : 'ばねについた音源：振動数 440 Hz';
      svg.appendChild(tH);
      const srcX = scene.phase === 'turn' ? d.turnX : d.eqX;
      // 壁。
      svg.appendChild(el('line', { x1: d.wallX, y1: 110, x2: d.wallX, y2: 190, stroke: '#333', 'stroke-width': 3 }));
      // ばね：壁から音源までのジグザグ（歯の高さは計算値ではなく図示の幅）。
      let sp = `M ${d.wallX} ${d.srcY}`;
      const steps = Math.max(2, Math.round((srcX - d.wallX) / 16));
      for (let i = 1; i <= steps; i++) {
        const x = d.wallX + ((srcX - d.wallX) * i) / steps;
        const y = d.srcY + (i % 2 === 1 ? -12 : 12);
        sp += ` L ${x.toFixed(1)} ${y}`;
      }
      sp += ` L ${srcX} ${d.srcY}`;
      svg.appendChild(el('path', { d: sp, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      // 音源の箱。
      svg.appendChild(el('rect', { x: srcX - 15, y: d.srcY - 15, width: 30, height: 30, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tS = el('text', { x: srcX - 14, y: d.srcY + 36 }); tS.textContent = '音源'; svg.appendChild(tS);
      // 観測者。
      svg.appendChild(el('circle', { cx: d.obsX, cy: d.srcY, r: 10, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      const tO = el('text', { x: d.obsX - 28, y: d.srcY - 22 }); tO.textContent = '観測者'; svg.appendChild(tO);
      if (scene.phase !== 'turn') {
        // 音の波：音源の右側に半円の弧を 3 本（間隔は波長から）。
        for (const r of [30, 60, 90]) {
          svg.appendChild(el('path', { d: `M ${srcX} ${d.srcY - r} A ${r} ${r} 0 0 1 ${srcX} ${d.srcY + r}`, fill: 'none', stroke: '#336699', 'stroke-width': 2 }));
        }
        const tL = el('text', { x: 296, y: 104, fill: '#555' }); tL.textContent = 'λ≈0.77 m'; svg.appendChild(tL);
      }
      if (scene.phase === 'approach') {
        const tF = el('text', { x: 296, y: 196, fill: '#b00' }); tF.textContent = 'f′≈443 Hz'; svg.appendChild(tF);
      }
      if (scene.phase === 'turn') {
        const tF = el('text', { x: 296, y: 196, fill: '#b00' }); tF.textContent = 'f′=440 Hz'; svg.appendChild(tF);
      }
    }
  } else if (scene.type === 'capSpring') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'charged' ? 'Q 一定：静電引力とばねの力がつり合う'
      : scene.phase === 'shm' ? 'つり合い位置のまわりで単振動する'
      : scene.phase === 'energy' ? 'd を半分に：C は 2 倍、V は半分、U は半分'
      : scene.phase === 'contrast' ? 'V 一定：d を半分にすると引力は 4 倍'
      : '充電する前：ばねは自然長、力は 0';
    svg.appendChild(tH);
    // 動く極板の位置は場面で決まる（base は自然長、charged はつり合い、shm は +1.0 mm、energy・contrast は d=2.5 mm）。
    const px = scene.phase === 'base' ? d.naturalPlateX
      : scene.phase === 'shm' ? d.shmPlateX
      : (scene.phase === 'energy' || scene.phase === 'contrast') ? d.closePlateX
      : d.eqPlateX;
    const dMm = (px - d.leftPlateX) / d.dPxPerMm;
    // 固定の極板（左）と動く極板（右）。
    svg.appendChild(el('line', { x1: d.leftPlateX, y1: d.plateY0, x2: d.leftPlateX, y2: d.plateY1, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: px, y1: d.plateY0, x2: px, y2: d.plateY1, stroke: '#333', 'stroke-width': 3 }));
    // 極板間隔 d のラベル（力のラベルと重ならないよう、上へ出す）。
    const tD = el('text', { x: 118, y: 92, fill: '#555' }); tD.textContent = 'd=' + dMm.toFixed(1) + ' mm'; svg.appendChild(tD);
    // 「固定」は「動く極板」と重ならないよう、左へ出す。
    const tF = el('text', { x: 76, y: 212, fill: '#555' }); tF.textContent = '固定'; svg.appendChild(tF);
    const tM = el('text', { x: px - 24, y: 212, fill: '#555' }); tM.textContent = '動く極板'; svg.appendChild(tM);
    // ばね：動く極板から壁までのジグザグ。
    let sp = `M ${px} ${d.plateY}`;
    const steps = Math.max(2, Math.round((d.wallX - px) / 16));
    for (let i = 1; i <= steps; i++) {
      const x = px + ((d.wallX - px) * i) / steps;
      const y = d.plateY + (i % 2 === 1 ? -12 : 12);
      sp += ` L ${x.toFixed(1)} ${y}`;
    }
    sp += ` L ${d.wallX} ${d.plateY}`;
    svg.appendChild(el('path', { d: sp, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: d.wallX, y1: d.plateY0, x2: d.wallX, y2: d.plateY1, stroke: '#333', 'stroke-width': 3 }));
    const tW = el('text', { x: 346, y: 130 }); tW.textContent = '壁'; svg.appendChild(tW);
    if (scene.phase === 'base') {
      const tB = el('text', { x: 230, y: 128, fill: '#555' }); tB.textContent = 'ばね（自然長）'; svg.appendChild(tB);
    }
    if (scene.phase === 'energy') {
      const tB = el('text', { x: 260, y: 128, fill: '#555' }); tB.textContent = 'ばね'; svg.appendChild(tB);
    }
    // 場面の下の注釈。
    const tN = el('text', { x: 40, y: 244, fill: '#555' });
    tN.textContent = scene.phase === 'charged' ? 'ばねの伸び 2.3 mm（つり合い）'
      : scene.phase === 'shm' ? 'つり合い位置から ±1.0 mm、周期 約 0.63 s'
      : scene.phase === 'energy' ? 'C=70.8 pF、V≈2820 V、U≈0.28 mJ'
      : scene.phase === 'contrast' ? '引く力 0.45 N ＞ ばねの力 0.24 N'
      : '充電する前：力ははたらかない';
    svg.appendChild(tN);
  } else if (scene.type === 'slopeEnergy') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'forces' ? '斜面の上の力：重力の分解と摩擦力'
      : scene.phase === 'energy' ? 'エネルギー：重力の仕事 − 摩擦の仕事'
      : scene.phase === 'trap' ? '罠：摩擦を無視すると速くなる'
      : scene.phase === 'floor' ? '斜面を出たあと：水平な床で止まる'
      : '粗い斜面をすべりおりる：摩擦がある';
    svg.appendChild(tH);
    if (scene.phase === 'energy') {
      // エネルギーの棒グラフ：棒の長さは 2 px/J で計算値から決める。
      const rows = [
        [`重力の仕事 ${d.wGravityJ.toFixed(0)} J`, d.wGravityJ * 2, '#cfe3ff'],
        [`摩擦の仕事 ${d.wFrictionJ.toFixed(0)} J`, Math.abs(d.wFrictionJ) * 2, '#ffb3b3'],
        [`運動エネルギー ${d.keJ.toFixed(0)} J`, d.keJ * 2, '#b3e6b3'],
      ];
      rows.forEach(([label, w, fill], i) => {
        const y = 90 + i * 50;
        const tL = el('text', { x: 40, y: y - 8, fill: '#555' }); tL.textContent = label; svg.appendChild(tL);
        svg.appendChild(el('rect', { x: 60, y, width: w, height: 20, fill, stroke: '#333', 'stroke-width': 1.5 }));
      });
      const tN2 = el('text', { x: 40, y: 258, fill: '#555' });
      tN2.textContent = `${d.wGravityJ.toFixed(0)} − ${Math.abs(d.wFrictionJ).toFixed(0)} = ${d.keJ.toFixed(0)} J が速さになる：v≈${d.vMs.toFixed(1)} m/s`;
      svg.appendChild(tN2);
      // 下端の玉（速度の矢印は forces で描く）。
      svg.appendChild(el('line', { x1: 40, y1: 240, x2: 360, y2: 240, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: 285, y: 216, width: 30, height: 24, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tB = el('text', { x: 250, y: 210 }); tB.textContent = '下端'; svg.appendChild(tB);
    } else if (scene.phase === 'trap') {
      // 摩擦ありとなしの速さを並べる。
      const tA = el('text', { x: 40, y: 140, fill: '#555' }); tA.textContent = '摩擦あり'; svg.appendChild(tA);
      const tB = el('text', { x: 40, y: 200, fill: '#555' }); tB.textContent = '摩擦なし'; svg.appendChild(tB);
      const tN2 = el('text', { x: 40, y: 262, fill: '#555' });
      tN2.textContent = `正しいのは ${d.vMs.toFixed(1)} m/s。摩擦の仕事を忘れない`;
      svg.appendChild(tN2);
    } else if (scene.phase === 'floor') {
      // 水平な床：出発点の玉と、止まる点の玉。
      svg.appendChild(el('line', { x1: 40, y1: 240, x2: 360, y2: 240, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: 65, y: 216, width: 30, height: 24, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 95, y1: 228, x2: d.floorStopX, y2: 228, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      svg.appendChild(el('rect', { x: d.floorStopX - 15, y: 216, width: 30, height: 24, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const tS = el('text', { x: d.floorStopX - 22, y: 206 }); tS.textContent = '止まる'; svg.appendChild(tS);
      // 止まるまでの距離の目盛り（地面の下）。
      svg.appendChild(el('line', { x1: d.floorStartX, y1: 262, x2: d.floorStopX, y2: 262, stroke: '#333', 'stroke-width': 1.5, 'marker-end': 'url(#fig-arrow)' }));
      const tD = el('text', { x: 150, y: 280, fill: '#555' }); tD.textContent = `約 ${d.stopM.toFixed(1)} m`; svg.appendChild(tD);
      const tF = el('text', { x: 320, y: 226, fill: '#555' }); tF.textContent = '床（粗い）'; svg.appendChild(tF);
    } else {
      // 斜面と玉（base・forces）。地面と斜面の線、玉は斜面に沿って傾ける。
      svg.appendChild(el('polygon', { points: `${d.slopeA.x},${d.slopeA.y.toFixed(1)} ${d.slopeB.x},${d.slopeB.y} ${d.slopeB.x},280 ${d.slopeA.x},280`, fill: '#eee' }));
      svg.appendChild(el('line', { x1: 40, y1: 240, x2: 360, y2: 240, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: d.slopeA.x, y1: d.slopeA.y, x2: d.slopeB.x, y2: d.slopeB.y, stroke: '#333', 'stroke-width': 3 }));
      const g = el('g', { transform: `rotate(-30 ${d.blockM.x} ${d.blockM.y})` });
      g.appendChild(el('rect', { x: d.blockM.x - 30, y: d.blockM.y - 15, width: 60, height: 30, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(g);
      const tM = el('text', { x: 100, y: 108 }); tM.textContent = 'm=2.0 kg'; svg.appendChild(tM);
      if (scene.phase === 'forces') {
        // θ の弧：斜面の下端を中心に、地面と斜面のあいだ。必ず描く。
        let arc = '';
        for (let deg = 180; deg <= 210; deg += 5) {
          const r = deg2rad(deg);
          const x = (320 + 30 * Math.cos(r)).toFixed(1), y = (240 + 30 * Math.sin(r)).toFixed(1);
          arc += (arc ? ' L ' : 'M ') + x + ' ' + y;
        }
        svg.appendChild(el('path', { d: arc, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
        const th = el('text', { x: 240, y: 236 }); th.textContent = 'θ=30°'; svg.appendChild(th);
        const tS = el('text', { x: 240, y: 80, fill: '#555' }); tS.textContent = '斜面（粗い）'; svg.appendChild(tS);
      }
    }
  } else if (scene.type === 'inductionLC') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'charge' ? 'コンデンサにたまる：Q=200 μC、U=0.20 mJ'
      : scene.phase === 'lc' ? 'スイッチを切り替える：LC 振動がはじまる'
      : scene.phase === 'graph' ? 'q と i の時間変化（1周期 T≈0.020 s）'
      : scene.phase === 'trap' ? '罠：B が変わらなくなると V=0'
      : 'コイルの磁束が増える：誘導起電力 V=2.0 V';
    svg.appendChild(tH);
    if (scene.phase === 'charge') {
      // コンデンサの極板：左が ＋、右が −。
      svg.appendChild(el('line', { x1: 180, y1: 100, x2: 180, y2: 200, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 220, y1: 100, x2: 220, y2: 200, stroke: '#333', 'stroke-width': 3 }));
      const s1 = el('text', { x: 160, y: 156, fill: '#b00', 'font-size': 18 }); s1.textContent = '＋'; svg.appendChild(s1);
      const s2 = el('text', { x: 232, y: 156, fill: 'blue', 'font-size': 18 }); s2.textContent = '−'; svg.appendChild(s2);
      const tQ1 = el('text', { x: 140, y: 88, fill: '#b00' }); tQ1.textContent = '＋200 μC'; svg.appendChild(tQ1);
      const tQ2 = el('text', { x: 220, y: 88, fill: 'blue' }); tQ2.textContent = '−200 μC'; svg.appendChild(tQ2);
      // 充電回路の下の配線。
      svg.appendChild(el('line', { x1: 180, y1: 200, x2: 180, y2: 240, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 180, y1: 240, x2: 220, y2: 240, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 220, y1: 240, x2: 220, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      const tV = el('text', { x: 160, y: 272, fill: '#555' }); tV.textContent = 'V=2.0 V、U=0.20 mJ'; svg.appendChild(tV);
    } else if (scene.phase === 'lc') {
      // LC 回路：左にコンデンサ、右にコイル（3つの丸）。
      svg.appendChild(el('line', { x1: 100, y1: 80, x2: 280, y2: 80, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 200, x2: 280, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 80, x2: 100, y2: 135, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 147, x2: 100, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 86, y1: 135, x2: 114, y2: 135, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 86, y1: 147, x2: 114, y2: 147, stroke: '#333', 'stroke-width': 3 }));
      // コイル：右の辺に 3 つの丸。
      svg.appendChild(el('line', { x1: 280, y1: 80, x2: 280, y2: 105, stroke: '#333', 'stroke-width': 2 }));
      for (const cy of [115, 145, 175]) {
        svg.appendChild(el('circle', { cx: 280, cy, r: 10, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      }
      svg.appendChild(el('line', { x1: 280, y1: 185, x2: 280, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      const tC = el('text', { x: 40, y: 64 }); tC.textContent = 'C=100 μF'; svg.appendChild(tC);
      const tL = el('text', { x: 300, y: 64 }); tL.textContent = 'L=0.10 H'; svg.appendChild(tL);
      const tN = el('text', { x: 40, y: 240, fill: '#555' }); tN.textContent = 'ω≈316 rad/s、T≈0.020 s、f≈50 Hz'; svg.appendChild(tN);
    } else if (scene.phase === 'graph') {
      // q(t) = Q cos ωt（赤）、i(t) = −I0 sin ωt（青）。中心 y=150、振幅 90 px。
      const x0 = 60, x1 = 340, yC = 150;
      const xOf = (t) => x0 + (t / d.periodS) * (x1 - x0);
      svg.appendChild(el('line', { x1: x0, y1: 240, x2: x1, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: 60, x2: x0, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: yC, x2: x1, y2: yC, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      let pq = '', pi = '';
      for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * d.periodS;
        const x = xOf(t).toFixed(1);
        pq += (pq ? ' L ' : 'M ') + x + ' ' + (yC - (d.qAt(t) / d.qC) * 90).toFixed(1);
        pi += (pi ? ' L ' : 'M ') + x + ' ' + (yC - (d.iAt(t) / d.i0A) * 90).toFixed(1);
      }
      svg.appendChild(el('path', { d: pq, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      svg.appendChild(el('path', { d: pi, fill: 'none', stroke: 'blue', 'stroke-width': 2 }));
      const tQ = el('text', { x: 70, y: 56, fill: '#b00' }); tQ.textContent = 'q 最大 200 μC'; svg.appendChild(tQ);
      const tI = el('text', { x: 210, y: 56, fill: 'blue' }); tI.textContent = 'i 最大 63 mA'; svg.appendChild(tI);
      const t0 = el('text', { x: 56, y: 258, fill: '#555' }); t0.textContent = '0'; svg.appendChild(t0);
      const tQ4 = el('text', { x: 118, y: 258, fill: '#555' }); tQ4.textContent = 'T/4'; svg.appendChild(tQ4);
      const tT = el('text', { x: 330, y: 258, fill: '#555' }); tT.textContent = 'T'; svg.appendChild(tT);
      const tN = el('text', { x: 40, y: 278, fill: '#555' }); tN.textContent = 'T/4 で q=0、i は最大になる'; svg.appendChild(tN);
    } else if (scene.phase === 'trap') {
      // B–t グラフ：B は 0.20 s で 0.40 T まで増えて、そのあとは一定。V は増えている間だけ 2.0 V。
      const x0 = 60, x1 = 340, y0 = 240;
      const xOf = (t) => x0 + (t / 0.40) * (x1 - x0);
      const yB = (b) => y0 - (b / 0.40) * 120;
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: 60, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('path', { d: `M ${x0} ${y0} L ${xOf(0.20).toFixed(1)} ${yB(0.40)} L ${x1} ${yB(0.40)}`, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      svg.appendChild(el('path', { d: `M ${x0} 180 L ${xOf(0.20).toFixed(1)} 180 L ${xOf(0.20).toFixed(1)} ${y0} L ${x1} ${y0}`, fill: 'none', stroke: 'blue', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
      const tB = el('text', { x: 210, y: 108, fill: '#b00' }); tB.textContent = 'B=0.40 T'; svg.appendChild(tB);
      const tV = el('text', { x: 70, y: 170, fill: 'blue' }); tV.textContent = 'V=2.0 V'; svg.appendChild(tV);
      const tV0 = el('text', { x: 250, y: 232, fill: 'blue' }); tV0.textContent = 'V=0'; svg.appendChild(tV0);
      const tT1 = el('text', { x: 190, y: 258, fill: '#555' }); tT1.textContent = '0.20 s'; svg.appendChild(tT1);
      const tT2 = el('text', { x: 320, y: 258, fill: '#555' }); tT2.textContent = '0.40 s'; svg.appendChild(tT2);
      const tN = el('text', { x: 40, y: 278, fill: '#555' }); tN.textContent = 'B が変わらなくなると、起電力は 0 になる'; svg.appendChild(tN);
    } else {
      // コイルの回路：四角いループの中に × 印（裏向きの磁場）、右の辺にコンデンサ。
      const tN = el('text', { x: 110, y: 64, fill: '#555' }); tN.textContent = 'N=100 回'; svg.appendChild(tN);
      svg.appendChild(el('line', { x1: 100, y1: 80, x2: 280, y2: 80, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 200, x2: 280, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 80, x2: 100, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 280, y1: 80, x2: 280, y2: 135, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 280, y1: 147, x2: 280, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 268, y1: 135, x2: 292, y2: 135, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 268, y1: 147, x2: 292, y2: 147, stroke: '#333', 'stroke-width': 3 }));
      // 磁場（裏向き）の × 印：3×3。
      for (const cx of [130, 170, 210]) {
        for (const cy of [110, 140, 170]) {
          svg.appendChild(el('line', { x1: cx - 5, y1: cy - 5, x2: cx + 5, y2: cy + 5, stroke: '#b00', 'stroke-width': 2 }));
          svg.appendChild(el('line', { x1: cx + 5, y1: cy - 5, x2: cx - 5, y2: cy + 5, stroke: '#b00', 'stroke-width': 2 }));
        }
      }
      const tC = el('text', { x: 296, y: 142 }); tC.textContent = 'C=100 μF'; svg.appendChild(tC);
      const tB = el('text', { x: 120, y: 226, fill: '#b00' }); tB.textContent = 'B（裏向き）'; svg.appendChild(tB);
      const tS = el('text', { x: 230, y: 226, fill: '#555' }); tS.textContent = 'S=0.010 m²'; svg.appendChild(tS);
    }
  } else if (scene.type === 'gasResonance') {
    const d = scene.derived;
    // 管：横 x=60〜340（0.85 m）、縦 y=120〜180。両端とも閉じている。
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'heat' ? '定積加熱：T=300 K → 600 K、p は 2 倍に'
      : scene.phase === 'sound' ? '基本振動：両端が節、中央が腹'
      : scene.phase === 'resonance' ? '共鳴振動数：温度が 2 倍で √2 倍になる'
      : scene.phase === 'trap' ? '罠：圧力が変わっても音速は変わらない'
      : 'ヘリウムを管に封入：定積加熱と共鳴';
    svg.appendChild(tH);
    if (scene.phase === 'resonance') {
      // 振動数の棒グラフ：棒の長さは 0.15 px/Hz で計算値から決める。
      const rows = [
        [`f1（300 K）${d.f1aHz.toFixed(0)} Hz`, d.f1aHz * 0.15, '#cfe3ff'],
        [`f1（600 K）${d.f1bHz.toFixed(0)} Hz`, d.f1bHz * 0.15, '#ffb3b3'],
        [`f2（300 K）${d.f2aHz.toFixed(0)} Hz`, d.f2aHz * 0.15, '#b3e6b3'],
        [`f2（600 K）${d.f2bHz.toFixed(0)} Hz`, d.f2bHz * 0.15, '#ffd24d'],
      ];
      rows.forEach(([label, w, fill], i) => {
        const y = 80 + i * 50;
        const tL = el('text', { x: 40, y: y - 8, fill: '#555' }); tL.textContent = label; svg.appendChild(tL);
        svg.appendChild(el('rect', { x: 60, y, width: w, height: 18, fill, stroke: '#333', 'stroke-width': 1.5 }));
      });
      const tN = el('text', { x: 40, y: 272, fill: '#555' });
      tN.textContent = '温度が 2 倍 → 音速は √2 倍 → 振動数も √2 倍';
      svg.appendChild(tN);
    } else if (scene.phase === 'trap') {
      // 圧力だけが違う 2 本の管：温度が同じなら音速も振動数も同じ。
      for (const [y0, pLabel] of [[90, 'p=1.0×10⁵ Pa、T=300 K'], [180, 'p=2.0×10⁵ Pa、T=300 K']]) {
        const tP = el('text', { x: 60, y: y0 - 10, fill: '#555' }); tP.textContent = pLabel; svg.appendChild(tP);
        svg.appendChild(el('rect', { x: 60, y: y0, width: 280, height: 40, fill: '#eee', stroke: '#333', 'stroke-width': 2 }));
        const tV = el('text', { x: 140, y: y0 + 25, fill: '#b00' }); tV.textContent = 'v≈1020 m/s（同じ）'; svg.appendChild(tV);
      }
      const tN = el('text', { x: 40, y: 244, fill: '#555' });
      tN.textContent = '圧力が 2 倍でも音速は同じ';
      svg.appendChild(tN);
      const tN1 = el('text', { x: 40, y: 266, fill: '#555' });
      tN1.textContent = 'v=√(γRT/M) に p はない';
      svg.appendChild(tN1);
      const tN2 = el('text', { x: 40, y: 288, fill: '#555' });
      tN2.textContent = '閉管の式 v/(4L) は 300 Hz（まちがい）';
      svg.appendChild(tN2);
    } else {
      // 管と音源。音源は管の左端の外側。
      svg.appendChild(el('circle', { cx: 48, cy: 150, r: 7, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tS = el('text', { x: 28, y: 128 }); tS.textContent = '音源'; svg.appendChild(tS);
      svg.appendChild(el('rect', { x: 60, y: 120, width: 280, height: 60, fill: '#eee', stroke: '#333', 'stroke-width': 2 }));
      const tL = el('text', { x: 160, y: 205, fill: '#555' }); tL.textContent = 'L=0.85 m（両端閉管）'; svg.appendChild(tL);
      if (scene.phase === 'heat') {
        const tT = el('text', { x: 150, y: 110, fill: '#b00' }); tT.textContent = 'T=600 K'; svg.appendChild(tT);
        const tP = el('text', { x: 150, y: 232, fill: '#555' }); tP.textContent = 'p=2.0×10⁵ Pa'; svg.appendChild(tP);
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'V=1.0 L（変わらない）、W=0'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'ΔU=150 J、Q=150 J'; svg.appendChild(tN2);
      } else if (scene.phase === 'sound') {
        // 基本振動の変位の包絡線：両端が節、中央が腹。y=150±40·sin(π(x−60)/280)。
        let pUp = '', pDn = '';
        for (let i = 0; i <= 40; i++) {
          const x = 60 + (i / 40) * 280;
          const a = 40 * Math.sin((Math.PI * (x - 60)) / 280);
          pUp += (pUp ? ' L ' : 'M ') + x.toFixed(1) + ' ' + (150 - a).toFixed(1);
          pDn += (pDn ? ' L ' : 'M ') + x.toFixed(1) + ' ' + (150 + a).toFixed(1);
        }
        svg.appendChild(el('path', { d: pUp, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
        svg.appendChild(el('path', { d: pDn, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
        svg.appendChild(el('line', { x1: 60, y1: 150, x2: 340, y2: 150, stroke: '#888', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
        const tN1 = el('text', { x: 52, y: 112 }); tN1.textContent = '節'; svg.appendChild(tN1);
        const tN2 = el('text', { x: 330, y: 112 }); tN2.textContent = '節'; svg.appendChild(tN2);
        const tA = el('text', { x: 192, y: 96, fill: '#b00' }); tA.textContent = '腹'; svg.appendChild(tA);
        const tLam = el('text', { x: 60, y: 232, fill: '#555' }); tLam.textContent = 'λ=2L=1.7 m'; svg.appendChild(tLam);
        const tV = el('text', { x: 230, y: 232, fill: '#555' }); tV.textContent = 'v≈1020 m/s'; svg.appendChild(tV);
        const tF = el('text', { x: 40, y: 272, fill: '#555' }); tF.textContent = `f1 = v/(2L) ≈ ${d.f1aHz.toFixed(0)} Hz`; svg.appendChild(tF);
      } else {
        const tHe = el('text', { x: 180, y: 154, fill: '#555' }); tHe.textContent = 'ヘリウム'; svg.appendChild(tHe);
        const tN = el('text', { x: 40, y: 250, fill: '#555' }); tN.textContent = 'p=1.0×10⁵ Pa、T=300 K、V=1.0 L、n≈0.040 mol'; svg.appendChild(tN);
      }
    }
  } else if (scene.type === 'railCapCoil') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'charge' ? 'コンデンサにためる：Q=0.50 C、U=0.25 J'
      : scene.phase === 'lc' ? 'スイッチを切り替える：LC 振動がはじまる'
      : scene.phase === 'graph' ? 'q と i の時間変化（1周期 T≈3.14 s）'
      : scene.phase === 'trap' ? '罠：エネルギーは半分、ジュール熱になる'
      : '棒がすべるとコンデンサが充電される';
    svg.appendChild(tH);
    if (scene.phase === 'lc') {
      // LC 回路：左にコンデンサ、右にコイル（3つの丸）。
      svg.appendChild(el('line', { x1: 100, y1: 80, x2: 280, y2: 80, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 200, x2: 280, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 80, x2: 100, y2: 135, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 147, x2: 100, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 86, y1: 135, x2: 114, y2: 135, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 86, y1: 147, x2: 114, y2: 147, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 280, y1: 80, x2: 280, y2: 105, stroke: '#333', 'stroke-width': 2 }));
      for (const cy of [115, 145, 175]) {
        svg.appendChild(el('circle', { cx: 280, cy, r: 10, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      }
      svg.appendChild(el('line', { x1: 280, y1: 185, x2: 280, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      const tC = el('text', { x: 40, y: 64 }); tC.textContent = 'C=0.50 F'; svg.appendChild(tC);
      const tL = el('text', { x: 300, y: 64 }); tL.textContent = 'L=0.50 H'; svg.appendChild(tL);
      const tN = el('text', { x: 40, y: 240, fill: '#555' }); tN.textContent = 'ω=2.0 rad/s、T≈3.14 s、f≈0.32 Hz'; svg.appendChild(tN);
      const tN2 = el('text', { x: 40, y: 262, fill: '#555' }); tN2.textContent = 'Q0=0.50 C、I0=1.0 A'; svg.appendChild(tN2);
    } else if (scene.phase === 'graph') {
      // q(t) = Q cos ωt（赤）、i(t) = −I0 sin ωt（青）。中心 y=150、振幅 90 px。
      const x0 = 60, x1 = 340, yC = 150;
      const xOf = (t) => x0 + (t / d.periodS) * (x1 - x0);
      svg.appendChild(el('line', { x1: x0, y1: 240, x2: x1, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: 60, x2: x0, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: yC, x2: x1, y2: yC, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      let pq = '', pi = '';
      for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * d.periodS;
        const x = xOf(t).toFixed(1);
        pq += (pq ? ' L ' : 'M ') + x + ' ' + (yC - (d.qAt(t) / d.qC) * 90).toFixed(1);
        pi += (pi ? ' L ' : 'M ') + x + ' ' + (yC - (d.iAt(t) / d.i0A) * 90).toFixed(1);
      }
      svg.appendChild(el('path', { d: pq, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      svg.appendChild(el('path', { d: pi, fill: 'none', stroke: 'blue', 'stroke-width': 2 }));
      const tQ = el('text', { x: 70, y: 56, fill: '#b00' }); tQ.textContent = 'q 最大 0.50 C'; svg.appendChild(tQ);
      const tI = el('text', { x: 210, y: 56, fill: 'blue' }); tI.textContent = 'i 最大 1.0 A'; svg.appendChild(tI);
      const t0 = el('text', { x: 56, y: 258, fill: '#555' }); t0.textContent = '0'; svg.appendChild(t0);
      const tQ4 = el('text', { x: 118, y: 258, fill: '#555' }); tQ4.textContent = 'T/4'; svg.appendChild(tQ4);
      const tT = el('text', { x: 330, y: 258, fill: '#555' }); tT.textContent = 'T'; svg.appendChild(tT);
      const tN = el('text', { x: 40, y: 278, fill: '#555' }); tN.textContent = 'T/4≈0.79 s で q=0、i は最大になる'; svg.appendChild(tN);
    } else if (scene.phase === 'trap') {
      // エネルギーの行き先の棒グラフ：棒の長さは 150 px/J で計算値から決める。
      const rows = [
        [`はじめの運動エネルギー ${d.ke0J.toFixed(2)} J`, d.ke0J * 150, '#cfe3ff'],
        [`あとの運動エネルギー ${d.ke1J.toFixed(2)} J`, d.ke1J * 150, '#b3e6b3'],
        [`コンデンサのエネルギー ${d.uJ.toFixed(2)} J`, d.uJ * 150, '#ffd24d'],
        [`ジュール熱 ${d.jouleJ.toFixed(2)} J`, d.jouleJ * 150, '#ffb3b3'],
      ];
      rows.forEach(([label, w, fill], i) => {
        const y = 80 + i * 50;
        const tL = el('text', { x: 40, y: y - 8, fill: '#555' }); tL.textContent = label; svg.appendChild(tL);
        svg.appendChild(el('rect', { x: 60, y, width: w, height: 18, fill, stroke: '#333', 'stroke-width': 1.5 }));
      });
      const tN = el('text', { x: 40, y: 266, fill: '#555' });
      tN.textContent = '1.0 = 0.25 + 0.25 + 0.50 J';
      svg.appendChild(tN);
      const tN2 = el('text', { x: 40, y: 286, fill: '#555' });
      tN2.textContent = 'エネルギー保存だけでは v1 は求まらない';
      svg.appendChild(tN2);
    } else {
      // レール回路：上の配線 y=90、下の配線 y=210、左は棒（x=140）、右はコンデンサ。
      svg.appendChild(el('line', { x1: 60, y1: 90, x2: 300, y2: 90, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 60, y1: 210, x2: 300, y2: 210, stroke: '#333', 'stroke-width': 2 }));
      // 棒：太い縦線。レール幅 L=1.0 m は破線で示す。
      svg.appendChild(el('line', { x1: 140, y1: 90, x2: 140, y2: 210, stroke: '#333', 'stroke-width': 6 }));
      const tRod = el('text', { x: 132, y: 82 }); tRod.textContent = '棒'; svg.appendChild(tRod);
      svg.appendChild(el('line', { x1: 118, y1: 90, x2: 118, y2: 210, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      const tL = el('text', { x: 36, y: 154 }); tL.textContent = 'L=1.0 m'; svg.appendChild(tL);
      // コンデンサ：右の配線の中の 2 枚の極板（水平線）。
      svg.appendChild(el('line', { x1: 300, y1: 90, x2: 300, y2: 140, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 288, y1: 140, x2: 312, y2: 140, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 288, y1: 152, x2: 312, y2: 152, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 300, y1: 152, x2: 300, y2: 210, stroke: '#333', 'stroke-width': 2 }));
      const tC = el('text', { x: 316, y: 146 }); tC.textContent = 'C=0.50 F'; svg.appendChild(tC);
      // 磁場（裏向き）の × 印：棒と速度の矢印と重ならない位置に置く。
      // 中段（y=150）は速度の矢印と充電ラベルの場所なので置かない。
      for (const cx of [220, 260]) {
        for (const cy of [115, 185]) {
          svg.appendChild(el('line', { x1: cx - 5, y1: cy - 5, x2: cx + 5, y2: cy + 5, stroke: '#b00', 'stroke-width': 2 }));
          svg.appendChild(el('line', { x1: cx + 5, y1: cy - 5, x2: cx - 5, y2: cy + 5, stroke: '#b00', 'stroke-width': 2 }));
        }
      }
      const tB = el('text', { x: 225, y: 226, fill: '#b00' }); tB.textContent = 'B（裏向き）'; svg.appendChild(tB);
      if (scene.phase === 'charge') {
        // 充電後の電荷：上の極板が ＋、下の極板が −。
        const tQ1 = el('text', { x: 296, y: 128, fill: '#b00' }); tQ1.textContent = '＋0.50 C'; svg.appendChild(tQ1);
        const tQ2 = el('text', { x: 250, y: 172, fill: 'blue' }); tQ2.textContent = '−0.50 C'; svg.appendChild(tQ2);
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = '棒の速さは 2.0 m/s → 1.0 m/s に落ちる'; svg.appendChild(tN);
      } else {
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'B=1.0 T（裏向き）、棒 m=0.50 kg'; svg.appendChild(tN);
      }
    }
  } else if (scene.type === 'capSpringGrav') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'charge' ? '電池をつなぐ：静電気力が下に引く'
      : scene.phase === 'shm' ? 'つり合いのまわりで単振動する'
      : scene.phase === 'graph' ? '正味の力 G(d)：つり合いと安定性'
      : scene.phase === 'trap' ? '罠：電圧を上げすぎると吸いつく'
      : '電池なし：ばねと重力だけのつり合い';
    svg.appendChild(tH);
    if (scene.phase === 'graph') {
      // G(d) = k(d_nat−d) − mg − C_e/d² のグラフ。d=1.5〜5.0 mm、G=−0.06〜+0.06 N。
      const xOf = (dMm) => 60 + (dMm - 1.5) * (280 / 3.5);
      const yOf = (gN) => 240 - (gN + 0.06) * (180 / 0.12);
      const gOf = (dMm) => scene.kNm * (scene.dNatMm - dMm) * 1e-3 - d.mgN - d.cE / ((dMm * 1e-3) * (dMm * 1e-3));
      svg.appendChild(el('line', { x1: 60, y1: 240, x2: 340, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: 60, y1: 60, x2: 60, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: 60, y1: yOf(0), x2: 340, y2: yOf(0), stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      let pth = '';
      for (let i = 0; i <= 70; i++) {
        const dMm = 1.5 + (i / 70) * 3.5;
        pth += (pth ? ' L ' : 'M ') + xOf(dMm).toFixed(1) + ' ' + yOf(gOf(dMm)).toFixed(1);
      }
      svg.appendChild(el('path', { d: pth, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      const tG = el('text', { x: 48, y: 56 }); tG.textContent = 'G'; svg.appendChild(tG);
      const tD = el('text', { x: 344, y: 244 }); tD.textContent = 'd'; svg.appendChild(tD);
      const t0 = el('text', { x: 64, y: yOf(0) - 6, fill: '#555' }); t0.textContent = 'G=0'; svg.appendChild(t0);
      // 安定なつり合い（d1）と不安定なつり合い（d_u）の目印。
      for (const [dMm, label, lx, ly] of [
        [d.d1M * 1e3, '安定 d≈3.2 mm', xOf(d.d1M * 1e3) + 6, yOf(0) - 12],
        [d.dUnstableM * 1e3, '不安定 d≈2.0 mm', xOf(d.dUnstableM * 1e3) + 6, yOf(0) + 22],
      ]) {
        svg.appendChild(el('circle', { cx: xOf(dMm), cy: yOf(0), r: 4, fill: '#b00', stroke: '#333', 'stroke-width': 1 }));
        const tL = el('text', { x: lx, y: ly, fill: '#b00' }); tL.textContent = label; svg.appendChild(tL);
      }
      const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'G=0 がつり合い。傾きが負なら安定'; svg.appendChild(tN);
      const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = '安定 3.2 mm、不安定 2.0 mm'; svg.appendChild(tN2);
    } else {
      // ばね（天井 y=60 から上極板まで、ジグザグは長さから計算）と 2 枚の極板。
      const plateY = scene.phase === 'trap' ? d.lowerY
        : scene.phase === 'charge' ? d.plateY1
        : scene.phase === 'shm' ? d.plateY0 : d.plateY0;
      svg.appendChild(el('line', { x1: 120, y1: 60, x2: 280, y2: 60, stroke: '#333', 'stroke-width': 3 }));
      let zig = '';
      const nSeg = 12;
      for (let i = 0; i <= nSeg; i++) {
        const y = 60 + ((plateY - 60) * i) / nSeg;
        const x = i === 0 || i === nSeg ? 200 : (i % 2 === 1 ? 188 : 212);
        zig += (zig ? ' L ' : 'M ') + x + ' ' + y.toFixed(1);
      }
      svg.appendChild(el('path', { d: zig, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 120, y1: plateY, x2: 280, y2: plateY, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 120, y1: d.lowerY, x2: 280, y2: d.lowerY, stroke: '#333', 'stroke-width': 3 }));
      const s1 = el('text', { x: 130, y: plateY - 8, fill: '#b00', 'font-size': 18 }); s1.textContent = '＋'; svg.appendChild(s1);
      const s2 = el('text', { x: 130, y: d.lowerY + 24, fill: '#b00', 'font-size': 18 }); s2.textContent = '－'; svg.appendChild(s2);
      // 電圧の表示は左の空きに置く（右側は力のラベルと重なるため）。
      const tV = el('text', { x: 40, y: 100 }); tV.textContent = scene.phase === 'trap' ? 'V=4000 V' : scene.phase === 'base' ? '電池なし' : 'V=3000 V'; svg.appendChild(tV);
      if (scene.phase !== 'trap') {
        // 板間隔 d の目印（破線）。ラベルは下極板の下に中央寄せで置く（力のラベルと重ならない）。
        svg.appendChild(el('line', { x1: 310, y1: plateY, x2: 310, y2: d.lowerY, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
        const tD = el('text', { x: 310, y: 212, 'text-anchor': 'middle' }); tD.textContent = scene.phase === 'charge' ? 'd≈3.2 mm' : 'd=4.0 mm'; svg.appendChild(tD);
      }
      if (scene.phase === 'shm') {
        // つり合い位置（破線）と振幅の目印。ラベルは左の空きに置く。
        svg.appendChild(el('line', { x1: 120, y1: d.plateY1, x2: 280, y2: d.plateY1, stroke: '#b00', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
        const tE = el('text', { x: 40, y: d.plateY1 + 4, fill: '#b00' }); tE.textContent = 'つり合い'; svg.appendChild(tE);
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'つり合いのまわりで単振動'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'ω≈52 rad/s、T≈0.12 s、振幅 0.76 mm'; svg.appendChild(tN2);
      } else if (scene.phase === 'trap') {
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'V=4000 V ではつり合いがなくなる'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = '極板が吸いついてしまう'; svg.appendChild(tN2);
      } else if (scene.phase === 'charge') {
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'ばね 0.28 N ＝ 重力＋静電気力'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'd≈3.2 mm、F≈0.076 N'; svg.appendChild(tN2);
      } else {
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'ばね 0.20 N ＝ 重力 0.20 N'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'd=4.0 mm、ω0≈71 rad/s、T0≈0.089 s'; svg.appendChild(tN2);
      }
    }
  } else if (scene.type === 'gasSpringCycle') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'expand' ? '加熱：ピストンが上がり、ばねが縮む'
      : scene.phase === 'lock' ? 'ピストンを固定して冷やす'
      : scene.phase === 'return' ? '等温圧縮：T=300 K のままゆっくり戻す'
      : scene.phase === 'trap' ? 'p–V 図：囲まれた面積が正味の仕事'
      : 'はじめ：ばねは自然長、p=1.10×10⁵ Pa';
    svg.appendChild(tH);
    if (scene.phase === 'trap') {
      // p–V 図：A(2.0, 1.10)、B(3.0, 1.20)、C(3.0, 0.733)、C→A は等温線 p=2.20/V。
      const pts = [[2.0, 1.10], [3.0, 1.20], [3.0, 0.7333]];
      let poly = '';
      for (const [vL, p] of pts) poly += (poly ? ' L ' : 'M ') + d.pvX(vL).toFixed(1) + ' ' + d.pvY(p).toFixed(1);
      for (let i = 1; i <= 40; i++) {
        const vL = 3.0 - (i / 40) * 1.0;
        poly += ' L ' + d.pvX(vL).toFixed(1) + ' ' + d.pvY(2.20 / vL).toFixed(1);
      }
      poly += ' Z';
      svg.appendChild(el('path', { d: poly, fill: '#e8f4ff', stroke: 'none' }));
      svg.appendChild(el('line', { x1: 60, y1: 240, x2: 340, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: 60, y1: 60, x2: 60, y2: 240, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: d.pvX(2.0), y1: d.pvY(1.10), x2: d.pvX(3.0), y2: d.pvY(1.20), stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: d.pvX(3.0), y1: d.pvY(1.20), x2: d.pvX(3.0), y2: d.pvY(0.7333), stroke: '#333', 'stroke-width': 2 }));
      let curve = '';
      for (let i = 0; i <= 40; i++) {
        const vL = 2.0 + (i / 40) * 1.0;
        curve += (curve ? ' L ' : 'M ') + d.pvX(vL).toFixed(1) + ' ' + d.pvY(2.20 / vL).toFixed(1);
      }
      svg.appendChild(el('path', { d: curve, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      for (const [vL, p, label, lx, ly] of [
        [2.0, 1.10, 'A', d.pvX(2.0) - 14, d.pvY(1.10) - 8],
        [3.0, 1.20, 'B', d.pvX(3.0) + 8, d.pvY(1.20) - 8],
        [3.0, 0.7333, 'C', d.pvX(3.0) + 8, d.pvY(0.7333) + 4],
      ]) {
        svg.appendChild(el('circle', { cx: d.pvX(vL), cy: d.pvY(p), r: 4, fill: '#b00', stroke: '#333', 'stroke-width': 1 }));
        const tL = el('text', { x: lx, y: ly }); tL.textContent = label; svg.appendChild(tL);
      }
      const tX = el('text', { x: 344, y: 244 }); tX.textContent = 'V'; svg.appendChild(tX);
      const tY = el('text', { x: 48, y: 56 }); tY.textContent = 'p'; svg.appendChild(tY);
      const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = '囲まれた面積＝正味の仕事 25.8 J'; svg.appendChild(tN);
      const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = '効率 η = 25.8/325 ≈ 7.9%'; svg.appendChild(tN2);
    } else {
      // シリンダーとピストンとばね。ピストン高さで位置が決まる。
      const pistonY = scene.phase === 'expand' || scene.phase === 'lock' ? d.pistonYB
        : scene.phase === 'return' ? d.pistonY(0.25) : d.pistonYA;
      svg.appendChild(el('line', { x1: 120, y1: 40, x2: 120, y2: 260, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 280, y1: 40, x2: 280, y2: 260, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: 120, y1: 260, x2: 280, y2: 260, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('rect', { x: 120, y: pistonY, width: 160, height: 260 - pistonY, fill: '#e8f4ff', stroke: 'none' }));
      // ばね（上）：天井 y=40 からピストンまで。ジグザグは長さから計算する。
      let zig = '';
      const nSeg = 12;
      for (let i = 0; i <= nSeg; i++) {
        const y = 40 + ((pistonY - 6 - 40) * i) / nSeg;
        const x = i === 0 || i === nSeg ? 200 : (i % 2 === 1 ? 188 : 212);
        zig += (zig ? ' L ' : 'M ') + x + ' ' + y.toFixed(1);
      }
      svg.appendChild(el('path', { d: zig, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: 116, y: pistonY - 6, width: 168, height: 12, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const tP = el('text', { x: 288, y: pistonY + 4 }); tP.textContent = 'ピストン'; svg.appendChild(tP);
      // 「気体」は下の注記と重ならないよう、底から少し上に置く。
      const tG = el('text', { x: 180, y: 240 }); tG.textContent = '気体'; svg.appendChild(tG);
      // 「大気圧 p0」は見出しと重ならないよう、ばねの右側に置く。
      const tA = el('text', { x: 230, y: 80 }); tA.textContent = '大気圧 p0'; svg.appendChild(tA);
      const tS = el('text', { x: 212, y: 52 }); tS.textContent = 'ばね'; svg.appendChild(tS);
      // 高さ h の目印（破線）。ラベルはピストンの少し下に置く（力のラベルと重ならない）。
      svg.appendChild(el('line', { x1: 310, y1: pistonY, x2: 310, y2: 260, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      const tH2 = el('text', { x: 316, y: pistonY + 20 }); tH2.textContent = scene.phase === 'expand' || scene.phase === 'lock' ? 'h=0.30 m' : scene.phase === 'return' ? 'h=0.25 m' : 'h=0.20 m'; svg.appendChild(tH2);
      if (scene.phase === 'lock') {
        // 留め具：シリンダーの壁に止める金具。
        svg.appendChild(el('rect', { x: 108, y: pistonY - 8, width: 12, height: 16, fill: '#888', stroke: '#333', 'stroke-width': 1 }));
        svg.appendChild(el('rect', { x: 280, y: pistonY - 8, width: 12, height: 16, fill: '#888', stroke: '#333', 'stroke-width': 1 }));
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'V=3.0 L のまま T=300 K まで冷やす'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'p=0.73×10⁵ Pa、W=0、Q=−210 J'; svg.appendChild(tN2);
      } else if (scene.phase === 'expand') {
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'p=1.10→1.20×10⁵ Pa、T=300→491 K'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'W=115 J、ΔU=210 J、Q=325 J'; svg.appendChild(tN2);
      } else if (scene.phase === 'return') {
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = '等温圧縮：T=300 K のまま戻す'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'W=−89.2 J、ΔU=0、Q=−89.2 J'; svg.appendChild(tN2);
      } else {
        const tN = el('text', { x: 40, y: 258, fill: '#555' }); tN.textContent = 'p=1.10×10⁵ Pa、V=2.0 L、T=300 K'; svg.appendChild(tN);
        const tN2 = el('text', { x: 40, y: 280, fill: '#555' }); tN2.textContent = 'ばねは自然長（力は 0）'; svg.appendChild(tN2);
      }
    }
  } else if (scene.type === 'capacitor') {
    const topY = 110, dPx = scene.dPx;
    // 2枚の極板（水平）。上板が +、下板が −。
    svg.appendChild(el('line', { x1: 120, y1: topY, x2: 280, y2: topY, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 120, y1: topY + dPx, x2: 280, y2: topY + dPx, stroke: '#333', 'stroke-width': 3 }));
    const s1 = el('text', { x: 130, y: topY - 8, fill: '#b00', 'font-size': 18 }); s1.textContent = '＋'; svg.appendChild(s1);
    const s2 = el('text', { x: 130, y: topY + dPx + 20, fill: '#b00', 'font-size': 18 }); s2.textContent = '－'; svg.appendChild(s2);
    const tP = el('text', { x: 286, y: topY - 8 }); tP.textContent = '極板'; svg.appendChild(tP);
    // 極板間隔 d の目印（破線）。引力の矢印は x=285 にあるので、こちらは x=330 にずらす。
    svg.appendChild(el('line', { x1: 330, y1: topY, x2: 330, y2: topY + dPx, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    const tD = el('text', { x: 336, y: topY + dPx / 2 + 4 }); tD.textContent = 'd'; svg.appendChild(tD);
    // 場面の説明（何が一定か）。数字は HTML の文章側にもある。
    const ph = el('text', { x: 40, y: 36, fill: '#555' });
    ph.textContent = scene.phase === 'initial' ? 'はじめ：電池 10 V につないだ状態'
      : scene.phase === 'connected' ? '電池につないだまま d を 2 倍に（V 一定）'
      : '電池を切り離してから d を 2 倍に（Q 一定）';
    svg.appendChild(ph);
  } else if (scene.type === 'circle') {
    const c = scene.center, rPx = scene.rPx;
    if (scene.phase === 'horizontal') {
      // 水平面内の円運動（真上から見た図）。床はなめらかで、重力と垂直抗力はつり合って見えない。
      svg.appendChild(el('circle', { cx: c.x, cy: c.y, r: rPx, fill: 'none', stroke: '#333', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
      const tO = el('text', { x: c.x - 60, y: c.y - rPx - 10 }); tO.textContent = '円の軌道（真上から見る）'; svg.appendChild(tO);
      // 糸：中心から粒子まで。
      svg.appendChild(el('line', { x1: c.x, y1: c.y, x2: scene.pos.x, y2: scene.pos.y, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: scene.pos.x, cy: scene.pos.y, r: 8, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tC = el('text', { x: c.x + 8, y: c.y - 8 }); tC.textContent = '中心'; svg.appendChild(tC);
    } else {
      // 鉛直面内のループ（横から見る）。円のレール。
      svg.appendChild(el('circle', { cx: c.x, cy: c.y, r: rPx, fill: 'none', stroke: '#333', 'stroke-width': 3 }));
      const tL = el('text', { x: c.x + rPx + 8, y: c.y + 4 }); tL.textContent = 'ループ'; svg.appendChild(tL);
      svg.appendChild(el('circle', { cx: scene.pos.x, cy: scene.pos.y, r: 8, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tP = el('text', { x: scene.pos.x + 12, y: scene.pos.y - 10 }); tP.textContent = scene.phase === 'top' ? '頂点' : '最下点'; svg.appendChild(tP);
      if (scene.phase === 'top') {
        const tN = el('text', { x: scene.pos.x - 120, y: scene.pos.y + 4, fill: '#555' }); tN.textContent = '垂直抗力 N = 0'; svg.appendChild(tN);
      }
    }
  } else if (scene.type === 'shm') {
    if (scene.phase === 'pendulum') {
      const p = scene.pivot, pos = scene.pos;
      // 支点と糸とおもり。糸の長さは計算値から（L=1.0 m → 200px）。
      svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 5, fill: '#333' }));
      const tP = el('text', { x: p.x + 10, y: p.y - 8 }); tP.textContent = '支点'; svg.appendChild(tP);
      svg.appendChild(el('line', { x1: p.x, y1: p.y, x2: pos.x, y2: pos.y, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: pos.x, cy: pos.y, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      // 鉛直線（破線）と振れ角 θ の弧。θ が図にない、という誤りを防ぐために必ず描く。
      svg.appendChild(el('line', { x1: p.x, y1: p.y, x2: p.x, y2: p.y + scene.lenPx, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      let d = '';
      for (let deg = 270; deg <= 270 + scene.thetaDeg; deg += 1) {
        const rad = deg2rad(deg);
        const x = (p.x + 38 * Math.cos(rad)).toFixed(1), y = (p.y + 38 * Math.sin(rad)).toFixed(1);
        d += (d ? ' L ' : 'M ') + x + ' ' + y;
      }
      svg.appendChild(el('path', { d, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
      const th = el('text', { x: p.x + 14, y: p.y + 52 }); th.textContent = 'θ'; svg.appendChild(th);
    } else {
      const eqX = scene.eqX, cy = scene.cy;
      // 水平なばね：左の壁からおもりまで。つり合い位置に目印の破線。
      svg.appendChild(el('line', { x1: 60, y1: 120, x2: 60, y2: 240, stroke: '#333', 'stroke-width': 3 }));
      const tW = el('text', { x: 30, y: 112 }); tW.textContent = '壁'; svg.appendChild(tW);
      const massX = scene.pos.x;
      let d = 'M 60 ' + cy;
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const x = 60 + ((massX - 20 - 60) * i) / steps;
        const y = i === steps ? cy : (i % 2 === 1 ? cy - 12 : cy + 12);
        d += ' L ' + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      svg.appendChild(el('path', { d, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: eqX, y1: cy - 40, x2: eqX, y2: cy + 40, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      const tE = el('text', { x: eqX - 34, y: cy + 56 }); tE.textContent = 'つり合い位置'; svg.appendChild(tE);
      svg.appendChild(el('rect', { x: massX - 20, y: cy - 20, width: 40, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      if (scene.phase === 'spring-max') {
        const tz = el('text', { x: massX - 14, y: cy - 28 }); tz.textContent = 'v = 0'; svg.appendChild(tz);
      } else if (scene.phase === 'spring-eq') {
        const tz = el('text', { x: massX - 34, y: cy - 28 }); tz.textContent = 'ばねの力 0'; svg.appendChild(tz);
      }
      svg.appendChild(el('line', { x1: 60, y1: 240, x2: 380, y2: 240, stroke: '#333', 'stroke-width': 3 }));
      const tf = el('text', { x: 300, y: 265 }); tf.textContent = '床（なめらか）'; svg.appendChild(tf);
    }
  } else if (scene.type === 'collision') {
    const cy = scene.cy, floorY = 240;
    svg.appendChild(el('line', { x1: 40, y1: floorY, x2: 380, y2: floorY, stroke: '#333', 'stroke-width': 3 }));
    const tf = el('text', { x: 300, y: floorY + 22 }); tf.textContent = '床（なめらか）'; svg.appendChild(tf);
    const block = (cx, label) => {
      svg.appendChild(el('rect', { x: cx - 20, y: cy - 20, width: 40, height: 40, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const t = el('text', { x: cx - 6, y: cy + 5 }); t.textContent = label; svg.appendChild(t);
    };
    if (scene.phase === 'before') {
      block(110, 'A'); block(220, 'B');
      const tz = el('text', { x: 206, y: 180 }); tz.textContent = 'v = 0'; svg.appendChild(tz);
    } else if (scene.phase === 'elastic') {
      block(180, 'A'); block(260, 'B');
    } else {
      // 合体：2つの箱をくっつけて1つに描く。
      svg.appendChild(el('rect', { x: 180, y: cy - 20, width: 80, height: 40, fill: '#ffe1c2', stroke: '#333', 'stroke-width': 2 }));
      const t = el('text', { x: 214, y: cy + 5 }); t.textContent = 'A+B'; svg.appendChild(t);
    }
  } else if (scene.type === 'gravitation') {
    const c = scene.center, rPx = scene.orbitPx, ePx = scene.earthPx;
    // 地球（半径は 120×R/r px）と軌道（破線の円）。衛星は軌道の真上に描く。
    svg.appendChild(el('circle', { cx: c.x, cy: c.y, r: rPx, fill: 'none', stroke: '#333', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
    svg.appendChild(el('circle', { cx: c.x, cy: c.y, r: ePx, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    const tE = el('text', { x: c.x + ePx + 8, y: c.y + 4 }); tE.textContent = '地球'; svg.appendChild(tE);
    const tR = el('text', { x: c.x + rPx - 30, y: c.y + 16, fill: '#555' }); tR.textContent = '軌道半径 r'; svg.appendChild(tR);
    svg.appendChild(el('circle', { cx: scene.sat.x, cy: scene.sat.y, r: 8, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
    const tS = el('text', { x: scene.sat.x + 12, y: scene.sat.y - 6 }); tS.textContent = '人工衛星'; svg.appendChild(tS);
  } else if (scene.type === 'standingWave') {
    const x0 = scene.x0, span = scene.spanPx, yMid = scene.yMid, amp = scene.ampPx;
    // 波形：境界条件から計算する（弦・開管は sin/cos、閉管は sin(mπt/2)）。
    const shapeY = (t) => {
      if (scene.mode === 'string') return yMid - amp * Math.sin(scene.derived.harmonicM * Math.PI * t);
      if (scene.mode === 'open') return yMid - amp * Math.cos(scene.derived.harmonicM * Math.PI * t);
      return yMid - amp * Math.sin((scene.derived.harmonicM * Math.PI * t) / 2);
    };
    if (scene.mode === 'string') {
      svg.appendChild(el('line', { x1: x0, y1: yMid, x2: x0 + span, y2: yMid, stroke: '#333', 'stroke-width': 2 }));
      // 両端は固定端（壁の印）。
      svg.appendChild(el('line', { x1: x0, y1: yMid - 12, x2: x0, y2: yMid + 12, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('line', { x1: x0 + span, y1: yMid - 12, x2: x0 + span, y2: yMid + 12, stroke: '#333', 'stroke-width': 3 }));
      const tS = el('text', { x: x0, y: yMid - 52 }); tS.textContent = '弦（両端固定）'; svg.appendChild(tS);
    } else {
      // 気柱：管の枠。閉管は左端に壁、開管は両端が開いている。
      svg.appendChild(el('rect', { x: x0, y: yMid - 40, width: span, height: 80, fill: '#f2f6ff', stroke: '#333', 'stroke-width': 2 }));
      if (scene.mode === 'closed') {
        svg.appendChild(el('line', { x1: x0, y1: yMid - 40, x2: x0, y2: yMid + 40, stroke: '#333', 'stroke-width': 4 }));
        const tC = el('text', { x: x0, y: yMid - 52 }); tC.textContent = '閉管（左端は壁、右端は開いている）'; svg.appendChild(tC);
      } else {
        const tO = el('text', { x: x0, y: yMid - 52 }); tO.textContent = '開管（両端が開いている）'; svg.appendChild(tO);
      }
    }
    let d = '';
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const x = (x0 + t * span).toFixed(1), y = shapeY(t).toFixed(1);
      d += (d ? ' L ' : 'M ') + x + ' ' + y;
    }
    svg.appendChild(el('path', { d, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
    // 節の目印：赤い短い縦線。腹の目印：波の上の点。
    for (const nx of scene.nodesPx) {
      svg.appendChild(el('line', { x1: nx, y1: yMid - 10, x2: nx, y2: yMid + 10, stroke: '#b00', 'stroke-width': 2 }));
    }
    for (const ax of scene.antinodesPx) {
      const t = (ax - x0) / span;
      svg.appendChild(el('circle', { cx: ax, cy: shapeY(t), r: 4, fill: '#b00' }));
    }
    const tN = el('text', { x: scene.nodesPx[0] - 6, y: yMid + 26, fill: '#b00' }); tN.textContent = '節'; svg.appendChild(tN);
    const tA = el('text', { x: scene.antinodesPx[0] - 6, y: yMid + 26, fill: '#b00' }); tA.textContent = '腹'; svg.appendChild(tA);
  } else if (scene.type === 'photoelectric') {
    const px = scene.plateX;
    // 金属板（縦の板）。光は左から、電子は右へ出る。
    svg.appendChild(el('rect', { x: px - 4, y: 100, width: 8, height: 140, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    const tP = el('text', { x: px + 14, y: 92 }); tP.textContent = '金属板'; svg.appendChild(tP);
    const tS = el('text', { x: 40, y: 92 }); tS.textContent = '光源'; svg.appendChild(tS);
    if (!scene.derived.emitted) {
      const tX = el('text', { x: px + 30, y: 180, fill: '#b00' }); tX.textContent = '電子は出ない'; svg.appendChild(tX);
    }
  } else if (scene.type === 'heatCycle') {
    const c = scene.corners;
    // 軸：V が右、p が上。目盛りは V が 1・2・3（×10⁻³ m³）、p が 1・2・3（×10⁵ Pa）。
    svg.appendChild(el('line', { x1: 70, y1: 250, x2: 360, y2: 250, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: 70, y1: 20, x2: 70, y2: 250, stroke: '#333', 'stroke-width': 2 }));
    const tV = el('text', { x: 348, y: 272 }); tV.textContent = 'V'; svg.appendChild(tV);
    const tP = el('text', { x: 54, y: 28 }); tP.textContent = 'p'; svg.appendChild(tP);
    for (const [x, label] of [[140, '1'], [210, '2'], [280, '3']]) {
      svg.appendChild(el('line', { x1: x, y1: 250, x2: x, y2: 256, stroke: '#333', 'stroke-width': 1.5 }));
      const t = el('text', { x: x - 3, y: 268 }); t.textContent = label; svg.appendChild(t);
    }
    for (const [y, label] of [[200, '1'], [150, '2'], [100, '3']]) {
      svg.appendChild(el('line', { x1: 64, y1: y, x2: 70, y2: y, stroke: '#333', 'stroke-width': 1.5 }));
      const t = el('text', { x: 52, y: y + 4 }); t.textContent = label; svg.appendChild(t);
    }
    const tU = el('text', { x: 70, y: 288, fill: '#555' }); tU.textContent = 'V（×10⁻³ m³）、p（×10⁵ Pa）'; svg.appendChild(tU);
    // サイクルの長方形：phase が full のときだけ中を塗る（1 サイクルの仕事＝面積）。
    const pts = `${c.A.x},${c.A.y} ${c.D.x},${c.D.y} ${c.C.x},${c.C.y} ${c.B.x},${c.B.y}`;
    svg.appendChild(el('polygon', { points: pts, fill: scene.phase === 'full' ? '#fff3e0' : 'none', stroke: '#333', 'stroke-width': 2 }));
    for (const [key, lx, ly] of [['A', 148, 218], ['B', 288, 218], ['C', 288, 92], ['D', 112, 92]]) {
      svg.appendChild(el('circle', { cx: c[key].x, cy: c[key].y, r: 3, fill: '#333' }));
      const t = el('text', { x: lx, y: ly }); t.textContent = key; svg.appendChild(t);
    }
  } else if (scene.type === 'railRod') {
    // 磁場：レールのあいだに × 印（紙面の裏向き）。
    for (let gx = 110; gx <= 320; gx += 42) {
      for (const gy of [140, 180]) {
        const t = el('text', { x: gx, y: gy, fill: '#888', 'font-size': 16 }); t.textContent = '×'; svg.appendChild(t);
      }
    }
    const tB = el('text', { x: 96, y: 104, fill: '#555' }); tB.textContent = '磁場 B（裏向き）'; svg.appendChild(tB);
    // 2本のレールと、左端をつなぐ抵抗。
    svg.appendChild(el('line', { x1: 60, y1: 120, x2: 340, y2: 120, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 60, y1: 200, x2: 340, y2: 200, stroke: '#333', 'stroke-width': 3 }));
    const tR = el('text', { x: 296, y: 110 }); tR.textContent = 'レール'; svg.appendChild(tR);
    svg.appendChild(el('rect', { x: 52, y: 148, width: 16, height: 44, fill: '#fff', stroke: '#333', 'stroke-width': 2 }));
    const tRe = el('text', { x: 4, y: 176 }); tRe.textContent = '抵抗'; svg.appendChild(tRe);
    // 棒：レールの上にまたがる縦の板。
    svg.appendChild(el('rect', { x: 192, y: 120, width: 16, height: 80, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
    const tRod = el('text', { x: 216, y: 152 }); tRod.textContent = '棒'; svg.appendChild(tRod);
  } else if (scene.type === 'doppler') {
    const cx = 200, cy = 180, d = scene.derived;
    // 基準線（音の進む向き）と音源・観測者。
    svg.appendChild(el('line', { x1: 40, y1: cy, x2: 360, y2: cy, stroke: '#333', 'stroke-width': 1.5 }));
    svg.appendChild(el('circle', { cx, cy, r: 7, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
    const tS = el('text', { x: 178, y: 162 }); tS.textContent = '音源'; svg.appendChild(tS);
    svg.appendChild(el('circle', { cx: 320, cy, r: 7, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
    const tO = el('text', { x: 296, y: 162 }); tO.textContent = '観測者'; svg.appendChild(tO);
    // 波の弧：半円を小さな線分で描く（右側と左側で間隔が違うため、円では描けない）。
    const arc = (r, fromDeg, toDeg) => {
      let path = '';
      for (let deg = fromDeg; deg <= toDeg; deg += 5) {
        const rad = deg2rad(deg);
        const x = (cx + r * Math.cos(rad)).toFixed(1), y = (cy + r * Math.sin(rad)).toFixed(1);
        path += (path ? ' L ' : 'M ') + x + ' ' + y;
      }
      svg.appendChild(el('path', { d: path, fill: 'none', stroke: '#888', 'stroke-width': 1.5 }));
    };
    if (scene.phase === 'beats') {
      // うなり：強くなる時刻の目印（周期 0.25 s ごとに 70 px）。
      for (let k = 0; k <= 4; k++) {
        const x = 60 + k * d.beatPx;
        svg.appendChild(el('line', { x1: x, y1: 150, x2: x, y2: 210, stroke: '#b00', 'stroke-width': 2 }));
      }
      const tB = el('text', { x: 60, y: 138, fill: '#b00' }); tB.textContent = 'うなり：強くなるところ'; svg.appendChild(tB);
      const tN = el('text', { x: 60, y: 120, fill: '#555' }); tN.textContent = 'うなり 4.0 Hz（0.25 s ごと）'; svg.appendChild(tN);
    } else if (scene.phase === 'approach' || scene.phase === 'reflect') {
      for (let k = 1; k <= 3; k++) arc(k * d.approachPx, -90, 90); // 右側：間隔が 0.90 倍に縮む
      for (let k = 1; k <= 3; k++) arc(k * d.recedePx, 90, 270); // 左側：間隔が 1.10 倍に伸びる
    } else {
      // base / observer：音源が静止しているので、波の間隔は左右で等しい。
      for (let k = 1; k <= 3; k++) {
        svg.appendChild(el('circle', { cx, cy, r: k * d.basePx, fill: 'none', stroke: '#888', 'stroke-width': 1.5 }));
      }
    }
    if (scene.phase === 'reflect') {
      svg.appendChild(el('line', { x1: 340, y1: 100, x2: 340, y2: 260, stroke: '#333', 'stroke-width': 3 }));
      const tW = el('text', { x: 318, y: 92 }); tW.textContent = '壁'; svg.appendChild(tW);
    }
  } else if (scene.type === 'dcCircuit') {
    // 回路図：電池は左、R1 は上の配線、R2・R3 は並列の縦の枝。電流矢印の長さは電流から計算する。
    const ph = el('text', { x: 40, y: 36, fill: '#555' });
    ph.textContent = scene.phase === 'current' ? '電流の分かれ方：I = I2 + I3'
      : scene.phase === 'power' ? '電力：電池 16 W = ジュール熱の和'
      : '回路全体：電池 12 V、内部抵抗 1.0 Ω';
    svg.appendChild(ph);
    const zigzagH = (x1, x2, y) => {
      let d = `M ${x1} ${y}`;
      const n = 6, w = (x2 - x1) / n;
      for (let i = 1; i < n; i++) d += ` L ${(x1 + w * i).toFixed(1)} ${(i % 2 === 1 ? y - 8 : y + 8)}`;
      return d + ` L ${x2} ${y}`;
    };
    const zigzagV = (y1, y2, x) => {
      let d = `M ${x} ${y1}`;
      const n = 6, h = (y2 - y1) / n;
      for (let i = 1; i < n; i++) d += ` L ${(i % 2 === 1 ? x - 8 : x + 8)} ${(y1 + h * i).toFixed(1)}`;
      return d + ` L ${x} ${y2}`;
    };
    // 配線：上の線 y=120、下の線 y=200、電池は x=60 の縦の部分。
    svg.appendChild(el('line', { x1: 60, y1: 120, x2: 280, y2: 120, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: 60, y1: 200, x2: 280, y2: 200, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: 60, y1: 120, x2: 60, y2: 140, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: 60, y1: 160, x2: 60, y2: 200, stroke: '#333', 'stroke-width': 2 }));
    // 電池：長い板が +、短い板が −。
    svg.appendChild(el('line', { x1: 48, y1: 140, x2: 72, y2: 140, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 54, y1: 160, x2: 66, y2: 160, stroke: '#333', 'stroke-width': 3 }));
    const tPlus = el('text', { x: 76, y: 144 }); tPlus.textContent = '＋'; svg.appendChild(tPlus);
    const tMinus = el('text', { x: 76, y: 164 }); tMinus.textContent = '－'; svg.appendChild(tMinus);
    const tB = el('text', { x: 80, y: 186 }); tB.textContent = '電池 12 V'; svg.appendChild(tB);
    // 内部抵抗 r（下の配線）と R1（上の配線）はジグザグで描く。
    svg.appendChild(el('path', { d: zigzagH(90, 120, 200), fill: 'none', stroke: '#333', 'stroke-width': 2 }));
    const tR = el('text', { x: 84, y: 224 }); tR.textContent = 'r = 1.0 Ω'; svg.appendChild(tR);
    svg.appendChild(el('path', { d: zigzagH(130, 170, 120), fill: 'none', stroke: '#333', 'stroke-width': 2 }));
    const t1 = el('text', { x: 126, y: 142 }); t1.textContent = 'R1 = 4.0 Ω'; svg.appendChild(t1);
    // 並列の枝：R2（x=210）、R3（x=280）。分岐点に黒点。
    for (const bx of [210, 280]) {
      svg.appendChild(el('line', { x1: bx, y1: 120, x2: bx, y2: 140, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: bx, y1: 180, x2: bx, y2: 200, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('path', { d: zigzagV(140, 180, bx), fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: bx, cy: 120, r: 3, fill: '#333' }));
      svg.appendChild(el('circle', { cx: bx, cy: 200, r: 3, fill: '#333' }));
    }
    const t2 = el('text', { x: 216, y: 192 }); t2.textContent = 'R2'; svg.appendChild(t2);
    const t3 = el('text', { x: 286, y: 192 }); t3.textContent = 'R3'; svg.appendChild(t3);
  } else if (scene.type === 'refractionLens') {
    const d = scene.derived;
    const ph = el('text', { x: 40, y: 36, fill: '#555' });
    ph.textContent = scene.phase === 'refract' ? '空気 → ガラス：入射角 60°'
      : scene.phase === 'total' ? 'ガラス → 空気：入射角 50° > 臨界角 41.8°'
      : scene.phase === 'real' ? '凸レンズ：a = 15 cm（実像）'
      : '凸レンズ：a = 5 cm（虚像）';
    svg.appendChild(ph);
    // 角度の弧は、中心と半径と角度から点列で描く（角度は計算値）。
    const arc = (cx, cy, r, degFrom, degTo) => {
      let p = '';
      for (let deg = degFrom; deg <= degTo; deg += 2) {
        const rad = deg2rad(deg);
        const x = (cx + r * Math.cos(rad)).toFixed(1), y = (cy + r * Math.sin(rad)).toFixed(1);
        p += (p ? ' L ' : 'M ') + x + ' ' + y;
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
    };
    if (scene.phase === 'refract' || scene.phase === 'total') {
      // 境界面 y=180、法線は破線の縦線。角度は法線から測る。
      svg.appendChild(el('line', { x1: 40, y1: 180, x2: 360, y2: 180, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 200, y1: 60, x2: 200, y2: 270, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      const tA = el('text', { x: 300, y: 60 }); tA.textContent = '空気'; svg.appendChild(tA);
      const tG = el('text', { x: 300, y: 288 }); tG.textContent = 'ガラス'; svg.appendChild(tG);
      if (scene.phase === 'refract') {
        arc(200, 180, 40, 210, 270); // 入射角 60° の弧（法線の左上）
        const th1 = el('text', { x: 168, y: 134 }); th1.textContent = 'θ1'; svg.appendChild(th1);
        arc(200, 180, 30, 54.7, 90); // 屈折角 35.3° の弧（法線の右下）
        const th2 = el('text', { x: 210, y: 226 }); th2.textContent = 'θ2'; svg.appendChild(th2);
      } else {
        arc(200, 180, 40, 90, 140); // 入射角 50° の弧（法線の左下）
        const th1 = el('text', { x: 172, y: 232 }); th1.textContent = 'θ'; svg.appendChild(th1);
        arc(200, 180, 40, 40, 90); // 反射角 50° の弧（法線の右下）
        const th2 = el('text', { x: 220, y: 232 }); th2.textContent = 'θ'; svg.appendChild(th2);
        const tN = el('text', { x: 40, y: 60, fill: '#555' }); tN.textContent = '屈折光は出ない（全反射）'; svg.appendChild(tN);
      }
    } else {
      // レンズ：光軸 y=180、レンズは x=200 の縦線（両端に矢印）。
      const objH = 30, imgH = Math.abs(d.mReal) * objH; // 像の高さは倍率×物体の高さ
      const real = scene.phase === 'real';
      const objX = real ? d.objRealX : d.objVirtualX;
      const imgX = real ? d.imgRealX : d.imgVirtualX;
      svg.appendChild(el('line', { x1: 40, y1: 180, x2: 380, y2: 180, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: 200, y1: 100, x2: 200, y2: 260, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('path', { d: 'M 192 112 L 200 100 L 208 112', fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('path', { d: 'M 192 248 L 200 260 L 208 248', fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      const tL = el('text', { x: 208, y: 96 }); tL.textContent = 'レンズ'; svg.appendChild(tL);
      for (const fx of [d.focalX1, d.focalX2]) {
        svg.appendChild(el('line', { x1: fx, y1: 172, x2: fx, y2: 188, stroke: '#333', 'stroke-width': 2 }));
        const tF = el('text', { x: fx - 4, y: 200 }); tF.textContent = 'F'; svg.appendChild(tF);
      }
      // 物体の矢印（上向き）と像の矢印（実像は下向き・実線、虚像は上向き・破線）。
      svg.appendChild(el('line', { x1: objX, y1: 180, x2: objX, y2: 180 - objH, stroke: '#b00', 'stroke-width': 3 }));
      const tO = el('text', { x: objX - 30, y: 140 }); tO.textContent = '物体'; svg.appendChild(tO);
      if (real) {
        svg.appendChild(el('line', { x1: imgX, y1: 180, x2: imgX, y2: 180 + imgH, stroke: '#b00', 'stroke-width': 3 }));
        const tI = el('text', { x: imgX - 40, y: 258 }); tI.textContent = '実像'; svg.appendChild(tI);
        // 3本の主光線：平行光線・中心を通る光線・焦点を通る光線（位置は計算値）。
        svg.appendChild(el('polyline', { points: `${objX},${180 - objH} 200,${180 - objH} ${imgX},${180 + imgH}`, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
        svg.appendChild(el('line', { x1: objX, y1: 180 - objH, x2: imgX, y2: 180 + imgH, stroke: '#333', 'stroke-width': 1.5 }));
        svg.appendChild(el('polyline', { points: `${objX},${180 - objH} 200,${180 + imgH} ${imgX},${180 + imgH}`, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
      } else {
        svg.appendChild(el('line', { x1: imgX, y1: 180, x2: imgX, y2: 180 - imgH, stroke: '#b00', 'stroke-width': 3, 'stroke-dasharray': '5 4' }));
        const tI = el('text', { x: imgX + 6, y: 116 }); tI.textContent = '虚像'; svg.appendChild(tI);
        // 2本の主光線（実線）と、虚像へ戻る延長線（破線）。延長線は像の頂点で交わる。
        svg.appendChild(el('polyline', { points: `${objX},${180 - objH} 200,${180 - objH} ${imgX + 240},${180 + imgH}`, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
        svg.appendChild(el('line', { x1: objX, y1: 180 - objH, x2: 320, y2: 300, stroke: '#333', 'stroke-width': 1.5 }));
        svg.appendChild(el('line', { x1: 200, y1: 180 - objH, x2: imgX, y2: 180 - imgH, stroke: '#b00', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
        svg.appendChild(el('line', { x1: 200, y1: 180, x2: imgX, y2: 180 - imgH, stroke: '#b00', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      }
    }
  } else if (scene.type === 'bohr') {
    const d = scene.derived;
    if (scene.phase === 'debroglie') {
      const cx = 200, cy = 170, r = 80;
      const ph = el('text', { x: 40, y: 36, fill: '#555' });
      ph.textContent = 'n=1：円周 2πr = λ（波が 1 個）';
      svg.appendChild(ph);
      // 軌道の円と、円周に沿う 1 波長の波（半径を sinθ でうねらせる）。
      svg.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#333', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      let p = '';
      for (let deg = 0; deg <= 360; deg += 3) {
        const rad = deg2rad(deg);
        const rr = r + 12 * Math.sin(rad);
        const x = (cx + rr * Math.cos(rad)).toFixed(1), y = (cy + rr * Math.sin(rad)).toFixed(1);
        p += (p ? ' L ' : 'M ') + x + ' ' + y;
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx, cy, r: 6, fill: '#333' }));
      const tN = el('text', { x: cx + 10, y: cy - 4 }); tN.textContent = '原子核'; svg.appendChild(tN);
      svg.appendChild(el('circle', { cx, cy: cy - r, r: 6, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tE = el('text', { x: cx + 10, y: cy - r - 4 }); tE.textContent = '電子'; svg.appendChild(tE);
      const tW = el('text', { x: 40, y: 284, fill: '#555' });
      tW.textContent = '波の振幅は見やすく誇張してある';
      svg.appendChild(tW);
    } else {
      // 見出しは n=1 の準位線（y=36）と重ならないよう、上へ出す。
      const ph = el('text', { x: 40, y: 20, fill: '#555' });
      ph.textContent = scene.phase === 'lyman' ? 'ライマン系列：n=2 → n=1' : 'エネルギー準位：E_n = −13.6/n² eV';
      svg.appendChild(ph);
      // 準位の横線：高さはエネルギー×15 px（E=0 が y=240）。
      for (const [ev, label] of [[d.e1, 'n=1'], [d.e2, 'n=2'], [d.e3, 'n=3']]) {
        const y = d.yE(ev);
        svg.appendChild(el('line', { x1: 80, y1: y, x2: 200, y2: y, stroke: '#333', 'stroke-width': 3 }));
        const t = el('text', { x: 210, y: y + 4 }); t.textContent = label + '（' + ev.toFixed(2) + ' eV）'; svg.appendChild(t);
      }
      svg.appendChild(el('line', { x1: 80, y1: 240, x2: 200, y2: 240, stroke: '#888', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
      const t0 = el('text', { x: 210, y: 244 }); t0.textContent = 'E = 0（イオン化）'; svg.appendChild(t0);
    }
  } else if (scene.type === 'kineticTheory') {
    const d = scene.derived;
    const boxW = scene.phase === 'half' ? 120 : 240;
    const x0 = 80, y0 = 90, boxH = 140;
    // 箱：幅 240 px が L=0.10 m。half の場面は幅 120 px（体積は半分）。
    svg.appendChild(el('rect', { x: x0, y: y0, width: boxW, height: boxH, fill: '#f2f6ff', stroke: '#333', 'stroke-width': 2 }));
    if (scene.phase === 'half') {
      // もとの箱の大きさを破線で残す（半分に縮んだことが分かる）。
      svg.appendChild(el('rect', { x: x0, y: y0, width: 240, height: boxH, fill: 'none', stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    }
    const tT = el('text', { x: x0, y: 76, fill: '#555' });
    tT.textContent = scene.phase === 'hot' ? 'T = 600 K（2 倍の温度）' : 'T = 300 K';
    svg.appendChild(tT);
    const tB = el('text', { x: x0 + boxW + 8, y: y0 + 20 }); tB.textContent = '壁'; svg.appendChild(tB);
    if (scene.phase === 'one') {
      // 1個の分子：右の壁に向かう。速度の矢印は forces（v_x / −v_x）で描く。
      svg.appendChild(el('circle', { cx: 260, cy: 160, r: 7, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tM = el('text', { x: 244, y: 140 }); tM.textContent = '分子'; svg.appendChild(tM);
      // 図下の説明は右端で切れないよう、左から短く書く。
      const tN = el('text', { x: 40, y: 272, fill: '#555' });
      tN.textContent = '壁で跳ね返る（速さは変わらない）';
      svg.appendChild(tN);
    } else {
      // 分子の集まり：位置と向きは固定（計算で決めたもの）。hot では矢印が √2 倍長い。
      const len = scene.phase === 'hot' ? 42 : 30;
      // 分子の位置は箱の幅に対する割合で決める（half では箱が狭いので自動的に密集する）。
      const fracs = [[0.10, 0.25, 30], [0.30, 0.75, -40], [0.55, 0.30, 120], [0.85, 0.75, 200], [0.40, 0.50, 80], [0.70, 0.20, -120]];
      for (const [fx, fy, ang] of fracs) {
        const px = x0 + fx * boxW, py = y0 + fy * boxH;
        const rad = deg2rad(ang);
        svg.appendChild(el('line', { x1: px, y1: py, x2: (px + len * Math.cos(rad)).toFixed(1), y2: (py + len * Math.sin(rad)).toFixed(1), stroke: '#d35400', 'stroke-width': 2, 'marker-end': 'url(#fig-arrow)' }));
        svg.appendChild(el('circle', { cx: px, cy: py, r: 5, fill: '#ffd24d', stroke: '#333', 'stroke-width': 1.5 }));
      }
      const tN = el('text', { x: 40, y: 272, fill: '#555' });
      tN.textContent = scene.phase === 'hot'
        ? '速さは√2倍、衝突の回数も増える'
        : scene.phase === 'half'
          ? '体積は半分、数は同じ（ぎゅうぎゅう）'
          : '分子はでたらめな向きに飛んでいる';
      svg.appendChild(tN);
    }
  } else if (scene.type === 'travellingWave') {
    const d = scene.derived;
    const x0 = d.x0Px, span = d.spanPx, yMid = d.yMid, amp = d.ampPx;
    // 横軸：波形の場面は x（m）、振動の場面は t（s）。
    svg.appendChild(el('line', { x1: 40, y1: yMid, x2: 360, y2: yMid, stroke: '#333', 'stroke-width': 1.5 }));
    if (scene.phase === 'vibration') {
      for (let k = 0; k <= 4; k++) {
        const x = x0 + k * (span / 4);
        svg.appendChild(el('line', { x1: x, y1: yMid - 4, x2: x, y2: yMid + 4, stroke: '#333', 'stroke-width': 1.5 }));
        const t = el('text', { x: x - 8, y: yMid + 22 }); t.textContent = ['0', '0.25', '0.5', '0.75', '1.0'][k]; svg.appendChild(t);
      }
      const tA = el('text', { x: 330, y: yMid + 40 }); tA.textContent = 't（s）'; svg.appendChild(tA);
      // x=0 の点の振動 y=A sin(2πt/T)：t=0〜1.0 s（2 周期）。
      let p = '';
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const x = (x0 + t * span).toFixed(1);
        const y = (yMid - amp * Math.sin(2 * Math.PI * t / scene.periodS)).toFixed(1);
        p += (p ? ' L ' : 'M ') + x + ' ' + y;
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      // t=0.25 s のラベルは、軸の目盛り（y=202）と重ならないよう、点の右上に出す。
      // 点の右側では波形が軸の下側を通るので、軸の上側は空いている。
      for (const [t, label, lx, ly] of [[0.125, 't=0.125 s：y=+A', 100, 128], [0.25, 't=0.25 s：y=0', 140, 160], [0.375, 't=0.375 s：y=−A', 168, 248]]) {
        const x = x0 + t * span, y = yMid - amp * Math.sin(2 * Math.PI * t / scene.periodS);
        svg.appendChild(el('circle', { cx: x, cy: y, r: 4, fill: '#b00' }));
        const tt = el('text', { x: lx, y: ly, fill: '#b00' }); tt.textContent = label; svg.appendChild(tt);
      }
      const tN = el('text', { x: 40, y: 36, fill: '#555' }); tN.textContent = 'x=0 の点の振動（横軸は時間）'; svg.appendChild(tN);
    } else {
      for (let k = 0; k <= 4; k++) {
        const x = x0 + k * (span / 4);
        svg.appendChild(el('line', { x1: x, y1: yMid - 4, x2: x, y2: yMid + 4, stroke: '#333', 'stroke-width': 1.5 }));
        const t = el('text', { x: x - 3, y: yMid + 22 }); t.textContent = String(k); svg.appendChild(t);
      }
      const tA = el('text', { x: 330, y: yMid + 40 }); tA.textContent = 'x（m）'; svg.appendChild(tA);
      // 波形 y=A sin 2π(t/T − x/λ)。t は JSON の tS。
      const wavePath = (t) => {
        let p = '';
        for (let i = 0; i <= 120; i++) {
          const x = (i / 120) * 4.0;
          const px = (x0 + (x / 4.0) * span).toFixed(1);
          const py = (yMid - amp * Math.sin(2 * Math.PI * (t / scene.periodS - x / scene.wavelengthM))).toFixed(1);
          p += (p ? ' L ' : 'M ') + px + ' ' + py;
        }
        return p;
      };
      if (scene.phase === 'moved') {
        // t=0 の波形を灰色の破線で残し、t=0.125 s の波形を赤で描く。
        svg.appendChild(el('path', { d: wavePath(0), fill: 'none', stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
        svg.appendChild(el('path', { d: wavePath(scene.tS), fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
        svg.appendChild(el('line', { x1: 60, y1: 120, x2: 95, y2: 120, stroke: '#333', 'stroke-width': 2, 'marker-end': 'url(#fig-arrow)' }));
        const tM = el('text', { x: 60, y: 108 }); tM.textContent = '0.50 m 右へ'; svg.appendChild(tM);
        const tN = el('text', { x: 40, y: 36, fill: '#555' }); tN.textContent = 'Δt=0.125 s で波は 0.50 m 進む'; svg.appendChild(tN);
      } else {
        svg.appendChild(el('path', { d: wavePath(scene.tS), fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
        if (scene.phase === 'phase') {
          // x=0 と x=0.50 m と x=1.0 m の点を打つ。
          for (const [xm, label, lx, ly] of [[0, 'x=0：y=0', 48, 160], [0.5, 'x=0.50 m：y=−A', 100, 248], [1.0, 'x=1.0 m：y=0', 120, 160]]) {
            const px = x0 + (xm / 4.0) * span;
            const py = yMid - amp * Math.sin(2 * Math.PI * (scene.tS / scene.periodS - xm / scene.wavelengthM));
            svg.appendChild(el('circle', { cx: px, cy: py, r: 4, fill: '#b00' }));
            const tt = el('text', { x: lx, y: ly, fill: '#b00' }); tt.textContent = label; svg.appendChild(tt);
          }
          const tN = el('text', { x: 40, y: 36, fill: '#555' }); tN.textContent = 't=0 の波形（横軸は位置）'; svg.appendChild(tN);
        } else {
          const tN = el('text', { x: 40, y: 36, fill: '#555' }); tN.textContent = 't=0 の波形：y=−A sin(2πx/λ)'; svg.appendChild(tN);
        }
      }
    }
  } else if (scene.type === 'coulombField') {
    const d = scene.derived;
    if (scene.phase === 'lines') {
      // 電気力線：＋から出て−に入る 3 本の曲線。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '電気力線：＋から出て−に入る'; svg.appendChild(tH);
      const cx1 = 120, cx2 = 300, cy = 180;
      svg.appendChild(el('circle', { cx: cx1, cy, r: 14, fill: '#ffcccc', stroke: '#b00', 'stroke-width': 2 }));
      const tP = el('text', { x: cx1 - 5, y: cy + 5, fill: '#b00', 'font-size': 16 }); tP.textContent = '+'; svg.appendChild(tP);
      svg.appendChild(el('circle', { cx: cx2, cy, r: 14, fill: '#cfe3ff', stroke: 'blue', 'stroke-width': 2 }));
      const tM = el('text', { x: cx2 - 5, y: cy + 5, fill: 'blue', 'font-size': 16 }); tM.textContent = '−'; svg.appendChild(tM);
      for (const bulge of [-55, 0, 55]) {
        let p = '';
        for (let i = 0; i <= 60; i++) {
          const t = i / 60;
          const x = (cx1 + t * (cx2 - cx1)).toFixed(1);
          const y = (cy + bulge * Math.sin(Math.PI * t)).toFixed(1);
          p += (p ? ' L ' : 'M ') + x + ' ' + y;
        }
        svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 1.5 }));
      }
      const tN = el('text', { x: 170, y: 280, fill: '#555' }); tN.textContent = '電場の向きは線の接線方向'; svg.appendChild(tN);
    } else if (scene.phase === 'dipole') {
      // ＋と−を 0.30 m（180 px）離す。中点に点を打つ。
      svg.appendChild(el('circle', { cx: 120, cy: 180, r: 14, fill: '#ffcccc', stroke: '#b00', 'stroke-width': 2 }));
      const tP = el('text', { x: 115, y: 185, fill: '#b00', 'font-size': 16 }); tP.textContent = '+'; svg.appendChild(tP);
      svg.appendChild(el('circle', { cx: 300, cy: 180, r: 14, fill: '#cfe3ff', stroke: 'blue', 'stroke-width': 2 }));
      const tM = el('text', { x: 295, y: 185, fill: 'blue', 'font-size': 16 }); tM.textContent = '−'; svg.appendChild(tM);
      svg.appendChild(el('circle', { cx: 210, cy: 180, r: 4, fill: '#333' }));
      const tC = el('text', { x: 196, y: 152 }); tC.textContent = '中点'; svg.appendChild(tC);
      const tL1 = el('text', { x: 108, y: 212, fill: '#555' }); tL1.textContent = '+2.0 μC'; svg.appendChild(tL1);
      const tL2 = el('text', { x: 288, y: 212, fill: '#555' }); tL2.textContent = '−2.0 μC'; svg.appendChild(tL2);
      const tD = el('text', { x: 40, y: 36, fill: '#555' }); tD.textContent = '2つの電荷の中点（0.15 m ずつ）'; svg.appendChild(tD);
    } else {
      // 点電荷 ＋2.0 μC と、r=0.10 m・0.20 m の目印。
      svg.appendChild(el('line', { x1: 100, y1: 180, x2: 360, y2: 180, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('circle', { cx: 140, cy: 180, r: 14, fill: '#ffcccc', stroke: '#b00', 'stroke-width': 2 }));
      const tP = el('text', { x: 135, y: 185, fill: '#b00', 'font-size': 16 }); tP.textContent = '+'; svg.appendChild(tP);
      const tQ = el('text', { x: 128, y: 212, fill: '#555' }); tQ.textContent = '+2.0 μC'; svg.appendChild(tQ);
      for (const [x, label] of [[210, 'r=0.10 m'], [280, 'r=0.20 m']]) {
        svg.appendChild(el('line', { x1: x, y1: 174, x2: x, y2: 186, stroke: '#333', 'stroke-width': 1.5 }));
        // 距離のラベルはさらに下へ出して、「+2.0 μC」と重ならないようにする。
        const t = el('text', { x: x - 26, y: 238, fill: '#555' }); t.textContent = label; svg.appendChild(t);
      }
      if (scene.phase === 'force') {
        // 試験電荷 q を r=0.10 m の位置に置く。
        svg.appendChild(el('circle', { cx: 210, cy: 180, r: 8, fill: '#cfe3ff', stroke: 'blue', 'stroke-width': 2 }));
        const tQ2 = el('text', { x: 207, y: 184, fill: 'blue' }); tQ2.textContent = 'q'; svg.appendChild(tQ2);
        const tN = el('text', { x: 40, y: 36, fill: '#555' }); tN.textContent = '電場 E は q を置く前からある'; svg.appendChild(tN);
      } else {
        const tN = el('text', { x: 40, y: 36, fill: '#555' }); tN.textContent = '点電荷のまわりの電場（距離で 1/r²）'; svg.appendChild(tN);
      }
    }
  } else if (scene.type === 'calorimetry') {
    const d = scene.derived;
    if (scene.phase === 'compare') {
      // 同じ熱量でも、熱容量が小さい銅のほうが温度が大きく上がる。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '同じ Q=9750 J を与える'; svg.appendChild(tH);
      svg.appendChild(el('rect', { x: 80, y: 120, width: 80, height: 50, fill: '#f0c8c8', stroke: '#333', 'stroke-width': 2 }));
      const tCu = el('text', { x: 84, y: 148 }); tCu.textContent = '銅 0.50 kg'; svg.appendChild(tCu);
      svg.appendChild(el('rect', { x: 80, y: 200, width: 80, height: 50, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const tW = el('text', { x: 84, y: 228 }); tW.textContent = '水 0.20 kg'; svg.appendChild(tW);
      // 温度の上がり幅の棒（基準線 y=280）：銅 50 K、水は約 12 K。
      const baseY = 280;
      svg.appendChild(el('line', { x1: 200, y1: baseY, x2: 360, y2: baseY, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('rect', { x: 230, y: baseY - scene.copperDT, width: 30, height: scene.copperDT, fill: '#b00', stroke: '#333', 'stroke-width': 1 }));
      const t1 = el('text', { x: 222, y: baseY - scene.copperDT - 8 }); t1.textContent = 'ΔT=50 K'; svg.appendChild(t1);
      svg.appendChild(el('rect', { x: 300, y: baseY - d.dTWaterSameQ, width: 30, height: d.dTWaterSameQ, fill: '#b00', stroke: '#333', 'stroke-width': 1 }));
      const t2 = el('text', { x: 292, y: baseY - d.dTWaterSameQ - 8 }); t2.textContent = 'ΔT≈12 K'; svg.appendChild(t2);
    } else if (scene.phase === 'heat') {
      // 水 0.20 kg を 20°C から 80°C に温める。熱は上から入る（forces の矢印）。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '水 0.20 kg を 20°C から 80°C に温める'; svg.appendChild(tH);
      svg.appendChild(el('rect', { x: 180, y: 120, width: 120, height: 140, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: 184, y: 180, width: 112, height: 76, fill: '#cfe3ff', stroke: 'none' }));
      const tW = el('text', { x: 210, y: 220 }); tW.textContent = '水'; svg.appendChild(tW);
      // 温度の目盛り：20°C が y=250、80°C が y=130（1 K = 2 px）。
      svg.appendChild(el('line', { x1: 320, y1: 120, x2: 320, y2: 260, stroke: '#333', 'stroke-width': 1.5 }));
      for (const [t, y] of [[20, 250], [80, 130]]) {
        svg.appendChild(el('line', { x1: 314, y1: y, x2: 326, y2: y, stroke: '#333', 'stroke-width': 1.5 }));
        const tt = el('text', { x: 330, y: y + 4 }); tt.textContent = t + '°C'; svg.appendChild(tt);
      }
    } else if (scene.phase === 'mix') {
      // 80°C の水と 20°C の水を混ぜる。熱は熱いほうから冷たいほうへ流れる。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '80°C の水と 20°C の水を混ぜる'; svg.appendChild(tH);
      svg.appendChild(el('rect', { x: 60, y: 140, width: 90, height: 110, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: 64, y: 180, width: 82, height: 66, fill: '#ffb3b3', stroke: 'none' }));
      const t1 = el('text', { x: 80, y: 210 }); t1.textContent = '80°C'; svg.appendChild(t1);
      svg.appendChild(el('rect', { x: 250, y: 140, width: 90, height: 110, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: 254, y: 180, width: 82, height: 66, fill: '#cfe3ff', stroke: 'none' }));
      const t2 = el('text', { x: 270, y: 210 }); t2.textContent = '20°C'; svg.appendChild(t2);
      const tR = el('text', { x: 40, y: 284, fill: '#555' }); tR.textContent = '混ぜると 44°C になる'; svg.appendChild(tR);
    } else {
      // T–Q グラフ：横軸 Q（0〜4.14×10⁴ J → x=60〜340）、縦軸 T（0〜20°C → y=240〜120）。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '氷をとかす：温度は 0°C のまま'; svg.appendChild(tH);
      const x0 = 60, x1 = 340, y0 = 240, y1 = 120;
      const xFlat = x0 + (d.qMelt / d.qTotalIce) * (x1 - x0);
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: y1, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      // 0°C で水平（とける）、その後 20°C まで上がる。
      svg.appendChild(el('path', { d: `M ${x0} ${y0} L ${xFlat.toFixed(1)} ${y0} L ${x1} ${y1}`, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      const tY = el('text', { x: 40, y: 124 }); tY.textContent = 'T'; svg.appendChild(tY);
      const t0 = el('text', { x: 28, y: 244 }); t0.textContent = '0°C'; svg.appendChild(t0);
      // 下の説明は短くして、Q 軸ラベルと重ならないようにする。
      const tF = el('text', { x: 160, y: 260, fill: '#555' }); tF.textContent = 'とけるだけ（0°C）'; svg.appendChild(tF);
      const tQ = el('text', { x: 348, y: 258, fill: '#555' }); tQ.textContent = 'Q'; svg.appendChild(tQ);
    }
  } else if (scene.type === 'drag') {
    const d = scene.derived;
    if (scene.phase === 'heavy') {
      // v–t グラフ：軽い玉と重い玉の 2 本の曲線。横軸 t（0〜10 s）、縦軸 v（0〜40 m/s、5 px/(m/s)）。
      const x0 = 60, x1 = 340, y0 = 240;
      const tx = (t) => x0 + t * 28;
      const vy = (v) => y0 - v * 5;
      // 見出しは短くして、右上の「重い玉 40 m/s」ラベルと重ならないようにする。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = 'v–t グラフ：重い玉が速い'; svg.appendChild(tH);
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: 40, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      // 終端速度の破線。
      for (const [vt, label, ly] of [[d.vt, '軽い玉 20 m/s', 132], [d.vtHeavy, '重い玉 40 m/s', 32]]) {
        svg.appendChild(el('line', { x1: x0, y1: vy(vt), x2: x1, y2: vy(vt), stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
        const tt = el('text', { x: 250, y: ly, fill: '#555' }); tt.textContent = label; svg.appendChild(tt);
      }
      // 曲線：v(t)=v_t(1−e^(−t/τ))。
      const curve = (vt, tau, color) => {
        let p = '';
        for (let i = 0; i <= 100; i++) {
          const t = (i / 100) * 10;
          const v = vt * (1 - Math.exp(-t / tau));
          p += (p ? ' L ' : 'M ') + tx(t).toFixed(1) + ' ' + vy(v).toFixed(1);
        }
        svg.appendChild(el('path', { d: p, fill: 'none', stroke: color, 'stroke-width': 2 }));
      };
      curve(d.vt, d.tau, '#b00');
      curve(d.vtHeavy, d.tauHeavy, 'blue');
      // t=2 s の点。
      svg.appendChild(el('line', { x1: tx(2), y1: y0, x2: tx(2), y2: vy(d.vHeavyMid), stroke: '#888', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
      svg.appendChild(el('circle', { cx: tx(2), cy: vy(d.vMid), r: 4, fill: '#b00' }));
      svg.appendChild(el('circle', { cx: tx(2), cy: vy(d.vHeavyMid), r: 4, fill: 'blue' }));
      const tL = el('text', { x: tx(2) + 6, y: vy(d.vMid) + 16, fill: '#b00' }); tL.textContent = '12.6 m/s'; svg.appendChild(tL);
      const tHv = el('text', { x: tx(2) + 6, y: vy(d.vHeavyMid) - 10, fill: 'blue' }); tHv.textContent = '15.7 m/s'; svg.appendChild(tHv);
      const tA = el('text', { x: 320, y: y0 + 22 }); tA.textContent = 't（s）'; svg.appendChild(tA);
      const tV = el('text', { x: 36, y: 48 }); tV.textContent = 'v'; svg.appendChild(tV);
    } else {
      // 落ちる玉：重力はつねに同じ長さ、空気抵抗は速さで変わる（forces の矢印）。
      const tH = el('text', { x: 40, y: 36, fill: '#555' });
      tH.textContent = scene.phase === 'start' ? '落とし始め：抵抗はまだ 0'
        : scene.phase === 'mid' ? 't=2.0 s：速さ 12.6 m/s、抵抗 3.16 N'
        : '終端速度：抵抗 = 重力、加速度 0';
      svg.appendChild(tH);
      svg.appendChild(el('line', { x1: 40, y1: 270, x2: 360, y2: 270, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: 200, cy: 120, r: 12, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      // 「玉」は玉の左側に出し、空気抵抗の矢印と重ならないようにする。
      const tB = el('text', { x: 160, y: 124 }); tB.textContent = '玉'; svg.appendChild(tB);
      const tG = el('text', { x: 40, y: 288, fill: '#555' }); tG.textContent = '地面'; svg.appendChild(tG);
    }
  } else if (scene.type === 'decay') {
    const d = scene.derived;
    if (scene.phase === 'dating') {
      // 年代測定：残った割合から半減期の回数を数える。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '¹⁴C が 1/8 だけ残っている → 3 半減期'; svg.appendChild(tH);
      const baseY = 240;
      svg.appendChild(el('line', { x1: 40, y1: baseY, x2: 360, y2: baseY, stroke: '#333', 'stroke-width': 1.5 }));
      const years = [0, 5730, 11460, 17190];
      const fracs = [1, 0.5, 0.25, 0.125];
      for (let i = 0; i < 4; i++) {
        const x = 80 + i * 80;
        const h = fracs[i] * 160;
        svg.appendChild(el('rect', { x, y: baseY - h, width: 40, height: h, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 1.5 }));
        const tF = el('text', { x: x + 2, y: baseY - h - 8 }); tF.textContent = fracs[i] === 1 ? '1' : '1/' + (1 / fracs[i]); svg.appendChild(tF);
        const tY = el('text', { x: x - 6, y: baseY + 20 }); tY.textContent = years[i] + '年'; svg.appendChild(tY);
      }
    } else {
      // 崩壊曲線：N(t)=N0・2^(−t/T)。横軸 0〜32 日、縦軸 0〜1.0×10⁶ 個。
      const tH = el('text', { x: 40, y: 36, fill: '#555' });
      tH.textContent = scene.phase === 'half' ? '半減期 8.0 日：8 日で半分になる'
        : scene.phase === 'quarter' ? '16 日で 1/4 になる（直線ではない）'
        : scene.phase === 'activity' ? '放射能も N と同じ割合で減る'
        : '崩壊曲線：N=N0・(1/2)^(t/T)';
      svg.appendChild(tH);
      const x0 = 60, x1 = 340, y0 = 240, y1 = 40;
      const tx = (t) => x0 + (t / 32) * (x1 - x0);
      const ny = (n) => y0 - (n / scene.n0) * (y0 - y1);
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: y1, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      let p = '';
      for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * 32;
        const n = scene.n0 * Math.pow(0.5, t / scene.halfLifeDays);
        p += (p ? ' L ' : 'M ') + tx(t).toFixed(1) + ' ' + ny(n).toFixed(1);
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      // 半減期ごとの点（ラベルは曲線や見出しと重ならない位置に置く）。
      // 目盛りラベルは縦に離して置き、「1.3×10⁵」と「6.3×10⁴」が重ならないようにする。
      const labels = ['1.0×10⁶', '5.0×10⁵', '2.5×10⁵', '1.3×10⁵', '6.3×10⁴'];
      const labelPos = [[66, 56], [120, 130], [190, 180], [252, 200], [240, 228]];
      for (let i = 0; i <= 4; i++) {
        const t = i * scene.halfLifeDays;
        const n = scene.n0 * d.fracs[i];
        svg.appendChild(el('circle', { cx: tx(t), cy: ny(n), r: 4, fill: '#b00' }));
        const tt = el('text', { x: labelPos[i][0], y: labelPos[i][1] }); tt.textContent = labels[i]; svg.appendChild(tt);
      }
      const tA = el('text', { x: 320, y: y0 + 22 }); tA.textContent = 't（日）'; svg.appendChild(tA);
      // N 軸ラベルは見出しと重ならないよう、下へ出す。
      const tN = el('text', { x: 30, y: 60 }); tN.textContent = 'N'; svg.appendChild(tN);
    }
  } else if (scene.type === 'moment') {
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'child' ? '子ども 200 N が左端にのる'
      : scene.phase === 'weight' ? '板の重さ 100 N は中心にはたらく'
      : scene.phase === 'balance' ? 'モーメントのつり合い：F を求める'
      : scene.phase === 'summary' ? 'まとめ：モーメント = 力 × うで'
      : '板（4.0 m）と支点：力のモーメントを考える';
    svg.appendChild(tH);
    // 板：x=60〜340 が 4.0 m（70 px/m）。支点は左端から 1.5 m（x=165）、板の中心は x=200。
    svg.appendChild(el('line', { x1: 60, y1: 210, x2: 340, y2: 210, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('polygon', { points: '150,250 180,250 165,210', fill: '#eee', stroke: '#333', 'stroke-width': 2 }));
    const tP = el('text', { x: 135, y: 270 }); tP.textContent = '支点'; svg.appendChild(tP);
    // 子ども：左端の上にのる箱。
    svg.appendChild(el('rect', { x: 40, y: 170, width: 40, height: 40, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
    const tC = el('text', { x: 28, y: 160 }); tC.textContent = '子ども'; svg.appendChild(tC);
    const tB = el('text', { x: 250, y: 196 }); tB.textContent = '板（4.0 m）'; svg.appendChild(tB);
    if (scene.phase === 'summary') {
      // モーメントの値を板の下に並べる。
      const t1 = el('text', { x: 60, y: 285, fill: '#d35400' }); t1.textContent = '300 N·m'; svg.appendChild(t1);
      const t2 = el('text', { x: 185, y: 285, fill: 'red' }); t2.textContent = '50 N·m'; svg.appendChild(t2);
      const t3 = el('text', { x: 290, y: 285, fill: 'blue' }); t3.textContent = '250 N·m'; svg.appendChild(t3);
    }
  } else if (scene.type === 'solenoid') {
    if (scene.phase === 'coil') {
      // 1 巻きのコイル：円の中心の磁場は紙面の裏向き（×印）。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = '1 巻きのコイルの中心の磁場'; svg.appendChild(tH);
      svg.appendChild(el('circle', { cx: 200, cy: 150, r: 60, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      // 電流の向き：円の上を右向きに流れる矢印。
      svg.appendChild(el('path', { d: 'M 158 108 A 60 60 0 0 1 242 108', fill: 'none', stroke: '#d35400', 'stroke-width': 2, 'marker-end': 'url(#fig-arrow)' }));
      const tI = el('text', { x: 248, y: 100, fill: '#d35400' }); tI.textContent = 'I=2.0 A'; svg.appendChild(tI);
      // 中心の磁場（裏向き）の × 印。
      svg.appendChild(el('line', { x1: 192, y1: 142, x2: 208, y2: 158, stroke: '#b00', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 208, y1: 142, x2: 192, y2: 158, stroke: '#b00', 'stroke-width': 2 }));
      const tB = el('text', { x: 200, y: 185, fill: '#b00' }); tB.textContent = 'B≈25 μT（裏向き）'; svg.appendChild(tB);
      // 半径 r=0.050 m：中心から上への破線。
      svg.appendChild(el('line', { x1: 200, y1: 150, x2: 200, y2: 90, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      const tR = el('text', { x: 250, y: 76, fill: '#555' }); tR.textContent = 'r=0.050 m'; svg.appendChild(tR);
    } else {
      const tH = el('text', { x: 40, y: 36, fill: '#555' });
      tH.textContent = scene.phase === 'field' ? '中の磁場はほぼ一様：B = μ₀nI'
        : scene.phase === 'current' ? '電流 4.0 A にすると B は 2 倍'
        : scene.phase === 'summary' ? 'まとめ：B は n と I に比例する'
        : 'ソレノイド：コイルを巻いたもの';
      svg.appendChild(tH);
      // コイル：8 個の楕円ループ（横から見たソレノイド）。上下の導線でつなぐ。
      for (let i = 0; i < 8; i++) {
        const cx = 100 + i * 30;
        svg.appendChild(el('ellipse', { cx, cy: 150, rx: 10, ry: 42, fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      }
      svg.appendChild(el('line', { x1: 100, y1: 108, x2: 310, y2: 108, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 100, y1: 192, x2: 310, y2: 192, stroke: '#333', 'stroke-width': 2 }));
      const tN = el('text', { x: 40, y: 100, fill: '#555' }); tN.textContent = 'n=1000 /m'; svg.appendChild(tN);
      const tI = el('text', { x: 320, y: 100 }); tI.textContent = 'I=' + scene.currentA.toFixed(1) + ' A'; svg.appendChild(tI);
      const tL = el('text', { x: 40, y: 230, fill: '#555' }); tL.textContent = '長さ 0.20 m・全 200 回'; svg.appendChild(tL);
      // 「中の磁場 B」は「全 200 回」と重ならないよう、右へ出す。
      const tB = el('text', { x: 245, y: 218, fill: '#b00' }); tB.textContent = '中の磁場 B'; svg.appendChild(tB);
    }
  } else if (scene.type === 'transient') {
    const d = scene.derived;
    if (scene.phase === 'circuit') {
      // RC 回路図：電池・抵抗・コンデンサ・スイッチの四角い回路。
      const tH = el('text', { x: 40, y: 36, fill: '#555' }); tH.textContent = 'RC 回路：電池・抵抗・コンデンサ'; svg.appendChild(tH);
      svg.appendChild(el('line', { x1: 80, y1: 100, x2: 140, y2: 100, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 210, y1: 100, x2: 320, y2: 100, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 320, y1: 100, x2: 320, y2: 220, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 320, y1: 220, x2: 80, y2: 220, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 80, y1: 220, x2: 80, y2: 100, stroke: '#333', 'stroke-width': 2 }));
      // 電池（左の辺）：長い線と短い太い線。
      svg.appendChild(el('line', { x1: 68, y1: 150, x2: 92, y2: 150, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 72, y1: 162, x2: 88, y2: 162, stroke: '#333', 'stroke-width': 4 }));
      const tE = el('text', { x: 100, y: 160 }); tE.textContent = 'E=10 V'; svg.appendChild(tE);
      // 抵抗（上の辺）：ジグザグ。
      svg.appendChild(el('polyline', { points: '140,100 150,88 160,112 170,88 180,112 190,88 200,112 210,100', fill: 'none', stroke: '#333', 'stroke-width': 2 }));
      const tR = el('text', { x: 150, y: 78 }); tR.textContent = 'R=1000 Ω'; svg.appendChild(tR);
      // コンデンサ（右の辺）：2 枚の平行板。
      svg.appendChild(el('line', { x1: 300, y1: 140, x2: 340, y2: 140, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: 300, y1: 152, x2: 340, y2: 152, stroke: '#333', 'stroke-width': 2 }));
      const tC = el('text', { x: 250, y: 130 }); tC.textContent = 'C=100 μF'; svg.appendChild(tC);
      // スイッチ（下の辺）：開いたスイッチ。
      svg.appendChild(el('line', { x1: 180, y1: 220, x2: 215, y2: 205, stroke: '#333', 'stroke-width': 2 }));
      const tS = el('text', { x: 180, y: 245 }); tS.textContent = 'スイッチ'; svg.appendChild(tS);
    } else {
      // 指数曲線のグラフ：充電・放電・RL・まとめで共通の軸を使う。
      // 充電：Vc=10(1−e^(−t/0.1))、放電：Vc=10e^(−t/0.1)、RL：I=1.0(1−e^(−t/0.1))。
      const x0 = 60, x1 = 340, y0 = 240, y1 = 40;
      const tx = (t) => x0 + (t / 0.30) * (x1 - x0);
      const isDischarge = scene.phase === 'discharge';
      const isRL = scene.phase === 'rl';
      const yOf = (v) => y0 - (v / (isRL ? 1.0 : 10)) * (y0 - y1);
      const val = (t) => isDischarge ? scene.emfV * Math.exp(-t / d.tauRC)
        : isRL ? d.iInf * (1 - Math.exp(-t / d.tauRL))
        : scene.emfV * (1 - Math.exp(-t / d.tauRC));
      const tH = el('text', { x: 40, y: 36, fill: '#555' });
      tH.textContent = isDischarge ? '放電：Vc は 0 に近づく'
        : isRL ? 'コイルの電流：急には流れない'
        : scene.phase === 'summary' ? 'まとめ：τ で 63%、3τ で 95%'
        : '充電：Vc は 10 V に近づく';
      svg.appendChild(tH);
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: y1, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      // 最終値の破線（充電・RL は上、放電は 0 の軸そのもの）。
      if (!isDischarge) {
        svg.appendChild(el('line', { x1: x0, y1: y1, x2: x1, y2: y1, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
        const tE = el('text', { x: 345, y: y1 + 18, fill: '#555' }); tE.textContent = isRL ? 'I=1.0 A' : 'E=10 V'; svg.appendChild(tE);
      }
      // 目盛り：0.1 s ごと。
      for (const [t, label] of [[0.1, '0.1'], [0.2, '0.2'], [0.3, '0.3']]) {
        svg.appendChild(el('line', { x1: tx(t), y1: y0 - 4, x2: tx(t), y2: y0 + 4, stroke: '#333', 'stroke-width': 1.5 }));
        const tt = el('text', { x: tx(t) - 8, y: y0 + 22 }); tt.textContent = label; svg.appendChild(tt);
      }
      const tA = el('text', { x: 345, y: y0 + 4 }); tA.textContent = 't（s）'; svg.appendChild(tA);
      const tV = el('text', { x: 34, y: 56 }); tV.textContent = isRL ? 'I' : 'V'; svg.appendChild(tV);
      // 曲線：式から 100 点で描く。
      let p = '';
      for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * 0.30;
        p += (p ? ' L ' : 'M ') + tx(t).toFixed(1) + ' ' + yOf(val(t)).toFixed(1);
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      // τ・2τ・3τ の点と値（ラベルは曲線の上に置く）。
      const pts = isDischarge
        ? [[0.1, '3.7 V', d.vdTau], [0.2, '1.4 V', d.vd2Tau]]
        : isRL
        ? [[0.1, '0.63 A', d.iTau], [0.2, '0.86 A', d.i2Tau], [0.3, '0.95 A', d.i3Tau]]
        : [[0.1, '6.3 V', d.vcTau], [0.2, '8.6 V', d.vc2Tau], [0.3, '9.5 V', d.vc3Tau]];
      for (const [t, label, v] of pts) {
        svg.appendChild(el('circle', { cx: tx(t), cy: yOf(v), r: 4, fill: '#b00' }));
        const tt = el('text', { x: tx(t) + 7, y: yOf(v) - 12, fill: '#b00' }); tt.textContent = label; svg.appendChild(tt);
      }
    }
  } else if (scene.type === 'ladder') {
    svg.appendChild(el('line', { x1: 80, y1: 20, x2: 80, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 80, y1: 260, x2: 380, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    const t1 = el('text', { x: 55, y: 40 }); t1.textContent = '壁'; svg.appendChild(t1);
    const t2 = el('text', { x: 300, y: 285 }); t2.textContent = '床'; svg.appendChild(t2);
    svg.appendChild(el('line', { x1: 80, y1: 80, x2: 280, y2: 260, stroke: '#b5651d', 'stroke-width': 6 }));
  } else if (scene.type === 'twoBody') {
    const d = scene.derived;
    const xPx = (x) => 60 + x * 40; // 位置：1 m = 40 px、原点 x=60
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    if (scene.phase === 'collision') {
      // 重心系の2段：上段が衝突前、下段が衝突後。矢印は forces で描く。
      tH.textContent = '重心系で見ると、衝突は速度の反転';
      svg.appendChild(tH);
      const r1 = el('text', { x: 40, y: 70, fill: '#555' }); r1.textContent = '衝突前（重心系）'; svg.appendChild(r1);
      const r2 = el('text', { x: 40, y: 160, fill: '#555' }); r2.textContent = '衝突後（重心系）'; svg.appendChild(r2);
      for (const [cx, cy] of [[100, 110], [280, 110], [100, 210], [280, 210]]) {
        svg.appendChild(el('rect', { x: cx - 15, y: cy - 10, width: 30, height: 20, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      }
      const lA1 = el('text', { x: 92, y: 88 }); lA1.textContent = 'A'; svg.appendChild(lA1);
      const lB1 = el('text', { x: 272, y: 88 }); lB1.textContent = 'B'; svg.appendChild(lB1);
      const lA2 = el('text', { x: 92, y: 188 }); lA2.textContent = 'A'; svg.appendChild(lA2);
      const lB2 = el('text', { x: 272, y: 188 }); lB2.textContent = 'B'; svg.appendChild(lB2);
      const cap = el('text', { x: 40, y: 280, fill: '#555' }); cap.textContent = '地面系：v1′=0.60 m/s、v2′=2.6 m/s'; svg.appendChild(cap);
    } else if (scene.phase === 'summary') {
      // 重心の軌跡：t=0 から t=2.5 s まで、V_G=1.8 m/s で 4.5 m 進む。
      tH.textContent = '重心は等速直線運動：外力がなければ';
      svg.appendChild(tH);
      svg.appendChild(el('line', { x1: 80, y1: 200, x2: 260, y2: 200, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      svg.appendChild(el('polygon', { points: '80,192 80,208 88,200', fill: '#b00' }));
      svg.appendChild(el('polygon', { points: '260,192 260,208 268,200', fill: '#b00' }));
      const l0 = el('text', { x: 40, y: 230, fill: '#555' }); l0.textContent = 't=0：x_G=3.0 m'; svg.appendChild(l0);
      const l25 = el('text', { x: 200, y: 230, fill: '#555' }); l25.textContent = 't=2.5 s：x_G=7.5 m'; svg.appendChild(l25);
      const cap = el('text', { x: 40, y: 280, fill: '#555' }); cap.textContent = 't=2.5 s に A と B は x=7.5 m で出会う'; svg.appendChild(cap);
    } else {
      // 床と2つの物体、重心の位置。速度の矢印は forces で描く。
      tH.textContent = scene.phase === 'velocity' ? '重心の速度 V_G = 1.8 m/s'
        : scene.phase === 'relative' ? 'A から見た B は 2.0 m/s で近づく'
        : '2つの物体と、その重心';
      svg.appendChild(tH);
      svg.appendChild(el('line', { x1: 40, y1: 270, x2: 360, y2: 270, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: xPx(scene.x1M) - 15, y: 246, width: 30, height: 24, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('rect', { x: xPx(scene.x2M) - 15, y: 246, width: 30, height: 24, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const lA = el('text', { x: xPx(scene.x1M) - 8, y: 238 }); lA.textContent = 'A'; svg.appendChild(lA);
      const lB = el('text', { x: xPx(scene.x2M) - 8, y: 238 }); lB.textContent = 'B'; svg.appendChild(lB);
      // 重心：破線の目印とラベル。velocity の場面では v1 のラベルと重ならないよう、下に出す。
      svg.appendChild(el('line', { x1: xPx(d.xG), y1: 225, x2: xPx(d.xG), y2: 270, stroke: '#b00', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      const lG = el('text', { x: xPx(d.xG) - 30, y: scene.phase === 'velocity' ? 290 : 215, fill: '#b00' }); lG.textContent = '重心 G'; svg.appendChild(lG);
      if (scene.phase !== 'relative') {
        const mA = el('text', { x: xPx(scene.x1M) - 18, y: 290, fill: '#555' }); mA.textContent = '2.0 kg'; svg.appendChild(mA);
        const mB = el('text', { x: xPx(scene.x2M) - 18, y: 290, fill: '#555' }); mB.textContent = '3.0 kg'; svg.appendChild(mB);
      }
      if (scene.phase === 'base') {
        const dist = el('text', { x: 150, y: 290, fill: '#555' }); dist.textContent = '5.0 m'; svg.appendChild(dist);
      }
      if (scene.phase === 'relative') {
        const cap = el('text', { x: 40, y: 290, fill: '#555' }); cap.textContent = '2.5 s 後に追いつく（5.0 m ÷ 2.0 m/s）'; svg.appendChild(cap);
      }
    }
  } else if (scene.type === 'induction') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    if (scene.phase === 'summary') {
      // B–t グラフ：B は 0.10 s で 0.20 T まで上がり、その後一定。V は上がるあいだだけ 2.0 V。
      tH.textContent = 'B が変わるあいだだけ、起電力が生まれる';
      svg.appendChild(tH);
      const x0 = 60, x1 = 340, y0 = 240, yTop = 100;
      const tx = (t) => x0 + (t / 0.30) * (x1 - x0);
      svg.appendChild(el('line', { x1: x0, y1: y0, x2: x1, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('line', { x1: x0, y1: yTop - 20, x2: x0, y2: y0, stroke: '#333', 'stroke-width': 1.5 }));
      svg.appendChild(el('path', { d: `M ${x0} ${y0} L ${tx(0.10).toFixed(1)} ${yTop} L ${x1} ${yTop}`, fill: 'none', stroke: '#b00', 'stroke-width': 2 }));
      svg.appendChild(el('path', { d: `M ${x0} ${yTop} L ${tx(0.10).toFixed(1)} ${yTop} L ${tx(0.10).toFixed(1)} ${y0} L ${x1} ${y0}`, fill: 'none', stroke: 'blue', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
      const lV = el('text', { x: 70, y: 90, fill: 'blue' }); lV.textContent = 'V=2.0 V'; svg.appendChild(lV);
      const lB = el('text', { x: 170, y: 90, fill: '#b00' }); lB.textContent = 'B=0.20 T'; svg.appendChild(lB);
      const lT = el('text', { x: 320, y: 262 }); lT.textContent = 't'; svg.appendChild(lT);
      const lT10 = el('text', { x: tx(0.10) - 18, y: 262, fill: '#555' }); lT10.textContent = '0.10 s'; svg.appendChild(lT10);
      const cap = el('text', { x: 40, y: 285, fill: '#555' }); cap.textContent = 'B が変わっているあいだだけ、V が生まれる'; svg.appendChild(cap);
    } else {
      // コイルを正面から見た円。× は紙面の裏向きの磁場。
      tH.textContent = scene.phase === 'flux' ? '磁束 Φ = BS = 2.0×10⁻³ Wb'
        : scene.phase === 'emf' ? '誘導起電力 V = 2.0 V、電流 0.20 A'
        : scene.phase === 'lenz' ? 'レンツの法則：変化を妨げる向きに流れる'
        : 'コイルを貫く磁束 Φ = BS';
      svg.appendChild(tH);
      svg.appendChild(el('circle', { cx: 200, cy: 150, r: 60, fill: scene.phase === 'flux' ? '#cfe3ff' : 'none', stroke: '#333', 'stroke-width': 2 }));
      for (const [cx, cy] of [[170, 120], [200, 120], [230, 120], [170, 150], [200, 150], [230, 150], [170, 180], [200, 180], [230, 180]]) {
        svg.appendChild(el('line', { x1: cx - 6, y1: cy - 6, x2: cx + 6, y2: cy + 6, stroke: '#b00', 'stroke-width': 2 }));
        svg.appendChild(el('line', { x1: cx + 6, y1: cy - 6, x2: cx - 6, y2: cy + 6, stroke: '#b00', 'stroke-width': 2 }));
      }
      const lB = el('text', { x: 40, y: 70, fill: '#b00' }); lB.textContent = 'B（裏向き）'; svg.appendChild(lB);
      const lC = el('text', { x: 40, y: 240, fill: '#555' }); lC.textContent = 'コイル N=100 回'; svg.appendChild(lC);
      if (scene.phase === 'flux') {
        const lP = el('text', { x: 40, y: 270, fill: '#555' }); lP.textContent = 'Φ = 0.20 × 0.010 = 2.0×10⁻³ Wb'; svg.appendChild(lP);
      }
      if (scene.phase === 'emf' || scene.phase === 'lenz') {
        // 誘導電流：外の磁場（裏向き）が増えるので、表向きの磁場をつくる向き＝反時計回り。
        svg.appendChild(el('path', { d: 'M 280 150 A 80 80 0 1 0 200 230', fill: 'none', stroke: '#d35400', 'stroke-width': 2, 'marker-end': 'url(#fig-arrow)' }));
        const lI = el('text', { x: 40, y: 270, fill: '#d35400' }); lI.textContent = '誘導電流 I=0.20 A'; svg.appendChild(lI);
      }
      if (scene.phase === 'lenz') {
        // 誘導電流のつくる磁場は表向き（・印）。
        for (const [cx, cy] of [[180, 140], [220, 140], [180, 160], [220, 160]]) {
          svg.appendChild(el('circle', { cx, cy, r: 3, fill: '#d35400' }));
        }
        // ラベルは短くして、右端ではみ出さないようにする（「表向き」は本文で説明する）。
        const lD = el('text', { x: 250, y: 260, fill: '#d35400' }); lD.textContent = '誘導電流の磁場'; svg.appendChild(lD);
      }
    }
  } else if (scene.type === 'ballistic') {
    const d = scene.derived;
    const pivot = d.pivot;
    // 天井と支点。
    svg.appendChild(el('line', { x1: 160, y1: pivot.y, x2: 240, y2: pivot.y, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('circle', { cx: pivot.x, cy: pivot.y, r: 4, fill: '#333' }));
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'before' ? '弾丸がおもりに向かって飛んでくる'
      : scene.phase === 'impact' ? '衝突直後：弾丸がめり込んで一緒に動く'
      : '最大の高さ：ここで一瞬止まる';
    svg.appendChild(tH);
    if (scene.phase === 'before') {
      // 糸とおもり（最下点）、弾丸は左から飛んでくる。
      const bob = d.bobBottom;
      svg.appendChild(el('line', { x1: pivot.x, y1: pivot.y, x2: bob.x, y2: bob.y, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: bob.x, cy: bob.y, r: 18, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const tZ = el('text', { x: bob.x - 15, y: bob.y - 26 }); tZ.textContent = 'v = 0'; svg.appendChild(tZ);
      const tB = el('text', { x: bob.x - 30, y: bob.y + 40, fill: '#555' }); tB.textContent = 'おもり'; svg.appendChild(tB);
      svg.appendChild(el('circle', { cx: 70, cy: 200, r: 6, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tM = el('text', { x: 56, y: 228 }); tM.textContent = '弾丸'; svg.appendChild(tM);
    } else if (scene.phase === 'impact') {
      // 弾丸がめり込んだおもり。弾丸はおもりの左端に描く。
      const bob = d.bobBottom;
      svg.appendChild(el('line', { x1: pivot.x, y1: pivot.y, x2: bob.x, y2: bob.y, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: bob.x, cy: bob.y, r: 18, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: bob.x - 15, cy: bob.y, r: 6, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      // 「おもり＋弾丸」は重力のラベルと重ならないよう、下へ出す。
      const tB = el('text', { x: bob.x - 30, y: bob.y + 62, fill: '#555' }); tB.textContent = 'おもり＋弾丸'; svg.appendChild(tB);
    } else {
      // 最大の高さ：糸が θ だけ傾いた位置。θ の弧は支点に描く。
      const bob = d.bobMax;
      svg.appendChild(el('line', { x1: pivot.x, y1: pivot.y, x2: bob.x, y2: bob.y, stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: bob.x, cy: bob.y, r: 18, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: bob.x - 15, cy: bob.y, r: 6, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      // θ の弧：鉛直下向きと糸のあいだ。弧の半径 30。
      const rad = (d.thetaDeg * Math.PI) / 180;
      const x2 = pivot.x + 30 * Math.sin(rad);
      const y2 = pivot.y + 30 * Math.cos(rad);
      svg.appendChild(el('path', { d: `M ${pivot.x} ${pivot.y + 30} A 30 30 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`, fill: 'none', stroke: '#333', 'stroke-width': 1.5 }));
      const th = el('text', { x: pivot.x + 36, y: pivot.y + 34 }); th.textContent = 'θ'; svg.appendChild(th);
      // 最下点の高さの破線と、上がった高さ h の矢印。
      svg.appendChild(el('line', { x1: 200, y1: d.bobBottom.y, x2: bob.x, y2: d.bobBottom.y, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      svg.appendChild(el('line', { x1: bob.x, y1: d.bobBottom.y, x2: bob.x, y2: bob.y, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      // h のラベルは重力のラベルと重ならないよう、破線の左側に出す。
      const tHm = el('text', { x: 190, y: 192, fill: '#555' }); tHm.textContent = 'h=0.20 m'; svg.appendChild(tHm);
      const tZ = el('text', { x: bob.x + 22, y: bob.y - 4 }); tZ.textContent = 'v = 0'; svg.appendChild(tZ);
    }
  } else if (scene.type === 'loop') {
    const d = scene.derived;
    const c = d.center, rPx = d.rPx;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'drop' ? '高さ h から静かに落とす'
      : scene.phase === 'bottom' ? '最下点：速さ最大、垂直抗力も最大'
      : scene.phase === 'top' ? '頂点：重力と垂直抗力の合力が向心力'
      : '途中でレールから離れる';
    svg.appendChild(tH);
    // ループのレールと地面。地面 y=280、最下点の玉の中心は (200,270)。
    svg.appendChild(el('circle', { cx: c.x, cy: c.y, r: rPx, fill: 'none', stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 40, y1: 280, x2: 360, y2: 280, stroke: '#333', 'stroke-width': 2 }));
    if (scene.phase === 'drop') {
      // 出発点の高さ h：右側の台の上。破線で高さを測る（120 px/m）。
      // 玉は見出しと重ならないよう、右側に置く。静かに落とすので v = 0 の表示はいらない。
      const yTop = 280 - scene.hM * 120;
      const ballX = 310, ballY = yTop - 10;
      svg.appendChild(el('line', { x1: 260, y1: yTop, x2: 360, y2: yTop, stroke: '#333', 'stroke-width': 3 }));
      svg.appendChild(el('circle', { cx: ballX, cy: ballY, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('line', { x1: ballX, y1: yTop, x2: ballX, y2: 280, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      const tHm = el('text', { x: 40, y: 170, fill: '#555' }); tHm.textContent = 'h=' + scene.hM.toFixed(2) + ' m'; svg.appendChild(tHm);
    } else if (scene.phase === 'bottom') {
      svg.appendChild(el('circle', { cx: 200, cy: 270, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tB = el('text', { x: 40, y: 295, fill: '#555' }); tB.textContent = '最下点'; svg.appendChild(tB);
    } else if (scene.phase === 'top') {
      svg.appendChild(el('circle', { cx: 200, cy: 170, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tT = el('text', { x: 240, y: 150, fill: '#555' }); tT.textContent = '頂点'; svg.appendChild(tT);
    } else if (scene.phase === 'fall' && d.fallPos) {
      // 離れる点の玉と、そのあとの放物線（破線）。放物線は時刻 0〜0.5 s を 0.05 s 刻みで描く。
      const ball = d.fallPos;
      svg.appendChild(el('circle', { cx: ball.x, cy: ball.y, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const vx = -d.fallCos * d.fallV, vy = -d.fallSin * d.fallV; // m/s（上向きが負）
      let p = '';
      for (let i = 0; i <= 10; i++) {
        const t = i * 0.05;
        const x = ball.x + vx * t * 120;
        const y = ball.y + vy * t * 120 + 0.5 * (scene.g || 10) * t * t * 120;
        p += (p ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: '#b00', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
      const tL = el('text', { x: 300, y: 110, fill: '#b00' }); tL.textContent = 'ここで離れる'; svg.appendChild(tL);
    }
  } else if (scene.type === 'projEnergy') {
    const d = scene.derived;
    const tH = el('text', { x: 40, y: 36, fill: '#555' });
    tH.textContent = scene.phase === 'top' ? '最高点：鉛直成分は 0、水平成分だけ残る'
      : scene.phase === 'ground' ? '着地の速さ：成分に分けて考える'
      : scene.phase === 'time' ? '滞空時間 t≈1.62 s、飛距離 R≈14.0 m'
      : scene.phase === 'down' ? '下向きに投げても着地の速さは同じ'
      : '高さ 5.0 m から 30° に投げる';
    svg.appendChild(tH);
    // 地面と発射台の高さ。
    svg.appendChild(el('line', { x1: 40, y1: d.groundY, x2: 360, y2: d.groundY, stroke: '#333', 'stroke-width': 2 }));
    svg.appendChild(el('line', { x1: d.originX, y1: d.launch.y, x2: d.originX, y2: d.groundY, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    // h0 のラベルは地面のすぐ上に出し、重力ラベルと重ならないようにする。
    const tH0 = el('text', { x: 66, y: 256, fill: '#555' }); tH0.textContent = 'h0=5.0 m'; svg.appendChild(tH0);
    // 軌道を描く：y(t) = h0 ± v0y・t − (g/2)t² を 0.05 s 刻みでたどる。
    const traj = (v0ySign, color) => {
      let p = '';
      const tEnd = v0ySign > 0 ? d.tFlightS : d.tDownS;
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * tEnd;
        const y = scene.h0M + v0ySign * d.v0y * t - 0.5 * d.g * t * t;
        const x = d.originX + d.v0x * t * d.xScale;
        const sy = d.groundY - y * d.xScale;
        p += (p ? ' L ' : 'M ') + x.toFixed(1) + ' ' + sy.toFixed(1);
      }
      svg.appendChild(el('path', { d: p, fill: 'none', stroke: color, 'stroke-width': 2 }));
    };
    if (scene.phase === 'top') {
      traj(1, '#b00');
      svg.appendChild(el('circle', { cx: d.top.x, cy: d.top.y, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      // 最高点から地面までの破線と H のラベル。
      svg.appendChild(el('line', { x1: d.top.x, y1: d.top.y, x2: d.top.x, y2: d.groundY, stroke: '#888', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      const tHm = el('text', { x: 136, y: 210, fill: '#555' }); tHm.textContent = 'H=6.25 m'; svg.appendChild(tHm);
    } else if (scene.phase === 'ground') {
      traj(1, '#b00');
      svg.appendChild(el('circle', { cx: d.landing.x, cy: d.landing.y - 10, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      const tL = el('text', { x: 250, y: 285, fill: '#555' }); tL.textContent = '着地'; svg.appendChild(tL);
    } else if (scene.phase === 'time') {
      traj(1, '#b00');
      svg.appendChild(el('circle', { cx: d.launch.x, cy: d.launch.y, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: d.landing.x, cy: d.landing.y - 10, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      // 飛距離の矢印（地面の下）。
      svg.appendChild(el('line', { x1: d.originX, y1: 278, x2: d.landing.x, y2: 278, stroke: '#333', 'stroke-width': 1.5, 'marker-end': 'url(#fig-arrow)' }));
      const tR = el('text', { x: 150, y: 295, fill: '#555' }); tR.textContent = 'R≈14.0 m'; svg.appendChild(tR);
    } else if (scene.phase === 'down') {
      traj(1, '#b00');
      traj(-1, 'blue');
      svg.appendChild(el('circle', { cx: d.launch.x, cy: d.launch.y, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: d.landing.x, cy: d.landing.y - 10, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
      svg.appendChild(el('circle', { cx: d.landingDown.x, cy: d.landingDown.y - 10, r: 10, fill: '#cfe3ff', stroke: '#333', 'stroke-width': 2 }));
      const tD = el('text', { x: 60, y: 292, fill: '#555' }); tD.textContent = '下向き：R≈5.4 m'; svg.appendChild(tD);
      const tU = el('text', { x: 230, y: 292, fill: '#555' }); tU.textContent = '上向き：R≈14.0 m'; svg.appendChild(tU);
    } else {
      traj(1, '#b00');
      svg.appendChild(el('circle', { cx: d.launch.x, cy: d.launch.y, r: 10, fill: '#ffd24d', stroke: '#333', 'stroke-width': 2 }));
    }
  }
  // 中心の黒点は、力の作用点がある型だけに描く。young・capacitor には作用点がないので描かない。
  if (scene.centerDot !== false) svg.appendChild(el('circle', { cx: scene.center.x, cy: scene.center.y, r: 4, fill: '#333' }));
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
  // 1つの図が失敗しても、他の図や完了ボタンの登録まで巻き添えにしない。
  document.querySelectorAll('svg.fig').forEach((svg) => {
    try {
      const dataEl = document.getElementById(svg.dataset.scene);
      const data = dataEl ? JSON.parse(dataEl.textContent) : { type: svg.dataset.figure, thetaDeg: 23.2, mgPx: 60 };
      const show = (svg.dataset.show || '').split(',').map((s) => s.trim()).filter(Boolean);
      renderFigure(svg, data, show);
    } catch (err) {
      console.error('figure failed for', svg.dataset.scene, err);
    }
  });
}

if (typeof module !== 'undefined') module.exports = { slopeForces, ladderForces, pullForces, hangForces, springForces, pulleyForces, slopePulleyForces, collisionSpringDerived, collisionSpringLayout, collisionSpringForces, chargedCircleDerived, chargedCircleForces, lcDerived, lcForces, gasPistonDerived, gasPistonForces, youngDerived, youngLayout, youngForces, capacitorDerived, capacitorForces, circleDerived, circleForces, shmDerived, shmForces, collisionDerived, collisionForces, gravitationDerived, gravitationForces, standingWaveDerived, photoelectricDerived, photoelectricForces, heatCycleDerived, heatCycleForces, railRodDerived, railRodForces, dopplerDerived, dopplerForces, dcCircuitDerived, dcCircuitForces, refractionLensDerived, refractionLensForces, bohrDerived, bohrForces, kineticTheoryDerived, kineticTheoryForces, travellingWaveDerived, travellingWaveForces, coulombFieldDerived, coulombFieldForces, calorimetryDerived, calorimetryForces, dragDerived, dragForces, decayDerived, decayForces, momentDerived, momentForces, solenoidDerived, solenoidForces, transientDerived, transientForces, twoBodyDerived, twoBodyForces, inductionDerived, inductionForces, ballisticDerived, ballisticForces, loopDerived, loopForces, projEnergyDerived, projEnergyForces, youngWaterDerived, youngWaterForces, dopplerShmDerived, dopplerShmForces, capSpringDerived, capSpringForces, slopeEnergyDerived, slopeEnergyForces, inductionLCDerived, inductionLCForces, gasResonanceDerived, gasResonanceForces, railCapCoilDerived, railCapCoilForces, capSpringGravDerived, capSpringGravForces, gasSpringCycleDerived, gasSpringCycleForces, sceneFor, validateScene, renderFigure };
