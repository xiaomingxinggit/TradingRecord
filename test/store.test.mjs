import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../server/store.mjs';

function report({ closed = true } = {}) {
  return {
    account: { id: '12345', name: 'Test account', server: 'Broker-Demo', currency: 'USD' },
    trades: [{
      id: 'mt5:12345:9988', accountId: '12345', ticket: '9988', symbol: 'XAUUSD', side: 'buy',
      volume: 0.02, openTime: '2026-09-01 10:00:00', openPrice: 3500,
      closeTime: closed ? '2026-09-01 11:00:00' : null, closePrice: closed ? 3510 : null,
      stopLoss: 3490, takeProfit: 3520, commission: closed ? -0.2 : 0, swap: closed ? -0.1 : 0,
      fees: 0, profit: closed ? 20 : 0, netProfit: closed ? 19.7 : 0,
      comment: 'Original comment', sourceFile: 'original.html',
    }],
    cashFlows: [{ id: 'mt5-cash:12345:1000', accountId: '12345', time: '2026-09-01 09:00:00',
      type: 'deposit', amount: 100, comment: 'Initial deposit' }],
    warnings: [],
  };
}

async function directory(t) {
  const taskDir = await mkdtemp(join(tmpdir(), 'trading-store-'));
  t.after(async () => {
    const target = resolve(taskDir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('trading-store-'));
    await rm(target, { recursive: true, force: true });
  });
  return taskDir;
}

async function fixture(t) {
  const taskDir = await directory(t);
  const store = createStore(taskDir);
  // Close before the directory cleanup hook even if an assertion fails.
  const close = store.close.bind(store);
  let closed = false;
  store.close = () => { if (!closed) { close(); closed = true; } };
  t.after(() => store.close());
  return store;
}

test('reimport closes a matching open position, records an update and preserves its note', async (t) => {
  const store = await fixture(t);
  try {
    const initial = report({ closed: false });
    store.importReport(initial, 'open.html', 'open');
    const note = store.updateNote(initial.trades[0].id, {
      strategy: 'Trend', tags: ['reviewed'], rating: 4, content: 'Keep this journal entry.',
    });
    const result = store.importReport(report(), 'closed.xlsx', 'closed');
    assert.equal(result.addedCount, 0);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.duplicateCount, 0);
    assert.deepEqual(result.warnings, []);
    const data = store.getData();
    assert.equal(data.trades.length, 1);
    assert.equal(data.cashFlows.length, 1);
    assert.equal(data.trades[0].closeTime, '2026-09-01 11:00:00');
    assert.equal(data.trades[0].closePrice, 3510);
    assert.equal(data.trades[0].netProfit, 19.7);
    assert.deepEqual(data.trades[0].note, note);
    assert.equal(data.imports[0].updatedCount, 1);
  } finally { store.close(); }
});

test('an open position is not closed by a conflicting opening identity', async (t) => {
  const store = await fixture(t);
  try {
    const initial = report({ closed: false });
    store.importReport(initial, 'open.html', 'open');
    const saved = store.getTrade(initial.trades[0].id);
    for (const [field, value] of [
      ['ticket', '9989'], ['symbol', 'EURUSD'], ['side', 'sell'], ['volume', 0.03],
      ['openTime', '2026-09-01 10:01:00'], ['openPrice', 3501],
    ]) {
      const changed = report();
      changed.trades[0][field] = value;
      const result = store.importReport(changed, `${field}.html`, field);
      assert.equal(result.updatedCount, 0, field);
      assert.equal(result.addedCount, 0, field);
      assert.equal(result.duplicateCount, 1, field);
      assert.ok(result.warnings.length > 0, `${field} conflict should be visible`);
      assert.deepEqual(store.getTrade(initial.trades[0].id), saved, field);
    }
  } finally { store.close(); }
});

test('conflicting closed positions and older open records preserve the stored trade with a warning', async (t) => {
  const store = await fixture(t);
  try {
    const initial = report();
    store.importReport(initial, 'closed.html', 'closed');
    const saved = store.getTrade(initial.trades[0].id);
    const variants = [report({ closed: false }), ...[
      ['closeTime', '2026-09-01 11:01:00'], ['closePrice', 3511], ['profit', 22],
      ['netProfit', 21.7], ['commission', -0.3], ['swap', -0.2], ['fees', -0.1],
      ['stopLoss', 3480], ['takeProfit', 3530],
    ].map(([field, value]) => {
      const changed = report();
      changed.trades[0][field] = value;
      return changed;
    })];
    for (const [index, changed] of variants.entries()) {
      const result = store.importReport(changed, `conflict-${index}.html`, `conflict-${index}`);
      assert.equal(result.updatedCount, 0);
      assert.equal(result.addedCount, 0);
      assert.equal(result.duplicateCount, 1);
      assert.ok(result.warnings.length > 0, `variant ${index} should produce a warning`);
      assert.deepEqual(store.getTrade(initial.trades[0].id), saved);
    }
  } finally { store.close(); }
});

