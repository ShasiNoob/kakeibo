// db.js — IndexedDB データレイヤー
// UI 層(app.js)からはこのモジュールの関数だけを呼び出す。
// 将来クラウドDB(Supabase等)に差し替える場合は、この層のインターフェースを維持したまま
// 内部実装を置き換えることで対応できる。

const DB_NAME = 'kakeiboDB';
const DB_VERSION = 1;

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
  const stores = ['incomes', 'funds', 'expenses', 'categories', 'settings'];
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

const DEFAULT_SETTINGS = {
  normalSavingsDefault: 10000,
  carMaintenanceDefault: 10000,
  categories: ['食費', '交通費', '車', 'DJ・音楽', 'PC・ゲーム', 'ファッション', '趣味', '日用品', '娯楽', 'その他'],
};

async function getSettings() {
  const rows = await getAll('settings');
  const map = {};
  rows.forEach((r) => (map[r.key] = r.value));
  return {
    normalSavingsDefault: map.normalSavingsDefault ?? DEFAULT_SETTINGS.normalSavingsDefault,
    carMaintenanceDefault: map.carMaintenanceDefault ?? DEFAULT_SETTINGS.carMaintenanceDefault,
    categories: map.categories ?? DEFAULT_SETTINGS.categories.slice(),
  };
}

async function saveSetting(key, value) {
  await put('settings', { key, value });
}

async function ensureDefaultsSeeded() {
  const rows = await getAll('settings');
  if (rows.length === 0) {
    await saveSetting('normalSavingsDefault', DEFAULT_SETTINGS.normalSavingsDefault);
    await saveSetting('carMaintenanceDefault', DEFAULT_SETTINGS.carMaintenanceDefault);
    await saveSetting('categories', DEFAULT_SETTINGS.categories.slice());
  }
}

// ---- 収入 ----

async function addIncome({ year, month, amount, normalSavingsAmount, carMaintenanceAmount, memo }) {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const freeAmount = amount - normalSavingsAmount - carMaintenanceAmount;
  const income = {
    id: uid(),
    date: `${monthStr}-01`,
    month: monthStr,
    amount,
    normalSavingsAmount,
    carMaintenanceAmount,
    freeAmount,
    memo: memo || '',
  };
  await put('incomes', income);

  const funds = [];
  if (normalSavingsAmount > 0) {
    funds.push({ id: uid(), type: 'savings', sourceMonth: monthStr, originalAmount: normalSavingsAmount, remainingAmount: normalSavingsAmount, incomeId: income.id });
  }
  if (carMaintenanceAmount > 0) {
    funds.push({ id: uid(), type: 'car', sourceMonth: monthStr, originalAmount: carMaintenanceAmount, remainingAmount: carMaintenanceAmount, incomeId: income.id });
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

// requestedByType: [{type:'free', amount: 50000}, {type:'savings', amount:20000}]
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

async function getFundTotals() {
  const funds = await getAll('funds');
  const totals = { free: 0, savings: 0, car: 0 };
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
  const savings = incomes.reduce((s, i) => s + i.normalSavingsAmount, 0);
  const car = incomes.reduce((s, i) => s + i.carMaintenanceAmount, 0);
  const free = incomes.reduce((s, i) => s + i.freeAmount, 0);
  return { monthStr, incomes, expenses, incomeTotal, expenseTotal, savings, car, free };
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

// ---- バックアップ / 復元 ----

async function exportAllData() {
  const [incomes, funds, expenses, categories, settings] = await Promise.all([
    getAll('incomes'), getAll('funds'), getAll('expenses'), getAll('categories'), getAll('settings'),
  ]);
  return { version: DB_VERSION, exportedAt: new Date().toISOString(), incomes, funds, expenses, categories, settings };
}

async function importAllData(data) {
  await clearAll();
  if (data.incomes) await bulkPut('incomes', data.incomes);
  if (data.funds) await bulkPut('funds', data.funds);
  if (data.expenses) await bulkPut('expenses', data.expenses);
  if (data.categories) await bulkPut('categories', data.categories);
  if (data.settings) await bulkPut('settings', data.settings);
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
  return { free: '自由資金', savings: '普通貯金', car: '車維持費' }[type] || type;
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
  exportAllData,
  importAllData,
  exportExpensesCSV,
  typeLabel,
};
