import { createHash, randomUUID } from 'node:crypto';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, label, limit, required = false) => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim())) fail(400, `${label}无效。`);
  return value.trim();
};
const price = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(400, '已填价位必须是大于 0 的有效数字。');
  return value;
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
export function updateAdjustmentJournal(plan, body, kind, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请提交有效的调整内容。');
  const allowed = kind === 'append' ? ['requestId', 'groupId', 'manualTicket', 'entryPrice', 'stopLoss', 'takeProfit', 'reason']
    : kind === 'emotion' ? ['requestId', 'groupId', 'emotion', 'note'] : [];
  if (!allowed.length || Object.keys(body).some(key => !allowed.includes(key))) fail(400, '调整请求包含不支持的字段。');
  const requestId = text(body.requestId, '请求编号', 100, true);
  const groupId = text(body.groupId, '记录组', 200);
  const manualTicket = text(body.manualTicket, '手动持仓编号', 100);
  const values = kind === 'append' ? { entryPrice: price(body.entryPrice), stopLoss: price(body.stopLoss),
    takeProfit: price(body.takeProfit), reason: text(body.reason, '调整原因', 2000) }
    : { emotion: text(body.emotion, '情绪', 20, true), note: text(body.note, '情绪备注', 2000) };
  if (kind === 'emotion' && !['平静', '焦虑', '恐惧', '贪婪', '急躁', '其他'].includes(values.emotion)) fail(400, '请选择有效的情绪。');
  // Keep the append signature shape so requests created before FLOW-01 can retry.
  const signature = createHash('sha256').update(JSON.stringify({ kind, groupId, positionId: '', manualTicket, ...values })).digest('hex');
  const journal = adjustmentJournal(plan);
  const prior = journal.requests.find((request) => request.requestId === requestId);
  if (prior) {
    if (prior.signature !== signature) fail(409, '此请求编号已用于其他内容，请重新打开调整窗口。');
    return { journal, changed: false };
  }
  let group = groupId ? journal.groups.find((item) => item.id === groupId) : null;
  if (groupId && !group) fail(404, '未找到持仓调整记录组。');
  if (kind === 'emotion') {
    journal.emotions.push({ id: randomUUID(), type: 'emotion', recordTime: now, groupId, ...values });
  } else {
    if (group && manualTicket) fail(400, '追加时不能更换记录组来源。');
    if (!group) {
      if (!manualTicket) fail(400, '请填写手动持仓编号，或选择已有记录组。');
      group = { id: randomUUID(), origin: 'manual', manualTicket, sourceSnapshot: null,
        createdAt: now, boundAt: null, entries: [] };
      journal.groups.push(group);
    }
    // Historical MT5 groups are now independent; retain every source snapshot.
    group.entries.push({ id: randomUUID(), type: 'price', requestId, recordTime: now, ...values,
      sourceSnapshot: group.sourceSnapshot ?? null });
  }
  journal.requests.push({ requestId, signature, groupId: group?.id ?? '', kind, recordTime: now });
  return { journal, changed: true };
}
