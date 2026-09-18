import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import english from '@tesseract.js-data/eng';

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const MODES = ['pending', 'open', 'closed'];
const MAX_ROWS = 20;
// Proportions refer to the full-width, light MT5 table layouts supplied for
// this feature. These are separate layouts, not an arbitrary column detector.
const CLOSED_COLUMNS = {
  openTime: [0.009, 0.079], symbol: [0.079, 0.1655], ticket: [0.1655, 0.2325],
  orderType: [0.2325, 0.2905], volume: [0.2905, 0.3873], openPrice: [0.3873, 0.4832],
  reportedSL: [0.4832, 0.5796], reportedTP: [0.5796, 0.6767],
  closeTime: [0.6767, 0.7454], closePrice: [0.7454, 0.8413], reportedProfit: [0.8413, 0.9502],
};
const LIVE_COLUMNS = {
  symbol: [0.009, 0.1295], ticket: [0.13, 0.29], orderType: [0.30, 0.387],
  volume: [0.40, 0.487], entryPrice: [0.50, 0.587],
  reportedSL: [0.60, 0.680], reportedTP: [0.70, 0.780],
};
// Positions has its own ticket AND report-clock columns. Coordinates describe
// the full table, including the two trailing columns that we never recognize.
const OPEN_REFERENCE_WIDTH = 2533;
const OPEN_COLUMNS = {
  symbol: [24, 328], ticket: [328, 556], openTime: [556, 731],
  orderType: [731, 984], volume: [984, 1237], openPrice: [1237, 1490],
  reportedSL: [1490, 1743], reportedTP: [1743, 1996],
};
const LABELS = {
  ticket: '订单号', symbol: '品种', orderType: '交易类型', volume: '手数',
  pendingPrice: '挂单目标价', openPrice: '开仓价', closePrice: '平仓价',
  reportedSL: '止损', reportedTP: '止盈', reportedProfit: '截图盈利',
  openTime: '开仓时间', closeTime: '平仓时间',
};

function liveColumns(pixels, width, height) {
  // Same left-gutter correction as the existing price recognizer.
  let separator = Math.round(width * 0.1295), best = 0;
  for (let x = Math.floor(width * 0.12); x < width * 0.15; x++) {
    let score = 0;
    for (let y = 0; y < height; y++) {
      const p = pixels[y * width + x];
      if (p > 140 && p < 225 && pixels[y * width + x - 1] > p + 10 && pixels[y * width + x + 1] > p + 10) score++;
    }
    if (score > best) { best = score; separator = x; }
  }
  const offset = best > height * 0.5 ? Math.max(0, (separator / width - 0.1295) / 0.8705) : 0;
  return Object.fromEntries(Object.entries(LIVE_COLUMNS).map(([key, bounds]) => [key, bounds.map(x => offset + x * (1 - offset))]));
}

function cropBounds(columns, width) {
  return Object.fromEntries(Object.entries(columns).map(([key, [from, to]]) => {
    // Keep table rules/icons out of OCR without clipping the right-aligned text.
    const left = Math.max(2, Math.round(from * width) + 2);
    return [key, { left, width: Math.max(1, Math.round(to * width) - left - 2) }];
  }));
}

