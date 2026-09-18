import { createHash, randomUUID } from 'node:crypto';
import { createOrderProcessStore } from './order-process.mjs';
import { createOrderReviewStore } from './order-review.mjs';
import { adjustmentJournal } from './plan-adjustments.mjs';

const fail = (status, message, details) => { throw Object.assign(new Error(message), { status, details }); };
const labels = { ticket: '订单编号', state: '订单阶段', symbol: '品种', side: '方向', volume: '手数',
  orderType: '订单类型', pendingPrice: '挂单目标价', pendingVolume: '挂单数量', pendingTime: '挂单时间', expiresAt: '有效期', openTime: '开仓时间', openPrice: '实际开仓价',
  closeTime: '平仓时间', closePrice: '实际平仓价', closeReason: '平仓原因', reportedSL: '截图止损', reportedTP: '截图止盈', reportedProfit: '截图盈利', source: '录入来源' };
const fields = Object.keys(labels);
const nonempty = value => value !== null && value !== undefined && value !== '';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, label, limit, required = false) => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim())) fail(400, `${label}无效。`);
  return value.trim();
};
const number = (value, label, positive = true) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) fail(400, `${label}必须是${positive ? '大于 0 的' : ''}有限数值或空值。`);
  return value;
};
const clock = (value, label) => {
  const raw = text(value, label, 19);
  if (!raw) return '';
  const match = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!match) fail(400, `${label}请使用 YYYY.MM.DD HH:mm:ss。`);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) fail(400, `${label}不是有效的日历时间。`);
  return raw;
};
const conflict = (field, existing, incoming) => ({ field, label: field === 'planId' ? '所属计划' : labels[field] ?? field, existing, incoming });
const differences = (existing, incoming) => fields.filter(key => existing[key] !== incoming[key]).map(key => conflict(key, existing[key] ?? null, incoming[key] ?? null));

function observation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => ![...fields, 'requestId', 'observationKey'].includes(key))) fail(400, '订单观察包含不支持的字段。');
  const requestId = text(body.requestId, '请求编号', 100, true);
  const observationKey = text(body.observationKey, '观察编号', 300, true);
  const rawTicket = text(body.ticket, '订单编号', 100, true);
  if (!/^\d+$/.test(rawTicket)) fail(400, '订单编号必须是十进制字符串。');
  const ticket = rawTicket.replace(/^0+(?=\d)/, '');
  const input = { ticket, state: body.state, symbol: text(body.symbol, '品种', 40, true), side: body.side,
    volume: number(body.volume, '手数'), orderType: text(body.orderType, '挂单类型', 30),
    pendingVolume: number(body.pendingVolume, '挂单数量'), pendingTime: clock(body.pendingTime, '挂单时间'), expiresAt: clock(body.expiresAt, '有效期'),
    pendingPrice: number(body.pendingPrice, '挂单目标价'), openTime: clock(body.openTime, '开仓时间'),
    openPrice: number(body.openPrice, '实际开仓价'), closeTime: clock(body.closeTime, '平仓时间'),
    closePrice: number(body.closePrice, '实际平仓价'), closeReason: text(body.closeReason, '平仓原因', 2000), reportedSL: number(body.reportedSL, '报告止损'),
    reportedTP: number(body.reportedTP, '截图止盈'), reportedProfit: number(body.reportedProfit, '截图盈利', false), source: body.source };
  if (!['pending', 'open', 'closed', 'cancelled', 'expired'].includes(input.state) || !['buy', 'sell'].includes(input.side)
    || !['manual', 'screenshot'].includes(input.source)) fail(400, '订单阶段、方向或来源无效。');
  if (input.orderType && !['market', 'buy limit', 'sell limit', 'buy stop', 'sell stop', 'buy stop limit', 'sell stop limit'].includes(input.orderType)) fail(400, '订单类型无效。');
  if (input.orderType && input.orderType !== 'market' && !input.orderType.startsWith(`${input.side} `)) fail(400, '订单类型与方向不一致。');
  if (input.state === 'pending' && (!input.orderType || input.orderType === 'market' || input.pendingPrice === null || input.pendingVolume === null)) fail(400, '挂单需要明确挂单类型、目标价和挂单数量。');
  if (['pending', 'cancelled', 'expired'].includes(input.state) && (input.openTime || input.openPrice !== null || input.volume !== null)) fail(400, '未成交订单不能填写实际成交信息。');
  if (['open', 'closed'].includes(input.state) && (input.openPrice === null || input.volume === null)) fail(400, '持仓或已平仓记录需要实际开仓价和成交量。');
  if (input.state !== 'closed' && (input.closeTime || input.closePrice !== null || input.reportedProfit !== null || input.closeReason)) fail(400, '只有已平仓记录可以填写平仓时间、价格、盈利和原因。');
  if (input.state === 'closed' && input.closePrice === null) fail(400, '已平仓记录需要实际平仓价；未知时间请留空。');
  if (['cancelled', 'expired'].includes(input.state) && input.source !== 'manual') fail(400, '取消或失效必须通过手动明确确认，不能由截图推断。');
  if (input.pendingTime && input.expiresAt && input.expiresAt < input.pendingTime) fail(400, '有效期不能早于挂单时间。');
  if (input.openTime && input.closeTime && input.closeTime < input.openTime) fail(400, '平仓时间不能早于开仓时间。');
  return { requestId, observationKey, input };
}

