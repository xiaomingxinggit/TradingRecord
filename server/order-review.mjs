const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const results = new Set(['未记录', '未结束', '盈利', '亏损', '持平']);
const adherences = new Set(['未评定', '是', '部分', '否']);
const emotions = new Set(['未评定', '是', '否']);
const eligible = order => ['open', 'closed'].includes(order.state) && Number.isFinite(order.openPrice) && order.openPrice > 0
  && Number.isFinite(order.volume) && order.volume > 0;
const empty = () => ({ version: 1, revision: 0, result: '未记录', adherence: '未评定', analysis: '', good: '', improve: '',
  emotional: '未评定', status: 'draft', updatedAt: null });

export function createOrderReviewStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tr_order_reviews_v1 (
    order_id TEXT PRIMARY KEY REFERENCES tr_orders_v1(id), payload TEXT NOT NULL
  );`);
  const read = db.prepare('SELECT payload FROM tr_order_reviews_v1 WHERE order_id = ?');
  const write = db.prepare('INSERT INTO tr_order_reviews_v1 (order_id, payload) VALUES (?, ?) ON CONFLICT(order_id) DO UPDATE SET payload = excluded.payload');
  const get = order => {
    const row = read.get(order.id);
    if (!row) return empty();
    const review = JSON.parse(row.payload);
    if (review.version !== 1 || !Number.isSafeInteger(review.revision) || review.revision < 0) fail(409, '订单复盘版本无法读取，已有记录未被修改。');
    return review;
  };
  return {
    get,
    state(order) { const allowed = eligible(order); return { review: get(order), eligible: allowed, canComplete: allowed && order.state === 'closed' }; },
    save(order, body, now) {
      if (!eligible(order)) fail(409, '只有实际成交的订单可以填写交易复盘。');
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['revision', 'result', 'adherence', 'analysis', 'good', 'improve', 'emotional', 'status'].includes(key))) fail(400, '请提交有效的订单复盘。');
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, '复盘版本无效，请重新读取。');
      const previous = get(order);
      if (previous.revision !== body.revision) fail(409, '复盘已更新，请重新读取后再保存。');
      if (!results.has(body.result) || !adherences.has(body.adherence) || !emotions.has(body.emotional)
        || !['draft', 'completed'].includes(body.status)) fail(400, '复盘结果、执行、情绪化操作或状态无效。');
      const readText = (value, label) => {
        if (typeof value !== 'string' || value.trim().length > 5000) fail(400, `${label}必须为 5000 字以内文字。`);
        return value.trim();
      };
      const analysis = readText(body.analysis, '交易判断');
      const good = readText(body.good, '做得好的地方');
      const improve = readText(body.improve, '下次改进');
      if (body.status === 'completed' && (order.state !== 'closed' || (!good && !improve))) fail(400, '只有已平仓订单可以完成复盘，并需至少填写一项总结。');
      if (previous.revision === Number.MAX_SAFE_INTEGER) fail(409, '复盘版本超出支持范围。');
      const review = { version: 1, revision: previous.revision + 1, result: body.result, adherence: body.adherence,
        analysis, good, improve, emotional: body.emotional, status: body.status, updatedAt: now };
      write.run(order.id, JSON.stringify(review));
      return review;
    },
  };
}
