import { DB } from './db.js';
import { Charts } from './charts.js';

const state = {
  tab: 'home',
  modal: null, // {type, payload}
  toast: null,
  theme: 'amber',
  shiftMonth: null, // 'YYYY-MM' シフトタブで表示中の月
};

const THEMES = [
  { id: 'amber', name: 'アンバー', color: '#D4A15C', chart: '#D4A15C' },
  { id: 'sakura', name: 'さくら', color: '#E58AA5', chart: '#E58AA5' },
  { id: 'ocean', name: 'オーシャン', color: '#7FA8DC', chart: '#7FA8DC' },
  { id: 'forest', name: 'フォレスト', color: '#6FBFA0', chart: '#6FBFA0' },
  { id: 'grape', name: 'グレープ', color: '#B79FD4', chart: '#B79FD4' },
];

const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const thisMonth = () => todayISO().slice(0, 7);
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return `${y}年${parseInt(mo, 10)}月`;
};
const shiftMonthOf = (m, delta) => {
  const [y, mo] = m.split('-').map((x) => parseInt(x, 10));
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const hoursLabel = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
};

const root = document.getElementById('app');

async function init() {
  await DB.ensureDefaultsSeeded();
  const settings = await DB.getSettings();
  applyTheme(settings.theme);
  state.shiftMonth = thisMonth();
  render();
}

function applyTheme(themeId) {
  state.theme = THEMES.some((t) => t.id === themeId) ? themeId : 'amber';
  document.documentElement.dataset.theme = state.theme;
}

function themeChartColor() {
  return (THEMES.find((t) => t.id === state.theme) || THEMES[0]).chart;
}

function setTab(tab) {
  state.tab = tab;
  state.modal = null;
  render();
}

function openModal(type, payload = null) {
  state.modal = { type, payload };
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

function showToast(msg, isError = false) {
  state.toast = { msg, isError };
  render();
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    state.toast = null;
    const el = document.getElementById('toast');
    if (el) el.remove();
  }, 2600);
}

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const content = await renderTab(state.tab);
  const modalHtml = state.modal ? await renderModal() : '';
  // 描画中に新しい描画が始まっていたら、古い結果で上書きしない
  if (seq !== renderSeq) return;
  root.innerHTML = `
    <div class="screen">
      <main id="main" class="main">${content}</main>
      ${renderNav()}
    </div>
    ${modalHtml}
    ${state.toast ? `<div id="toast" class="toast ${state.toast.isError ? 'toast-error' : ''}">${escapeHtml(state.toast.msg)}</div>` : ''}
  `;
  attachHandlers();
  runPostRenderCharts();
}

function renderNav() {
  const items = [
    { id: 'home', label: 'ホーム', icon: iconHome() },
    { id: 'transactions', label: '収支', icon: iconList() },
    { id: 'shifts', label: 'シフト', icon: iconCalendar() },
    { id: 'charts', label: 'グラフ', icon: iconChart() },
    { id: 'funds', label: '資金', icon: iconWallet() },
    { id: 'goals', label: '目標', icon: iconTarget() },
    { id: 'settings', label: '設定', icon: iconGear() },
  ];
  return `<nav class="bottomnav">
    ${items.map((it) => `
      <button class="navbtn ${state.tab === it.id ? 'active' : ''}" data-nav="${it.id}">
        ${it.icon}
        <span>${it.label}</span>
      </button>`).join('')}
  </nav>`;
}

// ---------------- タブ振り分け ----------------

async function renderTab(tab) {
  if (tab === 'home') return renderHome();
  if (tab === 'transactions') return renderTransactions();
  if (tab === 'shifts') return renderShifts();
  if (tab === 'charts') return renderCharts();
  if (tab === 'funds') return renderFunds();
  if (tab === 'goals') return renderGoals();
  if (tab === 'settings') return renderSettings();
  return '';
}

// ---------------- ホーム ----------------

async function renderHome() {
  const month = thisMonth();
  const settings = await DB.getSettings();
  const summary = await DB.getMonthSummary(month);
  const totals = await DB.getFundTotals();
  const frameTotal = settings.frames.reduce((s, fr) => s + (totals[fr.id] || 0), 0);
  const totalAssets = (totals.free || 0) + frameTotal;
  const months = (await DB.getAllMonths()).slice().reverse().slice(0, 6);
  const shiftSummary = await DB.getMonthShiftSummary(month);

  return `
    <section class="hero-card">
      <div class="hero-label">今月あと自由に使える金額</div>
      <div class="hero-amount">${yen(totals.free || 0)}</div>
      <div class="hero-sub">${monthLabel(month)}${shiftSummary.count ? ` ・ シフト給与見込み ${yen(shiftSummary.totalPay)}` : ''}</div>
    </section>

    <section class="stat-grid">
      ${statTile('収入', summary.incomeTotal, 'up')}
      ${statTile('支出', summary.expenseTotal, 'down')}
      ${statTile('自由資金', totals.free || 0)}
      ${settings.frames.map((fr) => statTile(escapeHtml(fr.name), totals[fr.id] || 0)).join('')}
      ${statTile('総資産', totalAssets, 'total')}
    </section>

    <section class="section">
      <div class="section-head">
        <h2>クイック登録</h2>
      </div>
      <div class="quick-actions">
        <button class="btn btn-primary" data-open-modal="income">＋ 収入を登録</button>
        <button class="btn btn-outline" data-open-modal="expense">＋ 支出を登録</button>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>月別履歴</h2></div>
      ${months.length === 0 ? emptyState('まだ記録がありません', '収入を登録して家計簿を始めましょう') :
        `<div class="month-list">
          ${months.map((m) => `<button class="month-row" data-month="${m}">
            <span>${monthLabel(m)}</span>
            <span class="chev">›</span>
          </button>`).join('')}
        </div>`}
    </section>
  `;
}

function statTile(label, value, kind) {
  const cls = kind === 'up' ? 'stat-up' : kind === 'down' ? 'stat-down' : kind === 'total' ? 'stat-total' : '';
  return `<div class="stat-tile ${cls}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${yen(value)}</div>
  </div>`;
}

function emptyState(title, sub) {
  return `<div class="empty-state">
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-sub">${escapeHtml(sub)}</div>
  </div>`;
}

// ---------------- 収支 ----------------

async function renderTransactions() {
  const [incomes, expenses] = await Promise.all([DB.getAll('incomes'), DB.getAll('expenses')]);
  const items = [
    ...incomes.map((i) => ({ kind: 'income', date: i.date, sortKey: i.date + 'b', data: i })),
    ...expenses.map((e) => ({ kind: 'expense', date: e.date, sortKey: e.date + 'a', data: e })),
  ].sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));

  return `
    <section class="section sticky-actions">
      <div class="quick-actions">
        <button class="btn btn-primary" data-open-modal="income">＋ 収入を登録</button>
        <button class="btn btn-outline" data-open-modal="expense">＋ 支出を登録</button>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>履歴</h2></div>
      ${items.length === 0 ? emptyState('まだ記録がありません', '上のボタンから登録してください') :
        `<div class="tx-list">
          ${items.map((it) => renderTxRow(it)).join('')}
        </div>`}
    </section>
  `;
}

