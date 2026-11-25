// 高校物理攻略 — 図描画シミュレータ（試作 v0.8：力学の単一モデル 円運動・単振動・衝突 追加）
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

function sceneFor(type, thetaDeg, mgPx, fPx, data) {
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
  } else if (scene.type === 'ladder') {
    svg.appendChild(el('line', { x1: 80, y1: 20, x2: 80, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    svg.appendChild(el('line', { x1: 80, y1: 260, x2: 380, y2: 260, stroke: '#333', 'stroke-width': 3 }));
    const t1 = el('text', { x: 55, y: 40 }); t1.textContent = '壁'; svg.appendChild(t1);
    const t2 = el('text', { x: 300, y: 285 }); t2.textContent = '床'; svg.appendChild(t2);
    svg.appendChild(el('line', { x1: 80, y1: 80, x2: 280, y2: 260, stroke: '#b5651d', 'stroke-width': 6 }));
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
  document.querySelectorAll('svg.fig').forEach((svg) => {
    const dataEl = document.getElementById(svg.dataset.scene);
    const data = dataEl ? JSON.parse(dataEl.textContent) : { type: svg.dataset.figure, thetaDeg: 23.2, mgPx: 60 };
    const show = (svg.dataset.show || '').split(',').map((s) => s.trim()).filter(Boolean);
    renderFigure(svg, data, show);
  });
}

if (typeof module !== 'undefined') module.exports = { slopeForces, ladderForces, pullForces, hangForces, springForces, pulleyForces, slopePulleyForces, collisionSpringDerived, collisionSpringLayout, collisionSpringForces, chargedCircleDerived, chargedCircleForces, lcDerived, lcForces, gasPistonDerived, gasPistonForces, youngDerived, youngLayout, youngForces, capacitorDerived, capacitorForces, circleDerived, circleForces, shmDerived, shmForces, collisionDerived, collisionForces, sceneFor, validateScene };
