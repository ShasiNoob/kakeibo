// charts.js — 依存なしの軽量 Canvas グラフ描画
// オフラインでも確実に動くよう、外部ライブラリに頼らず自前実装する。

function formatYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
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
  const pad = { top: 16, right: 12, bottom: 28, left: 12 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const max = Math.max(...values, 1);
  const barGap = 8;
  const barW = Math.max(6, (chartW - barGap * (values.length - 1)) / values.length);
  const color = opts.color || '#D4A15C';

  values.forEach((v, i) => {
    const barH = (v / max) * chartH;
    const x = pad.left + i * (barW + barGap);
    const y = pad.top + chartH - barH;
    ctx.fillStyle = color;
    const r = Math.min(4, barW / 2);
    roundRect(ctx, x, y, barW, Math.max(barH, 1), r);
    ctx.fill();

    ctx.fillStyle = opts.labelColor || 'rgba(230,230,235,0.55)';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, h - 10);
  });
}

function drawLineChart(canvas, labels, values, opts = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { top: 16, right: 12, bottom: 28, left: 12 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const color = opts.color || '#6FAE9C';
  const stepX = values.length > 1 ? chartW / (values.length - 1) : 0;

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

  ctx.fillStyle = opts.labelColor || 'rgba(230,230,235,0.55)';
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
    ctx.fillStyle = 'rgba(230,230,235,0.85)';
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
