const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const results = new Set(['未记录', '未结束', '盈利', '亏损', '持平']);
const adherenceOptions = new Set(['未评定', '是', '部分', '否']);
const statuses = new Set(['draft', 'completed']);

export function simpleReview(plan) {
  if (plan.simpleReview === undefined) return { version: 1, revision: 0, result: '未记录', adherence: '未评定',
    good: '', improve: '', status: 'draft', updatedAt: null };
  const review = plan.simpleReview;
  if (review?.version !== 1 || !Number.isSafeInteger(review.revision) || review.revision < 0
    || !results.has(review.result) || !adherenceOptions.has(review.adherence) || !statuses.has(review.status)
    || typeof review.good !== 'string' || typeof review.improve !== 'string') {
    fail(409, '复盘版本无法读取，请升级应用后重试；已有记录未被修改。');
  }
  return review;
}

export function updateSimpleReview(plan, body, now) {
  const fields = ['revision', 'result', 'adherence', 'good', 'improve', 'status'];
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !fields.includes(key))) fail(400, '请提交有效的复盘内容。');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, '复盘版本无效，请重新读取。');
  const previous = simpleReview(plan);
  if (body.revision !== previous.revision) fail(409, '复盘已在其他窗口更新，请重新读取后再保存。');
  if (!results.has(body.result) || !adherenceOptions.has(body.adherence) || !statuses.has(body.status)) fail(400, '复盘结果、计划执行情况或状态无效。');
  const readText = (value, label) => {
    if (typeof value !== 'string' || value.trim().length > 5000) fail(400, `${label}必须是 5000 字以内的文字。`);
    return value.trim();
  };
  const good = readText(body.good, '做得好的地方');
  const improve = readText(body.improve, '下次改进');
  if (body.status === 'completed' && !good && !improve) fail(400, '完成复盘前，请至少填写一项总结。');
  if (previous.revision === Number.MAX_SAFE_INTEGER) fail(409, '复盘版本超出支持范围，已有记录未被修改。');
  return { version: 1, revision: previous.revision + 1, result: body.result, adherence: body.adherence,
    good, improve, status: body.status, updatedAt: now };
}
