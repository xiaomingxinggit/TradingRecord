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
