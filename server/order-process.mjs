import { createHash, randomUUID } from 'node:crypto';
import { validateImages } from './images.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, label, limit) => {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > limit) fail(400, `${label}必须是 ${limit} 字以内的文字。`);
  return value.trim();
};
const price = value => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(400, '价位必须为正有限数或空值。');
  return value;
};
const digest = value => createHash('sha256').update(value).digest('hex');

export function createOrderProcessStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tr_order_process_v1 (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL REFERENCES tr_orders_v1(id),
      request_id TEXT NOT NULL, signature TEXT NOT NULL, payload TEXT NOT NULL, recorded_at TEXT NOT NULL, UNIQUE(order_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS tr_order_process_images_v1 (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES tr_order_process_v1(id), name TEXT NOT NULL, mime_type TEXT NOT NULL,
      size INTEGER NOT NULL, position INTEGER NOT NULL, content BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tr_order_process_images_event_v1 ON tr_order_process_images_v1(event_id);
  `);
  const events = db.prepare('SELECT * FROM tr_order_process_v1 WHERE order_id = ? ORDER BY sequence');
  const prior = db.prepare('SELECT * FROM tr_order_process_v1 WHERE order_id = ? AND request_id = ?');
  const images = db.prepare('SELECT id, name, mime_type AS mimeType, size FROM tr_order_process_images_v1 WHERE event_id = ? ORDER BY position');
  const exportImages = db.prepare('SELECT id, name, mime_type AS mimeType, size, content FROM tr_order_process_images_v1 WHERE event_id = ? ORDER BY position');
  const readImage = db.prepare(`SELECT i.mime_type AS mimeType, i.content FROM tr_order_process_images_v1 i
    JOIN tr_order_process_v1 e ON e.id = i.event_id WHERE e.order_id = ? AND e.id = ? AND i.id = ?`);
  const insert = db.prepare('INSERT INTO tr_order_process_v1 (id, order_id, request_id, signature, payload, recorded_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertImage = db.prepare('INSERT INTO tr_order_process_images_v1 (id, event_id, name, mime_type, size, position, content) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const hydrate = (row, exporting = false) => ({ ...JSON.parse(row.payload), id: row.id, recordedAt: row.recorded_at,
    images: (exporting ? exportImages : images).all(row.id).map(image => ({ ...image,
      url: `/api/orders/${encodeURIComponent(row.order_id)}/process/${encodeURIComponent(row.id)}/images/${encodeURIComponent(image.id)}` })) });
  return {
    list(id, exporting = false) { return events.all(id).map(row => hydrate(row, exporting)); },
    image(orderId, eventId, imageId) { return readImage.get(orderId, eventId, imageId) ?? null; },
    append(orderId, body, files, now) {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['requestId', 'type', 'entryPrice', 'stopLoss', 'takeProfit', 'emotion', 'note'].includes(key))) fail(400, '过程记录包含不支持的字段。');
      const requestId = text(body.requestId, '请求编号', 100);
      if (!requestId) fail(400, '请求编号不能为空。');
      if (!['price', 'emotion', 'note'].includes(body.type)) fail(400, '请选择价位、情绪或判断记录。');
      const data = { type: body.type, entryPrice: price(body.entryPrice), stopLoss: price(body.stopLoss), takeProfit: price(body.takeProfit),
        emotion: text(body.emotion, '情绪', 20), note: text(body.note, '过程记录', 5000) };
      if (data.type !== 'price' && [data.entryPrice, data.stopLoss, data.takeProfit].some(value => value !== null)) fail(400, '情绪或判断记录不能修改价位。');
      if (data.type === 'emotion' && !['平静', '焦虑', '恐惧', '贪婪', '急躁', '其他'].includes(data.emotion)) fail(400, '请选择有效情绪。');
      if (data.type !== 'emotion' && data.emotion) fail(400, '请通过情绪记录保存情绪。');
      const checkedImages = validateImages(files);
      if (data.type === 'note' && !data.note && !checkedImages.length) fail(400, '判断记录至少填写文字或添加一张图片。');
      const signature = digest(JSON.stringify({ ...data, images: checkedImages.map(image => ({ name: image.name,
        mimeType: image.mimeType, size: image.size, hash: digest(image.buffer) })) }));
      const existing = prior.get(orderId, requestId);
      if (existing) {
        if (existing.signature !== signature) fail(409, '此请求编号已保存不同的文字或图片，请核对后重试。');
        return { event: hydrate(existing), changed: false };
      }
      const id = randomUUID();
      insert.run(id, orderId, requestId, signature, JSON.stringify(data), now);
      checkedImages.forEach((image, index) => insertImage.run(image.id, id, image.name, image.mimeType, image.size, index, image.buffer));
      return { event: hydrate(prior.get(orderId, requestId)), changed: true };
    },
  };
}
