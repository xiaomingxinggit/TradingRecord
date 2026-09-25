import { randomUUID } from 'node:crypto';
import { Router, json } from 'express';
import multer from 'multer';
import { MAX_IMAGE_SIZE, MAX_IMAGES, imageTypes, validateImages } from './images.mjs';

const MAX_CONTENT_LENGTH = 2000;
const MAX_REPLY_LENGTH = 500;
const PAGE_SIZE = 10;
const publicError = (status, message) => Object.assign(new Error(message), { status });
const imageMetadata = (rantId, image) => ({
  id: image.id, name: image.name, mimeType: image.mimeType, size: image.size,
  url: `/api/market-rants/${encodeURIComponent(rantId)}/images/${encodeURIComponent(image.id)}`,
});
const replyImageMetadata = (rantId, replyId, image) => ({
  id: image.id, name: image.name, mimeType: image.mimeType, size: image.size,
  url: `/api/market-rants/${encodeURIComponent(rantId)}/replies/${encodeURIComponent(replyId)}/images/${encodeURIComponent(image.id)}`,
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
    CREATE TABLE IF NOT EXISTS market_rant_replies_v1 (
      id TEXT PRIMARY KEY,
      rant_id TEXT NOT NULL REFERENCES market_rants_v1(id),
      content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 500),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS market_rant_replies_rant_created_v1
      ON market_rant_replies_v1(rant_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS market_rant_reply_images_v1 (
      id TEXT PRIMARY KEY,
      reply_id TEXT NOT NULL REFERENCES market_rant_replies_v1(id),
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      size INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
      sort_order INTEGER NOT NULL CHECK (sort_order >= 0 AND sort_order < 4),
      content BLOB NOT NULL,
      UNIQUE (reply_id, sort_order)
    );
    CREATE INDEX IF NOT EXISTS market_rant_reply_images_reply_v1 ON market_rant_reply_images_v1(reply_id, sort_order);
  `);
  const countRants = db.prepare('SELECT COUNT(*) AS total FROM market_rants_v1');
  const listRants = db.prepare('SELECT id, content, created_at AS createdAt FROM market_rants_v1 ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?');
  const insertRant = db.prepare('INSERT INTO market_rants_v1 (id, content, created_at) VALUES (?, ?, ?)');
  const insertImage = db.prepare('INSERT INTO market_rant_images_v1 (id, rant_id, name, mime_type, size, sort_order, content) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const getImage = db.prepare('SELECT mime_type AS mimeType, content FROM market_rant_images_v1 WHERE rant_id = ? AND id = ?');
  const getRant = db.prepare('SELECT id FROM market_rants_v1 WHERE id = ?');
  const insertReply = db.prepare('INSERT INTO market_rant_replies_v1 (id, rant_id, content, created_at) VALUES (?, ?, ?, ?)');
  const insertReplyImage = db.prepare('INSERT INTO market_rant_reply_images_v1 (id, reply_id, name, mime_type, size, sort_order, content) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const getReplyImage = db.prepare('SELECT i.mime_type AS mimeType, i.content FROM market_rant_reply_images_v1 i JOIN market_rant_replies_v1 r ON r.id = i.reply_id WHERE r.rant_id = ? AND r.id = ? AND i.id = ?');
  return {
    list(requestedPage) {
      // Count, page, images and replies share one snapshot; screenshot BLOBs stay out of the response.
      db.exec('BEGIN');
      try {
        const total = countRants.get().total;
        const totalPages = Math.ceil(total / PAGE_SIZE);
        const page = Math.min(requestedPage, Math.max(totalPages, 1));
        const rants = listRants.all(PAGE_SIZE, (page - 1) * PAGE_SIZE)
          .map((rant) => ({ ...rant, images: [], replies: [], replyCount: 0 }));
        const byId = new Map(rants.map((rant) => [rant.id, rant]));
        if (rants.length) {
          const placeholders = rants.map(() => '?').join(', ');
          const images = db.prepare(`SELECT id, rant_id AS rantId, name, mime_type AS mimeType, size FROM market_rant_images_v1 WHERE rant_id IN (${placeholders}) ORDER BY rant_id, sort_order`).all(...byId.keys());
          const replies = db.prepare(`SELECT id, rant_id AS rantId, content, created_at AS createdAt FROM market_rant_replies_v1 WHERE rant_id IN (${placeholders}) ORDER BY created_at ASC, rowid ASC`).all(...byId.keys());
          for (const image of images) byId.get(image.rantId).images.push(imageMetadata(image.rantId, image));
          const replyById = new Map();
          for (const reply of replies) {
            const rant = byId.get(reply.rantId);
            // Pure-image replies use one storage-only space to satisfy the old table CHECK.
            reply.content = reply.content.trim();
            reply.images = [];
            rant.replies.push(reply);
            rant.replyCount++;
            replyById.set(reply.id, reply);
          }
          const replyImages = db.prepare(`SELECT i.id, i.reply_id AS replyId, r.rant_id AS rantId, i.name, i.mime_type AS mimeType, i.size FROM market_rant_reply_images_v1 i JOIN market_rant_replies_v1 r ON r.id = i.reply_id WHERE r.rant_id IN (${placeholders}) ORDER BY i.reply_id, i.sort_order`).all(...byId.keys());
          for (const image of replyImages) replyById.get(image.replyId)?.images.push(replyImageMetadata(image.rantId, image.replyId, image));
        }
        db.exec('COMMIT');
        return { rants, page, pageSize: PAGE_SIZE, total, totalPages };
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
      return { ...rant, images: images.map((image) => imageMetadata(rant.id, image)), replies: [], replyCount: 0 };
    },
    reply(rantId, content, files = []) {
      if (typeof content !== 'string') throw publicError(400, '回复正文必须是文本。');
      content = content.trim();
      if (content.length > MAX_REPLY_LENGTH) throw publicError(400, '回复文字不能超过 500 字。');
      if (files.length > MAX_IMAGES) throw publicError(400, '每条回复最多保存 4 张图片。');
      const images = validateImages(files);
      if (!content && !images.length) throw publicError(400, '请写下回复或添加至少一张图片。');
      const reply = { id: randomUUID(), rantId, content, createdAt: new Date().toISOString() };
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!getRant.get(rantId)) throw publicError(404, '未找到这条行情吐槽。');
        // The existing reply table requires nonempty content; only validated pure-image replies use a storage-only space.
        insertReply.run(reply.id, rantId, content || ' ', reply.createdAt);
        images.forEach((image, index) => insertReplyImage.run(image.id, reply.id, image.name, image.mimeType, image.size, index, image.buffer));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { ...reply, images: images.map((image) => replyImageMetadata(rantId, reply.id, image)) };
    },
    getImage(rantId, imageId) { return getImage.get(rantId, imageId) ?? null; },
    getReplyImage(rantId, replyId, imageId) { return getReplyImage.get(rantId, replyId, imageId) ?? null; },
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
  const readReplyUpload = (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(publicError(400, '请使用 multipart/form-data 或 JSON 提交回复。'));
    upload(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') return next(publicError(413, '每张回复图片不能超过 5 MB。'));
        if (['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_PART_COUNT'].includes(error.code)) {
          return next(publicError(400, '每条回复最多 4 张图片，文字请使用 content 字段，图片请使用 images 字段。'));
        }
        return next(publicError(400, '回复字段不符合要求或文字过长，请缩短后重试。'));
      }
      if (error) return next(error.status ? error : publicError(400, '上传请求不完整，请重新选择图片后回复。'));
      next();
    });
  };
  router.get('/', (req, res) => {
    const rawPage = req.query.page ?? '1';
    if (typeof rawPage !== 'string' || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage))) {
      throw publicError(400, '页码必须是正整数。');
    }
    res.json(store.list(Number(rawPage)));
  });
  router.post('/', readUpload, (req, res) => {
    if (typeof req.body?.content !== 'string' || Object.keys(req.body).some((key) => key !== 'content')) {
      throw publicError(400, '请通过唯一的 content 字段提交正文；纯图片吐槽的正文可为空。');
    }
    res.status(201).json({ rant: store.create(req.body.content, req.files ?? []) });
  });
  router.post('/:rantId/replies', (req, res, next) => {
    if (req.is('application/json')) return json({ limit: '4kb' })(req, res, next);
    readReplyUpload(req, res, next);
  }, (req, res) => {
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).some((key) => key !== 'content')
      || (req.body.content !== undefined && typeof req.body.content !== 'string')
      || (req.is('application/json') && Object.keys(req.body).length !== 1)) {
      throw publicError(400, '回复只接受 content 文字字段与最多 4 个 images 图片；纯图片回复的文字可为空。');
    }
    res.status(201).json({ reply: store.reply(req.params.rantId, req.body.content ?? '', req.files ?? []) });
  });
  router.get('/:rantId/replies/:replyId/images/:imageId', (req, res) => {
    const image = store.getReplyImage(req.params.rantId, req.params.replyId, req.params.imageId);
    if (!image) throw publicError(404, '未找到这张回复图片。');
    const content = Buffer.from(image.content);
    res.set('Content-Type', image.mimeType);
    res.set('Content-Length', String(content.length));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
    res.send(content);
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
