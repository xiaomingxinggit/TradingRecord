import { randomUUID } from 'node:crypto';

const statuses = new Set(['pending', 'open', 'closed']);
const sides = new Set(['buy', 'sell']);
const updateEmotions = new Set(['calm', 'confident', 'hesitant', 'nervous', 'fearful', 'greedy', 'impulsive']);
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

function validateComparedFields(body) {
  const fields = ['volume', 'reportedSL', 'reportedTP'];
  const allowed = new Set(['expectedUpdatedAt', 'reason', 'emotion', ...fields]);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !allowed.has(key))) throw publicError(400, '截图对比更新包含不支持的字段。');
  const expectedUpdatedAt = text(body.expectedUpdatedAt, '订单更新时间', 40, true);
  const reason = text(body.reason, '修改原因', 500, true);
  const emotion = text(body.emotion, '当时情绪', 20, true);
  if (!updateEmotions.has(emotion)) throw publicError(400, '当时情绪无效。');
  const supplied = fields.filter(key => Object.hasOwn(body, key));
  if (!supplied.length) throw publicError(400, '请至少提交一项已识别的手数、止损或止盈。');
  const values = Object.fromEntries(supplied.map(key => {
    if (body[key] === null || body[key] === '') throw publicError(400, '未知的截图字段不能用于清空订单。');
    return [key, number(body[key], { volume: '手数', reportedSL: '止损', reportedTP: '止盈' }[key])];
  }));
  return { expectedUpdatedAt, reason, emotion, supplied, values };
}

function sameNumber(left, right) {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
}

function nextTimestamp(previous) {
  const now = new Date();
  if (previous && now.toISOString() <= previous) return new Date(Date.parse(previous) + 1).toISOString();
  return now.toISOString();
}

export function createOrderStore(db, getEventStore = () => null) {
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
  // Additive migration: existing orders remain unlocked; older versions ignore this nullable column.
  if (!db.prepare('PRAGMA table_info(tr_orders_v2)').all().some(column => column.name === 'locked_at')) {
    db.exec('ALTER TABLE tr_orders_v2 ADD COLUMN locked_at TEXT');
  }
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
  const lock = db.prepare('UPDATE tr_orders_v2 SET locked_at = ?, updated_at = ? WHERE id = ?');
  const updateCompared = db.prepare(`UPDATE tr_orders_v2
    SET volume = ?, reported_sl = ?, reported_tp = ?, updated_at = ? WHERE id = ?`);
  const hydrate = row => row ? ({
    id: row.id, ticket: row.ticket, planId: row.plan_id, status: row.status, symbol: row.symbol, side: row.side,
    volume: row.volume, pendingTime: row.pending_time, pendingPrice: row.pending_price,
    openTime: row.open_time, openPrice: row.open_price, closeTime: row.close_time, closePrice: row.close_price,
    reportedSL: row.reported_sl, reportedTP: row.reported_tp, reportedProfit: row.reported_profit,
    createdAt: row.created_at, updatedAt: row.updated_at, lockedAt: row.locked_at ?? null,
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
  const appendEvent = (planId, orderId, type, detail, createdAt) => {
    const store = getEventStore();
    if (!store) throw new Error('计划事件存储尚未初始化。');
    return store.append(planId, orderId, type, detail, createdAt);
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
          const now = nextTimestamp(existing.updated_at);
          attach.run(planId, now, existing.id);
          const event = appendEvent(planId, existing.id, 'order_created', { ticket: existing.ticket }, now);
          return { order: hydrate(byId.get(existing.id)), created: false, event };
        }
        const id = randomUUID(), now = new Date().toISOString();
        insert.run(id, input.ticket, planId, input.status, input.symbol, input.side, input.volume,
          input.pendingTime, input.pendingPrice, input.openTime, input.openPrice, input.closeTime, input.closePrice,
          input.reportedSL, input.reportedTP, input.reportedProfit, now, now);
        const event = appendEvent(planId, id, 'order_created', { ticket: input.ticket }, now);
        return { order: hydrate(byId.get(id)), created: true, event };
      });
    },
    changeStatus(planId, orderId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || !statuses.has(body.status)) {
        throw publicError(400, '请仅提交 pending、open 或 closed 状态。');
      }
      return transaction(() => {
        const row = requireOwned(planId, orderId);
        if (row.locked_at) throw publicError(409, '订单已锁定，无法再修改状态。');
        if (row.status === body.status) return { order: hydrate(row), changed: false };
        const now = nextTimestamp(row.updated_at);
        updateStatus.run(body.status, now, orderId);
        const event = appendEvent(planId, orderId, 'order_status_changed', { ticket: row.ticket,
          changes: [{ field: 'status', from: row.status, to: body.status }] }, now);
        return { order: hydrate(byId.get(orderId)), changed: true, event };
      });
    },
    updateComparedFields(planId, orderId, body) {
      const input = validateComparedFields(body);
      return transaction(() => {
        const row = requireOwned(planId, orderId);
        if (row.locked_at) throw publicError(409, '订单已锁定，无法再修改手数、止损和止盈。');
        if (row.updated_at !== input.expectedUpdatedAt) {
          throw publicError(409, '订单已发生变化，请重新加载订单并再次对比截图。');
        }
        const columns = { volume: 'volume', reportedSL: 'reported_sl', reportedTP: 'reported_tp' };
        const changes = input.supplied.filter(key => !sameNumber(row[columns[key]], input.values[key]))
          .map(key => ({ field: key, from: row[columns[key]] ?? null, to: input.values[key] }));
        if (!changes.length) return { order: hydrate(row), changed: false, event: null };
        const next = { volume: row.volume, reportedSL: row.reported_sl, reportedTP: row.reported_tp };
        for (const change of changes) next[change.field] = change.to;
        const now = nextTimestamp(row.updated_at);
        updateCompared.run(next.volume, next.reportedSL, next.reportedTP, now, orderId);
        const event = appendEvent(planId, orderId, 'order_fields_changed', {
          ticket: row.ticket, changes, reason: input.reason, emotion: input.emotion, source: 'ocr',
        }, now);
        return { order: hydrate(byId.get(orderId)), changed: true, event };
      });
    },
    lockForPlan(planId, orderId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => key !== 'expectedUpdatedAt')) {
        throw publicError(400, '锁定订单仅接受订单更新时间。');
      }
      const expectedUpdatedAt = text(body.expectedUpdatedAt, '订单更新时间', 40, true);
      return transaction(() => {
        const row = requireOwned(planId, orderId);
        if (row.locked_at) return { order: hydrate(row), changed: false };
        if (row.updated_at !== expectedUpdatedAt) {
          throw publicError(409, '订单已发生变化，请重新加载后再确认锁定。');
        }
        if (row.status !== 'closed') throw publicError(409, '只有已平仓订单可以锁定。');
        const now = nextTimestamp(row.updated_at);
        lock.run(now, now, orderId);
        const event = appendEvent(planId, orderId, 'order_fields_changed', { ticket: row.ticket,
          changes: [{ field: 'lockedAt', from: null, to: now }] }, now);
        return { order: hydrate(byId.get(orderId)), changed: true, event };
      });
    },
    exportForPlan(planId) {
      return byPlan.all(planId).map(hydrate);
    },
  };
}
