import { randomUUID } from 'node:crypto';
import { MAX_IMAGE_SIZE, MAX_IMAGES, imageTypes, validateImages } from './images.mjs';
import { Router, json } from 'express';
import multer from 'multer';
import { exportPlansArchive } from './export.mjs';

const timeframes = new Set(['', 'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1']);
const marketStates = new Set(['uptrend', 'downtrend', 'range', 'uncertain']);
const planStatuses = new Set(['draft', 'ready', 'executed', 'abandoned', 'untriggered', 'expired']);
const publicError = (status, message) => Object.assign(new Error(message), { status });

function readText(value, label, limit) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw publicError(400, `${label}必须是文字。`);
  const trimmed = value.trim();
  if (trimmed.length > limit) throw publicError(400, `${label}不能超过 ${limit} 字。`);
  return trimmed;
}

function readPrice(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw publicError(400, `${label}为选填，填写时必须是大于 0 的有效数值。`);
  }
  return value;
}

function validateContent(body, status) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw publicError(400, '计划内容必须是 JSON 对象。');
  }
  const plan = {
    symbol: readText(body.symbol, '品种', 40),
    side: body.side ?? '',
    timeframe: body.timeframe ?? '',
    marketState: body.marketState ?? 'uncertain',
    keyStructure: readText(body.keyStructure, '关键结构', 300),
    reason: readText(body.reason, '入场理由', 5000),
    invalidationCondition: readText(body.invalidationCondition, '出场理由', 500),
    entryPrice: readPrice(body.entryPrice, '计划入场价'),
    stopLoss: readPrice(body.stopLoss, '止损价'),
    takeProfit: readPrice(body.takeProfit, '止盈价'),
    status,
  };
  if (!['', 'buy', 'sell'].includes(plan.side)) throw publicError(400, '方向请选择做多或做空。');
  if (!timeframes.has(plan.timeframe)) throw publicError(400, '请选择有效的分析周期。');
  if (!marketStates.has(plan.marketState)) throw publicError(400, '请选择有效的市场状态。');
  if (!planStatuses.has(plan.status)) throw publicError(400, '请选择有效的计划状态。');
  if (['ready', 'executed'].includes(plan.status)) {
    const missing = [['symbol', '品种'], ['side', '方向'], ['timeframe', '分析周期'], ['reason', '入场理由']]
      .filter(([field]) => !plan[field]).map(([, label]) => label);
    if (missing.length) throw publicError(400, `${plan.status === 'executed' ? '已执行' : '待触发'}计划需要${missing.join('、')}，请先编辑补齐。`);
  }
  const { side, entryPrice, stopLoss, takeProfit } = plan;
  if (side) {
    const before = side === 'buy' ? (a, b) => a < b : (a, b) => a > b;
    const direction = side === 'buy' ? '做多' : '做空';
    const relation = side === 'buy' ? '低于' : '高于';
    if (stopLoss !== null && entryPrice !== null && !before(stopLoss, entryPrice)) {
      throw publicError(400, `${direction}计划的止损价必须${relation}计划入场价。`);
    }
    if (entryPrice !== null && takeProfit !== null && !before(entryPrice, takeProfit)) {
      throw publicError(400, `${direction}计划的入场价必须${relation}止盈价。`);
    }
    if (stopLoss !== null && takeProfit !== null && !before(stopLoss, takeProfit)) {
      throw publicError(400, `${direction}计划的止损价必须${relation}止盈价。`);
    }
  }
  return plan;
}

function validatePayload(body, editing, status) {
  const plan = validateContent(body, status);
  if (body.status !== undefined && !planStatuses.has(body.status)) throw publicError(400, '计划状态无效。');
  const keepImageIds = body.keepImageIds ?? (editing ? null : []);
  if (!Array.isArray(keepImageIds) || keepImageIds.length > MAX_IMAGES
    || keepImageIds.some((id) => typeof id !== 'string' || !id || id.length > 64)
    || new Set(keepImageIds).size !== keepImageIds.length) {
    throw publicError(400, '保留截图列表无效，最多保留 4 张不同的截图。');
  }
  return { plan, keepImageIds };
}

