import { randomUUID } from 'node:crypto';
import { Router, json } from 'express';
import multer from 'multer';
import { validateImages } from './plans.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const states = ['draft', 'open', 'closed'];
const periods = ['', 'M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];
const emptyReview = () => ({ adherence: 'unrated', good: '', improve: '', state: 'draft', completedAt: null, updatedAt: null });
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, '请提交有效的记录对象。'); }
function text(value, name, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > max) throw fail(400, `${name}需为文字且不超过 ${max} 字。`);
  return value.trim();
}
function numeric(value, name, positive = false) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12 || (positive && value <= 0)) throw fail(400, `${name}需为${positive ? '大于 0 的' : ''}有限数值，绝对值不超过一万亿。`);
  return value;
}
function validate(body, previous) {
  object(body);
  const record = {
    status: body.status ?? 'draft', symbol: text(body.symbol, '品种', 40), side: body.side ?? '', timeframe: body.timeframe ?? '',
    // These fields are no longer collected. Ignore old clients' copies and
    // preserve the values read inside the transaction, including explicit zero.
    openTime: previous?.openTime ?? null, openPrice: previous?.openPrice ?? null, volume: previous?.volume ?? null,
    closeTime: previous?.closeTime ?? null, closePrice: previous?.closePrice ?? null,
    netProfit: previous?.netProfit ?? null, currency: previous?.currency ?? '',
    marketState: body.marketState ?? 'uncertain', keyStructure: text(body.keyStructure, '关键结构', 300), reason: text(body.reason, '开仓分析', 5000),
    stopLoss: numeric(body.stopLoss, '计划止损', true), takeProfit: numeric(body.takeProfit, '计划止盈', true),
  };
  if (!states.includes(record.status) || !['', 'buy', 'sell'].includes(record.side) || !periods.includes(record.timeframe)) throw fail(400, '状态、方向或分析周期无效。');
  if (!['uptrend', 'downtrend', 'range', 'uncertain'].includes(record.marketState)) throw fail(400, '请选择有效的市场状态。');
  if (record.status !== 'draft' && (!record.symbol || !record.side || !record.timeframe)) throw fail(400, '模拟持仓中或已平仓需填写品种、方向和分析周期。');
  return record;
}
function purpose(value) { if (!['before', 'review'].includes(value)) throw fail(400, '截图用途请选择开仓前或复盘。'); return value; }

