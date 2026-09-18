import { randomUUID } from 'node:crypto';

const statuses = new Set(['pending', 'open', 'closed']);
const sides = new Set(['buy', 'sell']);
const publicError = (status, message) => Object.assign(new Error(message), { status });

function text(value, label, limit, required = false) {
  if (value === undefined || value === null) {
    if (required) throw publicError(400, `${label}不能为空。`);
    return null;
  }
  if (typeof value !== 'string') throw publicError(400, `${label}必须是文字。`);
  const result = value.trim();
  if ((required && !result) || result.length > limit) throw publicError(400, `${label}无效。`);
  return result || null;
}

function number(value, label, positive = true) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw publicError(400, `${label}必须是${positive ? '大于 0 的' : ''}有效数字或留空。`);
  }
  return value;
}

function reportTime(value, label) {
  const raw = text(value, label, 19);
  if (!raw) return null;
  const match = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!match) throw publicError(400, `${label}请使用 YYYY.MM.DD HH:mm:ss。`);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) throw publicError(400, `${label}不是有效时间。`);
  return raw;
}

function validateOrder(body) {
  const allowed = new Set(['ticket', 'status', 'symbol', 'side', 'volume', 'pendingTime', 'pendingPrice',
    'openTime', 'openPrice', 'closeTime', 'closePrice', 'reportedSL', 'reportedTP', 'reportedProfit']);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !allowed.has(key))) throw publicError(400, '订单包含不支持的字段。');
  const ticket = text(body.ticket, '订单号', 100, true);
  if (!/^\d+$/.test(ticket)) throw publicError(400, '订单号必须是完整的十进制字符串。');
  const status = body.status;
  if (!statuses.has(status)) throw publicError(400, '订单状态仅支持挂单、持仓中或已平仓。');
  const symbol = text(body.symbol, '品种', 40, true);
  const side = body.side;
  if (!sides.has(side)) throw publicError(400, '方向请选择做多或做空。');
  const result = {
    ticket, status, symbol, side,
    volume: number(body.volume, '手数'),
    pendingTime: reportTime(body.pendingTime, '挂单时间'),
    pendingPrice: number(body.pendingPrice, '挂单目标价'),
    openTime: reportTime(body.openTime, '开仓时间'),
    openPrice: number(body.openPrice, '开仓价'),
    closeTime: reportTime(body.closeTime, '平仓时间'),
    closePrice: number(body.closePrice, '平仓价'),
    reportedSL: number(body.reportedSL, '止损'),
    reportedTP: number(body.reportedTP, '止盈'),
    reportedProfit: number(body.reportedProfit, '截图盈利', false),
  };
  if (result.openTime && result.closeTime && result.closeTime < result.openTime) {
    throw publicError(400, '平仓时间不能早于开仓时间。');
  }
  return result;
}

export function createOrderStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tr_orders_v2 (
      id TEXT PRIMARY KEY,
      ticket TEXT NOT NULL UNIQUE,
      plan_id TEXT REFERENCES plans(id),
      status TEXT NOT NULL CHECK(status IN ('pending', 'open', 'closed')),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
      volume REAL,
      pending_time TEXT,
      pending_price REAL,
      open_time TEXT,
      open_price REAL,
      close_time TEXT,
      close_price REAL,
      reported_sl REAL,
      reported_tp REAL,
      reported_profit REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tr_orders_v2_plan ON tr_orders_v2(plan_id, created_at, id);
  `);
  const findPlan = db.prepare('SELECT id FROM plans WHERE id = ?');
  const byId = db.prepare('SELECT * FROM tr_orders_v2 WHERE id = ?');
  const byTicket = db.prepare('SELECT * FROM tr_orders_v2 WHERE ticket = ?');
  const byPlan = db.prepare('SELECT * FROM tr_orders_v2 WHERE plan_id = ? ORDER BY created_at, id');
  const insert = db.prepare(`INSERT INTO tr_orders_v2
    (id, ticket, plan_id, status, symbol, side, volume, pending_time, pending_price, open_time, open_price,
      close_time, close_price, reported_sl, reported_tp, reported_profit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const attach = db.prepare('UPDATE tr_orders_v2 SET plan_id = ?, updated_at = ? WHERE id = ? AND plan_id IS NULL');
  const updateStatus = db.prepare('UPDATE tr_orders_v2 SET status = ?, updated_at = ? WHERE id = ?');
  const hydrate = row => row ? ({
    id: row.id, ticket: row.ticket, planId: row.plan_id, status: row.status, symbol: row.symbol, side: row.side,
    volume: row.volume, pendingTime: row.pending_time, pendingPrice: row.pending_price,
    openTime: row.open_time, openPrice: row.open_price, closeTime: row.close_time, closePrice: row.close_price,
    reportedSL: row.reported_sl, reportedTP: row.reported_tp, reportedProfit: row.reported_profit,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }) : null;
  const requirePlan = planId => {
    if (!findPlan.get(planId)) throw publicError(404, '未找到这份交易计划。');
  };
  const requireOwned = (planId, orderId) => {
    requirePlan(planId);
    const row = byId.get(orderId);
    if (!row || row.plan_id !== planId) throw publicError(404, '未在当前计划中找到这个订单。');
    return row;
  };
  const transaction = action => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };

  return {
    listForPlan(planId) {
      requirePlan(planId);
      return byPlan.all(planId).map(hydrate);
    },
    createForPlan(planId, body) {
      return transaction(() => {
        requirePlan(planId);
        const input = validateOrder(body);
        const existing = byTicket.get(input.ticket);
        if (existing) {
          if (existing.plan_id === planId) return { order: hydrate(existing), created: false };
          if (existing.plan_id) throw publicError(409, `订单号 ${input.ticket} 已属于其他计划，未自动转移。`);
          const now = new Date().toISOString();
          attach.run(planId, now, existing.id);
          return { order: hydrate(byId.get(existing.id)), created: false };
        }
        const id = randomUUID(), now = new Date().toISOString();
        insert.run(id, input.ticket, planId, input.status, input.symbol, input.side, input.volume,
          input.pendingTime, input.pendingPrice, input.openTime, input.openPrice, input.closeTime, input.closePrice,
          input.reportedSL, input.reportedTP, input.reportedProfit, now, now);
        return { order: hydrate(byId.get(id)), created: true };
      });
    },
    changeStatus(planId, orderId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || !statuses.has(body.status)) {
        throw publicError(400, '请仅提交 pending、open 或 closed 状态。');
      }
      return transaction(() => {
        const row = requireOwned(planId, orderId);
        if (row.status === body.status) return { order: hydrate(row), changed: false };
        updateStatus.run(body.status, new Date().toISOString(), orderId);
        return { order: hydrate(byId.get(orderId)), changed: true };
      });
    },
    exportForPlan(planId) {
      return byPlan.all(planId).map(hydrate);
    },
  };
}
