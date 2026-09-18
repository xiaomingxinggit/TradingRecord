import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import english from '@tesseract.js-data/eng';

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const MODES = ['pending', 'open', 'closed'];
const MODE_LABELS = { pending: '挂单', open: '持仓中', closed: '已平仓' };
const MAX_ROWS = 20;
// Proportions refer to the full-width, light MT5 table layouts supplied for
// this feature. These are separate layouts, not an arbitrary column detector.
const CLOSED_COLUMNS = {
  openTime: [0.009, 0.079], symbol: [0.079, 0.1655], ticket: [0.1655, 0.2325],
  orderType: [0.2325, 0.2905], volume: [0.2905, 0.3873], openPrice: [0.3873, 0.4832],
  reportedSL: [0.4832, 0.5796], reportedTP: [0.5796, 0.6767],
  closeTime: [0.6767, 0.7454], closePrice: [0.7454, 0.8413], reportedProfit: [0.8413, 0.9502],
  changePercent: [0.9502, 0.998],
};
// Pending orders and open positions share this full-width grid. The last two
// columns are recognized only as structural evidence and never saved as a
// current price, floating profit, or placed status.
const SHARED_REFERENCE_WIDTH = 2533;
const SHARED_COLUMNS = {
  symbol: [24, 328], ticket: [328, 556], eventTime: [556, 731],
  orderType: [731, 984], volume: [984, 1237], entryPrice: [1237, 1490],
  reportedSL: [1490, 1743], reportedTP: [1743, 1996],
  currentPrice: [1996, 2249], tail: [2249, 2533],
};
const LABELS = {
  ticket: '订单号', symbol: '品种', orderType: '交易类型', volume: '手数',
  pendingPrice: '挂单目标价', openPrice: '开仓价', closePrice: '平仓价',
  reportedSL: '止损', reportedTP: '止盈', reportedProfit: '截图盈利',
  pendingTime: '挂单时间', openTime: '开仓时间', closeTime: '平仓时间',
};

const emptyReading = (confidence = 0) => ({ text: '', confidence, hasInk: false, inkFraction: 0 });

function safeRect(left, top, rectWidth, rectHeight, imageWidth, imageHeight) {
  const values = [left, top, rectWidth, rectHeight, imageWidth, imageHeight];
  if (!values.every(Number.isFinite) || imageWidth < 1 || imageHeight < 1 || rectWidth <= 0 || rectHeight <= 0
    || left >= imageWidth || top >= imageHeight || left + rectWidth <= 0 || top + rectHeight <= 0) return null;
  const x = Math.max(0, Math.min(imageWidth - 1, Math.floor(left)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.floor(top)));
  const right = Math.max(x + 1, Math.min(imageWidth, Math.ceil(left + rectWidth)));
  const bottom = Math.max(y + 1, Math.min(imageHeight, Math.ceil(top + rectHeight)));
  if (right <= x || bottom <= y) return null;
  return { left: x, top: y, width: right - x, height: bottom - y };
}

function cropBounds(columns, width) {
  return Object.fromEntries(Object.entries(columns).map(([key, [from, to]]) => {
    // Keep table rules/icons out of OCR without clipping the right-aligned text.
    const proposedLeft = Math.round(from * width) + 2;
    const proposedRight = Math.round(to * width) - 2;
    const rect = safeRect(proposedLeft, 0, proposedRight - proposedLeft, 1, width, 1);
    return [key, rect ? { left: rect.left, width: rect.width } : { left: 0, width: 0 }];
  }));
}

