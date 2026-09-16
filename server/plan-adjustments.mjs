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
  if (plan.adjustmentJournal === undefined) return { version: 1, groups: [], requests: [] };
  const journal = plan.adjustmentJournal;
  if (journal?.version !== 1 || !Array.isArray(journal.groups) || !Array.isArray(journal.requests)) {
    fail(409, '调整历史版本无法读取，请升级应用后重试；已有记录未被修改。');
  }
  return journal;
}

export function positionSnapshot(position) {
  return { positionId: position.id, ticket: position.ticket, symbol: position.symbol, side: position.side,
    entryPrice: position.openPrice, source: position.source, sourceFile: position.sourceFile, reportDate: position.reportDate };
}

// Called only inside the plan store's immediate write transaction. All identity
// and source information comes from the saved journal / linked MT5 positions.
export function updateAdjustmentJournal(plan, body, kind, linkedPositions, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请提交有效的调整内容。');
  const requestId = text(body.requestId, '请求编号', 100, true);
  const groupId = text(body.groupId, '记录组', 200);
  const positionId = text(body.positionId, '关联持仓', 200);
  const manualTicket = text(body.manualTicket, '手动持仓编号', 100);
  const values = kind === 'append' ? { entryPrice: price(body.entryPrice), stopLoss: price(body.stopLoss),
    takeProfit: price(body.takeProfit), reason: text(body.reason, '调整原因', 2000) } : {};
  const signature = createHash('sha256').update(JSON.stringify({ kind, groupId, positionId, manualTicket, ...values })).digest('hex');
  const journal = adjustmentJournal(plan);
  const prior = journal.requests.find((request) => request.requestId === requestId);
  if (prior) {
    if (prior.signature !== signature) fail(409, '此请求编号已用于其他内容，请重新打开调整窗口。');
    return { journal, changed: false };
  }
  const linked = (id) => {
    const position = linkedPositions.find((item) => item.id === id);
    if (!position) fail(409, '此 MT5 持仓当前未关联本计划，请重新选择。');
    return position;
  };
  let group = groupId ? journal.groups.find((item) => item.id === groupId) : null;
  if (groupId && !group) fail(404, '未找到持仓调整记录组。');
  if (kind === 'bind') {
    if (!group || group.origin !== 'manual' || group.sourceSnapshot || !positionId) fail(409, '请选择尚未绑定的手动记录组和当前关联持仓。');
    if (journal.groups.some((item) => item.sourceSnapshot?.positionId === positionId)) fail(409, '该持仓已有独立调整链路，不能合并历史。');
    group.sourceSnapshot = positionSnapshot(linked(positionId));
    group.boundAt = now;
  } else {
    if (group && (positionId || manualTicket)) fail(400, '追加时不能更换记录组来源。');
    if (!group) {
      if (Boolean(positionId) === Boolean(manualTicket)) fail(400, '请选择已关联持仓，或填写手动持仓编号。');
      if (positionId && journal.groups.some((item) => item.sourceSnapshot?.positionId === positionId)) fail(409, '该持仓已有调整链路，请在现有记录组中追加。');
      group = { id: positionId ? `mt5:${positionId}` : randomUUID(), origin: positionId ? 'mt5' : 'manual',
        manualTicket, sourceSnapshot: positionId ? positionSnapshot(linked(positionId)) : null,
        createdAt: now, boundAt: null, entries: [] };
      journal.groups.push(group);
    }
    group.entries.push({ id: randomUUID(), requestId, recordTime: now, ...values,
      sourceSnapshot: group.sourceSnapshot ?? null });
  }
  journal.requests.push({ requestId, signature, groupId: group.id, kind, recordTime: now });
  return { journal, changed: true };
}
