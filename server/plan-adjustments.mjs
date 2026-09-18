import { createHash } from 'node:crypto';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, label, limit, required = false) => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim())) fail(400, `${label}无效。`);
  return value.trim();
};

export function adjustmentJournal(plan) {
  if (plan.adjustmentJournal === undefined) return { version: 1, groups: [], requests: [], emotions: [] };
  const journal = plan.adjustmentJournal;
  if (journal?.version !== 1 || !Array.isArray(journal.groups) || !Array.isArray(journal.requests)
    || (journal.emotions !== undefined && !Array.isArray(journal.emotions))) {
    fail(409, '调整历史版本无法读取，请升级应用后重试；已有记录未被修改。');
  }
  return { ...journal, emotions: journal.emotions ?? [] };
}

// Called only inside the plan store's immediate write transaction. All identity
// and historical source information comes from the saved journal.
export function updateAdjustmentJournal(plan, body, kind, now, orders = []) {
  if (kind !== 'bind-order') fail(405, '计划过程历史只读，请在订单中新增记录。');
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请提交有效的调整内容。');
  if (Object.keys(body).some(key => !['requestId', 'groupId', 'orderId'].includes(key))) fail(400, '绑定请求包含不支持的字段。');
  const requestId = text(body.requestId, '请求编号', 100, true);
  const groupId = text(body.groupId, '记录组', 200);
  const orderId = text(body.orderId, '订单', 200);
  // Preserve the binding signature shape for retries of existing requests.
  const signature = createHash('sha256').update(JSON.stringify({ kind, groupId, positionId: '', manualTicket: '',
    ...(orderId ? { orderId } : {}) })).digest('hex');
  const journal = adjustmentJournal(plan);
  const prior = journal.requests.find((request) => request.requestId === requestId);
  if (prior) {
    if (prior.signature !== signature) fail(409, '此请求编号已用于其他内容，请重新打开调整窗口。');
    return { journal, changed: false };
  }
  const group = groupId ? journal.groups.find((item) => item.id === groupId) : null;
  if (groupId && !group) fail(404, '未找到持仓调整记录组。');
  const requireOrder = id => {
    const order = orders.find(item => item.id === id);
    if (!order) fail(409, '所选订单不属于当前计划，请重新读取。');
    return order;
  };
  const rejectDuplicateGroup = id => {
    const existing = journal.groups.find(item => item.orderId === id);
    if (existing) fail(409, `这个订单已有过程组（${existing.id}），请在原组中追加，不能合并历史。`);
  };
  if (!group || !orderId) fail(400, '请选择已有记录组和本计划订单。');
  if (group.orderId) fail(409, '这个记录组已绑定订单，不能重新绑定。');
  requireOrder(orderId);
  rejectDuplicateGroup(orderId);
  group.orderId = orderId;
  group.orderBoundAt = now;
  journal.requests.push({ requestId, signature, groupId: group?.id ?? '', kind, recordTime: now });
  return { journal, changed: true };
}