function renderTxRow(it) {
  if (it.kind === 'income') {
    const i = it.data;
    const alloc = DB.frameAllocOf(i);
    const parts = Object.entries(alloc).map(([fid, a]) => `${DB.frameName(fid)}${yen(a)}`);
    return `<div class="tx-row" data-income-id="${i.id}">
      <div class="tx-icon tx-icon-income">＋</div>
      <div class="tx-main">
        <div class="tx-title">収入${i.memo ? '・' + escapeHtml(i.memo) : ''}</div>
        <div class="tx-sub">${i.date}${parts.length ? ' ・ ' + escapeHtml(parts.join(' / ')) : ''}</div>
      </div>
      <div class="tx-amount tx-amount-up">+${yen(i.amount)}</div>
    </div>`;
  }
  const e = it.data;
  return `<div class="tx-row" data-expense-id="${e.id}">
    <div class="tx-icon tx-icon-expense">－</div>
    <div class="tx-main">
      <div class="tx-title">${escapeHtml(e.name)}</div>
      <div class="tx-sub">${e.date} ・ ${escapeHtml(e.category)}</div>
    </div>
    <div class="tx-amount tx-amount-down">-${yen(e.amount)}</div>
  </div>`;
}

// ---------------- グラフ ----------------

async function renderCharts() {
  const month = thisMonth();
  const summary = await DB.getMonthSummary(month);
  const diff = summary.incomeTotal - summary.expenseTotal;
  return `
    <section class="section">
      <div class="section-head"><h2>今月の収支（${monthLabel(month)}）</h2></div>
      <div class="stat-grid stat-grid-3">
        ${statTile('収入', summary.incomeTotal, 'up')}
        ${statTile('支出', summary.expenseTotal, 'down')}
        <div class="stat-tile ${diff >= 0 ? 'stat-up' : 'stat-down'}">
          <div class="stat-label">差額</div>
          <div class="stat-value stat-value-sm">${diff >= 0 ? '+' : '−'}${yen(Math.abs(diff))}</div>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>資金の内訳</h2></div>
      <div class="chart-card"><canvas id="chart-funds" height="80"></canvas></div>
    </section>
    <section class="section">
      <div class="section-head"><h2>月別収入</h2></div>
      <div class="chart-card"><canvas id="chart-income" height="220"></canvas></div>
    </section>
    <section class="section">
      <div class="section-head"><h2>月別支出</h2></div>
      <div class="chart-card"><canvas id="chart-expense" height="220"></canvas></div>
    </section>
    <section class="section">
      <div class="section-head"><h2>資産残高の推移</h2></div>
      <div class="chart-card"><canvas id="chart-assets" height="220"></canvas></div>
    </section>
    <section class="section">
      <div class="section-head">
        <h2>カテゴリ別支出</h2>
      </div>
      <button class="btn btn-outline btn-block" data-open-modal="categoryChart">今年のカテゴリ別内訳を見る</button>
    </section>
  `;
}

async function runPostRenderCharts() {
  const fundsCanvas = document.getElementById('chart-funds');
  if (fundsCanvas) {
    const settings = await DB.getSettings();
    const totals = await DB.getFundTotals();
    const entries = [
      { label: '自由資金', value: totals.free || 0, color: palette(1) },
      ...settings.frames.map((fr, i) => ({ label: fr.name, value: totals[fr.id] || 0, color: palette(i + 2) })),
    ].filter((e) => e.value > 0);
    if (entries.length === 0) {
      const ctx = fundsCanvas.getContext('2d');
      ctx.fillStyle = 'rgba(128,128,128,0.6)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('残高がありません', fundsCanvas.parentElement.clientWidth / 2, 40);
    } else {
      fundsCanvas.height = Math.max(entries.length * 30 + 10, 80);
      Charts.drawHBarBreakdown(fundsCanvas, entries);
    }
  }

  const incomeCanvas = document.getElementById('chart-income');
  const expenseCanvas = document.getElementById('chart-expense');
  const assetsCanvas = document.getElementById('chart-assets');
  if (incomeCanvas || expenseCanvas || assetsCanvas) {
    const months = await DB.getAllMonths();
    if (months.length === 0) {
      [incomeCanvas, expenseCanvas, assetsCanvas].forEach((c) => {
        if (!c) return;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(128,128,128,0.6)';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('データがありません', c.parentElement.clientWidth / 2, 100);
      });
      return;
    }
    const labels = months.map((m) => m.slice(2).replace('-', '/'));
    const incomeVals = [];
    const expenseVals = [];
    let running = 0;
    const assetVals = [];
    for (const m of months) {
      const s = await DB.getMonthSummary(m);
      incomeVals.push(s.incomeTotal);
      expenseVals.push(s.expenseTotal);
      running += s.incomeTotal - s.expenseTotal;
      assetVals.push(running);
    }
    if (incomeCanvas) Charts.drawBarChart(incomeCanvas, labels, incomeVals, { color: '#6FAE9C' });
    if (expenseCanvas) Charts.drawBarChart(expenseCanvas, labels, expenseVals, { color: themeChartColor() });
    if (assetsCanvas) Charts.drawLineChart(assetsCanvas, labels, assetVals, { color: '#8FB3D9' });
  }

  const catCanvas = document.getElementById('chart-category-modal');
  if (catCanvas) {
    const year = state.modal?.payload?.year || new Date().getFullYear();
    const totals = await DB.getCategoryTotals(year);
    const entries = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value, color: palette(i) }));
    if (entries.length === 0) {
      const ctx = catCanvas.getContext('2d');
      ctx.fillStyle = 'rgba(128,128,128,0.6)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('この年のデータはありません', catCanvas.parentElement.clientWidth / 2, 40);
    } else {
      catCanvas.height = Math.max(entries.length * 30 + 10, 80);
      Charts.drawHBarBreakdown(catCanvas, entries);
    }
  }
}

function palette(i) {
  const colors = ['#D4A15C', '#6FAE9C', '#8FB3D9', '#C97B7B', '#B79FD4', '#7FBFA0', '#E0B872', '#9BC1D9', '#D18F9C', '#A8A8A8'];
  return colors[i % colors.length];
}

// ---------------- 資金 ----------------

