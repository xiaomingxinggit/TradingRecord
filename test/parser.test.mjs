// Synthetic examples only: dates, prices and amounts below are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseReport } from '../server/parser.mjs';

const html = (rows) => Buffer.from(`<html><body><table>${rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</table></body></html>`);
const metadata = [
  ['Name:', 'Synthetic Example Account'], ['Account:', '100001 (USD, Example-Demo, demo, Hedge)'],
  ['Company:', 'Example Broker'], ['Date:', '2000.01.02 00:00'],
];
const header = ['Time', 'Position', 'Symbol', 'Type', 'Volume', 'Price', 'S/L', 'T/P', 'Time', 'Price', 'Commission', 'Swap', 'Profit'];
const trade = ['2000.01.01 09:00:00', '100001', 'XAUUSDm', 'buy', '0.01', '3 000.000', '', '', '2000.01.01 09:05:00', '2,995.000', '-0.20', '-0.05', '-5.00'];
const reportRows = (extra = []) => [...metadata, ['Positions'], header, trade, ...extra];

// Public history: assertions requiring private broker reports were removed.
// The remaining fixtures are synthetic; they do not verify a real account.

test('English HTML supports blank risk levels, grouped numbers, commission and swap', async () => {
  const result = await parseReport(html(reportRows()), 'english.html');
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].netProfit, -5.25);
  assert.equal(result.trades[0].openPrice, 3000);
  assert.equal(result.trades[0].closePrice, 2995.000);
  assert.equal(result.trades[0].stopLoss, null);
  assert.equal(result.trades[0].takeProfit, null);
  assert.equal(result.trades[0].openTime, '2000-01-01 09:00:00');
});

test('HTML cells hidden by class or inline style do not shift the column mapping', async () => {
  const raw = html(reportRows()).toString().replace('<td>0.01</td>', '<td class="hidden" colspan="8">999</td><td style="display: none">999</td><td>0.01</td>');
  const result = await parseReport(Buffer.from(raw), 'hidden.html');
  assert.equal(result.trades[0].volume, 0.01);
  assert.equal(result.trades[0].profit, -5.00);
});

test('UTF-16 little and big endian HTML decode identically', async () => {
  const text = html(reportRows()).toString();
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const big = Buffer.from(little).swap16();
  const a = await parseReport(little, 'utf16.html');
  const b = await parseReport(big, 'utf16.html');
  assert.deepEqual(a, b);
});

test('normal XLSX preserves empty cells and merged cells, and parses numeric Excel dates', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('MT5 history');
  sheet.addRow(['Name:', '', 'Synthetic Example Account']); sheet.mergeCells('A1:B1');
  sheet.addRow(['Account:', '', '100001 (USD, Example-Demo, demo, Hedge)']); sheet.mergeCells('A2:B2');
  sheet.addRow(['Company:', '', 'Example Broker']); sheet.mergeCells('A3:B3');
  sheet.addRow(['Date:', '', '2000.01.02 00:00']); sheet.mergeCells('A4:B4');
  sheet.addRow(['Positions']); sheet.mergeCells('A5:N5');
  sheet.addRow(header); sheet.mergeCells('M6:N6');
  const row = [...trade]; row[0] = new Date('2000-01-01T09:00:00Z');
  sheet.addRow(row); sheet.mergeCells('M7:N7');
  sheet.getCell('A7').numFmt = 'yyyy.mm.dd hh:mm:ss';
  const result = await parseReport(await workbook.xlsx.writeBuffer(), 'test.xlsx');
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].openTime, '2000-01-01 09:00:00');
  assert.equal(result.trades[0].takeProfit, null);
  assert.equal(result.trades[0].netProfit, -5.25);
});

test('duplicate position rows are deduplicated, while conflicting duplicates fail', async () => {
  const duplicated = await parseReport(html(reportRows([trade])), 'duplicate.html');
  assert.equal(duplicated.trades.length, 1);
  assert.match(duplicated.warnings[0], /重复持仓/);
  const different = [...trade]; different[12] = '10.00';
  await assert.rejects(() => parseReport(html(reportRows([different])), 'conflict.html'), /不同的重复记录/);
});

test('summary disagreements produce explicit warnings', async () => {
  const result = await parseReport(html(reportRows([
    ['Results'], ['Total Net Profit:', '100.00'], ['Total Trades:', '3'],
  ])), 'mismatch.html');
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings.join(' '), /报告汇总 3/);
  assert.match(result.warnings.join(' '), /报告总净盈利 100/);
});

test('deal-only exports are explicitly rejected instead of treated as trades', async () => {
  const dealHeader = ['Time', 'Deal', 'Symbol', 'Type', 'Direction', 'Volume', 'Price', 'Order', 'Commission', 'Fee', 'Swap', 'Profit', 'Balance', 'Comment'];
  const deal = ['2000.01.01 09:05:00', '300001', 'XAUUSDm', 'sell', 'out', '0.01', '2995.000', '', '0.00', '0.00', '0.00', '-5.00', '995.00', ''];
  await assert.rejects(() => parseReport(html([...metadata, ['Deals'], dealHeader, deal]), 'deals.html'), /不从逐笔成交自动重建持仓/);
});

test('unallocated deal fees are surfaced without manufacturing extra trades', async () => {
  const result = await parseReport(html(reportRows([
    ['Deals'],
    ['Time', 'Deal', 'Symbol', 'Type', 'Direction', 'Volume', 'Price', 'Order', 'Commission', 'Fee', 'Swap', 'Profit', 'Balance', 'Comment'],
    ['2000.01.01 09:05:00', '300001', 'XAUUSDm', 'sell', 'out', '0.01', '2995.000', '', '0.00', '-0.20', '0.00', '-5.00', '995.00', ''],
  ])), 'fees.html');
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].fees, 0);
  assert.match(result.warnings.join(' '), /额外费用/);
});

test('a closed position must have valid dates, price, volume and profit', async () => {
  for (const [index, value] of [[0, '2026.02.30 16:07:49'], [4, 'zero'], [4, '-0.01'], [4, '0,01'], [9, ''], [12, 'not-a-profit']]) {
    const badTrade = [...trade]; badTrade[index] = value;
    await assert.rejects(() => parseReport(html([...metadata, ['Positions'], header, badTrade]), 'bad.html'), /持仓表第/);
  }
});

test('unsupported, empty, corrupt and non-MT5 inputs fail clearly', async () => {
  await assert.rejects(() => parseReport(Buffer.alloc(0), 'empty.html'), /为空/);
  await assert.rejects(() => parseReport(Buffer.from('anything'), 'report.csv'), /仅支持/);
  await assert.rejects(() => parseReport(Buffer.from('invalid'), 'corrupt.xlsx'), /无法读取 XLSX/);
  await assert.rejects(() => parseReport(Buffer.from('<html>hello</html>'), 'plain.html'), /没有可解析的表格/);
  await assert.rejects(() => parseReport(html([['Positions'], header, trade]), 'no-account.html'), /账户编号/);
});