function mergeOrder(previous, incoming) {
  if (!previous) {
    if (['cancelled', 'expired'].includes(incoming.state)) fail(409, '只有已有挂单可以明确取消或失效。', { conflicts: [conflict('state', null, incoming.state)] });
    return incoming;
  }
  const conflicts = [];
  const transitions = { pending: ['pending', 'open', 'closed', 'cancelled', 'expired'], open: ['open', 'closed'], closed: ['closed'], cancelled: [], expired: [] };
  if (!transitions[previous.state].includes(incoming.state)) conflicts.push(conflict('state', previous.state, incoming.state));
  for (const key of ['symbol', 'side', 'volume', 'openTime', 'openPrice', 'closeTime', 'closePrice', 'reportedProfit', 'closeReason', 'pendingTime']) {
    if (nonempty(previous[key]) && nonempty(incoming[key]) && previous[key] !== incoming[key]) conflicts.push(conflict(key, previous[key], incoming[key]));
  }
  if (previous.state !== 'pending' || incoming.state !== 'pending') {
    for (const key of ['orderType', 'pendingPrice', 'pendingVolume', 'expiresAt']) {
      if (nonempty(previous[key]) && nonempty(incoming[key]) && previous[key] !== incoming[key]) conflicts.push(conflict(key, previous[key], incoming[key]));
    }
  }
  if (conflicts.length) fail(409, '订单已有记录与本次观察存在差异，未覆盖；手数变化或分批成交不支持合并。', { conflicts });
  const merged = { ...previous, ...incoming };
  for (const key of ['orderType', 'pendingPrice', 'pendingVolume', 'pendingTime', 'expiresAt', 'volume', 'openTime', 'openPrice', 'closeTime', 'closePrice', 'closeReason', 'reportedProfit']) {
    if (!nonempty(incoming[key])) merged[key] = previous[key];
  }
  if (merged.openTime && merged.closeTime && merged.closeTime < merged.openTime) fail(409, '补全后的平仓时间早于开仓时间，请核对。', { conflicts: [conflict('openTime', previous.openTime, incoming.openTime), conflict('closeTime', previous.closeTime, incoming.closeTime)] });
  if (merged.pendingTime && merged.expiresAt && merged.expiresAt < merged.pendingTime) fail(409, '补全后的有效期早于挂单时间，请核对。', { conflicts: [conflict('pendingTime', previous.pendingTime, incoming.pendingTime), conflict('expiresAt', previous.expiresAt, incoming.expiresAt)] });
  return merged;
}

