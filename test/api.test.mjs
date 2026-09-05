import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, csvCell } from '../server/index.mjs';

function makeReport() {
  return {
    account: { id: '12345', name: 'Test account', currency: 'USD', broker: 'Test broker', server: 'Demo' },
    trades: [{ id: 'mt5:12345:9988', accountId: '12345', ticket: '9988', symbol: 'XAUUSD', side: 'buy',
      volume: 0.02, openTime: '2026-09-01 10:00:00', closeTime: '2026-09-01 11:00:00',
      openPrice: 3500, closePrice: 3510, stopLoss: 3490, takeProfit: 3520,
      commission: -0.2, swap: -0.1, fees: 0, profit: 20, netProfit: 19.7,
      comment: '=HYPERLINK("https://example.com")', sourceFile: 'sample.html' }],
    cashFlows: [{ id: 'mt5-cash:12345:1000', accountId: '12345', time: '2026-09-01 09:00:00',
      type: 'deposit', amount: 100, comment: 'Initial deposit' }],
    summary: { reportedNetProfit: 19.7, reportedTradeCount: 1 }, warnings: [],
  };
}

async function fixture(t, { autoImport = false } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'trading-api-'));
  const dataDir = join(rootDir, 'data');
  await writeFile(join(rootDir, 'sample.html'), '<html>report</html>');
  await writeFile(join(rootDir, 'sample.xlsx'), 'report');
  await writeFile(join(rootDir, 'index.html'), '<html>frontend</html>');
  await writeFile(join(rootDir, 'notes.txt'), 'notes');
  await mkdir(join(rootDir, 'nested.html'));
  const parser = async (buffer) => {
    if (buffer.toString() === 'invalid') throw new Error('缺少 MT5 交易表。');
    return makeReport();
  };
  const app = await createApp({ rootDir, dataDir, parser, autoImport });
  const server = await new Promise((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.store.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  return { app, base, rootDir, dataDir, parser };
}

async function jsonResponse(base, path, options) {
  const response = await fetch(base + path, options);
  return { status: response.status, data: await response.json() };
}

function noteRequest(body) {
  return { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

test('root scan imports supported report files, deduplicates trades and preserves notes on reimport', async (t) => {
  const { base } = await fixture(t);
  const initial = await jsonResponse(base, '/api/data');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data.rootFiles.map((file) => file.name), ['sample.html', 'sample.xlsx']);
  assert.equal(initial.data.trades.length, 0);

  const first = await jsonResponse(base, '/api/import-root', { method: 'POST' });
  assert.equal(first.status, 200);
  assert.equal(first.data.addedCount, 1);
  assert.equal(first.data.duplicateCount, 1);
  assert.equal(first.data.files.length, 2);
  const id = encodeURIComponent('mt5:12345:9988');
  const saved = await jsonResponse(base, `/api/trades/${id}/note`, noteRequest({
    strategy: '  趋势回调  ', tags: ['耐心', '耐心', '  顺势  '], rating: 4,
    content: '先等确认，再入场。\n继续执行。',
  }));
  assert.equal(saved.status, 200);
  assert.equal(saved.data.note.strategy, '趋势回调');
  assert.deepEqual(saved.data.note.tags, ['耐心', '顺势']);
  assert.ok(saved.data.note.updatedAt);

  const second = await jsonResponse(base, '/api/import-root', { method: 'POST' });
  assert.equal(second.data.addedCount, 0);
  assert.equal(second.data.duplicateCount, 2);
  const final = await jsonResponse(base, '/api/data');
  assert.equal(final.data.accounts.length, 1);
  assert.equal(final.data.trades.length, 1);
  assert.equal(final.data.cashFlows.length, 1);
  assert.deepEqual(final.data.trades[0].note, saved.data.note);
  assert.equal(final.data.imports.length, 4);
});

test('startup imports data once by fingerprint and keeps saved notes across app recreation', async (t) => {
  const { base, rootDir, dataDir, parser } = await fixture(t, { autoImport: true });
  const initial = await jsonResponse(base, '/api/data');
  assert.equal(initial.data.trades.length, 1);
  await jsonResponse(base, `/api/trades/${encodeURIComponent('mt5:12345:9988')}/note`, noteRequest({ content: '持久化笔记' }));
  const restarted = await createApp({ rootDir, dataDir, parser });
  try {
    const data = restarted.locals.store.getData();
    assert.equal(data.imports.length, 2);
    assert.equal(data.trades[0].note.content, '持久化笔记');
  } finally {
    restarted.locals.store.close();
  }
});

test('multipart uploads accept valid files, report failed files and retain valid results', async (t) => {
  const { base } = await fixture(t);
  const form = new FormData();
  form.append('files', new Blob(['report']), 'upload.HTML');
  form.append('files', new Blob(['invalid']), 'broken.xlsx');
  const uploaded = await jsonResponse(base, '/api/import', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.data.addedCount, 1);
  assert.equal(uploaded.data.files[0].filename, 'upload.HTML');
  assert.match(uploaded.data.warnings[0], /broken.xlsx.*缺少 MT5/);

  const failed = new FormData();
  failed.append('files', new Blob(['invalid']), 'broken.html');
  const invalid = await jsonResponse(base, '/api/import', { method: 'POST', body: failed });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.data.addedCount, 0);
  assert.match(invalid.data.error, /解析失败/);
  assert.equal((await jsonResponse(base, '/api/data')).data.trades.length, 1);
});

test('invalid uploads, unsafe origins and invalid note requests return useful errors without mutations', async (t) => {
  const { base } = await fixture(t, { autoImport: true });
  const invalidFile = new FormData();
  invalidFile.append('files', new Blob(['report']), 'payload.exe');
  assert.equal((await jsonResponse(base, '/api/import', { method: 'POST', body: invalidFile })).status, 400);
  assert.equal((await jsonResponse(base, '/api/import', { method: 'POST', body: new FormData() })).status, 400);
  const oversized = new FormData();
  oversized.append('files', new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), 'oversized.html');
  const oversizedResult = await jsonResponse(base, '/api/import', { method: 'POST', body: oversized });
  assert.equal(oversizedResult.status, 400);
  assert.match(oversizedResult.data.error, /20 MB/);
  assert.equal((await jsonResponse(base, '/api/data', { headers: { origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await jsonResponse(base, '/api/missing')).status, 404);
  assert.equal((await jsonResponse(base, '/api/trades/missing/note', noteRequest({ content: 'note' }))).status, 404);

  const endpoint = `/api/trades/${encodeURIComponent('mt5:12345:9988')}/note`;
  for (const invalid of [{ rating: 6 }, { rating: 2.5 }, { rating: '5' }, { tags: ['a', 3] },
    { tags: Array(21).fill('tag') }, { content: 'a'.repeat(10001) }, { strategy: null }, {}, []]) {
    const response = await jsonResponse(base, endpoint, noteRequest(invalid));
    assert.equal(response.status, 400, JSON.stringify(invalid).slice(0, 80));
  }
  const badJson = await jsonResponse(base, endpoint, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(badJson.status, 400);
  assert.match(badJson.data.error, /JSON/);
  assert.equal((await jsonResponse(base, '/api/data')).data.trades[0].note.content, '');
});

test('CSV export contains BOM, lossless escaped notes and spreadsheet formula protection', async (t) => {
  const { base } = await fixture(t, { autoImport: true });
  const endpoint = `/api/trades/${encodeURIComponent('mt5:12345:9988')}/note`;
  await jsonResponse(base, endpoint, noteRequest({ content: '复盘,"第一行"\n第二行', strategy: '@SUM(1,2)' }));
  const response = await fetch(base + '/api/export');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(bytes);
  assert.match(csv, /"复盘,""第一行""\n第二行"/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example.com""\)"/);
  assert.match(csv, /"'@SUM\(1,2\)"/);
  assert.match(csv, /,-0.2,-0.1,0,20,19.7,/);
  assert.equal(csvCell('  +SUM(1)'), "'  +SUM(1)");
  assert.equal(csvCell('\tvalue'), "'\tvalue");
  assert.equal(csvCell(-25), '-25');
});
