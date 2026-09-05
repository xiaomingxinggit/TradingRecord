import path from 'node:path';
import { load } from 'cheerio';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_XML_SIZE = 100 * 1024 * 1024;
const labels = {
  time: ['时间', 'time', 'open time', 'close time'],
  ticket: ['持仓', 'position', 'ticket'],
  deal: ['成交', 'deal', 'ticket'],
  symbol: ['交易品种', '品种', 'symbol'],
  side: ['类型', 'type'],
  volume: ['交易量', 'volume', 'size'],
  price: ['价位', '价格', 'price', 'open price', 'close price'],
  stopLoss: ['止损', 's/l', 'sl', 'stop loss'],
  takeProfit: ['止盈', 't/p', 'tp', 'take profit'],
  commission: ['手续费', '佣金', 'commission'],
  swap: ['库存费', '隔夜利息', 'swap'],
  fees: ['费用', 'fee', 'fees'],
  profit: ['盈利', '利润', 'profit'],
  comment: ['注释', '备注', 'comment'],
};

function clean(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim();
    if ('result' in value) return clean(value.result);
    if ('text' in value) return clean(value.text);
    return '';
  }
  return String(value).replace(/[\u00a0\u202f]/g, ' ').trim();
}

function key(value) {
  return clean(value).toLowerCase().replace(/[:：]$/, '').trim();
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  // Some MT5 terminals export UTF-16 without a byte order mark.
  if (buffer[1] === 0 && buffer[3] === 0) return buffer.toString('utf16le');
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function number(value, { optional = false, zero = false } = {}) {
  let normalized = clean(value).replace(/[\s\u2009]/g, '').replace(/−/g, '-');
  if (!normalized || normalized === '-' || normalized === '—') {
    if (zero) return 0;
    if (optional) return null;
    throw new Error('缺少数值');
  }
  if (/^\([\d.]+\)$/.test(normalized)) normalized = `-${normalized.slice(1, -1)}`;
  if (normalized.includes(',')) {
    if (!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(normalized)) throw new Error(`无法识别数值「${clean(value)}」，请使用小数点格式导出`);
    normalized = normalized.replaceAll(',', '');
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) throw new Error(`无法识别数值「${clean(value)}」`);
  const result = Number(normalized);
  if (!Number.isFinite(result)) throw new Error('数值超出范围');
  return result;
}

function dateTime(value, optional = false) {
  const raw = clean(value);
  if (!raw || /^[-—]$/.test(raw)) {
    if (optional) return null;
    throw new Error('缺少时间');
  }
  const match = raw.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (!match) throw new Error(`无法识别时间「${raw}」`);
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (date.getUTCFullYear() !== +year || date.getUTCMonth() + 1 !== +month || date.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59) {
    throw new Error(`无效时间「${raw}」`);
  }
  // MT5 reports use the broker's server clock, with no UTC offset in the file.
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function htmlRows(buffer) {
  const $ = load(decodeText(buffer));
  const rows = [];
  $('tr').each((_, row) => {
    const cells = [];
    $(row).children('th,td').each((__, cell) => {
      const element = $(cell);
      if (element.hasClass('hidden') || element.attr('hidden') !== undefined || /display\s*:\s*none/i.test(element.attr('style') || '')) return;
      cells.push(clean(element.text()));
    });
    if (cells.some(Boolean)) rows.push(cells);
  });
  return rows;
}

async function xlsxRows(buffer) {
  let normalized = buffer;
  try {
    const zip = await JSZip.loadAsync(buffer);
    let changed = false;
    let xmlSize = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !/\.(?:xml|rels)$/i.test(entry.name)) continue;
      // The bundled MT5 sample stores XML parts as UTF-16. ExcelJS expects UTF-8.
      const declaredSize = entry._data?.uncompressedSize;
      if (declaredSize && xmlSize + declaredSize > MAX_XML_SIZE) throw new Error('XLSX 解压后的内容过大');
      const bytes = await entry.async('nodebuffer');
      xmlSize += bytes.length;
      if (xmlSize > MAX_XML_SIZE) throw new Error('XLSX 解压后的内容过大');
      if (bytes[0] === 0xff || bytes[0] === 0xfe || (bytes[1] === 0 && bytes[3] === 0)) {
        zip.file(entry.name, decodeText(bytes).replace(/encoding\s*=\s*["']UTF-16(?:LE|BE)?["']/i, 'encoding="UTF-8"'));
        changed = true;
      }
    }
    if (changed) normalized = await zip.generateAsync({ type: 'nodebuffer' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(normalized);
    const candidates = [];
    for (const sheet of workbook.worksheets) {
      if (sheet.rowCount > 200_000 || sheet.columnCount > 200) throw new Error('XLSX 表格超出可解析范围');
      const rows = [];
      sheet.eachRow(row => {
        const cells = [];
        for (let i = 1; i <= row.cellCount; i += 1) {
          const cell = row.getCell(i);
          if (cell.isMerged && cell.master.address !== cell.address) continue;
          if (sheet.getColumn(i).hidden) continue;
          cells.push(clean(cell.value));
        }
        if (cells.some(Boolean)) rows.push(cells);
      });
      candidates.push(rows);
    }
    const reportSheets = candidates.filter(rows => rows.some(row => row.filter(Boolean).length === 1 && ['持仓', 'positions', 'closed positions'].includes(key(row.find(Boolean)))));
    if (reportSheets.length > 1) throw new Error('XLSX 包含多个交易报告工作表，请分别导出后导入');
    return reportSheets[0] || candidates[0] || [];
  } catch (error) {
    throw new Error(`无法读取 XLSX 报告：${error.message}`);
  }
}

function headerIndex(row, label, occurrence = 0) {
  const indices = row.flatMap((cell, index) => labels[label].includes(key(cell)) ? [index] : []);
  return indices[occurrence] ?? -1;
}

function headerMap(row, section) {
  const map = Object.fromEntries(Object.keys(labels).map(label => [label, headerIndex(row, label)]));
  if (section === 'positions') {
    map.openTime = headerIndex(row, 'time');
    map.closeTime = headerIndex(row, 'time', 1);
    map.openPrice = headerIndex(row, 'price');
    map.closePrice = headerIndex(row, 'price', 1);
  }
  return map;
}

function cell(row, map, name) {
  return map[name] >= 0 ? row[map[name]] ?? '' : '';
}

function extractMetadata(rows) {
  const raw = {};
  const fields = { name: ['名称', 'name'], id: ['账户', '帐号', 'account'], broker: ['公司', 'company', 'broker'], reportDate: ['日期', 'date'], currency: ['货币', 'currency'], server: ['服务器', 'server'] };
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      for (const [field, names] of Object.entries(fields)) {
        if (names.includes(key(row[i])) && /[:：]$/.test(row[i])) raw[field] ||= row.slice(i + 1).find(Boolean) || '';
      }
    }
  }
  const match = (raw.id || '').match(/^(\d+)\s*(?:\(([^)]+)\))?/);
  if (!match) throw new Error('未识别 MT5 账户编号，请导出包含账户信息的完整交易历史报告');
  const accountDetails = (match[2] || '').split(',').map(clean);
  return {
    id: match[1],
    name: raw.name || '',
    currency: raw.currency || accountDetails[0] || '',
    broker: raw.broker || '',
    server: raw.server || accountDetails[1] || '',
    reportDate: raw.reportDate ? dateTime(raw.reportDate) : null,
  };
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
}

/** Parse MT5's full Chinese/English history report, without counting deals as trades. */
export async function parseReport(input, filename = 'report.html') {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buffer.length) throw new Error('报告文件为空');
  if (buffer.length > MAX_FILE_SIZE) throw new Error('报告文件不能超过 25 MB');
  const extension = path.extname(filename).toLowerCase();
  if (!['.html', '.htm', '.xlsx'].includes(extension)) throw new Error('仅支持 MT5 导出的 HTML、HTM 或 XLSX 交易历史报告');
  const rows = extension === '.xlsx' ? await xlsxRows(buffer) : htmlRows(buffer);
  if (!rows.length) throw new Error('报告中没有可解析的表格');
  const account = extractMetadata(rows);
  const trades = [];
  const cashFlows = [];
  const summary = {};
  const warnings = [];
  const sourceFile = path.basename(filename);
  const seenTrades = new Map();
  const seenCash = new Set();
  let section = null;
  let map = null;
  let foundPositions = false;
  let foundPositionHeader = false;
  let positionHasFees = false;
  let dealFees = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const populated = row.filter(Boolean);
    const sectionName = populated.length === 1 ? key(populated[0]) : '';
    if (['持仓', 'positions', 'closed positions'].includes(sectionName)) {
      section = 'positions'; map = null; foundPositions = true; continue;
    }
    if (['订单', 'orders', '成交', 'deals', '结果', 'results', '未平仓持仓', 'open positions', '挂单', 'working orders'].includes(sectionName)) {
      section = ['成交', 'deals'].includes(sectionName) ? 'deals' : null;
      map = null; continue;
    }
    for (let i = 0; i < row.length; i += 1) {
      const label = key(row[i]);
      if (['总净盈利', 'total net profit'].includes(label)) summary.reportedNetProfit = number(row.slice(i + 1).find(Boolean));
      if (['交易总计', 'total trades'].includes(label)) summary.reportedTradeCount = number(row.slice(i + 1).find(Boolean));
    }
    if (!section) continue;
    if (headerIndex(row, 'side') >= 0 && headerIndex(row, 'symbol') >= 0 && headerIndex(row, 'profit') >= 0) {
      map = headerMap(row, section);
      if (section === 'positions') {
        const required = ['ticket', 'symbol', 'side', 'volume', 'openTime', 'closeTime', 'openPrice', 'closePrice', 'profit'];
        if (required.some(field => map[field] < 0)) throw new Error('持仓表缺少必要列，请导出包含开仓和平仓信息的完整持仓历史报告');
        positionHasFees ||= map.fees >= 0;
        foundPositionHeader = true;
      }
      continue;
    }
    if (!map) continue;
    const side = key(cell(row, map, 'side'));
    if (section === 'positions' && ['buy', 'sell', '买入', '卖出'].includes(side)) {
      try {
        const ticket = clean(cell(row, map, 'ticket'));
        if (!/^\d+$/.test(ticket)) throw new Error('持仓编号无效');
        const id = `mt5:${account.id}:${ticket}`;
        const openTime = dateTime(cell(row, map, 'openTime'));
        const closeTime = dateTime(cell(row, map, 'closeTime'), true);
        const volume = number(cell(row, map, 'volume'));
        const openPrice = number(cell(row, map, 'openPrice'));
        const closePrice = number(cell(row, map, 'closePrice'), { optional: true });
        if (volume <= 0 || openPrice <= 0 || (closePrice !== null && closePrice <= 0)) throw new Error('交易量和成交价必须大于零');
        if (closeTime && (!closePrice || closeTime < openTime)) throw new Error('平仓时间或平仓价无效');
        const symbol = clean(cell(row, map, 'symbol'));
        if (!symbol) throw new Error('缺少交易品种');
        const commission = number(cell(row, map, 'commission'), { zero: true });
        const swap = number(cell(row, map, 'swap'), { zero: true });
        const fees = number(cell(row, map, 'fees'), { zero: true });
        const profit = number(cell(row, map, 'profit'), { zero: !closeTime });
        const trade = {
          id, accountId: account.id, ticket, symbol,
          side: ['buy', '买入'].includes(side) ? 'buy' : 'sell',
          volume, openTime, closeTime, openPrice, closePrice,
          stopLoss: number(cell(row, map, 'stopLoss'), { optional: true }) || null,
          takeProfit: number(cell(row, map, 'takeProfit'), { optional: true }) || null,
          commission, swap, fees, profit, netProfit: round(profit + commission + swap + fees),
          comment: clean(cell(row, map, 'comment')), sourceFile,
        };
        if (seenTrades.has(id)) {
          if (JSON.stringify(seenTrades.get(id)) !== JSON.stringify(trade)) throw new Error(`持仓 ${ticket} 出现不同的重复记录，当前不支持这种分拆格式`);
          warnings.push(`重复持仓 ${ticket} 已忽略`);
        } else {
          seenTrades.set(id, trade);
          trades.push(trade);
        }
      } catch (error) {
        throw new Error(`持仓表第 ${rowIndex + 1} 行解析失败：${error.message}`);
      }
    } else if (section === 'positions' && /^\d{4}[.\-/]\d{2}[.\-/]\d{2}/.test(cell(row, map, 'openTime'))) {
      throw new Error(`持仓表第 ${rowIndex + 1} 行包含不支持的交易类型「${side}」`);
    } else if (section === 'deals') {
      if (['buy', 'sell', '买入', '卖出'].includes(side)) {
        dealFees += number(cell(row, map, 'fees'), { zero: true });
        continue;
      }
      if (!['balance', 'credit', 'charge', 'correction', 'bonus', 'commission', 'commission daily', 'commission monthly', 'interest', 'dividend', 'tax', '结余', '信用', '余额'].includes(side)) continue;
      try {
        const ticket = clean(cell(row, map, 'deal'));
        if (!/^\d+$/.test(ticket)) throw new Error('成交编号无效');
        const amount = round(number(cell(row, map, 'profit')) + number(cell(row, map, 'commission'), { zero: true }) + number(cell(row, map, 'swap'), { zero: true }) + number(cell(row, map, 'fees'), { zero: true }));
        const id = `mt5-cash:${account.id}:${ticket}`;
        if (seenCash.has(id)) continue;
        seenCash.add(id);
        cashFlows.push({
          id, accountId: account.id, time: dateTime(cell(row, map, 'time')),
          type: ['balance', '结余', '余额'].includes(side) ? (amount >= 0 ? 'deposit' : 'withdrawal') : side,
          amount, comment: clean(cell(row, map, 'comment')),
        });
      } catch (error) {
        throw new Error(`资金流水第 ${rowIndex + 1} 行解析失败：${error.message}`);
      }
    }
  }
  if (!foundPositions || !foundPositionHeader) throw new Error('未找到可识别的持仓历史表。请在 MT5 历史中选择“持仓”或包含持仓的完整报告后导出；当前不从逐笔成交自动重建持仓');
  if (!account.currency) warnings.push('报告未标明账户币种，请核对后使用金额统计');
  if (!positionHasFees && Math.abs(dealFees) > 0.00000001) warnings.push(`成交表包含 ${round(dealFees)} 的额外费用，持仓表没有费用列，尚未分配到每笔交易`);
  const closedTrades = trades.filter(trade => trade.closeTime);
  const total = round(closedTrades.reduce((sum, trade) => sum + trade.netProfit, 0));
  if (summary.reportedTradeCount !== undefined && closedTrades.length !== summary.reportedTradeCount) warnings.push(`已解析 ${closedTrades.length} 笔已平仓交易，与报告汇总 ${summary.reportedTradeCount} 笔不同，请核对报告是否完整`);
  if (summary.reportedNetProfit !== undefined && Math.abs(total - summary.reportedNetProfit) > 0.011) warnings.push(`交易净利润合计 ${total}，与报告总净盈利 ${summary.reportedNetProfit} 不一致，请检查额外费用或报告范围`);
  return { account, trades, cashFlows, summary, warnings };
}