export function createPracticeStore(db) {
  const definitions = {
    tr_practice_records_v1: { names: ['id', 'payload', 'record_revision', 'review_payload', 'review_revision', 'created_at', 'updated_at'],
      sql: 'id TEXT PRIMARY KEY, payload TEXT NOT NULL, record_revision INTEGER NOT NULL, review_payload TEXT NOT NULL, review_revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL' },
    tr_practice_images_v1: { names: ['id', 'record_id', 'name', 'mime_type', 'size', 'position', 'purpose', 'content'],
      sql: 'id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES tr_practice_records_v1(id), name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, position INTEGER NOT NULL, purpose TEXT NOT NULL, content BLOB NOT NULL' },
  };
  for (const [name, def] of Object.entries(definitions)) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all();
    if (!cols.length) continue;
    const fk = db.prepare(`PRAGMA foreign_key_list(${name})`).all();
    const fkValid = name === 'tr_practice_records_v1' ? !fk.length : fk.length === 1 && fk[0].from === 'record_id' && fk[0].table === 'tr_practice_records_v1' && fk[0].to === 'id' && fk[0].on_delete === 'NO ACTION';
    if (!fkValid || cols.length !== def.names.length || cols.some((col, index) => col.name !== def.names[index]
      || col.type !== (['record_revision', 'review_revision', 'size', 'position'].includes(col.name) ? 'INTEGER' : col.name === 'content' ? 'BLOB' : 'TEXT')
      || col.pk !== (index === 0 ? 1 : 0) || col.notnull !== (index === 0 ? 0 : 1))) throw new Error(`模拟练习表 ${name} 结构不兼容，未覆盖旧表，请保留数据后处理。`);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, def] of Object.entries(definitions)) db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${def.sql})`);
    db.exec('CREATE INDEX IF NOT EXISTS tr_practice_images_record_v1 ON tr_practice_images_v1(record_id); COMMIT;');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const find = db.prepare('SELECT * FROM tr_practice_records_v1 WHERE id=?');
  const all = db.prepare('SELECT * FROM tr_practice_records_v1 ORDER BY created_at DESC, id DESC');
  const images = db.prepare('SELECT id, name, mime_type AS mimeType, size, purpose FROM tr_practice_images_v1 WHERE record_id=? ORDER BY position,id');
  const readImage = db.prepare('SELECT mime_type AS mimeType, content FROM tr_practice_images_v1 WHERE record_id=? AND id=?');
  const insertImage = db.prepare('INSERT INTO tr_practice_images_v1 VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const deleteImage = db.prepare('DELETE FROM tr_practice_images_v1 WHERE record_id=? AND id=?');
  const updateImage = db.prepare('UPDATE tr_practice_images_v1 SET position=?, purpose=? WHERE record_id=? AND id=?');
  const hydrate = row => row ? ({ ...JSON.parse(row.payload), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at,
    recordRevision: row.record_revision, reviewRevision: row.review_revision, review: JSON.parse(row.review_payload),
    images: images.all(row.id).map(image => ({ ...image, url: `/api/practice/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}` })) }) : null;
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function requireRow(id) { const row = find.get(id); if (!row) throw fail(404, '模拟记录不存在。'); return row; }
  return {
    list: () => all.all().map(hydrate),
    get: id => hydrate(requireRow(id)),
    getImage: (id, imageId) => readImage.get(id, imageId),
    exportSnapshot() {
      // Caller owns the shared read transaction with real plans and their images.
      const exportedImages = db.prepare('SELECT name, mime_type AS mimeType, purpose, content FROM tr_practice_images_v1 WHERE record_id=? ORDER BY position,id');
      return all.all().map(row => ({ ...hydrate(row), images: exportedImages.all(row.id) }));
    },
    save(id, body, files) {
      object(body);
      const added = validateImages(files);
      if (!Array.isArray(body.keepImages) || !Array.isArray(body.newImagePurposes) || body.newImagePurposes.length !== added.length
        || body.keepImages.length + added.length > 4) throw fail(400, '截图列表无效，每条模拟记录最多保存 4 张。');
      const keep = body.keepImages.map(image => { object(image); return { id: text(image.id, '截图标识', 64), purpose: purpose(image.purpose) }; });
      if (new Set(keep.map(image => image.id)).size !== keep.length) throw fail(400, '保留截图不能重复。');
      const newPurposes = body.newImagePurposes.map(purpose);
      return transaction(() => {
        const previous = id ? requireRow(id) : null, recordId = id ?? randomUUID();
        if (previous && body.expectedRevision !== previous.record_revision) throw fail(409, '这条模拟记录已被其他页面修改。当前输入和截图仍保留，请复制需保留的文字，再重新读取最新记录。');
        const record = validate(body, previous ? JSON.parse(previous.payload) : null);
        const oldImages = previous ? images.all(id) : [];
        if (keep.some(image => !oldImages.some(old => old.id === image.id))) throw fail(400, '保留截图不属于当前模拟记录，请重新读取后保存。');
        const changed = !previous || previous.payload !== JSON.stringify(record) || added.length > 0
          || JSON.stringify(keep) !== JSON.stringify(oldImages.map(image => ({ id: image.id, purpose: image.purpose })));
        if (!changed) return hydrate(previous);
        const now = new Date().toISOString();
        const review = previous ? JSON.parse(previous.review_payload) : emptyReview();
        const invalidated = previous && review.state !== 'draft';
        if (invalidated) { review.state = 'needs_update'; review.updatedAt = now; }
        if (!previous) db.prepare('INSERT INTO tr_practice_records_v1 VALUES (?, ?, ?, ?, ?, ?, ?)').run(recordId, JSON.stringify(record), 1, JSON.stringify(review), 0, now, now);
        else db.prepare('UPDATE tr_practice_records_v1 SET payload=?, record_revision=record_revision+1, review_payload=?, review_revision=review_revision+?, updated_at=? WHERE id=?')
          .run(JSON.stringify(record), JSON.stringify(review), invalidated ? 1 : 0, now, recordId);
        oldImages.filter(image => !keep.some(item => item.id === image.id)).forEach(image => deleteImage.run(recordId, image.id));
        keep.forEach((image, index) => updateImage.run(index, image.purpose, recordId, image.id));
        added.forEach((image, index) => insertImage.run(image.id, recordId, image.name, image.mimeType, image.size, keep.length + index, newPurposes[index], image.buffer));
        return hydrate(find.get(recordId));
      });
    },
    saveReview(id, body) {
      object(body);
      if (!['unrated', 'yes', 'partial', 'no'].includes(body.adherence) || !['draft', 'completed'].includes(body.state)) throw fail(400, '复盘选项无效。');
      const content = { adherence: body.adherence, good: text(body.good, '做得好的地方', 5000), improve: text(body.improve, '问题与改进', 5000) };
      if (body.state === 'completed' && !content.good && !content.improve) throw fail(400, '完成复盘前请至少填写一项非空总结。');
      return transaction(() => {
        const row = requireRow(id), record = JSON.parse(row.payload), previous = JSON.parse(row.review_payload);
        if (body.expectedRecordRevision !== row.record_revision || body.expectedReviewRevision !== row.review_revision) throw fail(409, '交易记录或复盘已有更新。当前输入仍保留，请复制需保留的文字，再重新读取最新记录。');
        if (record.status !== 'closed') throw fail(409, '仅已平仓的模拟记录可保存复盘，原有总结仍保留。');
        const now = new Date().toISOString();
        const review = { ...content, state: body.state, completedAt: body.state === 'completed' ? now : previous.completedAt, updatedAt: now };
        db.prepare('UPDATE tr_practice_records_v1 SET review_payload=?, review_revision=review_revision+1, updated_at=? WHERE id=?').run(JSON.stringify(review), now, id);
        return hydrate(find.get(id));
      });
    },
  };
}

export function createPracticeRouter(store) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 + 1, files: 4, fields: 1, fieldSize: 64 * 1024, parts: 6 },
    fileFilter: (_req, file, done) => done(['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype) ? null : fail(400, '截图仅支持 PNG、JPEG、WebP。'), true),
  }).array('images', 4);
  function save(req, res, next) {
    if (!req.is('multipart/form-data')) return next(fail(400, '请通过表单提交模拟记录。'));
    upload(req, res, error => {
      try {
        if (error) throw error.status ? error : fail(400, error.code === 'LIMIT_FILE_SIZE' ? '每张截图不超过 5 MB。' : '上传内容无效，最多 4 张截图，正文为 payload 字段。');
        if (typeof req.body?.payload !== 'string' || Object.keys(req.body).some(key => key !== 'payload')) throw fail(400, '请通过 payload 字段提交记录。');
        let body;
        try { body = JSON.parse(req.body.payload); } catch { throw fail(400, '模拟记录 JSON 格式无效。'); }
        res.status(req.params.id ? 200 : 201).json({ record: store.save(req.params.id ?? null, body, req.files ?? []) });
      } catch (failure) { next(failure); }
    });
  }
  router.get('/', (_req, res) => res.json({ records: store.list() }));
  router.get('/:id', (req, res) => res.json({ record: store.get(req.params.id) }));
  router.get('/:id/images/:imageId', (req, res) => {
    const image = store.getImage(req.params.id, req.params.imageId);
    if (!image) throw fail(404, '模拟截图不存在。');
    res.set('Content-Type', image.mimeType).set('X-Content-Type-Options', 'nosniff').set('Content-Disposition', 'inline').send(Buffer.from(image.content));
  });
  router.post('/', save);
  router.put('/:id', save);
  router.put('/:id/review', json({ limit: '64kb' }), (req, res) => res.json({ record: store.saveReview(req.params.id, req.body) }));
  return router;
}