async function renderFunds() {
  const settings = await DB.getSettings();
  const totals = await DB.getFundTotals();
  const free = await DB.getFundsByType('free');
  const frameFunds = {};
  for (const fr of settings.frames) frameFunds[fr.id] = await DB.getFundsByType(fr.id);
  // 削除済み枠など、設定に無いtypeの残高も落とさないよう表示する
  const knownTypes = new Set(['free', ...settings.frames.map((f) => f.id)]);
  const orphanTypes = Object.keys(totals).filter((t) => !knownTypes.has(t) && totals[t] > 0);

  return `
    <section class="stat-grid ${settings.frames.length + 1 <= 3 ? 'stat-grid-3' : ''}">
      ${statTile('自由資金', totals.free || 0)}
      ${settings.frames.map((fr) => statTile(escapeHtml(fr.name), totals[fr.id] || 0)).join('')}
      ${orphanTypes.map((t) => statTile(escapeHtml(DB.frameName(t)), totals[t])).join('')}
    </section>
    <section class="section">
      <button class="btn btn-outline btn-block" data-open-modal="transfer">⇄ 資金を移動する（枠のあいだ）</button>
    </section>
    ${fundSection('自由資金の内訳（出身月別）', free)}
    ${settings.frames.map((fr) => fundSection(`${escapeHtml(fr.name)}の内訳（積立月別）`, frameFunds[fr.id])).join('')}
    ${orphanTypes.map((t) => fundSection(`${escapeHtml(DB.frameName(t))}の内訳（積立月別）`, [])).join('')}
  `;
}

function fundSection(title, funds) {
  const active = funds.filter((f) => f.remainingAmount > 0);
  return `<section class="section">
    <div class="section-head"><h2>${title}</h2></div>
    ${active.length === 0 ? emptyState('残高はありません', '') :
      `<div class="fund-list">
        ${active.map((f) => `
          <div class="fund-row">
            <div class="fund-month">${monthLabel(f.sourceMonth)}</div>
            <div class="fund-bar-wrap">
              <div class="fund-bar" style="width:${Math.max(4, (f.remainingAmount / f.originalAmount) * 100)}%"></div>
            </div>
            <div class="fund-amount">${yen(f.remainingAmount)}<span class="fund-orig"> / ${yen(f.originalAmount)}</span></div>
          </div>`).join('')}
      </div>`}
  </section>`;
}

// ---------------- シフト ----------------

