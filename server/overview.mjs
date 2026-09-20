// A read-only snapshot of saved records. Never read image blobs or OCR drafts.
export function createOverviewStore(db) {
  const planCounts = db.prepare(`SELECT COALESCE(json_extract(payload, '$.status'), 'draft') AS status,
    COUNT(*) AS count FROM plans GROUP BY status`);
  const orderCounts = db.prepare(`SELECT o.status, COUNT(*) AS count,
    SUM(CASE WHEN o.locked_at IS NOT NULL THEN 1 ELSE 0 END) AS locked
    FROM tr_orders_v2 o INNER JOIN plans p ON p.id = o.plan_id GROUP BY o.status`);
  const reviewCount = db.prepare(`SELECT COUNT(*) AS count FROM tr_plan_reviews_v1 r
    INNER JOIN plans p ON p.id = r.plan_id
    WHERE TRIM(r.assessment) <> '' OR TRIM(r.discipline) <> ''
      OR TRIM(r.summary) <> '' OR TRIM(r.next_action) <> ''`);
  const eventCount = db.prepare(`SELECT COUNT(*) AS count FROM tr_plan_events_v1 e
    INNER JOIN plans p ON p.id = e.plan_id`);
  const symbolCounts = db.prepare(`SELECT UPPER(TRIM(COALESCE(json_extract(payload, '$.symbol'), ''))) AS symbol,
    COUNT(*) AS count FROM plans GROUP BY symbol ORDER BY count DESC, symbol ASC`);
  const recentPlans = db.prepare(`WITH activity AS (
      SELECT id AS plan_id, updated_at AS activity_at FROM plans
      UNION ALL SELECT plan_id, updated_at FROM tr_orders_v2 WHERE plan_id IS NOT NULL
      UNION ALL SELECT plan_id, updated_at FROM tr_plan_reviews_v1
      UNION ALL SELECT plan_id, created_at FROM tr_plan_events_v1
    ), latest AS (SELECT plan_id, MAX(activity_at) AS activity_at FROM activity GROUP BY plan_id)
    SELECT p.id, COALESCE(json_extract(p.payload, '$.symbol'), '') AS symbol,
      COALESCE(json_extract(p.payload, '$.status'), 'draft') AS status,
      p.created_at AS createdAt, latest.activity_at AS activityAt
    FROM latest INNER JOIN plans p ON p.id = latest.plan_id
    ORDER BY latest.activity_at DESC, p.id DESC LIMIT 6`);

  return {
    get() {
      // All totals and recent activity belong to the same database snapshot.
      db.exec('BEGIN');
      try {
        const plansByStatus = planCounts.all();
        const ordersByStatus = orderCounts.all();
        const symbols = symbolCounts.all();
        const result = {
          generatedAt: new Date().toISOString(),
          totals: {
            plans: plansByStatus.reduce((sum, row) => sum + row.count, 0),
            orders: ordersByStatus.reduce((sum, row) => sum + row.count, 0),
            closedOrders: ordersByStatus.find(row => row.status === 'closed')?.count ?? 0,
            lockedOrders: ordersByStatus.reduce((sum, row) => sum + row.locked, 0),
            reviews: reviewCount.get().count,
            events: eventCount.get().count,
          },
          plansByStatus,
          ordersByStatus: ordersByStatus.map(({ status, count }) => ({ status, count })),
          topSymbols: symbols.filter(row => row.symbol).slice(0, 5),
          distinctSymbols: symbols.filter(row => row.symbol).length,
          plansWithoutSymbol: symbols.find(row => !row.symbol)?.count ?? 0,
          recentPlans: recentPlans.all(),
        };
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
