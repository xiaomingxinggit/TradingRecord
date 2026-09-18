import { randomUUID } from 'node:crypto';

const eventTypes = new Set(['order_created', 'order_status_changed', 'order_fields_changed']);
const publicError = (status, message) => Object.assign(new Error(message), { status });

export function createPlanEventStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tr_plan_events_v1 (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      order_id TEXT REFERENCES tr_orders_v2(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('order_created', 'order_status_changed', 'order_fields_changed')),
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tr_plan_events_v1_plan ON tr_plan_events_v1(plan_id, created_at DESC, id DESC);
  `);
  const findPlan = db.prepare('SELECT id FROM plans WHERE id = ?');
  const byPlan = db.prepare(`SELECT id, plan_id, order_id, event_type, detail_json, created_at
    FROM tr_plan_events_v1 WHERE plan_id = ? ORDER BY created_at DESC, id DESC`);
  const insert = db.prepare(`INSERT INTO tr_plan_events_v1
    (id, plan_id, order_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const hydrate = row => ({ id: row.id, planId: row.plan_id, orderId: row.order_id,
    type: row.event_type, detail: JSON.parse(row.detail_json), createdAt: row.created_at });
  const requirePlan = planId => {
    if (!findPlan.get(planId)) throw publicError(404, '未找到这份交易计划。');
  };
  return {
    append(planId, orderId, type, detail, createdAt) {
      if (!eventTypes.has(type)) throw new Error('不支持的计划事件类型。');
      const event = { id: randomUUID(), planId, orderId: orderId ?? null, type, detail, createdAt };
      insert.run(event.id, event.planId, event.orderId, event.type, JSON.stringify(event.detail), event.createdAt);
      return event;
    },
    listForPlan(planId) {
      requirePlan(planId);
      return byPlan.all(planId).map(hydrate);
    },
    exportForPlan(planId) {
      return byPlan.all(planId).map(hydrate);
    },
  };
}
