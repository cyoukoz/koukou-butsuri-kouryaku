// 高校物理攻略 — 図描画シミュレータ（試作 v0.1）
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

function sceneFor(type, thetaDeg, mgPx) {
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

// 分解の検算：decompSin + decompCos == gravity（斜面のみ）
function validateScene(scene) {
  const byId = Object.fromEntries(scene.forces.map((f) => [f.id, f]));
  if (byId.decompSin && byId.decompCos && byId.gravity) {
    const sx = byId.decompSin.vector[0] + byId.decompCos.vector[0] - byId.gravity.vector[0];
    const sy = byId.decompSin.vector[1] + byId.decompCos.vector[1] - byId.gravity.vector[1];
    if (Math.hypot(sx, sy) > 0.5) return ['分解の和が重力と一致しません: (' + sx.toFixed(2) + ', ' + sy.toFixed(2) + ')'];
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

  if (scene.type === 'slope') {
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
  const scene = sceneFor(data.type, data.thetaDeg, data.mgPx);
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

if (typeof module !== 'undefined') module.exports = { slopeForces, ladderForces, sceneFor, validateScene };