export function createPlanStore(db, getOrderStore = () => null) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS plans_created ON plans(created_at DESC);
    CREATE TABLE IF NOT EXISTS plan_images (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      position INTEGER NOT NULL,
      content BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS plan_images_plan ON plan_images(plan_id);
  `);
  const findPlan = db.prepare('SELECT id, payload, created_at, updated_at FROM plans WHERE id = ?');
  const allPlans = db.prepare('SELECT id, payload, created_at, updated_at FROM plans ORDER BY created_at DESC, id DESC');
  const findImages = db.prepare(`SELECT id, name, mime_type AS mimeType, size
    FROM plan_images WHERE plan_id = ? ORDER BY position, id`);
  const readImage = db.prepare('SELECT mime_type AS mimeType, content FROM plan_images WHERE plan_id = ? AND id = ?');
  const exportImages = db.prepare(`SELECT name, mime_type AS mimeType, content
    FROM plan_images WHERE plan_id = ? ORDER BY position, id`);
  // Keep the nullable legacy column so existing databases need no table rebuild.
  // Every write clears it, including old values whose account no longer exists.
  const upsertPlan = db.prepare(`INSERT INTO plans (id, account_id, payload, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET account_id = NULL, payload = excluded.payload, updated_at = excluded.updated_at`);
  const updateStatus = db.prepare('UPDATE plans SET account_id = NULL, payload = ?, updated_at = ? WHERE id = ?');
  const insertImage = db.prepare(`INSERT INTO plan_images (id, plan_id, name, mime_type, size, position, content)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const removeImage = db.prepare('DELETE FROM plan_images WHERE plan_id = ? AND id = ?');
  const reorderImage = db.prepare('UPDATE plan_images SET position = ? WHERE plan_id = ? AND id = ?');
  const hydrate = (row) => {
    if (!row) return null;
    const plan = JSON.parse(row.payload);
    // Responses expose only current plan fields; saved unknown fields stay private.
    return {
      symbol: plan.symbol ?? '', side: plan.side ?? '', timeframe: plan.timeframe ?? '',
      marketState: plan.marketState ?? 'uncertain', keyStructure: plan.keyStructure ?? '',
      reason: plan.reason ?? '', invalidationCondition: plan.invalidationCondition ?? '',
      entryPrice: plan.entryPrice ?? null, stopLoss: plan.stopLoss ?? null, takeProfit: plan.takeProfit ?? null,
      status: plan.status ?? 'draft', statusChangedAt: plan.statusChangedAt ?? null, abandonReason: plan.abandonReason ?? '',
      id: row.id, createdAt: row.created_at, updatedAt: row.updated_at,
      images: findImages.all(row.id).map((image) => ({ ...image,
        url: `/api/plans/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}` })),
    };
  };

  return {
    list() {
      return allPlans.all().map(hydrate);
    },
    exportSnapshot() {
      // Read plans and original images from the same snapshot, then finish the
      // read transaction before asynchronously building the archive.
      db.exec('BEGIN');
      try {
        const orderStore = getOrderStore();
        const plans = allPlans.all().map((row) => ({ ...hydrate(row), images: exportImages.all(row.id),
          orders: orderStore ? orderStore.exportForPlan(row.id) : [] }));
        db.exec('COMMIT');
        return { plans };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    get(id) {
      return hydrate(findPlan.get(id));
    },
    getImage(planId, imageId) {
      return readImage.get(planId, imageId) ?? null;
    },
    changeStatus(id, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some((key) => !['status', 'abandonReason'].includes(key))) {
        throw publicError(400, '请仅提交状态及选填的放弃原因。');
      }
      if (!planStatuses.has(body.status)) throw publicError(400, '请选择有效的计划状态。');
      if (body.abandonReason !== undefined && body.status !== 'abandoned') {
        throw publicError(400, '仅在标记已放弃时填写放弃原因。');
      }
      const abandonReason = body.abandonReason === undefined ? undefined : readText(body.abandonReason, '放弃原因', 2000);
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = findPlan.get(id);
        if (!row) throw publicError(404, '未找到这份开仓计划。');
        const previous = JSON.parse(row.payload);
        if (previous.status === body.status) {
          const plan = hydrate(row);
          db.exec('COMMIT');
          return { plan, changed: false };
        }
        validateContent(previous, body.status);
        const now = new Date().toISOString();
        const plan = { ...previous, status: body.status, statusChangedAt: now,
          abandonReason: body.status === 'abandoned' ? abandonReason ?? previous.abandonReason ?? '' : previous.abandonReason ?? '' };
        updateStatus.run(JSON.stringify(plan), now, id);
        const saved = hydrate(findPlan.get(id));
        db.exec('COMMIT');
        return { plan: saved, changed: true };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    save(id, payload, files) {
      const newImages = validateImages(files);
      const planId = id ?? randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = id ? findPlan.get(id) : null;
        if (id && !previous) throw publicError(404, '未找到这份开仓计划。');
        const previousPlan = previous ? JSON.parse(previous.payload) : null;
        // Content saves preserve the latest stored status, even from stale forms.
        const status = previousPlan ? previousPlan.status : payload?.status ?? 'draft';
        if (!previous && !['draft', 'ready'].includes(status)) throw publicError(400, '新计划请先保存草稿或标记待触发。');
        const { plan: content, keepImageIds } = validatePayload(payload, Boolean(id), status);
        if (keepImageIds.length + newImages.length > MAX_IMAGES) throw publicError(400, '每个计划最多保存 4 张截图，请先移除多余截图。');
        const plan = { ...previousPlan, ...content, statusChangedAt: previousPlan?.statusChangedAt ?? null,
          abandonReason: previousPlan?.abandonReason ?? '' };
        const now = new Date().toISOString();
        const existingImages = previous ? findImages.all(planId) : [];
        if (keepImageIds.some((imageId) => !existingImages.some((image) => image.id === imageId))) {
          throw publicError(400, '保留的截图不属于当前计划，请重新打开计划后再保存。');
        }
        upsertPlan.run(planId, JSON.stringify(plan), previous?.created_at ?? now, now);
        for (const image of existingImages) {
          if (!keepImageIds.includes(image.id)) removeImage.run(planId, image.id);
        }
        keepImageIds.forEach((imageId, index) => reorderImage.run(index, planId, imageId));
        newImages.forEach((image, index) => insertImage.run(image.id, planId, image.name, image.mimeType,
          image.size, keepImageIds.length + index, image.buffer));
        const saved = hydrate(findPlan.get(planId));
        db.exec('COMMIT');
        return saved;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function createPlansRouter(store) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    // Busboy raises these limits at equality; the explicit checks above keep the advertised limits inclusive.
    limits: { fileSize: MAX_IMAGE_SIZE + 1, files: MAX_IMAGES, fields: 1, fieldSize: 64 * 1024, parts: MAX_IMAGES + 2 },
    fileFilter: (_req, file, done) => {
      if (!imageTypes.has(file.mimetype)) return done(publicError(400, '截图仅支持 PNG、JPEG 和 WebP 格式。'));
      done(null, true);
    },
  }).array('images', MAX_IMAGES);
  const readUpload = (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(publicError(400, '请使用 multipart/form-data 提交计划。'));
    upload(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') return next(publicError(413, '每张截图不能超过 5 MB。'));
        if (['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_PART_COUNT'].includes(error.code)) {
          return next(publicError(400, '每次最多上传 4 张截图，图片请使用 images 字段，计划内容请使用 payload 字段。'));
        }
        return next(publicError(400, '计划上传内容过大或字段不符合要求，请缩短文字后重试。'));
      }
      if (error) return next(error.status ? error : publicError(400, '上传请求不完整，请重新选择截图并保存。'));
      next();
    });
  };
  const save = (req, res) => {
    if (typeof req.body?.payload !== 'string' || Object.keys(req.body).some((key) => key !== 'payload')) {
      throw publicError(400, '请通过 payload 字段提交计划内容。');
    }
    let payload;
    try { payload = JSON.parse(req.body.payload); } catch { throw publicError(400, '计划内容的 JSON 格式无效。'); }
    const plan = store.save(req.params.id ?? null, payload, req.files ?? []);
    res.status(req.params.id ? 200 : 201).json({ plan });
  };

  router.get('/', (_req, res) => res.json({ plans: store.list() }));
  router.get('/export', async (_req, res) => {
    try {
      const { plans } = store.exportSnapshot();
      const archive = await exportPlansArchive(plans);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="trading-plans.zip"; filename*=UTF-8''${encodeURIComponent('交易计划.zip')}`);
      res.send(archive);
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      console.error(error);
      res.status(500).json({ error: '导出失败，未生成完整的 Markdown 与截图压缩包，请稍后重试。' });
    }
  });
  router.get('/:id', (req, res) => {
    const plan = store.get(req.params.id);
    if (!plan) throw publicError(404, '未找到这份开仓计划。');
    res.json({ plan });
  });
  router.get('/:id/images/:imageId', (req, res) => {
    const image = store.getImage(req.params.id, req.params.imageId);
    if (!image) throw publicError(404, '未找到这张行情截图。');
    res.set('Content-Type', image.mimeType);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
    res.send(Buffer.from(image.content));
  });
  router.post('/', readUpload, save);
  router.put('/:id', readUpload, save);
  router.patch('/:id/status', json({ limit: '16kb' }), (req, res) => res.json(store.changeStatus(req.params.id, req.body)));
  return router;
}