export function createOrderStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tr_orders_v1 (
      id TEXT PRIMARY KEY, plan_id TEXT REFERENCES plans(id), ticket TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tr_orders_plan_v1 ON tr_orders_v1(plan_id);
    CREATE TABLE IF NOT EXISTS tr_order_observations_v1 (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES tr_orders_v1(id), revision INTEGER NOT NULL,
      kind TEXT NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL, snapshot TEXT NOT NULL,
      observation_key TEXT NOT NULL UNIQUE, signature TEXT NOT NULL, UNIQUE(order_id, revision)
    );
    CREATE TABLE IF NOT EXISTS tr_order_requests_v1 (
      request_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES tr_order_observations_v1(id), signature TEXT NOT NULL
    );
  `);
  const processStore = createOrderProcessStore(db);
  const reviewStore = createOrderReviewStore(db);
  const byTicket = db.prepare('SELECT * FROM tr_orders_v1 WHERE ticket = ?');
  const byId = db.prepare('SELECT * FROM tr_orders_v1 WHERE id = ?');
  const all = db.prepare('SELECT * FROM tr_orders_v1 ORDER BY created_at DESC, id DESC');
  const byPlan = db.prepare('SELECT * FROM tr_orders_v1 WHERE plan_id = ? ORDER BY created_at, id');
  const findPlan = db.prepare('SELECT id, payload FROM plans WHERE id = ?');
  const touchPlan = db.prepare('UPDATE plans SET updated_at = ? WHERE id = ?');
  const touchOrder = db.prepare('UPDATE tr_orders_v1 SET updated_at = ? WHERE id = ?');
  const bindPlan = db.prepare('UPDATE tr_orders_v1 SET plan_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?');
  const events = db.prepare('SELECT * FROM tr_order_observations_v1 WHERE order_id = ? ORDER BY revision');
  const byObservation = db.prepare('SELECT * FROM tr_order_observations_v1 WHERE observation_key = ?');
  const byRequest = db.prepare(`SELECT e.*, r.signature AS request_signature FROM tr_order_requests_v1 r
    JOIN tr_order_observations_v1 e ON e.id = r.event_id WHERE r.request_id = ?`);
  const insertRequest = db.prepare('INSERT INTO tr_order_requests_v1 (request_id, event_id, signature) VALUES (?, ?, ?)');
  const saveOrder = db.prepare(`INSERT INTO tr_orders_v1 (id, plan_id, ticket, payload, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, revision = excluded.revision, updated_at = excluded.updated_at`);
  const insertEvent = db.prepare(`INSERT INTO tr_order_observations_v1 (id, order_id, revision, kind, source, recorded_at, snapshot, observation_key, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const hydrate = row => row ? { ...JSON.parse(row.payload), id: row.id, planId: row.plan_id, ticket: row.ticket,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    events: events.all(row.id).map(event => ({ id: event.id, kind: event.kind, source: event.source, recordedAt: event.recorded_at, snapshot: JSON.parse(event.snapshot) })) } : null;
  const requireOrder = id => { const row = byId.get(id); if (!row) fail(404, '未找到这个订单。'); return row; };
  const readPlanId = value => {
    if (value === null) return null;
    const id = text(value, '关联计划', 200, true);
    if (!findPlan.get(id)) fail(404, '未找到所选计划。');
    return id;
  };
  const transaction = (write, action) => {
    db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const list = planId => (planId === undefined ? all.all() : byPlan.all(planId)).map(hydrate);
  const legacy = row => {
    if (!row.plan_id) return { groups: [], emotions: [] };
    const plan = findPlan.get(row.plan_id);
    if (!plan) return { groups: [], emotions: [] };
    const journal = adjustmentJournal(JSON.parse(plan.payload));
    const groups = journal.groups.filter(group => group.orderId === row.id);
    const groupIds = new Set(groups.map(group => group.id));
    return { groups, emotions: journal.emotions.filter(event => event.orderId === row.id || (!event.orderId && groupIds.has(event.groupId))) };
  };
  const ownerConflict = (row, incoming) => fail(409, '订单归属不同；请通过关联入口明确关联，不能转移或解绑。', {
    conflicts: [conflict('planId', row.plan_id, incoming)], ...(row.plan_id ? { ownerPlanId: row.plan_id } : {}),
  });
  const response = (order, changed) => ({ order, changed, orders: list() });
  return {
    // list/export are also used inside the plan store's existing read transaction.
    list,
    get(id) { return transaction(false, () => hydrate(requireOrder(id))); },
    listSnapshot() { return transaction(false, () => ({ orders: list() })); },
    exportSnapshot() {
      return list().map(order => ({ ...order, process: processStore.list(order.id, true),
        review: reviewStore.get(order), legacy: legacy({ id: order.id, plan_id: order.planId }) }));
    },
    confirm(body, orderId = null) {
      return transaction(true, () => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请提交有效订单观察。');
        if (orderId && Object.hasOwn(body, 'planId')) fail(400, '观察不能修改订单归属，请使用关联入口。');
        const { planId: suppliedPlanId, ...content } = body;
        const { requestId, observationKey, input } = observation(orderId ? body : content);
        const target = orderId ? requireOrder(orderId) : null;
        if (target && target.ticket !== input.ticket) fail(409, '订单编号不能改变。', { conflicts: [conflict('ticket', target.ticket, input.ticket)] });
        const row = target ?? byTicket.get(input.ticket);
        const planId = orderId ? row.plan_id : suppliedPlanId === null ? null : text(suppliedPlanId, '关联计划', 200, true);
        const signature = hash(input);
        const requestSignature = hash({ observationKey, input, ...(orderId ? { orderId } : { planId }) });
        const request = byRequest.get(requestId);
        if (request) {
          if (request.request_signature !== requestSignature || (orderId && request.order_id !== orderId)) {
            const conflicts = differences(JSON.parse(request.snapshot), input);
            if (request.observation_key !== observationKey) conflicts.push({ field: 'observationKey', label: '观察编号', existing: request.observation_key, incoming: observationKey });
            if (!conflicts.length) conflicts.push({ field: 'requestId', label: '请求用途', existing: '已有请求', incoming: '不同订单或归属请求' });
            fail(409, '同一请求编号已用于不同内容。', { conflicts });
          }
          return response(hydrate(requireOrder(request.order_id)), false);
        }
        if (!orderId) {
          readPlanId(planId);
          if (row && row.plan_id !== planId) ownerConflict(row, planId);
        }
        const prior = byObservation.get(observationKey);
        if (prior) {
          if (prior.signature !== signature || (orderId && prior.order_id !== orderId)) fail(409, '同一观察已保存不同内容，请核对差异。', { conflicts: differences(JSON.parse(prior.snapshot), input) });
          insertRequest.run(requestId, prior.id, requestSignature);
          return response(hydrate(requireOrder(prior.order_id)), false);
        }
        const previous = row ? JSON.parse(row.payload) : null;
        const merged = mergeOrder(previous, input);
        const id = row?.id ?? randomUUID();
        const now = new Date().toISOString();
        const revision = (row?.revision ?? 0) + 1;
        const eventId = randomUUID();
        saveOrder.run(id, planId, input.ticket, JSON.stringify(merged), revision, row?.created_at ?? now, now);
        insertEvent.run(eventId, id, revision, !previous || previous.state !== input.state ? input.state : 'observation', input.source, now, JSON.stringify(input), observationKey, signature);
        insertRequest.run(requestId, eventId, requestSignature);
        if (planId) touchPlan.run(now, planId);
        return response(hydrate(requireOrder(id)), true);
      });
    },
    associate(id, body) {
      return transaction(true, () => {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['planId', 'revision'].includes(key))
          || !Number.isSafeInteger(body.revision) || body.revision < 1) fail(400, '关联请求需要有效计划和订单版本。');
        const row = requireOrder(id);
        const planId = readPlanId(body.planId);
        if (!planId) fail(400, '请选择要关联的计划，不支持自动解绑。');
        if (row.plan_id === planId) return response(hydrate(row), false);
        if (row.plan_id) ownerConflict(row, planId);
        if (row.revision !== body.revision) fail(409, '订单已更新，请重新读取后关联。', { conflicts: [{ field: 'revision', label: '订单版本', existing: row.revision, incoming: body.revision }] });
        const now = new Date().toISOString();
        bindPlan.run(planId, now, id);
        touchPlan.run(now, planId);
        return response(hydrate(requireOrder(id)), true);
      });
    },
    process(id) { return transaction(false, () => { const row = requireOrder(id); return { events: processStore.list(id), legacy: legacy(row) }; }); },
    appendProcess(id, body, files) {
      return transaction(true, () => {
        const row = requireOrder(id);
        const now = new Date().toISOString();
        const result = processStore.append(id, body, files, now);
        if (result.changed) touchOrder.run(now, id);
        return { ...result, events: processStore.list(id), legacy: legacy(row), order: hydrate(requireOrder(id)) };
      });
    },
    processImage(id, eventId, imageId) { return processStore.image(id, eventId, imageId); },
    review(id) { return transaction(false, () => reviewStore.state(hydrate(requireOrder(id)))); },
    saveReview(id, body) {
      return transaction(true, () => {
        const order = hydrate(requireOrder(id));
        const now = new Date().toISOString();
        const review = reviewStore.save(order, body, now);
        touchOrder.run(now, id);
        return { review, order: hydrate(requireOrder(id)) };
      });
    },
  };
}
