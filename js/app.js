import { DB } from './db.js';
import { Charts } from './charts.js';

const state = {
  tab: 'home',
  modal: null, // {type:'income'|'expense'|'expenseDetail'|'monthDetail'|'categoryChart'|'confirmDelete', payload}
  toast: null,
};

const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const todayISO = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return `${y}年${parseInt(mo, 10)}月`;
};

const root = document.getElementById('app');

async function init() {
  await DB.ensureDefaultsSeeded();
  render();
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

async function render() {
  const content = await renderTab(state.tab);
  root.innerHTML = `
    <div class="screen">
      <main id="main" class="main">${content}</main>
      ${renderNav()}
    </div>
    ${state.modal ? await renderModal() : ''}
    ${state.toast ? `<div id="toast" class="toast ${state.toast.isError ? 'toast-error' : ''}">${escapeHtml(state.toast.msg)}</div>` : ''}
  `;
  attachHandlers();
  runPostRenderCharts();
}

function renderNav() {
  const items = [
    { id: 'home', label: 'ホーム', icon: iconHome() },
    { id: 'transactions', label: '収支', icon: iconList() },
    { id: 'charts', label: 'グラフ', icon: iconChart() },
    { id: 'funds', label: '資金', icon: iconWallet() },
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

// ---------------- ホーム ----------------

async function renderTab(tab) {
  if (tab === 'home') return renderHome();
  if (tab === 'transactions') return renderTransactions();
  if (tab === 'charts') return renderCharts();
  if (tab === 'funds') return renderFunds();
  if (tab === 'settings') return renderSettings();
  return '';
}

async function renderHome() {
  const month = thisMonth();
  const summary = await DB.getMonthSummary(month);
  const totals = await DB.getFundTotals();
  const totalAssets = totals.free + totals.savings + totals.car;
  const months = (await DB.getAllMonths()).slice().reverse().slice(0, 6);

  return `
    <section class="hero-card">
      <div class="hero-label">今月あと自由に使える金額</div>
      <div class="hero-amount">${yen(totals.free)}</div>
      <div class="hero-sub">${monthLabel(month)}</div>
    </section>

    <section class="stat-grid">
      ${statTile('収入', summary.incomeTotal, 'up')}
      ${statTile('支出', summary.expenseTotal, 'down')}
      ${statTile('自由資金', totals.free)}
      ${statTile('普通貯金', totals.savings)}
      ${statTile('車維持費', totals.car)}
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
    return `<div class="tx-row" data-income-id="${i.id}">
      <div class="tx-icon tx-icon-income">＋</div>
      <div class="tx-main">
        <div class="tx-title">収入${i.memo ? '・' + escapeHtml(i.memo) : ''}</div>
        <div class="tx-sub">${i.date} ・ 貯金${yen(i.normalSavingsAmount)} / 車${yen(i.carMaintenanceAmount)}</div>
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
  return `
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
  const incomeCanvas = document.getElementById('chart-income');
  const expenseCanvas = document.getElementById('chart-expense');
  const assetsCanvas = document.getElementById('chart-assets');
  if (incomeCanvas || expenseCanvas || assetsCanvas) {
    const months = await DB.getAllMonths();
    if (months.length === 0) {
      [incomeCanvas, expenseCanvas, assetsCanvas].forEach((c) => {
        if (!c) return;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgba(230,230,235,0.4)';
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
    if (expenseCanvas) Charts.drawBarChart(expenseCanvas, labels, expenseVals, { color: '#D4A15C' });
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
      ctx.fillStyle = 'rgba(230,230,235,0.4)';
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
  const totals = await DB.getFundTotals();
  const [free, savings, car] = await Promise.all([
    DB.getFundsByType('free'), DB.getFundsByType('savings'), DB.getFundsByType('car'),
  ]);
  return `
    <section class="stat-grid stat-grid-3">
      ${statTile('自由資金', totals.free)}
      ${statTile('普通貯金', totals.savings)}
      ${statTile('車維持費', totals.car)}
    </section>
    ${fundSection('自由資金の内訳（出身月別）', free)}
    ${fundSection('普通貯金の内訳（積立月別）', savings)}
    ${fundSection('車維持費の内訳（積立月別）', car)}
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

// ---------------- 設定 ----------------

async function renderSettings() {
  const settings = await DB.getSettings();
  return `
    <section class="section">
      <div class="section-head"><h2>デフォルトの積立額</h2></div>
      <div class="form-card">
        <label class="field">
          <span>普通貯金（毎月の初期値）</span>
          <input type="number" id="set-savings" value="${settings.normalSavingsDefault}" inputmode="numeric">
        </label>
        <label class="field">
          <span>車維持費（毎月の初期値）</span>
          <input type="number" id="set-car" value="${settings.carMaintenanceDefault}" inputmode="numeric">
        </label>
        <button class="btn btn-primary btn-block" id="save-defaults">保存する</button>
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
      <label class="field"><span>金額</span><input type="number" name="amount" inputmode="numeric" placeholder="49500" required></label>
      <div class="field-row">
        <label class="field"><span>普通貯金</span><input type="number" name="savings" value="${settings.normalSavingsDefault}" inputmode="numeric"></label>
        <label class="field"><span>車維持費</span><input type="number" name="car" value="${settings.carMaintenanceDefault}" inputmode="numeric"></label>
      </div>
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
      <div class="field-row">
        <label class="field"><span>自由資金（残高 ${yen(totals.free)}）</span><input type="number" name="alloc_free" inputmode="numeric" placeholder="自動"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>普通貯金（残高 ${yen(totals.savings)}）</span><input type="number" name="alloc_savings" inputmode="numeric" placeholder="0"></label>
        <label class="field"><span>車維持費（残高 ${yen(totals.car)}）</span><input type="number" name="alloc_car" inputmode="numeric" placeholder="0"></label>
      </div>
      <button type="submit" class="btn btn-primary btn-block">登録する</button>
    </form>
  `;
}

async function renderExpenseDetail(expenseId) {
  const expenses = await DB.getAll('expenses');
  const e = expenses.find((x) => x.id === expenseId);
  if (!e) return `<div class="modal-head"><h2>見つかりません</h2><button class="icon-btn" data-close-modal="1">✕</button></div>`;
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
        <span>${monthLabel(a.sourceMonth)}${DB.typeLabel(a.type)}</span>
        <span>${yen(a.amount)}</span>
      </div>`).join('') || '<div class="hint">内訳情報がありません</div>'}
      <div class="alloc-row alloc-total"><span>合計</span><span>${yen(e.allocations.reduce((s, a) => s + a.amount, 0))}</span></div>
    </div>
    <button class="btn btn-danger btn-block" style="margin-top:16px;" data-delete-expense="${e.id}">この支出を削除</button>
  `;
}

async function renderMonthDetail(month) {
  const s = await DB.getMonthSummary(month);
  return `
    <div class="modal-head">
      <h2>${monthLabel(month)}</h2>
      <button class="icon-btn" data-close-modal="1">✕</button>
    </div>
    <div class="stat-grid">
      ${statTile('収入', s.incomeTotal, 'up')}
      ${statTile('支出', s.expenseTotal, 'down')}
      ${statTile('普通貯金', s.savings)}
      ${statTile('車維持費', s.car)}
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

  const incomeForm = document.getElementById('income-form');
  if (incomeForm) {
    const preview = () => {
      const fd = new FormData(incomeForm);
      const amount = Number(fd.get('amount') || 0);
      const savings = Number(fd.get('savings') || 0);
      const car = Number(fd.get('car') || 0);
      document.getElementById('free-preview').textContent = `自由資金：${yen(amount - savings - car)}`;
    };
    incomeForm.addEventListener('input', preview);
    preview();
    incomeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(incomeForm);
      await DB.addIncome({
        year: Number(fd.get('year')),
        month: Number(fd.get('month')),
        amount: Number(fd.get('amount')),
        normalSavingsAmount: Number(fd.get('savings') || 0),
        carMaintenanceAmount: Number(fd.get('car') || 0),
        memo: fd.get('memo'),
      });
      showToast('収入を登録しました');
      closeModal();
      state.tab = state.tab === 'settings' ? 'home' : state.tab;
      render();
    });
  }

  const expenseForm = document.getElementById('expense-form');
  if (expenseForm) {
    expenseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(expenseForm);
      const amount = Number(fd.get('amount'));
      const allocFree = Number(fd.get('alloc_free') || 0);
      const allocSavings = Number(fd.get('alloc_savings') || 0);
      const allocCar = Number(fd.get('alloc_car') || 0);
      const manualTotal = allocFree + allocSavings + allocCar;

      let requestedByType;
      if (manualTotal > 0) {
        if (manualTotal !== amount) {
          showToast(`支払い元の合計(${yen(manualTotal)})が支出額(${yen(amount)})と一致しません`, true);
          return;
        }
        requestedByType = [
          { type: 'free', amount: allocFree },
          { type: 'savings', amount: allocSavings },
          { type: 'car', amount: allocCar },
        ];
      } else {
        requestedByType = [{ type: 'free', amount }];
      }

      const { shortfall } = await DB.addExpense({
        date: fd.get('date'),
        amount,
        category: fd.get('category'),
        name: fd.get('name'),
        memo: fd.get('memo'),
        requestedByType,
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

  const saveDefaults = document.getElementById('save-defaults');
  if (saveDefaults) {
    saveDefaults.addEventListener('click', async () => {
      const savings = Number(document.getElementById('set-savings').value || 0);
      const car = Number(document.getElementById('set-car').value || 0);
      await DB.saveSetting('normalSavingsDefault', savings);
      await DB.saveSetting('carMaintenanceDefault', car);
      showToast('デフォルト値を保存しました');
    });
  }

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
      const csv = await DB.exportExpensesCSV();
      downloadFile(`kakeibo_expenses_${todayISO()}.csv`, '\ufeff' + csv, 'text/csv');
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
      showToast('すべてのデータを削除しました');
      closeModal();
      setTab('home');
    });
  }
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
function iconChart() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 19V10M12 19V5M19 19v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
function iconWallet() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3.5" y="6.5" width="17" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 12.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}
function iconGear() {
  return `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2.1 1.2L10 21h4l.5-2.6c.8-.3 1.5-.7 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}

init();