test('account server or currency conflicts reject the entire report without changing any persisted data', async (t) => {
  const store = await fixture(t);
  try {
    const initial = report();
    store.importReport(initial, 'initial.html', 'initial');
    store.updateNote(initial.trades[0].id, { strategy: 'Trend', tags: [], rating: 5, content: 'Preserve me.' });
    const before = store.getData();
    for (const [field, value] of [['server', 'OtherBroker-Demo'], ['currency', 'EUR']]) {
      const changed = report();
      changed.account[field] = value;
      changed.account.name = 'Should not overwrite';
      changed.trades.push({ ...changed.trades[0], id: 'mt5:12345:9999', ticket: '9999' });
      changed.cashFlows.push({ ...changed.cashFlows[0], id: 'mt5-cash:12345:1001', amount: 999 });
      assert.throws(() => store.importReport(changed, `${field}.html`, field));
      assert.deepEqual(store.getData(), before, `${field} rejection must be atomic`);
      assert.equal(store.hasImported(`${field}.html`, field), false);
    }
  } finally { store.close(); }
});

test('missing account server and currency can be filled in and later blank values preserve them', async (t) => {
  const store = await fixture(t);
  try {
    const incomplete = report();
    incomplete.account.server = '';
    incomplete.account.currency = '';
    store.importReport(incomplete, 'incomplete.html', 'incomplete');
    const completed = store.importReport(report(), 'complete.xlsx', 'complete');
    assert.equal(completed.duplicateCount, 1);
    assert.equal(store.getData().accounts[0].server, 'Broker-Demo');
    assert.equal(store.getData().accounts[0].currency, 'USD');
    store.importReport(incomplete, 'blank-again.html', 'blank-again');
    assert.equal(store.getData().accounts[0].server, 'Broker-Demo');
    assert.equal(store.getData().accounts[0].currency, 'USD');
  } finally { store.close(); }
});

test('filename and imported comment changes alone are duplicates and preserve the original record', async (t) => {
  const store = await fixture(t);
  try {
    const original = report();
    store.importReport(original, 'original.html', 'original');
    const before = store.getTrade(original.trades[0].id);
    const renamed = report();
    renamed.trades[0].comment = 'A newly exported comment';
    renamed.trades[0].sourceFile = 'renamed.xlsx';
    const result = store.importReport(renamed, 'renamed.xlsx', 'renamed');
    assert.equal(result.addedCount, 0);
    assert.equal(result.updatedCount, 0);
    assert.equal(result.duplicateCount, 1);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(store.getTrade(original.trades[0].id), before);
  } finally { store.close(); }
});

test('legacy import history is migrated with zero updates and remains readable', async (t) => {
  const taskDir = await directory(t);
  const legacy = new DatabaseSync(join(taskDir, 'trading.sqlite'));
  legacy.exec(`CREATE TABLE imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, fingerprint TEXT NOT NULL,
    imported_at TEXT NOT NULL, trade_count INTEGER NOT NULL, added_count INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL, warnings TEXT NOT NULL
  );
  INSERT INTO imports (filename, fingerprint, imported_at, trade_count, added_count, duplicate_count, warnings)
  VALUES ('legacy.html', 'legacy', '2026-09-01T00:00:00.000Z', 1, 1, 0, '[]');`);
  legacy.close();
  const store = createStore(taskDir);
  try {
    const history = store.getData().imports;
    assert.equal(history.length, 1);
    assert.equal(history[0].filename, 'legacy.html');
    assert.equal(history[0].updatedCount, 0);
    assert.equal(store.hasImported('legacy.html', 'legacy'), true);
    store.importReport(report({ closed: false }), 'open.html', 'open');
    const updated = store.importReport(report(), 'closed.html', 'closed');
    assert.equal(updated.updatedCount, 1);
    assert.equal(store.getData().imports[0].updatedCount, 1);
  } finally { store.close(); }
});
