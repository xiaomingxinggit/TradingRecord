import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { MAX_IMAGE_SIZE, MAX_IMAGES, imageTypes, validateImages } from './images.mjs';

const MAX_CONTENT_LENGTH = 2000;
const publicError = (status, message) => Object.assign(new Error(message), { status });
const imageMetadata = (rantId, image) => ({
  id: image.id, name: image.name, mimeType: image.mimeType, size: image.size,
  url: `/api/market-rants/${encodeURIComponent(rantId)}/images/${encodeURIComponent(image.id)}`,
});

export function createMarketRantStore(db) {
  // Additive schema only: older versions can ignore these independent tables.
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_rants_v1 (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL CHECK (length(content) <= 2000),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS market_rants_created_v1 ON market_rants_v1(created_at DESC);
    CREATE TABLE IF NOT EXISTS market_rant_images_v1 (
      id TEXT PRIMARY KEY,
      rant_id TEXT NOT NULL REFERENCES market_rants_v1(id),
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      size INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
      sort_order INTEGER NOT NULL CHECK (sort_order >= 0 AND sort_order < 4),
      content BLOB NOT NULL,
      UNIQUE (rant_id, sort_order)
    );
  `);
  const listRants = db.prepare('SELECT id, content, created_at AS createdAt FROM market_rants_v1 ORDER BY created_at DESC, rowid DESC');
  const listImages = db.prepare('SELECT id, rant_id AS rantId, name, mime_type AS mimeType, size FROM market_rant_images_v1 ORDER BY rant_id, sort_order');
  const insertRant = db.prepare('INSERT INTO market_rants_v1 (id, content, created_at) VALUES (?, ?, ?)');
  const insertImage = db.prepare('INSERT INTO market_rant_images_v1 (id, rant_id, name, mime_type, size, sort_order, content) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const getImage = db.prepare('SELECT mime_type AS mimeType, content FROM market_rant_images_v1 WHERE rant_id = ? AND id = ?');
  return {
    list() {
      // Keep metadata consistent without loading any screenshot BLOBs into the timeline response.
      db.exec('BEGIN');
      try {
        const rants = listRants.all().map((rant) => ({ ...rant, images: [] }));
        const byId = new Map(rants.map((rant) => [rant.id, rant]));
        for (const image of listImages.all()) byId.get(image.rantId)?.images.push(imageMetadata(image.rantId, image));
        db.exec('COMMIT');
        return rants;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    create(content, files) {
      if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
        throw publicError(400, '吐槽正文必须是最多 2000 字的文本。');
      }
      if (files.length > MAX_IMAGES) throw publicError(400, '每条吐槽最多保存 4 张图片。');
      const images = validateImages(files);
      content = content.trim();
      if (!content && !images.length) throw publicError(400, '请写下吐槽或添加至少一张图片。');
      const rant = { id: randomUUID(), content, createdAt: new Date().toISOString() };
      db.exec('BEGIN IMMEDIATE');
      try {
        insertRant.run(rant.id, rant.content, rant.createdAt);
        images.forEach((image, index) => insertImage.run(image.id, rant.id, image.name, image.mimeType, image.size, index, image.buffer));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { ...rant, images: images.map((image) => imageMetadata(rant.id, image)) };
    },
    getImage(rantId, imageId) { return getImage.get(rantId, imageId) ?? null; },
  };
}

export function createMarketRantsRouter(store) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    // Multipart parser limits are exclusive at equality; store validation keeps the advertised boundary inclusive.
    limits: { fileSize: MAX_IMAGE_SIZE + 1, files: MAX_IMAGES, fields: 1, fieldSize: 16 * 1024, parts: MAX_IMAGES + 2 },
    fileFilter: (_req, file, done) => {
      if (!imageTypes.has(file.mimetype)) return done(publicError(400, '图片仅支持 PNG、JPEG 和 WebP 格式。'));
      done(null, true);
    },
  }).array('images', MAX_IMAGES);
  const readUpload = (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(publicError(400, '请使用 multipart/form-data 发布吐槽。'));
    upload(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') return next(publicError(413, '每张图片不能超过 5 MB。'));
        if (['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_PART_COUNT'].includes(error.code)) {
          return next(publicError(400, '每条吐槽最多 4 张图片，正文请使用 content 字段，图片请使用 images 字段。'));
        }
        return next(publicError(400, '吐槽字段不符合要求或正文过长，请缩短后重试。'));
      }
      if (error) return next(error.status ? error : publicError(400, '上传请求不完整，请重新选择图片后发布。'));
      next();
    });
  };
  router.get('/', (_req, res) => res.json({ rants: store.list() }));
  router.post('/', readUpload, (req, res) => {
    if (typeof req.body?.content !== 'string' || Object.keys(req.body).some((key) => key !== 'content')) {
      throw publicError(400, '请通过唯一的 content 字段提交正文；纯图片吐槽的正文可为空。');
    }
    res.status(201).json({ rant: store.create(req.body.content, req.files ?? []) });
  });
  router.get('/:rantId/images/:imageId', (req, res) => {
    const image = store.getImage(req.params.rantId, req.params.imageId);
    if (!image) throw publicError(404, '未找到这张吐槽图片。');
    const content = Buffer.from(image.content);
    res.set('Content-Type', image.mimeType);
    res.set('Content-Length', String(content.length));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
    res.send(content);
  });
  return router;
}
