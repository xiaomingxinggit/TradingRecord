import { createHash } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const purposes = new Set(['unclassified', 'initial', 'add', 'reentry']);
const emptyReview = () => ({ adherence: 'unrated', good: '', improve: '', state: 'draft', completedAt: null, updatedAt: null, revision: 0 });
const openingKeys = ['ticket', 'symbol', 'side', 'volume', 'openTime', 'openPrice'];
const resultKeys = [...openingKeys, 'closeTime', 'closePrice', 'reportedStopLoss', 'reportedTakeProfit', 'commission', 'swap', 'fees', 'profit', 'netProfit', 'resultState', 'issues', 'comment'];
const pick = (value, keys) => keys.map(key => value[key] ?? null);
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, '请提交有效的 JSON 对象。');
  return value;
}
function text(value, label, max) {
  if (typeof value !== 'string' || value.trim().length > max) throw fail(400, `${label}必须是文字且最多 ${max} 字。`);
  return value.trim();
}
function linkContent(value) {
  object(value);
  if (!purposes.has(value.purpose)) throw fail(400, '请选择未分类、首次入场、加仓或重新入场。');
  return { purpose: value.purpose, note: text(value.note ?? '', '关联备注', 300) };
}

// Only versioned review tables belong to this module. Never interpret legacy
// accounts/trades/notes tables, or rebuild the existing plans/image tables.
export function createReviewStore(db, plans) {
  const definitions = {
    tr_review_accounts_v1: { columns: ['id', 'data', 'created_at', 'updated_at'], sql: 'id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL' },
    tr_review_positions_v1: { columns: ['id', 'source_id', 'ticket', 'data', 'result_hash', 'created_at', 'updated_at'], sql: 'id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES tr_review_accounts_v1(id), ticket TEXT NOT NULL, data TEXT NOT NULL, result_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source_id, ticket)' },
    tr_review_links_v1: { columns: ['position_id', 'plan_id', 'purpose', 'note', 'created_at', 'updated_at'], sql: 'position_id TEXT PRIMARY KEY REFERENCES tr_review_positions_v1(id), plan_id TEXT NOT NULL REFERENCES plans(id), purpose TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL' },
    tr_review_summaries_v1: { columns: ['plan_id', 'content', 'state', 'completed_at', 'updated_at', 'revision'], sql: 'plan_id TEXT PRIMARY KEY REFERENCES plans(id), content TEXT NOT NULL, state TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL, revision INTEGER NOT NULL' },
  };
  const foreignKeys = {
    tr_review_accounts_v1: [],
    tr_review_positions_v1: ['source_id:tr_review_accounts_v1:id'],
    tr_review_links_v1: ['position_id:tr_review_positions_v1:id', 'plan_id:plans:id'],
    tr_review_summaries_v1: ['plan_id:plans:id'],
  };
  for (const [name, def] of Object.entries(definitions)) {
    const existing = db.prepare(`PRAGMA table_info(${name})`).all();
    if (!existing.length) continue;
    const actualForeignKeys = db.prepare(`PRAGMA foreign_key_list(${name})`).all();
    const fkMatch = hash(actualForeignKeys.map(fk => `${fk.from}:${fk.table}:${fk.to}`).sort()) === hash([...foreignKeys[name]].sort())
      && actualForeignKeys.every(fk => fk.on_delete === 'NO ACTION' && fk.on_update === 'NO ACTION');
    const uniquePosition = name !== 'tr_review_positions_v1' || db.prepare(`PRAGMA index_list(${name})`).all().some(index => {
      if (!index.unique || index.partial) return false;
      // Index names are database metadata, so quote them as identifiers.
      const columns = db.prepare(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`).all().map(col => col.name);
      return hash(columns) === hash(['source_id', 'ticket']);
    });
    if (!fkMatch || !uniquePosition || existing.length !== def.columns.length || existing.some((col, i) => col.name !== def.columns[i]
      || col.type.toUpperCase() !== (col.name === 'revision' ? 'INTEGER' : 'TEXT') || col.pk !== (i === 0 ? 1 : 0)
      || col.notnull !== (i === 0 || col.name === 'completed_at' ? 0 : 1))) {
      throw new Error(`复盘表 ${name} 结构不兼容；请保留数据库备份后处理，应用未迁移或删除旧表。`);
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, def] of Object.entries(definitions)) db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${def.sql})`);
    db.exec('CREATE INDEX IF NOT EXISTS tr_review_links_plan_v1 ON tr_review_links_v1(plan_id); COMMIT;');
  } catch (error) { db.exec('ROLLBACK'); throw error; }

  const accountById = db.prepare('SELECT * FROM tr_review_accounts_v1 WHERE id = ?');
  const allAccounts = db.prepare('SELECT id, data FROM tr_review_accounts_v1 ORDER BY updated_at DESC');
  const positionById = db.prepare('SELECT * FROM tr_review_positions_v1 WHERE id = ?');
  const linkById = db.prepare('SELECT * FROM tr_review_links_v1 WHERE position_id = ?');
  const summaryById = db.prepare('SELECT * FROM tr_review_summaries_v1 WHERE plan_id = ?');
  const insertPosition = db.prepare('INSERT INTO tr_review_positions_v1 VALUES (?, ?, ?, ?, ?, ?, ?)');
  const updatePosition = db.prepare('UPDATE tr_review_positions_v1 SET data = ?, result_hash = ?, updated_at = ? WHERE id = ?');
  const insertLink = db.prepare('INSERT INTO tr_review_links_v1 VALUES (?, ?, ?, ?, ?, ?)');
  const updateLink = db.prepare('UPDATE tr_review_links_v1 SET plan_id = ?, purpose = ?, note = ?, updated_at = ? WHERE position_id = ?');
  const saveSummary = db.prepare(`INSERT INTO tr_review_summaries_v1 VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_id) DO UPDATE SET content=excluded.content, state=excluded.state,
    completed_at=excluded.completed_at, updated_at=excluded.updated_at, revision=excluded.revision`);
  const joined = `SELECT p.*, l.plan_id, l.purpose, l.note FROM tr_review_positions_v1 p
    LEFT JOIN tr_review_links_v1 l ON l.position_id = p.id`;
  const allPositions = db.prepare(`${joined} ORDER BY json_extract(p.data, '$.openTime') DESC, p.id`);
  const planPositions = db.prepare(`${joined} WHERE l.plan_id = ? ORDER BY json_extract(p.data, '$.openTime'), p.id`);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function requirePlan(id) {
    if (typeof id !== 'string' || !id) throw fail(400, '请选择开仓计划。');
    const plan = plans.get(id);
    if (!plan) throw fail(404, '关联的开仓计划不存在。');
    return plan;
  }
  function requirePosition(id) {
    if (typeof id !== 'string' || !id || !positionById.get(id)) throw fail(404, '持仓不存在，请刷新列表。');
  }
  function review(id) {
    const row = summaryById.get(id);
    return row ? { ...JSON.parse(row.content), state: row.state, completedAt: row.completed_at, updatedAt: row.updated_at, revision: row.revision } : emptyReview();
  }
  function touch(id) {
    const previous = review(id);
    saveSummary.run(id, JSON.stringify({ adherence: previous.adherence, good: previous.good, improve: previous.improve }),
      previous.state === 'draft' ? 'draft' : 'needs_update', previous.completedAt, now(), previous.revision + 1);
  }
  function accounts() { return allAccounts.all().map(row => ({ ...JSON.parse(row.data), id: row.id })); }
  function expand(rows, sources = accounts()) {
    const map = new Map(sources.map(source => [source.id, source]));
    return rows.map(row => ({ ...JSON.parse(row.data), id: row.id, source: map.get(row.source_id),
      link: row.plan_id ? { planId: row.plan_id, purpose: row.purpose, note: row.note } : null }));
  }
  function totals(positions) {
    const groups = new Map();
    for (const p of positions) {
      const key = `${p.source.id}:${p.source.currency}`;
      const group = groups.get(key) || { source: p.source, closed: 0, open: 0, incomplete: 0, netProfit: 0 };
      if (p.resultState === 'closed' && Number.isFinite(p.netProfit)) { group.closed++; group.netProfit += p.netProfit; }
      else if (p.resultState === 'open') group.open++;
      else group.incomplete++;
      groups.set(key, group);
    }
    return [...groups.values()].map(group => ({ ...group, netProfit: Number.isFinite(group.netProfit) ? Number(group.netProfit.toFixed(8)) : null }));
  }
  function snapshot(id) {
    const positions = expand(planPositions.all(id));
    return { positions, totals: totals(positions), review: review(id) };
  }
  function ownedLink(positionId, planId) {
    requirePosition(positionId);
    const link = linkById.get(positionId);
    if (!link || link.plan_id !== planId) throw fail(409, '持仓的关联已变化，请刷新后重试。');
    return link;
  }

  return {
    snapshot,
    detail(id) { return { plan: requirePlan(id), ...snapshot(id) }; },
    workspace() {
      const sources = accounts(), positions = expand(allPositions.all(), sources);
      const counts = new Map();
      positions.forEach(p => { if (p.link) counts.set(p.link.planId, (counts.get(p.link.planId) || 0) + 1); });
      const planList = plans.list().map(({ images: _images, ...plan }) => ({ ...plan, positionCount: counts.get(plan.id) || 0, review: review(plan.id) }));
      return { accounts: sources, positions, plans: planList, counts: {
        unlinked: positions.filter(p => !p.link).length,
        pending: planList.filter(p => p.positionCount && p.review.state !== 'completed').length,
        completed: planList.filter(p => p.positionCount && p.review.state === 'completed').length,
      } };
    },
    importReport(report) {
      const { account, trades, warnings, cashFlows } = report;
      const sourceId = hash([account.broker.trim().toLowerCase(), account.server.trim().toLowerCase(), account.id]);
      const source = { ...account, accountNumber: account.id, currency: account.currency.toUpperCase() };
      delete source.id;
      return transaction(() => {
        const oldAccount = accountById.get(sourceId);
        const previousSource = oldAccount ? JSON.parse(oldAccount.data) : null;
        if (previousSource && previousSource.currency !== source.currency) throw fail(409, '相同公司、服务器和账户编号的币种发生变化，无法安全合并，请核对报告。');
        const date = now();
        if (!previousSource) db.prepare('INSERT INTO tr_review_accounts_v1 VALUES (?, ?, ?, ?)').run(sourceId, JSON.stringify(source), date, date);
        else if (source.reportDate >= previousSource.reportDate) db.prepare('UPDATE tr_review_accounts_v1 SET data=?, updated_at=? WHERE id=?').run(JSON.stringify(source), date, sourceId);
        const result = { added: 0, updated: 0, duplicate: 0, conflicts: [], warnings, ignoredCashFlows: cashFlows.length, incomplete: 0, source: { ...source, id: sourceId } };
        const changedPlans = new Set();
        for (const trade of trades) {
          const id = hash([sourceId, trade.ticket]);
          const { id: _id, accountId: _account, stopLoss, takeProfit, ...rest } = trade;
          const value = { ...rest, reportedStopLoss: stopLoss, reportedTakeProfit: takeProfit, reportDate: account.reportDate };
          const digest = hash(pick(value, resultKeys));
          if (value.resultState === 'incomplete') result.incomplete++;
          const previous = positionById.get(id);
          if (!previous) {
            insertPosition.run(id, sourceId, trade.ticket, JSON.stringify(value), digest, date, date); result.added++; continue;
          }
          const old = JSON.parse(previous.data);
          if (previous.result_hash === digest) {
            // Advance provenance on a newer identical report, without invalidating a review.
            if (value.reportDate > old.reportDate) updatePosition.run(JSON.stringify(value), digest, date, id);
            result.duplicate++; continue;
          }
          let conflict = '';
          if (hash(pick(value, openingKeys)) !== hash(pick(old, openingKeys))) conflict = '开仓信息或交易量不同，可能为分拆持仓，未覆盖原记录';
          else if (value.reportDate <= old.reportDate) conflict = '报告日期相同或更早但内容不同，未覆盖较新记录';
          else if (old.resultState === 'closed' && value.resultState !== 'closed') conflict = '已完整平仓的记录不能被未平仓或不完整记录覆盖';
          else if (old.closeTime && !value.closeTime) conflict = '报告缺少已有的平仓信息，未覆盖原记录';
          if (conflict) { result.conflicts.push({ ticket: trade.ticket, reason: conflict }); continue; }
          updatePosition.run(JSON.stringify(value), digest, date, id); result.updated++;
          const link = linkById.get(id);
          if (link) changedPlans.add(link.plan_id);
        }
        changedPlans.forEach(touch);
        return result;
      });
    },
    link(body) {
      object(body);
      if (!Array.isArray(body.links) || !body.links.length || body.links.length > 100) throw fail(400, '每次请选择 1 至 100 个持仓。');
      const links = body.links.map(value => ({ ...linkContent(value), positionId: text(value.positionId, '持仓标识', 64) }));
      if (new Set(links.map(link => link.positionId)).size !== links.length) throw fail(400, '不能重复选择同一个持仓。');
      return transaction(() => {
        requirePlan(body.planId);
        let changed = false;
        for (const link of links) {
          requirePosition(link.positionId);
          const existing = linkById.get(link.positionId);
          if (existing) {
            if (existing.plan_id === body.planId && existing.purpose === link.purpose && existing.note === link.note) continue;
            const owner = plans.get(existing.plan_id);
            throw fail(409, `持仓已关联计划「${owner?.symbol || '未填品种'} · ${owner?.createdAt || existing.plan_id}」，请在原关联中明确解除或更换；本批次未作更改。`);
          }
          insertLink.run(link.positionId, body.planId, link.purpose, link.note, now(), now()); changed = true;
        }
        if (changed) touch(body.planId);
        return { planId: body.planId };
      });
    },
    editLink(id, body) {
      const content = linkContent(body);
      return transaction(() => {
        const old = ownedLink(id, body.planId);
        if (old.purpose !== content.purpose || old.note !== content.note) {
          updateLink.run(old.plan_id, content.purpose, content.note, now(), id); touch(old.plan_id);
        }
        return { planId: old.plan_id };
      });
    },
    unlink(id, body) {
      object(body);
      return transaction(() => {
        const old = ownedLink(id, body.planId);
        db.prepare('DELETE FROM tr_review_links_v1 WHERE position_id=?').run(id); touch(old.plan_id);
        return { planId: old.plan_id };
      });
    },
    move(body) {
      const content = linkContent(body);
      return transaction(() => {
        const old = ownedLink(body.positionId, body.fromPlanId);
        requirePlan(body.toPlanId);
        if (old.plan_id === body.toPlanId) throw fail(400, '请选择不同的目标计划。');
        updateLink.run(body.toPlanId, content.purpose, content.note, now(), body.positionId);
        touch(old.plan_id); touch(body.toPlanId);
        return { planId: body.toPlanId };
      });
    },
    saveReview(id, body) {
      object(body);
      if (!['unrated', 'yes', 'partial', 'no'].includes(body.adherence)) throw fail(400, '请选择有效的计划遵守程度。');
      if (!['draft', 'completed'].includes(body.state)) throw fail(400, '请选择保存草稿或完成复盘。');
      const content = { adherence: body.adherence, good: text(body.good, '做得好的地方', 5000), improve: text(body.improve, '下次改进', 5000) };
      if (body.state === 'completed' && !content.good && !content.improve) throw fail(400, '完成复盘前，请至少填写一项文字总结。');
      return transaction(() => {
        requirePlan(id);
        const previous = review(id);
        if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== previous.revision) throw fail(409, '持仓关联、结果或复盘已更新。当前输入仍保留，请刷新核对最新资料后再保存。');
        if (body.state === 'completed' && !planPositions.all(id).length) throw fail(409, '请先关联至少一个持仓，再完成复盘。');
        saveSummary.run(id, JSON.stringify(content), body.state, body.state === 'completed' ? now() : previous.completedAt, now(), previous.revision + 1);
        return { review: review(id) };
      });
    },
  };
}
