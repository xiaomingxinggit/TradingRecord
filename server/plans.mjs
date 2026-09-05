import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Router } from 'express';
import multer from 'multer';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGES = 4;
const timeframes = new Set(['', 'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1']);
const marketStates = new Set(['uptrend', 'downtrend', 'range', 'uncertain']);
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
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
    throw publicError(400, `${label}必须是大于 0 的有效数值，未填写时请留空。`);
  }
  return value;
}

function validatePayload(body, editing) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw publicError(400, '计划内容必须是 JSON 对象。');
  }
  const plan = {
    accountId: body.accountId ?? null,
    symbol: readText(body.symbol, '品种', 40),
    side: body.side ?? '',
    timeframe: body.timeframe ?? '',
    marketState: body.marketState ?? 'uncertain',
    keyStructure: readText(body.keyStructure, '关键结构', 300),
    reason: readText(body.reason, '入场理由', 5000),
    entryPrice: readPrice(body.entryPrice, '计划入场价'),
    stopLoss: readPrice(body.stopLoss, '止损价'),
    takeProfit: readPrice(body.takeProfit, '止盈价'),
    status: body.status ?? 'draft',
  };
  if (plan.accountId !== null && (typeof plan.accountId !== 'string' || !plan.accountId.trim())) {
    throw publicError(400, '请选择有效账户，或使用独立记录。');
  }
  if (!['', 'buy', 'sell'].includes(plan.side)) throw publicError(400, '方向请选择做多或做空。');
  if (!timeframes.has(plan.timeframe)) throw publicError(400, '请选择有效的分析周期。');
  if (!marketStates.has(plan.marketState)) throw publicError(400, '请选择有效的市场状态。');
  if (!['draft', 'ready'].includes(plan.status)) throw publicError(400, '计划状态仅支持草稿或待执行。');
  if (plan.status === 'ready') {
    const missing = [['symbol', '品种'], ['side', '方向'], ['timeframe', '分析周期'], ['reason', '入场理由']]
      .filter(([field]) => !plan[field]).map(([, label]) => label);
    if (missing.length) throw publicError(400, `标记待执行前，请填写${missing.join('、')}。`);
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
  const keepImageIds = body.keepImageIds ?? (editing ? null : []);
  if (!Array.isArray(keepImageIds) || keepImageIds.length > MAX_IMAGES
    || keepImageIds.some((id) => typeof id !== 'string' || !id || id.length > 64)
    || new Set(keepImageIds).size !== keepImageIds.length) {
    throw publicError(400, '保留截图列表无效，最多保留 4 张不同的截图。');
  }
  return { plan, keepImageIds };
}

function imageSignature(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && buffer.toString('ascii', 12, 16) === 'IHDR'
    && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0) return 'image/png';
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
    && buffer.readUInt32LE(4) + 8 === buffer.length) return 'image/webp';
  return null;
}

function imageName(originalName) {
  let name = originalName;
  // Busboy exposes multipart filenames as Latin-1; recover UTF-8 names when possible.
  if ([...name].every((char) => char.codePointAt(0) <= 255)) {
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1')); } catch { /* Keep the original name. */ }
  }
  return [...basename(name.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '')].slice(0, 180).join('') || '行情截图';
}

function validateImages(files) {
  if (files.length > MAX_IMAGES) throw publicError(400, '每个计划最多保存 4 张截图。');
  return files.map((file) => {
    if (file.size > MAX_IMAGE_SIZE) throw publicError(413, '每张截图不能超过 5 MB。');
    const mimeType = imageSignature(file.buffer);
    if (!mimeType || !imageTypes.has(file.mimetype) || file.mimetype !== mimeType) {
      throw publicError(400, '截图内容与格式不符，仅支持有效的 PNG、JPEG 和 WebP 图片。');
    }
    return { id: randomUUID(), name: imageName(file.originalname), mimeType, size: file.size, buffer: file.buffer };
  });
}

export function createPlanStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES accounts(id),
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
  const findAccount = db.prepare('SELECT 1 FROM accounts WHERE id = ?');
  const findPlan = db.prepare('SELECT * FROM plans WHERE id = ?');
  const findImages = db.prepare(`SELECT id, name, mime_type AS mimeType, size
    FROM plan_images WHERE plan_id = ? ORDER BY position, id`);
  const readImage = db.prepare('SELECT mime_type AS mimeType, content FROM plan_images WHERE plan_id = ? AND id = ?');
  const upsertPlan = db.prepare(`INSERT INTO plans (id, account_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, payload = excluded.payload, updated_at = excluded.updated_at`);
  const insertImage = db.prepare(`INSERT INTO plan_images (id, plan_id, name, mime_type, size, position, content)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const removeImage = db.prepare('DELETE FROM plan_images WHERE plan_id = ? AND id = ?');
  const reorderImage = db.prepare('UPDATE plan_images SET position = ? WHERE plan_id = ? AND id = ?');
  const hydrate = (row) => row ? {
    ...JSON.parse(row.payload), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at,
    images: findImages.all(row.id).map((image) => ({ ...image,
      url: `/api/plans/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}` })),
  } : null;

  return {
    list() {
      return db.prepare('SELECT * FROM plans ORDER BY created_at DESC, id DESC').all().map(hydrate);
    },
    get(id) {
      return hydrate(findPlan.get(id));
    },
    getImage(planId, imageId) {
      return readImage.get(planId, imageId) ?? null;
    },
    save(id, payload, files) {
      const { plan, keepImageIds } = validatePayload(payload, Boolean(id));
      const newImages = validateImages(files);
      if (keepImageIds.length + newImages.length > MAX_IMAGES) throw publicError(400, '每个计划最多保存 4 张截图，请先移除多余截图。');
      const planId = id ?? randomUUID();
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = id ? findPlan.get(id) : null;
        if (id && !previous) throw publicError(404, '未找到这份开仓计划。');
        if (plan.accountId !== null && !findAccount.get(plan.accountId)) {
          throw publicError(400, '所选账户不存在，请选择已有账户或独立记录。');
        }
        const existingImages = previous ? findImages.all(planId) : [];
        if (keepImageIds.some((imageId) => !existingImages.some((image) => image.id === imageId))) {
          throw publicError(400, '保留的截图不属于当前计划，请重新打开计划后再保存。');
        }
        upsertPlan.run(planId, plan.accountId, JSON.stringify(plan), previous?.created_at ?? now, now);
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
  return router;
}
