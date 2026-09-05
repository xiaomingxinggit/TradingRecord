import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/analytics.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { summarize } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${actual} to equal ${expected} within ${tolerance}`);
}

function trade(id, netProfit, overrides = {}) {
  return {
    id: String(id), accountId: 'test', ticket: String(id), symbol: 'XAUUSDm', side: 'buy', volume: 0.01,
    openTime: '2000-01-01 09:00:00', closeTime: `2000-01-01 10:${String(id).padStart(2, '0')}:00`,
    openPrice: 4000, closePrice: 4001, stopLoss: null, takeProfit: null,
    commission: 0, swap: 0, fees: 0, profit: netProfit, netProfit, comment: '', sourceFile: 'fixture',
    ...overrides,
  };
}

// Public history: private-account reconciliation assertions were removed.
// Remaining assertions use invented records and do not claim broker verification.

test('net profit after commission, swap and fees determines wins, loss and profit factor', () => {
  const result = summarize([
    trade(1, 8.5, { profit: 12, commission: -2, swap: -1, fees: -0.5 }),
    trade(2, -4, { profit: 5, commission: -7, swap: -1, fees: -1 }),
  ]);
  near(result.net, 4.5);
  near(result.fees, -12.5);
  assert.deepEqual(result.wins.map(item => item.id), ['1']);
  assert.deepEqual(result.losses.map(item => item.id), ['2']);
  assert.equal(result.winRate, 50);
  near(result.grossWin, 8.5);
  near(result.grossLoss, 4);
  near(result.profitFactor, 2.125);
  near(result.average, 2.25);
  near(result.drawdown, 4);
});

test('open positions are excluded from every realized performance metric', () => {
  const closed = trade(1, 10);
  const open = trade(2, 5000, { closeTime: null, closePrice: null, commission: -100, swap: -200, fees: -300 });
  assert.deepEqual(summarize([closed, open]), summarize([closed]));
  assert.deepEqual(summarize([open]), summarize([]));
});

test('all winning positions report infinite profit factor and no drawdown', () => {
  const result = summarize([trade(1, 3), trade(2, 7)]);
  assert.equal(result.net, 10);
  assert.equal(result.winRate, 100);
  assert.equal(result.profitFactor, Infinity);
  assert.equal(result.drawdown, 0);
  assert.equal(result.grossLoss, 0);
  assert.equal(result.best, 7);
  assert.equal(result.worst, 3);
});

test('all losing positions measure drawdown from the initial zero-profit baseline', () => {
  const result = summarize([trade(1, -3), trade(2, -7)]);
  assert.equal(result.net, -10);
  assert.equal(result.winRate, 0);
  assert.equal(result.profitFactor, 0);
  assert.equal(result.drawdown, 10);
  assert.equal(result.grossWin, 0);
  assert.equal(result.grossLoss, 10);
  assert.equal(result.best, -3);
  assert.equal(result.worst, -7);
});

test('breakeven trades count in the denominator and daily totals without becoming wins or losses', () => {
  const flat = summarize([trade(1, 0), trade(2, 0)]);
  assert.equal(flat.closed.length, 2);
  assert.equal(flat.wins.length, 0);
  assert.equal(flat.losses.length, 0);
  assert.equal(flat.profitFactor, 0);
  assert.equal(flat.winRate, 0);
  assert.equal(flat.drawdown, 0);
  assert.equal(flat.best, 0);
  assert.equal(flat.worst, 0);
  assert.equal(flat.days[0].count, 2);
  const mixed = summarize([trade(1, 5), trade(2, -2), trade(3, 0)]);
  near(mixed.winRate, 100 / 3);
  assert.equal(mixed.days[0].count, 3);
  assert.equal(mixed.days[0].wins, 1);
});

test('empty input produces zero numeric statistics and empty collections', () => {
  const result = summarize([]);
  for (const field of ['net', 'grossWin', 'grossLoss', 'winRate', 'profitFactor', 'drawdown', 'average', 'averageHold', 'best', 'worst', 'fees']) {
    assert.equal(result[field], 0, `${field} should be zero`);
  }
  for (const field of ['closed', 'wins', 'losses', 'curve', 'days']) assert.deepEqual(result[field], []);
});

test('drawdown follows chronological close order and does not mutate the source array', () => {
  const first = trade(1, -5);
  const second = trade(2, 20);
  const third = trade(3, -7);
  const fourth = trade(4, -9);
  const fifth = trade(5, 1);
  const input = [fifth, third, first, fourth, second];
  const originalOrder = input.map(item => item.id);
  const result = summarize(input);
  assert.deepEqual(result.closed.map(item => item.id), ['1', '2', '3', '4', '5']);
  assert.deepEqual(result.curve.map(point => point.value), [-5, 15, 8, -1, 0]);
  assert.equal(result.drawdown, 16);
  assert.equal(result.net, 0);
  assert.deepEqual(input.map(item => item.id), originalOrder);
});

test('same-time closes have a deterministic tie-break regardless of import order', () => {
  const gain = trade(1, 10, { closeTime: '2000-01-01 10:00:00' });
  const loss = trade(2, -7, { closeTime: '2000-01-01 10:00:00' });
  const a = summarize([gain, loss]);
  const b = summarize([loss, gain]);
  assert.deepEqual(a, b);
  assert.equal(a.drawdown, 7);
  assert.equal(a.net, 3);
});

test('daily results use close dates and holding time averages only realized trades', () => {
  const result = summarize([
    trade(1, 5, { openTime: '2000-01-01 23:55:00', closeTime: '2000-01-02 00:05:00' }),
    trade(2, -2, { openTime: '2000-01-02 23:45:00', closeTime: '2000-01-03 00:15:00' }),
  ]);
  assert.deepEqual(result.days, [
    { date: '2000-01-02', profit: 5, count: 1, wins: 1 },
    { date: '2000-01-03', profit: -2, count: 1, wins: 0 },
  ]);
  assert.equal(result.averageHold, 20);
});
