// charts.js — 依存なしの軽量 Canvas グラフ描画
// オフラインでも確実に動くよう、外部ライブラリに頼らず自前実装する。

function formatYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

function formatYenShort(n) {
  if (Math.abs(n) >= 10000) {
    const v = n / 10000;
    return '¥' + (Number.isInteger(v) ? v : v.toFixed(1)) + '万';
  }
  return formatYen(n);
}

// ライト/ダーク両対応の文字色(従来はダーク前提の色でライトモードだと読めなかった)
function schemeText(strong) {
  const dark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark
    ? (strong ? 'rgba(236,235,230,0.92)' : 'rgba(230,230,235,0.55)')
    : (strong ? 'rgba(26,31,43,0.88)' : 'rgba(26,31,43,0.5)');
}

function drawGridlines(ctx, pad, chartW, chartH, max) {
  ctx.strokeStyle = 'rgba(128,128,128,0.18)';
  ctx.lineWidth = 1;
  ctx.fillStyle = schemeText(false);
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  [0, 0.5, 1].forEach((r) => {
    const y = pad.top + chartH - chartH * r;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    if (r > 0) ctx.fillText(formatYenShort(max * r), pad.left + 2, y - 3);
  });
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.parentElement.clientWidth;
  const h = canvas.height / (canvas._dpr || 1) || 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas._dpr = dpr;
  return { ctx, w, h };
}

function drawBarChart(canvas, labels, values, opts = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { top: 30, right: 12, bottom: 28, left: 12 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const max = Math.max(...values, 1);
  const barGap = 8;
  const barW = Math.max(6, (chartW - barGap * (values.length - 1)) / values.length);
  const color = opts.color || '#D4A15C';

  drawGridlines(ctx, pad, chartW, chartH, max);

  values.forEach((v, i) => {
    const barH = (v / max) * chartH;
    const x = pad.left + i * (barW + barGap);
    const y = pad.top + chartH - barH;
    ctx.fillStyle = color;
    const r = Math.min(4, barW / 2);
    roundRect(ctx, x, y, barW, Math.max(barH, 1), r);
    ctx.fill();

    if (v > 0) {
      ctx.fillStyle = schemeText(true);
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(formatYenShort(v), x + barW / 2, y - 5);
    }

    ctx.fillStyle = opts.labelColor || schemeText(false);
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, h - 10);
  });
}

function drawLineChart(canvas, labels, values, opts = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { top: 30, right: 12, bottom: 28, left: 12 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const color = opts.color || '#6FAE9C';
  const stepX = values.length > 1 ? chartW / (values.length - 1) : 0;

  ctx.strokeStyle = 'rgba(128,128,128,0.18)';
  ctx.lineWidth = 1;
  ctx.fillStyle = schemeText(false);
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  [0, 0.5, 1].forEach((r) => {
    const val = min + range * r;
    const y = pad.top + chartH - chartH * r;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    ctx.fillText(formatYenShort(val), pad.left + 2, y - 3);
  });

  const pts = values.map((v, i) => ({
    x: pad.left + i * stepX,
    y: pad.top + chartH - ((v - min) / range) * chartH,
  }));

  // fill under line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pad.top + chartH);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, pad.top + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '05');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  pts.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  if (pts.length) {
    const last = pts[pts.length - 1];
    ctx.fillStyle = schemeText(true);
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatYen(values[values.length - 1]), Math.min(last.x, w - 12), Math.max(last.y - 8, 11));
  }

  ctx.fillStyle = opts.labelColor || schemeText(false);
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    if (labels.length > 8 && i % 2 !== 0 && i !== labels.length - 1) return;
    ctx.fillText(l, pts[i].x, h - 10);
  });
}

function drawHBarBreakdown(canvas, entries, opts = {}) {
  // entries: [{label, value, color}]
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...entries.map((e) => e.value), 1);
  const rowH = Math.min(28, (h - 8) / entries.length);
  entries.forEach((e, i) => {
    const y = 4 + i * rowH;
    const barMaxW = w * 0.58;
    const barW = (e.value / max) * barMaxW;
    ctx.fillStyle = e.color || '#D4A15C';
    roundRect(ctx, w * 0.36, y + 4, Math.max(barW, 2), rowH - 10, 4);
    ctx.fill();
    ctx.fillStyle = opts.textColor || schemeText(true);
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(e.label, 2, y + rowH / 2 + 4);
    ctx.textAlign = 'right';
    ctx.fillText(formatYen(e.value), w - 4, y + rowH / 2 + 4);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const Charts = { drawBarChart, drawLineChart, drawHBarBreakdown, formatYen };