async function renderShifts() {
  const settings = await DB.getSettings();
  const month = state.shiftMonth || thisMonth();
  const { shifts, totalMinutes, totalPay, count } = await DB.getMonthShiftSummary(month);
  const savingsEstimate = Math.floor((totalPay * (settings.savingsRate || 0)) / 100);

  const [y, mo] = month.split('-').map((x) => parseInt(x, 10));
  const firstDay = new Date(y, mo - 1, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // 月曜始まり
  const daysInMonth = new Date(y, mo, 0).getDate();
  const byDate = {};
  shifts.forEach((s) => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });
  const today = todayISO();
  const dows = ['月', '火', '水', '木', '金', '土', '日'];

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += `<div class="cal-day cal-dim"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
    const dayShifts = byDate[dateStr] || [];
    const dayPay = dayShifts.reduce((s, x) => s + x.pay, 0);
    const dayMin = dayShifts.reduce((s, x) => s + x.minutes, 0);
    cells += `<button class="cal-day ${dateStr === today ? 'cal-today' : ''}" data-shift-day="${dateStr}">
      <span class="cal-num">${d}</span>
      ${dayShifts.length ? `<span class="cal-shift">${hoursLabel(dayMin)}</span><span class="cal-pay">${yen(dayPay)}</span>` : ''}
    </button>`;
  }

  return `
    <section class="section">
      <div class="cal-head">
        <button class="btn btn-outline cal-nav" data-shift-nav="-1">‹ 前月</button>
        <div class="year-label">${monthLabel(month)}</div>
        <button class="btn btn-outline cal-nav" data-shift-nav="1">翌月 ›</button>
      </div>
      <div class="stat-grid stat-grid-3">
        <div class="stat-tile">
          <div class="stat-label">勤務時間（${count}回）</div>
          <div class="stat-value stat-value-sm">${hoursLabel(totalMinutes)}</div>
        </div>
        <div class="stat-tile stat-up">
          <div class="stat-label">給与見込み</div>
          <div class="stat-value stat-value-sm">${yen(totalPay)}</div>
        </div>
        <div class="stat-tile stat-total">
          <div class="stat-label">貯金見込み（${settings.savingsRate}%）</div>
          <div class="stat-value stat-value-sm">${yen(savingsEstimate)}</div>
        </div>
      </div>
      <div class="hint">貯金見込みは「給与見込み × 貯金率」で計算しています。貯金率と時給の初期値は設定タブで変更できます。日付をタップするとシフトを追加・削除できます。</div>
    </section>

    <section class="section">
      <div class="cal-grid cal-dow-row">
        ${dows.map((d, i) => `<div class="cal-dow ${i === 5 ? 'cal-sat' : i === 6 ? 'cal-sun' : ''}">${d}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2>この月のシフト一覧</h2></div>
      ${shifts.length === 0 ? emptyState('シフトはまだありません', 'カレンダーの日付をタップして追加しましょう') :
        `<div class="tx-list">
          ${shifts.map((s) => `<div class="tx-row" data-shift-day="${s.date}">
            <div class="tx-icon tx-icon-income">勤</div>
            <div class="tx-main">
              <div class="tx-title">${s.date.slice(5).replace('-', '/')} ${escapeHtml(s.start)}–${escapeHtml(s.end)}</div>
              <div class="tx-sub">${hoursLabel(s.minutes)} ・ 時給${yen(s.wage)}${s.breakMin ? ` ・ 休憩${s.breakMin}分` : ''}</div>
            </div>
            <div class="tx-amount tx-amount-up">${yen(s.pay)}</div>
          </div>`).join('')}
        </div>`}
    </section>
  `;
}

// ---------------- 目標 ----------------

async function renderGoals() {
  const goals = await DB.getGoals();
  return `
    <section class="section">
      <div class="section-head">
        <h2>買いたいものの目標</h2>
        <button class="btn btn-primary btn-sm" data-open-modal="goalNew">＋ 追加</button>
      </div>
      ${goals.length === 0 ? emptyState('目標はまだありません', '欲しいものを登録して、貯金の進み具合を見える化しましょう') :
        `<div class="goal-list">
          ${goals.map((g) => goalCard(g)).join('')}
        </div>`}
    </section>
  `;
}

function goalCard(g) {
  const pct = g.targetAmount > 0 ? Math.min(100, Math.floor(((g.savedAmount || 0) / g.targetAmount) * 100)) : 0;
  const done = g.targetAmount > 0 && (g.savedAmount || 0) >= g.targetAmount;
  const remain = Math.max(0, g.targetAmount - (g.savedAmount || 0));
  return `<div class="goal-card" data-goal-id="${g.id}">
    ${g.image ? `<img class="goal-img" src="${g.image}" alt="">` : ''}
    <div class="goal-body">
    <div class="goal-head">
      <div class="goal-name">${escapeHtml(g.name)}${done ? ' <span class="goal-done">達成！</span>' : ''}</div>
      <div class="goal-pct">${pct}%</div>
    </div>
    <div class="fund-bar-wrap">
      <div class="fund-bar" style="width:${Math.max(pct, (g.savedAmount || 0) > 0 ? 3 : 0)}%"></div>
    </div>
    <div class="goal-meta">
      <span>${yen(g.savedAmount || 0)} <span class="fund-orig">/ ${yen(g.targetAmount)}</span></span>
      <span>${done ? 'おめでとうございます' : 'あと ' + yen(remain)}${g.deadline ? ' ・ 目標日 ' + escapeHtml(g.deadline) : ''}</span>
    </div>
    </div>
  </div>`;
}

// ---------------- 設定 ----------------

async function renderSettings() {
  const settings = await DB.getSettings();
  const totals = await DB.getFundTotals();
  return `
    <section class="section">
      <div class="section-head"><h2>テーマカラー</h2></div>
      <div class="form-card">
        <div class="swatch-row">
          ${THEMES.map((t) => `<button class="swatch ${state.theme === t.id ? 'active' : ''}" data-theme="${t.id}" style="background:${t.color}" title="${t.name}"></button>`).join('')}
        </div>
        <div class="hint">${(THEMES.find((t) => t.id === state.theme) || THEMES[0]).name}（ボタンやグラフの色合いが変わります）</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>貯金枠</h2></div>
      <div class="form-card">
        <div class="hint">収入を登録するとき、ここで作った枠ごとに積立額を分けて管理できます。残高が残っている枠は削除できません。</div>
        ${settings.frames.map((fr) => `
          <div class="frame-row">
            <label class="field"><span>枠の名前</span><input type="text" data-frame-name="${fr.id}" value="${escapeHtml(fr.name)}"></label>
            <label class="field"><span>毎月の初期値（残高 ${yen(totals[fr.id] || 0)}）</span><input type="number" data-frame-default="${fr.id}" value="${fr.defaultAmount}" inputmode="numeric"></label>
            <button class="btn btn-danger btn-sm" data-del-frame="${fr.id}">削除</button>
          </div>`).join('')}
        <button class="btn btn-primary btn-block" id="save-frames">枠の設定を保存する</button>
        <div class="inline-form">
          <input type="text" id="new-frame-name" placeholder="新しい枠の名前（例：旅行）">
          <input type="number" id="new-frame-default" placeholder="初期値" inputmode="numeric" style="max-width:96px;flex:none;">
          <button class="btn btn-outline" id="add-frame">追加</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>シフトの初期値</h2></div>
      <div class="form-card">
        <label class="field">
          <span>時給（新規シフトの初期値）</span>
          <input type="number" id="set-wage" value="${settings.defaultHourlyWage}" inputmode="numeric">
        </label>
        <label class="field">
          <span>貯金率（給与見込みから貯金見込みを計算）</span>
          <div class="inline-form">
            <input type="number" id="set-rate" value="${settings.savingsRate}" inputmode="numeric" min="0" max="100">
            <span class="hint" style="flex:none;">%</span>
          </div>
        </label>
        <button class="btn btn-primary btn-block" id="save-shift-settings">保存する</button>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>支出カテゴリ</h2></div>
      <div class="form-card">
        <div class="chip-list">
          ${settings.categories.map((c) => `<span class="chip">${escapeHtml(c)}<button class="chip-x" data-del-category="${escapeHtml(c)}">×</button></span>`).join('')}
        </div>
        <div class="inline-form">
          <input type="text" id="new-category" placeholder="新しいカテゴリ名">
          <button class="btn btn-outline" id="add-category">追加</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>バックアップ</h2></div>
      <div class="form-card">
        <button class="btn btn-outline btn-block" id="export-json">JSONを書き出す</button>
        <label class="btn btn-outline btn-block file-btn">
          JSONを読み込む
          <input type="file" id="import-json" accept="application/json" hidden>
        </label>
        <button class="btn btn-outline btn-block" id="export-csv">CSV出力（支出）</button>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>データ管理</h2></div>
      <div class="form-card">
        <button class="btn btn-danger btn-block" id="delete-all">すべてのデータを削除</button>
      </div>
    </section>
  `;
}

// ---------------- モーダル ----------------

async function renderModal() {
  const { type, payload } = state.modal;
  let body = '';
  if (type === 'income') body = await renderIncomeForm();
  else if (type === 'expense') body = await renderExpenseForm();
  else if (type === 'expenseDetail') body = await renderExpenseDetail(payload);
  else if (type === 'monthDetail') body = await renderMonthDetail(payload);
  else if (type === 'categoryChart') body = renderCategoryChartModal(payload);
  else if (type === 'shiftDay') body = await renderShiftDayModal(payload);
  else if (type === 'transfer') body = await renderTransferModal();
  else if (type === 'goalNew') body = renderGoalNewModal();
  else if (type === 'goalDetail') body = await renderGoalDetailModal(payload);
  else if (type === 'confirmDeleteFrame') body = await renderConfirmDeleteFrame(payload);
  else if (type === 'confirmDeleteAll') body = renderConfirmDeleteAll();

  return `<div class="modal-backdrop" data-close-modal="1">
    <div class="modal-sheet" data-stop="1">
      ${body}
    </div>
  </div>`;
}

async function renderIncomeForm() {
  const settings = await DB.getSettings();
  const now = new Date();
  const shiftSummary = await DB.getMonthShiftSummary(thisMonth());
  const frameFields = settings.frames.map((fr) => `
    <label class="field"><span>${escapeHtml(fr.name)}</span><input type="number" class="frame-amt" name="frame_${fr.id}" value="${fr.defaultAmount}" inputmode="numeric"></label>`).join('');
  return `
    <div class="modal-head">
      <h2>収入を登録</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <form id="income-form" class="modal-form">
      <div class="field-row">
        <label class="field"><span>年</span><input type="number" name="year" value="${now.getFullYear()}" required></label>
        <label class="field"><span>月</span><input type="number" name="month" min="1" max="12" value="${now.getMonth() + 1}" required></label>
      </div>
      ${shiftSummary.totalPay > 0 ? `
      <div class="suggest-box">
        <div class="suggest-text">今月のシフト給与見込みは <strong>${yen(shiftSummary.totalPay)}</strong> です。そのまま入力しますか？</div>
        <button type="button" class="btn btn-outline btn-sm" id="use-shift-pay" data-amount="${shiftSummary.totalPay}">この金額で入力する</button>
      </div>` : ''}
      <label class="field"><span>金額</span><input type="number" name="amount" inputmode="numeric" placeholder="49500" required></label>
      <div class="section-head" style="margin-top:4px;"><h3>貯金枠への積立</h3></div>
      <div class="frame-fields">${frameFields || '<div class="hint">貯金枠がありません（設定タブで追加できます）</div>'}</div>
      <div class="hint" id="free-preview">自由資金：¥0</div>
      <label class="field"><span>メモ（任意）</span><input type="text" name="memo" placeholder=""></label>
      <button type="submit" class="btn btn-primary btn-block">登録する</button>
    </form>
  `;
}

async function renderExpenseForm() {
  const settings = await DB.getSettings();
  const totals = await DB.getFundTotals();
  return `
    <div class="modal-head">
      <h2>支出を登録</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <form id="expense-form" class="modal-form">
      <label class="field"><span>日付</span><input type="date" name="date" value="${todayISO()}" required></label>
      <label class="field"><span>項目名</span><input type="text" name="name" placeholder="例：ホイール" required></label>
      <label class="field"><span>金額</span><input type="number" name="amount" inputmode="numeric" placeholder="70000" required></label>
      <label class="field">
        <span>カテゴリ</span>
        <select name="category">
          ${settings.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>メモ（任意）</span><input type="text" name="memo"></label>

      <div class="section-head" style="margin-top:8px;">
        <h3>支払い元</h3>
      </div>
      <div class="hint">未入力の場合は自由資金からFIFOで自動的に支払われます。複数の資金から支払う場合は金額を入力してください。</div>
      <label class="field"><span>自由資金（残高 ${yen(totals.free || 0)}）</span><input type="number" name="alloc_free" inputmode="numeric" placeholder="自動"></label>
      ${settings.frames.map((fr) => `
      <label class="field"><span>${escapeHtml(fr.name)}（残高 ${yen(totals[fr.id] || 0)}）</span><input type="number" name="alloc_${fr.id}" inputmode="numeric" placeholder="0"></label>`).join('')}
      <button type="submit" class="btn btn-primary btn-block">登録する</button>
    </form>
  `;
}

async function renderExpenseDetail(expenseId) {
  const expenses = await DB.getAll('expenses');
  const e = expenses.find((x) => x.id === expenseId);
  if (!e) return `<div class="modal-head"><h2>見つかりません</h2><button class="icon-btn" data-close-modal="1">✕</button></div>`;
  await DB.getSettings(); // 枠名のキャッシュを最新化
  return `
    <div class="modal-head">
      <h2>${escapeHtml(e.name)}</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <div class="detail-amount">${yen(e.amount)}</div>
    <div class="detail-meta">${e.date} ・ ${escapeHtml(e.category)}${e.memo ? ' ・ ' + escapeHtml(e.memo) : ''}</div>
    <div class="section-head" style="margin-top:16px;"><h3>この支出に使用した資金</h3></div>
    <div class="alloc-list">
      ${e.allocations.map((a) => `<div class="alloc-row">
        <span>${monthLabel(a.sourceMonth)}${escapeHtml(DB.typeLabel(a.type))}</span>
        <span>${yen(a.amount)}</span>
      </div>`).join('') || '<div class="hint">内訳情報がありません</div>'}
      <div class="alloc-row alloc-total"><span>合計</span><span>${yen(e.allocations.reduce((s, a) => s + a.amount, 0))}</span></div>
    </div>
    <button class="btn btn-danger btn-block" style="margin-top:16px;" data-delete-expense="${e.id}">この支出を削除</button>
  `;
}

async function renderMonthDetail(month) {
  const settings = await DB.getSettings();
  const s = await DB.getMonthSummary(month);
  return `
    <div class="modal-head">
      <h2>${monthLabel(month)}</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <div class="stat-grid">
      ${statTile('収入', s.incomeTotal, 'up')}
      ${statTile('支出', s.expenseTotal, 'down')}
      ${settings.frames.map((fr) => statTile(escapeHtml(fr.name), s.frames[fr.id] || 0)).join('')}
      ${statTile('自由資金', s.free)}
    </div>
    <div class="section-head" style="margin-top:12px;"><h3>この月の収支一覧</h3></div>
    <div class="tx-list">
      ${[...s.incomes.map((i) => ({ kind: 'income', data: i })), ...s.expenses.map((e) => ({ kind: 'expense', data: e }))]
        .map((it) => renderTxRow(it)).join('') || emptyState('記録がありません', '')}
    </div>
  `;
}

function renderCategoryChartModal(payload) {
  const year = payload?.year || new Date().getFullYear();
  return `
    <div class="modal-head">
      <h2>カテゴリ別支出</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <div class="inline-form" style="margin-bottom:12px;">
      <button class="btn btn-outline" data-year-shift="-1">‹ ${year - 1}年</button>
      <div class="year-label">${year}年</div>
      <button class="btn btn-outline" data-year-shift="1">${year + 1}年 ›</button>
    </div>
    <div class="chart-card"><canvas id="chart-category-modal" height="80"></canvas></div>
  `;
}

async function renderShiftDayModal(dateStr) {
  const settings = await DB.getSettings();
  const shifts = (await DB.getShiftsByMonth(dateStr.slice(0, 7))).filter((s) => s.date === dateStr);
  const [, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  return `
    <div class="modal-head">
      <h2>${m}月${d}日のシフト</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    ${shifts.length ? `<div class="tx-list" style="margin-bottom:14px;">
      ${shifts.map((s) => `<div class="tx-row">
        <div class="tx-main">
          <div class="tx-title">${escapeHtml(s.start)}–${escapeHtml(s.end)}</div>
          <div class="tx-sub">${hoursLabel(s.minutes)} ・ 時給${yen(s.wage)}${s.breakMin ? ` ・ 休憩${s.breakMin}分` : ''} ・ ${yen(s.pay)}</div>
        </div>
        <button class="btn btn-danger btn-sm" data-delete-shift="${s.id}">削除</button>
      </div>`).join('')}
    </div>` : '<div class="hint" style="margin-bottom:12px;">この日のシフトはまだありません。</div>'}
    <form id="shift-form" class="modal-form">
      <input type="hidden" name="date" value="${dateStr}">
      <div class="field-row">
        <label class="field"><span>開始</span><input type="time" name="start" value="17:00" required></label>
        <label class="field"><span>終了</span><input type="time" name="end" value="22:00" required></label>
      </div>
      <div class="field-row">
        <label class="field"><span>休憩（分）</span><input type="number" name="breakMin" value="0" inputmode="numeric" min="0"></label>
        <label class="field"><span>時給</span><input type="number" name="wage" value="${settings.defaultHourlyWage}" inputmode="numeric" required></label>
      </div>
      <div class="hint" id="shift-preview">見込み：—</div>
      <button type="submit" class="btn btn-primary btn-block">シフトを追加</button>
    </form>
  `;
}

async function renderTransferModal() {
  const settings = await DB.getSettings();
  const totals = await DB.getFundTotals();
  const types = [
    { id: 'free', name: '自由資金' },
    ...settings.frames.map((fr) => ({ id: fr.id, name: fr.name })),
  ];
  const options = (selectedId) => types.map((t) => `
    <option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${escapeHtml(t.name)}（残高 ${yen(totals[t.id] || 0)}）</option>`).join('');
  return `
    <div class="modal-head">
      <h2>資金を移動する</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <form id="transfer-form" class="modal-form">
      <label class="field"><span>移動元</span><select name="from">${options('free')}</select></label>
      <label class="field"><span>移動先</span><select name="to">${options(settings.frames[0]?.id || 'free')}</select></label>
      <label class="field"><span>金額</span><input type="number" name="amount" inputmode="numeric" placeholder="5000" required></label>
      <div class="hint">移動元の古い積立から順に移します。移動先では同じ出身月の内訳として残ります。</div>
      <button type="submit" class="btn btn-primary btn-block">移動する</button>
    </form>
  `;
}

function renderGoalNewModal() {
  return `
    <div class="modal-head">
      <h2>目標を追加</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <form id="goal-form" class="modal-form">
      <label class="field"><span>買いたいもの</span><input type="text" name="name" placeholder="例：DDJ-1000" required></label>
      <label class="field"><span>目標金額</span><input type="number" name="targetAmount" inputmode="numeric" placeholder="150000" required></label>
      <label class="field"><span>目標日（任意）</span><input type="date" name="deadline"></label>
      <label class="field"><span>画像（任意）</span><input type="file" name="image" accept="image/*"></label>
      <button type="submit" class="btn btn-primary btn-block">追加する</button>
    </form>
  `;
}

async function renderGoalDetailModal(goalId) {
  const goals = await DB.getGoals();
  const g = goals.find((x) => x.id === goalId);
  if (!g) return `<div class="modal-head"><h2>見つかりません</h2><button class="icon-btn" data-close-modal="1">✕</button></div>`;
  const pct = g.targetAmount > 0 ? Math.min(100, Math.floor(((g.savedAmount || 0) / g.targetAmount) * 100)) : 0;
  return `
    <div class="modal-head">
      <h2>${escapeHtml(g.name)}</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    ${g.image ? `<img class="goal-detail-img" src="${g.image}" alt="">` : ''}
    <div class="detail-amount" style="color:var(--accent);">${yen(g.savedAmount || 0)}</div>
    <div class="detail-meta">目標 ${yen(g.targetAmount)} ・ ${pct}% ・ あと ${yen(Math.max(0, g.targetAmount - (g.savedAmount || 0)))}${g.deadline ? ' ・ 目標日 ' + escapeHtml(g.deadline) : ''}</div>
    <div class="fund-bar-wrap" style="margin-top:12px;">
      <div class="fund-bar" style="width:${Math.max(pct, (g.savedAmount || 0) > 0 ? 3 : 0)}%"></div>
    </div>
    <form id="goal-adjust-form" class="modal-form" style="margin-top:16px;">
      <input type="hidden" name="goalId" value="${g.id}">
      <label class="field"><span>金額</span><input type="number" name="delta" inputmode="numeric" placeholder="5000" required></label>
      <div class="field-row">
        <button type="submit" class="btn btn-primary btn-block" data-goal-adjust="in">貯金した</button>
        <button type="submit" class="btn btn-outline btn-block" data-goal-adjust="out">使った</button>
      </div>
    </form>
    <form id="goal-edit-form" class="modal-form" style="margin-top:20px;">
      <input type="hidden" name="goalId" value="${g.id}">
      <div class="section-head"><h3>目標を編集</h3></div>
      <label class="field"><span>名前</span><input type="text" name="name" value="${escapeHtml(g.name)}" required></label>
      <div class="field-row">
        <label class="field"><span>目標金額</span><input type="number" name="targetAmount" value="${g.targetAmount}" inputmode="numeric" required></label>
        <label class="field"><span>目標日（任意）</span><input type="date" name="deadline" value="${escapeHtml(g.deadline || '')}"></label>
      </div>
      <label class="field"><span>画像を変更（任意）</span><input type="file" name="image" accept="image/*"></label>
      ${g.image ? `<label class="check-row"><input type="checkbox" name="removeImage" value="1"> 画像を削除する</label>` : ''}
      <button type="submit" class="btn btn-outline btn-block">編集を保存</button>
    </form>
    <button class="btn btn-danger btn-block" style="margin-top:16px;" data-delete-goal="${g.id}">この目標を削除</button>
  `;
}

async function renderConfirmDeleteFrame(frameId) {
  const settings = await DB.getSettings();
  const fr = settings.frames.find((f) => f.id === frameId);
  const name = fr ? fr.name : frameId;
  return `
    <div class="modal-head"><h2>「${escapeHtml(name)}」を削除しますか？</h2></div>
    <p class="hint">この貯金枠を削除します。残高が残っている場合は削除できません。</p>
    <div class="field-row">
      <button class="btn btn-outline btn-block" data-close-modal="1">キャンセル</button>
      <button class="btn btn-danger btn-block" id="confirm-delete-frame" data-frame-id="${frameId}">削除する</button>
    </div>
  `;
}

function renderConfirmDeleteAll() {
  return `
    <div class="modal-head"><h2>本当に削除しますか？</h2></div>
    <p class="hint">本当にすべての家計簿データを削除しますか？この操作は元に戻せません。</p>
    <div class="field-row">
      <button class="btn btn-outline btn-block" data-close-modal="1">キャンセル</button>
      <button class="btn btn-danger btn-block" id="confirm-delete-all">削除する</button>
    </div>
  `;
}

// ---------------- イベント ----------------

function attachHandlers() {
  root.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => setTab(el.dataset.nav));
  });
  root.querySelectorAll('[data-open-modal]').forEach((el) => {
    el.addEventListener('click', () => openModal(el.dataset.openModal, el.dataset.openModal === 'categoryChart' ? { year: new Date().getFullYear() } : null));
  });
  root.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target === el) closeModal();
    });
  });
  const stopEl = root.querySelector('[data-stop]');
  if (stopEl) stopEl.addEventListener('click', (e) => e.stopPropagation());
  root.querySelectorAll('.icon-btn[data-close-modal]').forEach((el) => el.addEventListener('click', closeModal));

  root.querySelectorAll('[data-month]').forEach((el) => {
    el.addEventListener('click', () => openModal('monthDetail', el.dataset.month));
  });
  root.querySelectorAll('[data-expense-id]').forEach((el) => {
    el.addEventListener('click', () => openModal('expenseDetail', el.dataset.expenseId));
  });
  root.querySelectorAll('[data-delete-expense]').forEach((el) => {
    el.addEventListener('click', async () => {
      await DB.deleteExpense(el.dataset.deleteExpense);
      showToast('支出を削除しました');
      state.modal = null;
      render();
    });
  });
  root.querySelectorAll('[data-year-shift]').forEach((el) => {
    el.addEventListener('click', () => {
      const cur = state.modal.payload?.year || new Date().getFullYear();
      state.modal.payload = { year: cur + parseInt(el.dataset.yearShift, 10) };
      render();
    });
  });

  // ---- シフト ----
  root.querySelectorAll('[data-shift-nav]').forEach((el) => {
    el.addEventListener('click', () => {
      state.shiftMonth = shiftMonthOf(state.shiftMonth || thisMonth(), parseInt(el.dataset.shiftNav, 10));
      render();
    });
  });
  root.querySelectorAll('[data-shift-day]').forEach((el) => {
    el.addEventListener('click', () => openModal('shiftDay', el.dataset.shiftDay));
  });
  root.querySelectorAll('[data-delete-shift]').forEach((el) => {
    el.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const dateStr = state.modal?.payload;
      await DB.deleteShift(el.dataset.deleteShift);
      showToast('シフトを削除しました');
      if (dateStr) openModal('shiftDay', dateStr); else render();
    });
  });

  const shiftForm = document.getElementById('shift-form');
  if (shiftForm) {
    const preview = () => {
      const fd = new FormData(shiftForm);
      const minutes = DB.calcShift({ start: fd.get('start'), end: fd.get('end'), breakMin: Number(fd.get('breakMin') || 0) });
      const pay = Math.round((minutes / 60) * Number(fd.get('wage') || 0));
      const el = document.getElementById('shift-preview');
      if (el) el.textContent = `見込み：${hoursLabel(minutes)} ・ ${yen(pay)}`;
    };
    shiftForm.addEventListener('input', preview);
    preview();
    shiftForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(shiftForm);
      await DB.addShift({
        date: fd.get('date'),
        start: fd.get('start'),
        end: fd.get('end'),
        breakMin: Number(fd.get('breakMin') || 0),
        wage: Number(fd.get('wage') || 0),
      });
      showToast('シフトを追加しました');
      openModal('shiftDay', fd.get('date'));
    });
  }

  // ---- 目標 ----
  root.querySelectorAll('[data-goal-id]').forEach((el) => {
    el.addEventListener('click', () => openModal('goalDetail', el.dataset.goalId));
  });
  const goalForm = document.getElementById('goal-form');
  if (goalForm) {
    goalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(goalForm);
      const image = await readImageFile(goalForm.querySelector('[name="image"]'));
      await DB.addGoal({ name: fd.get('name'), targetAmount: Number(fd.get('targetAmount')), deadline: fd.get('deadline'), image });
      showToast('目標を追加しました');
      closeModal();
      render();
    });
  }
  const goalAdjustForm = document.getElementById('goal-adjust-form');
  if (goalAdjustForm) {
    goalAdjustForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(goalAdjustForm);
      const dir = e.submitter?.dataset?.goalAdjust === 'out' ? -1 : 1;
      const amount = Math.abs(Number(fd.get('delta') || 0));
      if (!amount) return;
      await DB.adjustGoalSaved(fd.get('goalId'), dir * amount);
      showToast(dir > 0 ? '貯金に加えました' : '貯金から減らしました');
      openModal('goalDetail', fd.get('goalId'));
    });
  }
  const goalEditForm = document.getElementById('goal-edit-form');
  if (goalEditForm) {
    goalEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(goalEditForm);
      const goals = await DB.getGoals();
      const g = goals.find((x) => x.id === fd.get('goalId'));
      if (!g) return;
      g.name = fd.get('name');
      g.targetAmount = Number(fd.get('targetAmount'));
      g.deadline = fd.get('deadline') || '';
      const image = await readImageFile(goalEditForm.querySelector('[name="image"]'));
      if (image) g.image = image;
      else if (fd.get('removeImage')) g.image = '';
      await DB.updateGoal(g);
      showToast('目標を更新しました');
      openModal('goalDetail', g.id);
    });
  }
  root.querySelectorAll('[data-delete-goal]').forEach((el) => {
    el.addEventListener('click', async () => {
      await DB.deleteGoal(el.dataset.deleteGoal);
      showToast('目標を削除しました');
      state.modal = null;
      render();
    });
  });

  // ---- 資金移動 ----
  const transferForm = document.getElementById('transfer-form');
  if (transferForm) {
    transferForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(transferForm);
      try {
        await DB.transferFunds(fd.get('from'), fd.get('to'), Number(fd.get('amount')));
        showToast('資金を移動しました');
        state.modal = null;
        render();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  // ---- 収入 ----
  const incomeForm = document.getElementById('income-form');
  if (incomeForm) {
    const preview = () => {
      const fd = new FormData(incomeForm);
      const amount = Number(fd.get('amount') || 0);
      let allocated = 0;
      incomeForm.querySelectorAll('.frame-amt').forEach((input) => (allocated += Number(input.value || 0)));
      document.getElementById('free-preview').textContent = `自由資金：${yen(amount - allocated)}`;
    };
    incomeForm.addEventListener('input', preview);
    preview();
    const useShiftPayBtn = document.getElementById('use-shift-pay');
    if (useShiftPayBtn) {
      useShiftPayBtn.addEventListener('click', () => {
        const amountInput = incomeForm.querySelector('[name="amount"]');
        amountInput.value = useShiftPayBtn.dataset.amount;
        useShiftPayBtn.textContent = '入力しました ✓';
        preview();
      });
    }
    incomeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(incomeForm);
      const frameAllocations = {};
      incomeForm.querySelectorAll('.frame-amt').forEach((input) => {
        frameAllocations[input.name.replace('frame_', '')] = Number(input.value || 0);
      });
      await DB.addIncome({
        year: Number(fd.get('year')),
        month: Number(fd.get('month')),
        amount: Number(fd.get('amount')),
        frameAllocations,
        memo: fd.get('memo'),
      });
      showToast('収入を登録しました');
      closeModal();
      state.tab = state.tab === 'settings' ? 'home' : state.tab;
      render();
    });
  }

  // ---- 支出 ----
  const expenseForm = document.getElementById('expense-form');
  if (expenseForm) {
    expenseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(expenseForm);
      const amount = Number(fd.get('amount'));
      const settings = await DB.getSettings();
      const types = ['free', ...settings.frames.map((fr) => fr.id)];
      const requestedByType = types.map((t) => ({ type: t, amount: Number(fd.get('alloc_' + t) || 0) }));
      const manualTotal = requestedByType.reduce((s, r) => s + r.amount, 0);

      let finalRequest;
      if (manualTotal > 0) {
        if (manualTotal !== amount) {
          showToast(`支払い元の合計(${yen(manualTotal)})が支出額(${yen(amount)})と一致しません`, true);
          return;
        }
        finalRequest = requestedByType;
      } else {
        finalRequest = [{ type: 'free', amount }];
      }

      const { shortfall } = await DB.addExpense({
        date: fd.get('date'),
        amount,
        category: fd.get('category'),
        name: fd.get('name'),
        memo: fd.get('memo'),
        requestedByType: finalRequest,
      });

      if (shortfall.length) {
        showToast(`資金が不足しています: ${shortfall.map((s) => DB.typeLabel(s.type) + ' ' + yen(s.missing) + '不足').join(' / ')}`, true);
      } else {
        showToast('支出を登録しました');
      }
      closeModal();
      render();
    });
  }

  // ---- 設定: テーマ ----
  root.querySelectorAll('[data-theme]').forEach((el) => {
    el.addEventListener('click', async () => {
      await DB.saveSetting('theme', el.dataset.theme);
      applyTheme(el.dataset.theme);
      showToast('テーマカラーを変更しました');
      render();
    });
  });

  // ---- 設定: 貯金枠 ----
  const saveFramesBtn = document.getElementById('save-frames');
  if (saveFramesBtn) {
    saveFramesBtn.addEventListener('click', async () => {
      const settings = await DB.getSettings();
      const frames = settings.frames.map((fr) => {
        const nameInput = document.querySelector(`[data-frame-name="${fr.id}"]`);
        const defInput = document.querySelector(`[data-frame-default="${fr.id}"]`);
        return {
          id: fr.id,
          name: nameInput ? nameInput.value.trim() || fr.name : fr.name,
          defaultAmount: defInput ? Number(defInput.value || 0) : fr.defaultAmount,
        };
      });
      await DB.updateFrames(frames);
      showToast('貯金枠の設定を保存しました');
      render();
    });
  }
  const addFrameBtn = document.getElementById('add-frame');
  if (addFrameBtn) {
    addFrameBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('new-frame-name');
      const defInput = document.getElementById('new-frame-default');
      const name = nameInput.value.trim();
      if (!name) {
        showToast('枠の名前を入力してください', true);
        return;
      }
      await DB.addFrame(name, Number(defInput.value || 0));
      showToast(`「${name}」を追加しました`);
      render();
    });
  }
  root.querySelectorAll('[data-del-frame]').forEach((el) => {
    el.addEventListener('click', () => openModal('confirmDeleteFrame', el.dataset.delFrame));
  });
  const confirmDeleteFrameBtn = document.getElementById('confirm-delete-frame');
  if (confirmDeleteFrameBtn) {
    confirmDeleteFrameBtn.addEventListener('click', async () => {
      try {
        await DB.deleteFrame(confirmDeleteFrameBtn.dataset.frameId);
        showToast('貯金枠を削除しました');
        state.modal = null;
        render();
      } catch (err) {
        showToast(err.message, true);
        state.modal = null;
        render();
      }
    });
  }

  // ---- 設定: シフト初期値 ----
  const saveShiftBtn = document.getElementById('save-shift-settings');
  if (saveShiftBtn) {
    saveShiftBtn.addEventListener('click', async () => {
      const wage = Number(document.getElementById('set-wage').value || 0);
      const rate = Math.min(100, Math.max(0, Number(document.getElementById('set-rate').value || 0)));
      await DB.saveSetting('defaultHourlyWage', wage);
      await DB.saveSetting('savingsRate', rate);
      showToast('シフトの初期値を保存しました');
    });
  }

  // ---- 設定: カテゴリ ----
  const addCategoryBtn = document.getElementById('add-category');
  if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', async () => {
      const input = document.getElementById('new-category');
      const name = input.value.trim();
      if (!name) return;
      const settings = await DB.getSettings();
      if (settings.categories.includes(name)) {
        showToast('すでに存在します', true);
        return;
      }
      settings.categories.push(name);
      await DB.saveSetting('categories', settings.categories);
      render();
    });
  }
  root.querySelectorAll('[data-del-category]').forEach((el) => {
    el.addEventListener('click', async () => {
      const settings = await DB.getSettings();
      settings.categories = settings.categories.filter((c) => c !== el.dataset.delCategory);
      await DB.saveSetting('categories', settings.categories);
      render();
    });
  });

  // ---- バックアップ ----
  const exportJsonBtn = document.getElementById('export-json');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', async () => {
      const data = await DB.exportAllData();
      downloadFile(`kakeibo_backup_${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
    });
  }
  const importJsonInput = document.getElementById('import-json');
  if (importJsonInput) {
    importJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await DB.importAllData(data);
        await DB.ensureDefaultsSeeded();
        const settings = await DB.getSettings();
        applyTheme(settings.theme);
        showToast('データを復元しました');
        render();
      } catch (err) {
        showToast('読み込みに失敗しました: ' + err.message, true);
      }
    });
  }
  const exportCsvBtn = document.getElementById('export-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', async () => {
      await DB.getSettings();
      const csv = await DB.exportExpensesCSV();
      downloadFile(`kakeibo_expenses_${todayISO()}.csv`, '﻿' + csv, 'text/csv');
    });
  }

  const deleteAllBtn = document.getElementById('delete-all');
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', () => openModal('confirmDeleteAll'));
  }
  const confirmDeleteAllBtn = document.getElementById('confirm-delete-all');
  if (confirmDeleteAllBtn) {
    confirmDeleteAllBtn.addEventListener('click', async () => {
      await DB.clearAll();
      await DB.ensureDefaultsSeeded();
      const settings = await DB.getSettings();
      applyTheme(settings.theme);
      showToast('すべてのデータを削除しました');
      closeModal();
      setTab('home');
    });
  }
}

// 画像ファイル → dataURL。まず長辺720pxに縮小して保存容量を抑え、
// うまくいかない環境では元のまま読み込む。
function readImageFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return Promise.resolve(null);
  return compressImageFile(file).catch(() => readAsDataURL(file));
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('image load timeout'));
    }, 4000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const maxDim = 720;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- アイコン ----------------

function iconHome() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 11.5L12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function iconList() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
function iconCalendar() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}
function iconChart() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 19V10M12 19V5M19 19v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
function iconWallet() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3.5" y="6.5" width="17" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 12.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
function iconTarget() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>`;
}
function iconGear() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2.1 1.2L10 21h4l.5-2.6c.8-.3 1.5-.7 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}

init();