function openCells(pixels, width, height) {
  const scale = width / OPEN_REFERENCE_WIDTH;
  const rules = new Map();
  const radius = Math.max(2, Math.round(8 * scale));
  const shoulder = Math.max(2, Math.ceil(3 * scale));
  // Search only close to each expected separator, not arbitrary text strokes.
  // Look across a few pixels so proportionally scaled rules can be wider than 1px.
  for (const edge of new Set(Object.values(OPEN_COLUMNS).flat().filter(x => x !== OPEN_COLUMNS.symbol[0]))) {
    const expected = Math.round(edge * scale);
    let best = null;
    const scores = new Map();
    for (let x = expected - radius; x <= expected + radius; x++) {
      let score = 0;
      for (let y = 0; y < height; y++) {
        const p = pixels[y * width + x];
        if (p >= 100 && p < 245
          && Math.max(pixels[y * width + x - shoulder], pixels[y * width + x + shoulder]) > p + 10) score++;
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
  return Object.fromEntries(Object.entries(OPEN_COLUMNS).map(([key, [from, to]]) => {
    const left = rules.get(from)?.right ?? Math.round(from * scale);
    const right = rules.get(to).left;
    // Exclude only the detected rule itself. No fixed right inset: the last
    // digit of a right-aligned value may sit immediately beside the separator.
    return [key, { left, width: Math.max(1, right - left) }];
  }));
}

function openValueCell(pixels, width, top, bottom, key, cell) {
  if (key !== 'reportedSL' && key !== 'reportedTP') return cell;
  const scale = width / OPEN_REFERENCE_WIDTH;
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
      if (lastInk - start >= 3) bands.push([start, lastInk + 1]);
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
  if (mode === 'open') return !/\d/.test(text) && !/\b(?:buy|sell|balance)\b/.test(text)
    && readings.openTime?.inkFraction > 0 && readings.openTime.inkFraction < 0.4
    && Object.values(readings).filter(cell => cell.hasInk).length >= 6;
  // English OCR cannot read the supplied Chinese header. Its two short time
  // labels, absence of any digits and many populated cells identify that row.
  // A damaged/unknown data row otherwise survives as an editable draft.
  return mode === 'closed' && !/\d/.test(text) && !/\b(?:buy|sell|balance)\b/.test(text)
    && readings.openTime?.inkFraction > 0 && readings.openTime.inkFraction < 0.4
    && readings.closeTime?.inkFraction > 0 && readings.closeTime.inkFraction < 0.4
    && Object.values(readings).filter(cell => cell.hasInk).length >= 6;
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
  if (ticket.confidence >= 85 && /^\d+$/.test(ticket.text)) row.ticket = ticket.text;
  else warn('ticket');
  const symbol = read('symbol');
  if (symbol.confidence >= 70 && /^[A-Za-z][A-Za-z0-9._#-]{0,39}$/.test(symbol.text)) row.symbol = symbol.text;
  else warn('symbol');
  const direction = read('orderType');
  const orderType = direction.text.toLowerCase().replace(/\s+/g, ' ');
  if (direction.confidence >= 75 && /^(buy|sell)( limit| stop| stop limit)?$/.test(orderType)) {
    const pending = orderType !== 'buy' && orderType !== 'sell';
    if (pending === (mode === 'pending')) {
      row.side = orderType.startsWith('buy') ? 'buy' : 'sell';
      row.orderType = orderType;
    } else row.warnings.push('图中交易类型与所选模式不一致；请核对模式，并补填方向和交易类型。');
  } else warn('orderType');
  const readNumber = (key, source = key) => {
    const cell = read(source), value = numeric(cell.text);
    const optional = key === 'reportedSL' || key === 'reportedTP';
    if (optional && !cell.hasInk) return;
    if (cell.confidence >= 70 && value !== null && (key === 'reportedProfit' || value > 0)) row[key] = value;
    else if (!(optional && cell.confidence >= 70 && value === 0)) warn(key);
  };
  readNumber('volume');
  readNumber('reportedSL');
  readNumber('reportedTP');
  if (mode === 'closed') {
    readNumber('openPrice'); readNumber('closePrice'); readNumber('reportedProfit');
    for (const key of ['openTime', 'closeTime']) {
      const cell = read(key), value = reportTime(cell.text);
      if (cell.confidence >= 75 && value) row[key] = value;
      else warn(key);
    }
  } else if (mode === 'open') {
    readNumber('openPrice');
    const cell = read('openTime'), value = reportTime(cell.text);
    if (cell.confidence >= 75 && value) row.openTime = value;
    else warn('openTime');
    // The current price/floating-profit columns are deliberately never read.
  } else readNumber('pendingPrice', 'entryPrice');
  if (!row.side) row.warnings.push('此行未可靠确认是交易行，请核对；表头、资金或汇总行不要保存。');
  return row;
}

async function recognizeMode(pixels, width, height, mode, worker) {
  const cells = mode === 'open' ? openCells(pixels, width, height)
    : cropBounds(mode === 'closed' ? CLOSED_COLUMNS : liveColumns(pixels, width, height), width);
  const bands = findBands(pixels, width, height, cells);
  const warnings = [];
  if (!bands.length) return { mode, rows: [], warnings, score: 0, matchedFields: 0, missingFields: 0 };
  if (mode === 'pending') warnings.push('挂单沿用既有价位布局；票号区域若含时间或其他文字将留空，开仓时间需手填。不识别当前市价与浮动盈亏。');
  if (mode === 'open') warnings.push('持仓按独立列识别订单号与开仓时间，支持无表头完整宽度数据行；低置信度字段留空，请手工核对。开仓时间保留截图时钟，不转换时区；不识别当前市价与浮动盈亏。');
  const rows = [];
  let skippedBalance = 0;
  // Bound work even for noisy images; do not silently truncate suspected rows.
  const candidateLimit = MAX_ROWS + 2;
  if (bands.length > candidateLimit) warnings.push(`检测到 ${bands.length} 个文字带，本次只处理前 ${candidateLimit} 个；请分开截图，剩余内容未识别。`);
  for (const [index, [top, bottom]] of bands.slice(0, candidateLimit).entries()) {
    const readings = {};
    for (const [key, cell] of Object.entries(cells)) {
      const { left, width: cellWidth } = mode === 'open'
        ? openValueCell(pixels, width, top, bottom, key, cell) : cell;
      let minInkX = cellWidth, maxInkX = -1, ink = 0;
      for (let y = top; y < bottom; y++) for (let x = 0; x < cellWidth; x++) {
        if (pixels[y * width + left + x] < 150) { ink++; minInkX = Math.min(minInkX, x); maxInkX = Math.max(maxInkX, x); }
      }
      if (ink < 3) { readings[key] = { text: '', confidence: 100, hasInk: false, inkFraction: 0 }; continue; }
      const y = Math.max(0, top - 2), h = Math.min(height, bottom + 2) - y;
      const crop = await sharp(pixels, { raw: { width, height, channels: 1 } })
        .extract({ left, top: y, width: cellWidth, height: h }).resize(cellWidth * 4, h * 4)
        .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#fff' }).png().toBuffer();
      const { data } = await worker.recognize(crop);
      readings[key] = { text: data.text.trim(), confidence: data.confidence, hasInk: true, inkFraction: (maxInkX - minInkX + 1) / cellWidth };
    }
    if (/^balance$/i.test(readings.orderType.text.trim())) { skippedBalance++; continue; }
    if (headerRow(readings, mode, index)) { warnings.push('已排除表头行。'); continue; }
    if (rows.length >= MAX_ROWS) { warnings.push('一次最多返回 20 行，后续内容未识别，请分开截图。'); break; }
    rows.push(draftRow(readings, mode, rows.length + 1));
  }
  if (skippedBalance) warnings.push(`已排除 ${skippedBalance} 行 balance 资金记录。`);
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
  // Complete layout-specific fields carry most weight; warnings and missing
  // fields keep a visually similar but structurally wrong layout from winning.
  const completeness = matchedFields + missingFields ? matchedFields / (matchedFields + missingFields) : 0;
  const score = Math.round((rows.length ? 25 : 0) + completeness * 70 - Math.min(20, missingFields * 2));
  return { mode, rows, warnings, score, matchedFields, missingFields };
}

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
      `布局判断：${selected.mode} 得分 ${selected.score}，其次 ${runnerUp.mode} 得分 ${runnerUp.score}；依据为表格结构及关键字段完整度。`,
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
