const assessments = new Set(['', 'valid', 'partial', 'invalid', 'unverified']);
const disciplines = new Set(['', 'followed', 'deviated', 'broken', 'not_executed']);
const publicError = (status, message) => Object.assign(new Error(message), { status });

function readText(value, label, limit) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw publicError(400, `${label}必须是文字。`);
  const trimmed = value.trim();
  if (trimmed.length > limit) throw publicError(400, `${label}不能超过 ${limit} 字。`);
  return trimmed;
}

function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['assessment', 'discipline', 'summary', 'nextAction', 'expectedUpdatedAt'].includes(key))) {
    throw publicError(400, '请仅提交复盘结论、执行纪律、复盘总结和下次行动。');
  }
  const assessment = body.assessment === undefined ? '' : body.assessment;
  const discipline = body.discipline === undefined ? '' : body.discipline;
  if (typeof assessment !== 'string' || !assessments.has(assessment)) throw publicError(400, '请选择有效的计划结论。');
  if (typeof discipline !== 'string' || !disciplines.has(discipline)) throw publicError(400, '请选择有效的执行纪律。');
  const review = {
    assessment,
    discipline,
    summary: readText(body.summary, '复盘总结', 3000),
    nextAction: readText(body.nextAction, '下次行动', 2000),
  };
  if (!review.assessment && !review.discipline && !review.summary && !review.nextAction) {
    throw publicError(400, '请至少填写一项复盘内容后再保存。');
  }
  if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== null
    && (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt)) {
    throw publicError(400, '复盘版本信息无效，请重新打开后再保存。');
  }
  return { review, expectedUpdatedAt: body.expectedUpdatedAt };
}

function nextTimestamp(previous) {
  const current = Date.now();
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(previousTime) ? Math.max(current, previousTime + 1) : current).toISOString();
}

export function createPlanReviewStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tr_plan_reviews_v1 (
      plan_id TEXT NOT NULL PRIMARY KEY REFERENCES plans(id),
      assessment TEXT NOT NULL CHECK(assessment IN ('', 'valid', 'partial', 'invalid', 'unverified')),
      discipline TEXT NOT NULL CHECK(discipline IN ('', 'followed', 'deviated', 'broken', 'not_executed')),
      summary TEXT NOT NULL,
      next_action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const findPlan = db.prepare('SELECT id FROM plans WHERE id = ?');
  const findReview = db.prepare(`SELECT plan_id, assessment, discipline, summary, next_action, created_at, updated_at
    FROM tr_plan_reviews_v1 WHERE plan_id = ?`);
  const insertReview = db.prepare(`INSERT INTO tr_plan_reviews_v1
    (plan_id, assessment, discipline, summary, next_action, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const updateReview = db.prepare(`UPDATE tr_plan_reviews_v1
    SET assessment = ?, discipline = ?, summary = ?, next_action = ?, updated_at = ? WHERE plan_id = ?`);
  const hydrate = row => row ? ({
    planId: row.plan_id,
    assessment: row.assessment,
    discipline: row.discipline,
    summary: row.summary,
    nextAction: row.next_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) : null;
  const requirePlan = planId => {
    if (!findPlan.get(planId)) throw publicError(404, '未找到这份交易计划。');
  };

  return {
    get(planId) {
      requirePlan(planId);
      return hydrate(findReview.get(planId));
    },
    save(planId, body) {
      const { review, expectedUpdatedAt } = validatePayload(body);
      db.exec('BEGIN IMMEDIATE');
      try {
        requirePlan(planId);
        const previous = findReview.get(planId);
        if (previous && expectedUpdatedAt !== previous.updated_at) {
          throw publicError(409, '这份计划复盘已在其他页面更新，请重新打开后再修改。');
        }
        if (!previous && expectedUpdatedAt !== undefined && expectedUpdatedAt !== null) {
          throw publicError(409, '这份计划复盘的版本已变化，请重新打开后再修改。');
        }
        const now = nextTimestamp(previous?.updated_at);
        if (previous) {
          updateReview.run(review.assessment, review.discipline, review.summary, review.nextAction, now, planId);
        } else {
          insertReview.run(planId, review.assessment, review.discipline, review.summary, review.nextAction, now, now);
        }
        const saved = hydrate(findReview.get(planId));
        db.exec('COMMIT');
        return saved;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    exportForPlan(planId) {
      return hydrate(findReview.get(planId));
    },
  };
}
