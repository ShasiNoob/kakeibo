// db.js — IndexedDB データレイヤー
// UI 層(app.js)からはこのモジュールの関数だけを呼び出す。
// 将来クラウドDB(Supabase等)に差し替える場合は、この層のインターフェースを維持したまま
// 内部実装を置き換えることで対応できる。

const DB_NAME = 'kakeiboDB';
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('incomes')) {
        db.createObjectStore('incomes', { keyPath: 'id' }).createIndex('month', 'month');
      }
      if (!db.objectStoreNames.contains('funds')) {
        const s = db.createObjectStore('funds', { keyPath: 'id' });
        s.createIndex('type', 'type');
        s.createIndex('sourceMonth', 'sourceMonth');
      }
      if (!db.objectStoreNames.contains('expenses')) {
        db.createObjectStore('expenses', { keyPath: 'id' }).createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // v2: シフト管理と目標
      if (!db.objectStoreNames.contains('shifts')) {
        db.createObjectStore('shifts', { keyPath: 'id' }).createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('goals')) {
        db.createObjectStore('goals', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const t = await tx([storeName]);
  return reqToPromise(t.objectStore(storeName).getAll());
}

async function put(storeName, value) {
  const t = await tx([storeName], 'readwrite');
  await reqToPromise(t.objectStore(storeName).put(value));
  return value;
}

async function bulkPut(storeName, values) {
  const t = await tx([storeName], 'readwrite');
  const store = t.objectStore(storeName);
  values.forEach((v) => store.put(v));
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

async function remove(storeName, key) {
  const t = await tx([storeName], 'readwrite');
  await reqToPromise(t.objectStore(storeName).delete(key));
}

async function clearAll() {
  const stores = ['incomes', 'funds', 'expenses', 'categories', 'settings', 'shifts', 'goals'];
  const t = await tx(stores, 'readwrite');
  stores.forEach((s) => t.objectStore(s).clear());
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

// ---- 設定 ----

// 貯金枠: fund の type がそのまま枠IDになる。'free' は自由資金(枠ではない)。
// 既存データ互換のため、初期枠として 'savings'(普通貯金) と 'car'(車維持費) を持つ。
const DEFAULT_FRAMES = [
  { id: 'savings', name: '普通貯金', defaultAmount: 10000 },
  { id: 'car', name: '車維持費', defaultAmount: 10000 },
];

const DEFAULT_SETTINGS = {
  frames: DEFAULT_FRAMES,
  categories: ['食費', '交通費', '車', 'DJ・音楽', 'PC・ゲーム', 'ファッション', '趣味', '日用品', '娯楽', 'その他'],
  theme: 'amber',
  defaultHourlyWage: 1200,
  savingsRate: 30,
  payday: 10,
  paydayAdjust: 'before', // 'before'=前倒し / 'after'=後倒し / 'none'=そのまま
  shiftPatterns: [],
};

let cachedFrames = null;

async function getSettings() {
  const rows = await getAll('settings');
  const map = {};
  rows.forEach((r) => (map[r.key] = r.value));
  let frames = map.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    // v1からの移行: 旧デフォルト積立額を初期枠として引き継ぐ
    frames = [
      { id: 'savings', name: '普通貯金', defaultAmount: map.normalSavingsDefault ?? 10000 },
      { id: 'car', name: '車維持費', defaultAmount: map.carMaintenanceDefault ?? 10000 },
    ];
  }
  cachedFrames = frames;
  return {
    frames,
    categories: map.categories ?? DEFAULT_SETTINGS.categories.slice(),
    theme: map.theme ?? DEFAULT_SETTINGS.theme,
    defaultHourlyWage: map.defaultHourlyWage ?? DEFAULT_SETTINGS.defaultHourlyWage,
    savingsRate: map.savingsRate ?? DEFAULT_SETTINGS.savingsRate,
    payday: map.payday ?? DEFAULT_SETTINGS.payday,
    paydayAdjust: map.paydayAdjust ?? DEFAULT_SETTINGS.paydayAdjust,
    shiftPatterns: Array.isArray(map.shiftPatterns) ? map.shiftPatterns : [],
  };
}

async function saveSetting(key, value) {
  await put('settings', { key, value });
  if (key === 'frames') cachedFrames = value;
}

async function ensureDefaultsSeeded() {
  const rows = await getAll('settings');
  const keys = new Set(rows.map((r) => r.key));
  if (!keys.has('frames')) {
    const legacy = {};
    rows.forEach((r) => (legacy[r.key] = r.value));
    await saveSetting('frames', [
      { id: 'savings', name: '普通貯金', defaultAmount: legacy.normalSavingsDefault ?? 10000 },
      { id: 'car', name: '車維持費', defaultAmount: legacy.carMaintenanceDefault ?? 10000 },
    ]);
  }
  if (!keys.has('categories')) await saveSetting('categories', DEFAULT_SETTINGS.categories.slice());
  if (!keys.has('theme')) await saveSetting('theme', DEFAULT_SETTINGS.theme);
  if (!keys.has('defaultHourlyWage')) await saveSetting('defaultHourlyWage', DEFAULT_SETTINGS.defaultHourlyWage);
  if (!keys.has('savingsRate')) await saveSetting('savingsRate', DEFAULT_SETTINGS.savingsRate);
  if (!keys.has('payday')) await saveSetting('payday', DEFAULT_SETTINGS.payday);
  if (!keys.has('paydayAdjust')) await saveSetting('paydayAdjust', DEFAULT_SETTINGS.paydayAdjust);
  if (!keys.has('shiftPatterns')) await saveSetting('shiftPatterns', []);
}

// ---- 貯金枠 ----

async function addFrame(name, defaultAmount) {
  const settings = await getSettings();
  const frame = { id: 'f_' + uid(), name, defaultAmount: Number(defaultAmount) || 0 };
  settings.frames.push(frame);
  await saveSetting('frames', settings.frames);
  return frame;
}

async function updateFrames(frames) {
  await saveSetting('frames', frames);
}

// 枠間(自由資金含む)の資金移動。移動元の lot を FIFO で減らし、
// 移動先に同じ出身月の lot を作ることで内訳表示と整合性を保つ。
async function transferFunds(fromType, toType, amount) {
  amount = Number(amount) || 0;
  if (amount <= 0) throw new Error('金額を入力してください');
  if (fromType === toType) throw new Error('移動元と移動先が同じです');
  const all = await getAll('funds');
  const pool = all
    .filter((f) => f.type === fromType && f.remainingAmount > 0)
    .sort((a, b) => (a.sourceMonth < b.sourceMonth ? -1 : a.sourceMonth > b.sourceMonth ? 1 : 0));
  const total = pool.reduce((s, f) => s + f.remainingAmount, 0);
  if (total < amount) throw new Error('移動元の残高が不足しています');
  let remaining = amount;
  const changed = [];
  for (const fund of pool) {
    if (remaining <= 0) break;
    const move = Math.min(fund.remainingAmount, remaining);
    fund.remainingAmount -= move;
    remaining -= move;
    changed.push(fund);
    changed.push({
      id: uid(),
      type: toType,
      sourceMonth: fund.sourceMonth,
      originalAmount: move,
      remainingAmount: move,
      incomeId: fund.incomeId,
      transferredFrom: fromType,
    });
  }
  await bulkPut('funds', changed);
}

async function deleteFrame(frameId) {
  const funds = (await getAll('funds')).filter((f) => f.type === frameId);
  const remaining = funds.reduce((s, f) => s + f.remainingAmount, 0);
  if (remaining > 0) {
    throw new Error('残高が残っている枠は削除できません。先に支出で使い切ってください。');
  }
  // 残高ゼロの fund レコードは掃除する
  for (const f of funds) await remove('funds', f.id);
  const settings = await getSettings();
  settings.frames = settings.frames.filter((fr) => fr.id !== frameId);
  await saveSetting('frames', settings.frames);
}

function frameName(type) {
  if (type === 'free') return '自由資金';
  const fr = (cachedFrames || DEFAULT_FRAMES).find((f) => f.id === type);
  return fr ? fr.name : type;
}

// income レコードから枠別積立額を取り出す(旧形式にも対応)
function frameAllocOf(income) {
  if (income.frameAllocations && typeof income.frameAllocations === 'object') {
    return income.frameAllocations;
  }
  const map = {};
  if (income.normalSavingsAmount) map.savings = income.normalSavingsAmount;
  if (income.carMaintenanceAmount) map.car = income.carMaintenanceAmount;
  return map;
}

// ---- 収入 ----

async function addIncome({ year, month, amount, frameAllocations, memo }) {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const allocMap = {};
  let allocTotal = 0;
  for (const [fid, raw] of Object.entries(frameAllocations || {})) {
    const a = Number(raw) || 0;
    if (a !== 0) {
      allocMap[fid] = a;
      allocTotal += a;
    }
  }
  const freeAmount = amount - allocTotal;
  const income = {
    id: uid(),
    date: `${monthStr}-01`,
    month: monthStr,
    amount,
    frameAllocations: allocMap,
    // 旧形式との互換用ミラー
    normalSavingsAmount: allocMap.savings || 0,
    carMaintenanceAmount: allocMap.car || 0,
    freeAmount,
    memo: memo || '',
  };
  await put('incomes', income);

  const funds = [];
  for (const [fid, a] of Object.entries(allocMap)) {
    if (a > 0) {
      funds.push({ id: uid(), type: fid, sourceMonth: monthStr, originalAmount: a, remainingAmount: a, incomeId: income.id });
    }
  }
  if (freeAmount !== 0) {
    funds.push({ id: uid(), type: 'free', sourceMonth: monthStr, originalAmount: freeAmount, remainingAmount: freeAmount, incomeId: income.id });
  }
  if (funds.length) await bulkPut('funds', funds);
  return income;
}

async function deleteIncome(incomeId) {
  // 関連する fund で、まだ消費されていないものだけなら削除可能。消費済みなら整合性が崩れるため警告。
  const funds = await getAll('funds');
  const related = funds.filter((f) => f.incomeId === incomeId);
  const consumed = related.some((f) => f.remainingAmount !== f.originalAmount);
  if (consumed) {
    throw new Error('この収入から生まれた資金は既に一部使用されているため削除できません。');
  }
  for (const f of related) await remove('funds', f.id);
  await remove('incomes', incomeId);
}

// ---- 資金アロケーション (FIFO) ----

// requestedByType: [{type:'free', amount: 50000}, {type:'<frameId>', amount:20000}]
// 戻り値: { allocations: [{fundId, sourceMonth, type, amount}], shortfall: [{type, missing}] }
async function allocateFunds(requestedByType) {
  const allFunds = await getAll('funds');
  const allocations = [];
  const shortfall = [];
  const fundsToUpdate = [];

  for (const req of requestedByType) {
    if (!req.amount || req.amount <= 0) continue;
    let remaining = req.amount;
    const pool = allFunds
      .filter((f) => f.type === req.type && f.remainingAmount > 0)
      .sort((a, b) => (a.sourceMonth < b.sourceMonth ? -1 : a.sourceMonth > b.sourceMonth ? 1 : 0));

    for (const fund of pool) {
      if (remaining <= 0) break;
      const use = Math.min(fund.remainingAmount, remaining);
      fund.remainingAmount -= use;
      remaining -= use;
      allocations.push({ fundId: fund.id, sourceMonth: fund.sourceMonth, type: fund.type, amount: use });
      fundsToUpdate.push(fund);
    }
    if (remaining > 0) {
      shortfall.push({ type: req.type, missing: remaining });
    }
  }

  return { allocations, shortfall, fundsToUpdate };
}

async function commitFundUpdates(fundsToUpdate) {
  if (fundsToUpdate.length) await bulkPut('funds', fundsToUpdate);
}

// 支出登録時に fund の remainingAmount を元に戻す(削除時)
async function restoreAllocations(allocations) {
  if (!allocations || !allocations.length) return;
  const t = await tx(['funds'], 'readwrite');
  const store = t.objectStore('funds');
  for (const a of allocations) {
    const fund = await reqToPromise(store.get(a.fundId));
    if (fund) {
      fund.remainingAmount += a.amount;
      store.put(fund);
    }
  }
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ---- 支出 ----

async function addExpense({ date, amount, category, name, memo, requestedByType }) {
  const { allocations, shortfall, fundsToUpdate } = await allocateFunds(requestedByType);
  await commitFundUpdates(fundsToUpdate);
  const expense = {
    id: uid(),
    date,
    month: date.slice(0, 7),
    amount,
    category,
    name,
    memo: memo || '',
    allocations,
  };
  await put('expenses', expense);
  return { expense, shortfall };
}

async function deleteExpense(expenseId) {
  const expenses = await getAll('expenses');
  const exp = expenses.find((e) => e.id === expenseId);
  if (!exp) return;
  await restoreAllocations(exp.allocations);
  await remove('expenses', expenseId);
}

// ---- 集計ヘルパー ----

// 戻り値: { free: n, <frameId>: n, ... } (fund の type をキーにした残高合計)
async function getFundTotals() {
  const funds = await getAll('funds');
  const totals = { free: 0 };
  funds.forEach((f) => (totals[f.type] = (totals[f.type] || 0) + f.remainingAmount));
  return totals;
}

async function getFundsByType(type) {
  const funds = await getAll('funds');
  return funds
    .filter((f) => f.type === type)
    .sort((a, b) => (a.sourceMonth < b.sourceMonth ? 1 : a.sourceMonth > b.sourceMonth ? -1 : 0));
}

async function getMonthSummary(monthStr) {
  const incomes = (await getAll('incomes')).filter((i) => i.month === monthStr);
  const expenses = (await getAll('expenses')).filter((e) => e.month === monthStr);
  const incomeTotal = incomes.reduce((s, i) => s + i.amount, 0);
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const frames = {};
  let free = 0;
  incomes.forEach((i) => {
    const alloc = frameAllocOf(i);
    for (const [fid, a] of Object.entries(alloc)) frames[fid] = (frames[fid] || 0) + a;
    free += i.freeAmount || 0;
  });
  return { monthStr, incomes, expenses, incomeTotal, expenseTotal, frames, free };
}

async function getAllMonths() {
  const incomes = await getAll('incomes');
  const expenses = await getAll('expenses');
  const set = new Set();
  incomes.forEach((i) => set.add(i.month));
  expenses.forEach((e) => set.add(e.month));
  return Array.from(set).sort();
}

async function getCategoryTotals(year) {
  const expenses = await getAll('expenses');
  const filtered = year ? expenses.filter((e) => e.date.startsWith(String(year))) : expenses;
  const totals = {};
  filtered.forEach((e) => {
    totals[e.category] = (totals[e.category] || 0) + e.amount;
  });
  return totals;
}

// ---- シフト ----

function timeToMinutes(t) {
  const [h, m] = String(t || '0:0').split(':').map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

function calcShift({ start, end, breakMin }) {
  let minutes = timeToMinutes(end) - timeToMinutes(start) - (Number(breakMin) || 0);
  if (minutes <= -720) minutes += 24 * 60; // 日付をまたぐシフト(終了が翌日)
  if (minutes < 0) minutes = 0;
  return minutes;
}

async function addShift({ date, start, end, breakMin, wage }) {
  const minutes = calcShift({ start, end, breakMin });
  const pay = Math.round((minutes / 60) * (Number(wage) || 0));
  const shift = {
    id: uid(),
    date,
    month: date.slice(0, 7),
    start,
    end,
    breakMin: Number(breakMin) || 0,
    wage: Number(wage) || 0,
    minutes,
    pay,
  };
  await put('shifts', shift);
  return shift;
}

async function deleteShift(shiftId) {
  await remove('shifts', shiftId);
}

async function getShiftsByMonth(monthStr) {
  const shifts = await getAll('shifts');
  return shifts
    .filter((s) => (s.month || s.date.slice(0, 7)) === monthStr)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1));
}

async function getMonthShiftSummary(monthStr) {
  const shifts = await getShiftsByMonth(monthStr);
  const totalMinutes = shifts.reduce((s, x) => s + (x.minutes || 0), 0);
  const totalPay = shifts.reduce((s, x) => s + (x.pay || 0), 0);
  return { shifts, totalMinutes, totalPay, count: shifts.length };
}

// ---- 目標 ----

async function addGoal({ name, targetAmount, deadline, image }) {
  const goal = {
    id: uid(),
    name,
    targetAmount: Number(targetAmount) || 0,
    savedAmount: 0,
    deadline: deadline || '',
    image: image || '',
    createdAt: new Date().toISOString().slice(0, 10),
  };
  await put('goals', goal);
  return goal;
}

async function getGoals() {
  const goals = await getAll('goals');
  return goals.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

async function updateGoal(goal) {
  await put('goals', goal);
  return goal;
}

async function adjustGoalSaved(goalId, delta) {
  const goals = await getAll('goals');
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return null;
  goal.savedAmount = Math.max(0, (goal.savedAmount || 0) + delta);
  await put('goals', goal);
  return goal;
}

async function deleteGoal(goalId) {
  await remove('goals', goalId);
}

// ---- バックアップ / 復元 ----

async function exportAllData() {
  const [incomes, funds, expenses, categories, settings, shifts, goals] = await Promise.all([
    getAll('incomes'), getAll('funds'), getAll('expenses'), getAll('categories'), getAll('settings'), getAll('shifts'), getAll('goals'),
  ]);
  return { version: DB_VERSION, exportedAt: new Date().toISOString(), incomes, funds, expenses, categories, settings, shifts, goals };
}

async function importAllData(data) {
  await clearAll();
  if (data.incomes) await bulkPut('incomes', data.incomes);
  if (data.funds) await bulkPut('funds', data.funds);
  if (data.expenses) await bulkPut('expenses', data.expenses);
  if (data.categories) await bulkPut('categories', data.categories);
  if (data.settings) await bulkPut('settings', data.settings);
  if (data.shifts) await bulkPut('shifts', data.shifts);
  if (data.goals) await bulkPut('goals', data.goals);
}

async function exportExpensesCSV() {
  const expenses = (await getAll('expenses')).sort((a, b) => (a.date < b.date ? -1 : 1));
  const rows = [['日付', '金額', 'カテゴリ', '項目', 'メモ', '支払い元内訳']];
  expenses.forEach((e) => {
    const alloc = e.allocations.map((a) => `${a.sourceMonth}${typeLabel(a.type)}:${a.amount}`).join(' / ');
    rows.push([e.date, e.amount, e.category, e.name, e.memo, alloc]);
  });
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function typeLabel(type) {
  return frameName(type);
}

export const DB = {
  openDB,
  getAll,
  put,
  remove,
  clearAll,
  uid,
  getSettings,
  saveSetting,
  ensureDefaultsSeeded,
  addFrame,
  updateFrames,
  deleteFrame,
  transferFunds,
  frameName,
  frameAllocOf,
  addIncome,
  deleteIncome,
  allocateFunds,
  addExpense,
  deleteExpense,
  getFundTotals,
  getFundsByType,
  getMonthSummary,
  getAllMonths,
  getCategoryTotals,
  addShift,
  deleteShift,
  getShiftsByMonth,
  getMonthShiftSummary,
  calcShift,
  addGoal,
  getGoals,
  updateGoal,
  adjustGoalSaved,
  deleteGoal,
  exportAllData,
  importAllData,
  exportExpensesCSV,
  typeLabel,
};