function sharedCells(pixels, width, height) {
  const scale = width / SHARED_REFERENCE_WIDTH;
  const rules = new Map();
  const radius = Math.max(2, Math.round(8 * scale));
  const shoulder = Math.max(2, Math.ceil(3 * scale));
  // Search only close to each expected separator, not arbitrary text strokes.
  // Look across a few pixels so proportionally scaled rules can be wider than 1px.
  for (const edge of new Set(Object.values(SHARED_COLUMNS).flat().filter(x => x !== SHARED_COLUMNS.symbol[0]))) {
    const expected = Math.max(0, Math.min(width, Math.round(edge * scale)));
    if (expected === 0 || expected === width) { rules.set(edge, { left: expected, right: expected }); continue; }
    let best = null;
    const scores = new Map();
    const searchLeft = Math.max(1, expected - radius), searchRight = Math.min(width - 2, expected + radius);
    for (let x = searchLeft; x <= searchRight; x++) {
      let score = 0;
      for (let y = 0; y < height; y++) {
        const p = pixels[y * width + x];
        const before = pixels[y * width + Math.max(0, x - shoulder)];
        const after = pixels[y * width + Math.min(width - 1, x + shoulder)];
        if (p >= 100 && p < 245 && Math.max(before, after) > p + 10) score++;
      }
      scores.set(x, score);
      if (score >= height * 0.7 && (!best || score > best.score
        || (score === best.score && Math.abs(x - expected) < Math.abs(best.x - expected)))) best = { x, score };
    }
    if (best) {
      let left = best.x, right = best.x + 1;
      while (scores.get(left - 1) >= height * 0.7) left--;
      while (scores.get(right) >= height * 0.7) right++;
      rules.set(edge, { left, right });
    } else rules.set(edge, { left: expected, right: expected });
  }
  return Object.fromEntries(Object.entries(SHARED_COLUMNS).map(([key, [from, to]]) => {
    const proposedLeft = rules.get(from)?.right ?? Math.round(from * scale);
    const proposedRight = rules.get(to)?.left ?? Math.round(to * scale);
    // Exclude only the detected rule itself. No fixed right inset: the last
    // digit of a right-aligned value may sit immediately beside the separator.
    const rect = safeRect(proposedLeft, 0, proposedRight - proposedLeft, 1, width, 1);
    return [key, rect ? { left: rect.left, width: rect.width } : { left: 0, width: 0 }];
  }));
}

function sharedValueCell(pixels, width, top, bottom, key, cell) {
  if (key !== 'reportedSL' && key !== 'reportedTP') return cell;
  const scale = width / SHARED_REFERENCE_WIDTH;
  const right = cell.left + cell.width;
  const slotLeft = Math.max(cell.left, right - Math.ceil(22 * scale));
  // The optional gray close control lives in the far-right slot of SL/TP.
  // Remove it only when it is a small, isolated gray component. A dark final
  // digit (or an uncertain shape) stays intact and goes through normal OCR.
  const occupied = x => {
    for (let y = top; y < bottom; y++) if (pixels[y * width + x] < 220) return true;
    return false;
  };
  let end = right - 1;
  while (end >= slotLeft && !occupied(end)) end--;
  if (end < slotLeft) return cell;
  let start = end;
  while (start > slotLeft && occupied(start - 1)) start--;
  let minY = bottom, maxY = -1, darkest = 255;
  for (let y = top; y < bottom; y++) for (let x = start; x <= end; x++) {
    const p = pixels[y * width + x];
    if (p < 220) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); darkest = Math.min(darkest, p); }
  }
  const componentWidth = end - start + 1, componentHeight = maxY - minY + 1;
  const maxSize = Math.ceil(12 * scale), minSize = Math.max(2, Math.floor(3 * scale));
  const gap = Math.max(1, Math.floor(3 * scale));
  if (darkest < 110 || componentWidth < minSize || componentWidth > maxSize
    || componentHeight < minSize || componentHeight > maxSize
    || componentWidth / componentHeight < 0.5 || componentWidth / componentHeight > 2
    || right - end - 1 < Math.max(1, Math.floor(3 * scale))
    || right - end - 1 > Math.ceil(14 * scale) || start - gap < slotLeft) return cell;
  for (let x = start - gap; x < start; x++) if (occupied(x)) return cell;
  let diagonalInk = 0, totalInk = 0;
  for (let y = minY; y <= maxY; y++) for (let x = start; x <= end; x++) {
    if (pixels[y * width + x] >= 220) continue;
    const nx = (x - start) / (componentWidth - 1), ny = (y - minY) / (componentHeight - 1);
    totalInk++;
    if (Math.min(Math.abs(nx - ny), Math.abs(nx + ny - 1)) <= 0.3) diagonalInk++;
  }
  if (diagonalInk < totalInk * 0.8) return cell;
  return { left: cell.left, width: start - cell.left };
}

function findBands(pixels, width, height, cells) {
  const bands = [];
  let start = -1, lastInk = -1;
  for (let y = 0; y <= height + 2; y++) {
    let active = false;
    if (y < height) {
      for (const { left, width: cellWidth } of Object.values(cells)) {
        let ink = 0;
        for (let x = left; x < left + cellWidth; x++) if (pixels[y * width + x] < 150) ink++;
        // A text band in any column is enough, even if the price/ticket is blank.
        // Horizontal rules and solid fills do not count as text.
        if (ink >= 3 && ink < cellWidth * 0.65) { active = true; break; }
      }
    }
    if (active) { if (start < 0) start = y; lastInk = y; }
    if (!active && start >= 0 && y - lastInk > 2) {
      // Two pixels are enough for very thin anti-aliased text in a 25px row.
      // Column edges are excluded above, so horizontal/vertical table rules do
      // not become rows by themselves.
      if (lastInk - start >= 1) bands.push([start, lastInk + 1]);
      start = -1;
    }
  }
  return bands;
}

// Accept only a complete report-clock value, never Date parsing/timezone conversion.
function reportTime(value) {
  const match = /^(\d{4})[.-](\d{2})[.-](\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '';
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return '';
  return `${year}.${month}.${day} ${hour}:${minute}:${second}`;
}

function numeric(value) {
  // Thousands separators are accepted only when grouping is unambiguous.
  value = value.replace(/\s+/g, ' ').trim();
  const plain = /^[+-]?\d+(?:\.\d+)?$/;
  const grouped = /^[+-]?\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?$/;
  if (!plain.test(value) && !grouped.test(value)) return null;
  const result = Number(value.replace(/[ ,]/g, ''));
  return Number.isFinite(result) ? result : null;
}

function headerRow(readings, mode, index) {
  if (index !== 0) return false;
  const text = Object.values(readings).map(cell => cell.text).join(' ').toLowerCase();
  const labels = text.match(/\b(?:ticket|symbol|volume|profit|price|type|time|order)\b/g) || [];
  if (labels.length >= 3 && !/\b(?:buy|sell|balance)\b/.test(text)) return true;
  const type = readings.orderType?.text ?? '';
  const ticket = readings.ticket?.text.trim() ?? '';
  const timeKeys = mode === 'closed' ? ['openTime', 'closeTime'] : ['eventTime'];
  const hasTime = timeKeys.some(key => reportTime(readings[key]?.text ?? ''));
  // English OCR cannot reliably read the Chinese labels. A header is the
  // first populated band without any of the three strongest data signals.
  return !/^\d+$/.test(ticket) && !pendingType(type) && !marketType(type) && !hasTime
    && Object.values(readings).filter(cell => cell.hasInk).length >= 5;
}

function nonOrderRow(readings, mode, index) {
  if (headerRow(readings, mode, index)) return 'header';
  const text = Object.values(readings).map(cell => cell.text).join(' ').toLowerCase();
  if (/\b(?:balance|equity|margin|free margin|account)\b/.test(text)) return 'summary';
  const type = readings.orderType?.text ?? '';
  const ticket = readings.ticket?.text.trim() ?? '';
  const timeKeys = mode === 'closed' ? ['openTime', 'closeTime'] : ['eventTime'];
  const timeCount = timeKeys.filter(key => reportTime(readings[key]?.text ?? '')).length;
  // Account totals and empty bands can contain amounts, but not a ticket,
  // buy/sell type, or complete report-clock value.
  if (!/^\d+$/.test(ticket) && !pendingType(type) && !marketType(type) && !timeCount) return 'summary';
  return '';
}

function draftRow(readings, mode, rowIndex) {
  const row = {
    rowIndex, ticket: '', status: mode, symbol: '', side: '', volume: null, orderType: '',
    pendingTime: null, pendingPrice: null, openTime: null, openPrice: null, closeTime: null, closePrice: null,
    reportedSL: null, reportedTP: null, reportedProfit: null, warnings: [],
    raw: Object.fromEntries(Object.entries(readings).map(([key, cell]) => [key, cell.text])),
  };
  const read = key => readings[key] || { text: '', confidence: 0, hasInk: false };
  const warn = key => row.warnings.push(`${LABELS[key]}缺失或无法可靠识别，请对照原图填写。`);
  const ticket = read('ticket');
  // Tickets must never pass through Number or character substitutions.
  if (ticket.confidence >= 72 && /^\d+$/.test(ticket.text)) row.ticket = ticket.text;
  else warn('ticket');
  const symbol = read('symbol');
  if (symbol.confidence >= 60 && /^[A-Za-z][A-Za-z0-9._#-]{0,39}$/.test(symbol.text)) row.symbol = symbol.text;
  else warn('symbol');
  const direction = read('orderType');
  const orderType = normalizedType(direction.text);
  if (direction.confidence >= 60 && (pendingType(orderType) || marketType(orderType))) {
    const isPending = pendingType(orderType);
    if (isPending === (mode === 'pending')) {
      row.side = orderType.startsWith('buy') ? 'buy' : 'sell';
      row.orderType = orderType;
    } else row.warnings.push('图中交易类型与所选模式不一致；请核对模式，并补填方向和交易类型。');
  } else warn('orderType');
  const readNumber = (key, source = key, parser = numeric) => {
    const cell = read(source), value = parser(cell.text);
    const optional = key === 'reportedSL' || key === 'reportedTP';
    if (optional && !cell.hasInk) return;
    if (cell.confidence >= 60 && value !== null && (key === 'reportedProfit' || value > 0)) row[key] = value;
    else if (!(optional && cell.confidence >= 60 && value === 0)) warn(key);
  };
  readNumber('volume', 'volume', volumeNumeric);
  readNumber('reportedSL');
  readNumber('reportedTP');
  if (mode === 'closed') {
    readNumber('openPrice'); readNumber('closePrice'); readNumber('reportedProfit');
    for (const key of ['openTime', 'closeTime']) {
      const cell = read(key), value = reportTime(cell.text);
      if (cell.confidence >= 60 && value) row[key] = value;
      else warn(key);
    }
  } else if (mode === 'open') {
    readNumber('openPrice', 'entryPrice');
    const cell = read('eventTime'), value = reportTime(cell.text);
    if (cell.confidence >= 60 && value) row.openTime = value;
    else warn('openTime');
    // The current price/floating-profit columns are deliberately never read.
  } else {
    readNumber('pendingPrice', 'entryPrice');
    const cell = read('eventTime'), value = reportTime(cell.text);
    if (cell.confidence >= 60 && value) row.pendingTime = value;
    else if (cell.hasInk) warn('pendingTime');
  }
  if (!row.side) row.warnings.push('此行未可靠确认是交易行，请核对；表头、资金或汇总行不要保存。');
  return row;
}

function structuralEvidence(readings, mode) {
  const reliable = (key, threshold = 50) => (readings[key]?.confidence ?? 0) >= threshold;
  const typeText = readings.orderType?.text ?? '';
  const ticket = reliable('ticket') && /^\d+$/.test(readings.ticket.text.trim());
  const symbol = reliable('symbol') && /^[A-Za-z][A-Za-z0-9._#-]{0,39}$/.test(readings.symbol.text.trim());
  const volume = reliable('volume') && volumeNumeric(readings.volume.text) !== null;
  const isPending = reliable('orderType') && pendingType(typeText);
  const isMarket = reliable('orderType') && marketType(typeText);
  const eventTime = reliable('eventTime') && !!reportTime(readings.eventTime?.text ?? '');
  const openTime = reliable('openTime') && !!reportTime(readings.openTime?.text ?? '');
  const closeTime = reliable('closeTime') && !!reportTime(readings.closeTime?.text ?? '');
  const entryPrice = reliable('entryPrice') && numeric(readings.entryPrice?.text ?? '') !== null;
  const openPrice = reliable('openPrice') && numeric(readings.openPrice?.text ?? '') !== null;
  const closePrice = reliable('closePrice') && numeric(readings.closePrice?.text ?? '') !== null;
  const profit = reliable('reportedProfit') && numeric(readings.reportedProfit?.text ?? '') !== null;
  const percent = reliable('changePercent') && percentNumeric(readings.changePercent?.text ?? '') !== null;
  const tailText = readings.tail?.text.trim() ?? '';
  const placed = reliable('tail') && /\bplaced\b/i.test(tailText);
  const floating = reliable('tail') && numeric(tailText) !== null;
  let score = (ticket ? 14 : 0) + (symbol ? 8 : 0) + (volume ? 8 : 0);
  let expected;
  if (mode === 'pending') {
    score += (isPending ? 32 : 0) + (placed ? 26 : 0) + (eventTime ? 6 : 0) + (entryPrice ? 6 : 0);
    if (isMarket) score -= 22;
    if (floating && !placed) score -= 8;
    expected = [ticket, symbol, volume, isPending, placed || eventTime, entryPrice];
  } else if (mode === 'open') {
    score += (isMarket ? 26 : 0) + (eventTime ? 22 : 0) + (entryPrice ? 10 : 0) + (floating ? 12 : 0);
    if (isPending) score -= 36;
    if (placed) score -= 36;
    expected = [ticket, symbol, volume, isMarket, eventTime, entryPrice, floating];
  } else {
    score += (isMarket ? 14 : 0) + (openTime && closeTime ? 34 : openTime || closeTime ? 5 : 0)
      + (openPrice ? 8 : 0) + (closePrice ? 8 : 0) + (profit ? 8 : 0) + (percent ? 6 : 0);
    if (isPending) score -= 32;
    if (!(openTime && closeTime)) score -= 18;
    expected = [ticket, symbol, volume, isMarket, openTime, closeTime, openPrice, closePrice, profit, percent];
  }
  return { score: Math.max(0, Math.min(100, score)), matched: expected.filter(Boolean).length, missing: expected.filter(value => !value).length };
}

async function recognizeMode(pixels, width, height, mode, worker) {
  const cells = mode === 'closed' ? cropBounds(CLOSED_COLUMNS, width) : sharedCells(pixels, width, height);
  const bands = findBands(pixels, width, height, cells);
  const warnings = [];
  if (!bands.length) return { mode, rows: [], warnings, score: 0, matchedFields: 0, missingFields: 0 };
  if (mode === 'pending') warnings.push('挂单按品种、订单号、时间、类型、交易量、目标价、止损、止盈的独立列识别；交易量“已下单 / 已成交”格式只取左侧。当前价与 placed 状态不写入订单字段。');
  if (mode === 'open') warnings.push('持仓按独立列识别订单号与开仓时间，支持无表头完整宽度数据行；低置信度字段留空，请手工核对。开仓时间保留截图时钟，不转换时区；不识别当前市价与浮动盈亏。');
  const rows = [];
  let skippedSummary = 0, invalidCells = 0, structureTotal = 0, structureMatched = 0, structureMissing = 0;
  // Bound work even for noisy images; do not silently truncate suspected rows.
  const candidateLimit = MAX_ROWS + 2;
  if (bands.length > candidateLimit) warnings.push(`检测到 ${bands.length} 个文字带，本次只处理前 ${candidateLimit} 个；请分开截图，剩余内容未识别。`);
  for (const [index, [top, bottom]] of bands.slice(0, candidateLimit).entries()) {
    const readings = {};
    const rowRect = safeRect(0, top, width, bottom - top, width, height);
    if (!rowRect) { invalidCells += Object.keys(cells).length; continue; }
    for (const [key, cell] of Object.entries(cells)) {
      const adjusted = mode !== 'closed'
        ? sharedValueCell(pixels, width, rowRect.top, rowRect.top + rowRect.height, key, cell) : cell;
      const cellRect = safeRect(adjusted.left, rowRect.top, adjusted.width, rowRect.height, width, height);
      if (!cellRect) { readings[key] = emptyReading(); invalidCells++; continue; }
      const { left, width: cellWidth } = cellRect;
      let minInkX = cellWidth, maxInkX = -1, ink = 0;
      for (let y = cellRect.top; y < cellRect.top + cellRect.height; y++) for (let x = 0; x < cellWidth; x++) {
        if (pixels[y * width + left + x] < 150) { ink++; minInkX = Math.min(minInkX, x); maxInkX = Math.max(maxInkX, x); }
      }
      if (ink < 3) { readings[key] = emptyReading(100); continue; }
      const cropRect = safeRect(left, cellRect.top - 3, cellWidth, cellRect.height + 6, width, height);
      if (!cropRect) { readings[key] = emptyReading(); invalidCells++; continue; }
      const scale = Math.min(6, Math.max(4, Math.ceil(64 / cropRect.height)));
      try {
        const crop = await sharp(pixels, { raw: { width, height, channels: 1 } })
          .extract(cropRect)
          .resize(cropRect.width * scale, cropRect.height * scale, { kernel: 'lanczos3' }).normalize().sharpen({ sigma: 0.8 })
          .extend({ top: 12, bottom: 12, left: 16, right: 16, background: '#fff' }).png().toBuffer();
        const { data } = await worker.recognize(crop);
        readings[key] = { text: data.text.trim(), confidence: data.confidence, hasInk: true,
          inkFraction: (maxInkX - minInkX + 1) / cellWidth };
      } catch {
        readings[key] = emptyReading(); invalidCells++;
      }
    }
    const excluded = nonOrderRow(readings, mode, index);
    if (excluded === 'header') { warnings.push('已排除表头行。'); continue; }
    if (excluded) { skippedSummary++; continue; }
    if (rows.length >= MAX_ROWS) { warnings.push('一次最多返回 20 行，后续内容未识别，请分开截图。'); break; }
    const evidence = structuralEvidence(readings, mode);
    structureTotal += evidence.score; structureMatched += evidence.matched; structureMissing += evidence.missing;
    rows.push(draftRow(readings, mode, rows.length + 1));
  }
  if (skippedSummary) warnings.push(`已排除 ${skippedSummary} 行表头、账户汇总或非订单内容。`);
  if (invalidCells) warnings.push(`有 ${invalidCells} 个单元格无法安全裁剪或识别，已留空并等待人工核对。`);
  const required = mode === 'pending'
    ? ['ticket', 'symbol', 'side', 'volume', 'pendingPrice']
    : mode === 'open'
      ? ['ticket', 'symbol', 'side', 'volume', 'openTime', 'openPrice']
      : ['ticket', 'symbol', 'side', 'volume', 'openTime', 'openPrice', 'closeTime', 'closePrice', 'reportedProfit'];
  let matchedFields = 0, missingFields = 0;
  for (const row of rows) for (const key of required) {
    if (row[key] !== null && row[key] !== '') matchedFields++;
    else missingFields++;
  }
  // Type, time count, ticket and the unsaved trailing status/profit signals
  // dominate; optional SL/TP completeness only makes a small adjustment.
  const completeness = matchedFields + missingFields ? matchedFields / (matchedFields + missingFields) : 0;
  const structural = rows.length ? structureTotal / rows.length : 0;
  const score = Math.round(Math.max(0, Math.min(100, structural * 0.88 + completeness * 12)));
  return { mode, rows, warnings, score, matchedFields: structureMatched, missingFields: structureMissing };
}

function volumeNumeric(value) {
  const left = value.split('/')[0]?.trim() ?? '';
  return numeric(left);
}

function percentNumeric(value) {
  return numeric(value.trim().replace(/\s*%$/, ''));
}

function normalizedType(value) {
  return value.toLowerCase().replace(/[^a-z]+/g, ' ').trim().replace(/\s+/g, ' ');
}

const pendingType = value => /^(?:buy|sell) (?:limit|stop|stop limit)$/.test(normalizedType(value));
const marketType = value => /^(?:buy|sell)$/.test(normalizedType(value));

export async function recognizeOrders(buffer) {
  let pixels, info;
  try {
    ({ data: pixels, info } = await sharp(buffer, { limitInputPixels: 12_000_000 })
      .flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true }));
  } catch { throw fail('图片无法读取，请使用 PNG、JPEG 或 WEBP 截图。'); }
  const { width, height } = info;
  if (width < 1000 || width > 6000 || height < 12 || height > 1000) throw fail('请截取完整宽度的浅色交易表格，保持支持的固定列布局。');
  const worker = await createWorker('eng', 1, { langPath: english.langPath, gzip: true, cacheMethod: 'none' });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const candidates = [];
    for (const mode of MODES) candidates.push(await recognizeMode(pixels, width, height, mode, worker));
    candidates.sort((a, b) => b.score - a.score || MODES.indexOf(a.mode) - MODES.indexOf(b.mode));
    const [selected, runnerUp] = candidates;
    if (!selected.rows.length) throw fail('没有找到可识别的交易行，请使用清晰的完整宽度截图。');
    const ambiguous = selected.score < 65 || selected.score - runnerUp.score < 12;
    const warnings = [
      '系统已自动比较挂单、持仓中和已平仓三套固定浅色 MT5 布局。识别结果仅为草稿，保存前请逐项对照原图。',
      `布局判断：${MODE_LABELS[selected.mode]}得分 ${selected.score}，其次${MODE_LABELS[runnerUp.mode]}得分 ${runnerUp.score}；依据为类型、时间数量、订单号、交易量及末列结构信号。`,
      ...selected.warnings,
    ];
    if (ambiguous) warnings.push('无法可靠唯一判断截图状态，已返回得分最高的草稿；请人工选择正确状态并修正字段后再保存。');
    return {
      rows: selected.rows,
      detectedStatus: selected.mode,
      ambiguous,
      imageHash: createHash('sha256').update(buffer).digest('hex'),
      warnings,
      detection: candidates.map(({ mode, score, matchedFields, missingFields }) => ({ status: mode, score, matchedFields, missingFields })),
    };
  } finally { await worker.terminate(); }
}
