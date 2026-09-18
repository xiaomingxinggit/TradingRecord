import { Router, json } from 'express';
import multer from 'multer';
import { MAX_IMAGES, MAX_IMAGE_SIZE, imageTypes } from './images.mjs';

const error = (status, message) => Object.assign(new Error(message), { status });

export function createOrdersRouter(store, plans) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_SIZE + 1, files: MAX_IMAGES, fields: 1, fieldSize: 64 * 1024, parts: MAX_IMAGES + 2 },
    fileFilter: (_req, file, done) => done(imageTypes.has(file.mimetype) ? null : error(400, '图片仅支持 PNG、JPEG 和 WebP。'), true),
  }).array('images', MAX_IMAGES);
  const readUpload = (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(error(400, '请使用 multipart/form-data 提交过程记录。'));
    upload(req, res, problem => {
      if (problem instanceof multer.MulterError) return next(error(problem.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
        problem.code === 'LIMIT_FILE_SIZE' ? '每张图片不能超过 5 MB。' : '每次最多添加 4 张图片，文字请使用 payload 字段。'));
      if (problem) return next(problem.status ? problem : error(400, '过程上传不完整，请重试。'));
      next();
    });
  };
  const withPlan = result => ({ ...result, ...(result.order.planId ? { plan: plans.get(result.order.planId) } : {}) });
  router.get('/', (_req, res) => res.json(store.listSnapshot()));
  router.post('/', json({ limit: '32kb' }), (req, res) => res.json(withPlan(store.confirm(req.body))));
  router.get('/:id', (req, res) => {
    const order = store.get(req.params.id);
    res.json({ order, plan: order.planId ? plans.get(order.planId) : null });
  });
  router.post('/:id/observations', json({ limit: '32kb' }), (req, res) => res.json(withPlan(store.confirm(req.body, req.params.id))));
  router.patch('/:id/plan', json({ limit: '16kb' }), (req, res) => res.json(withPlan(store.associate(req.params.id, req.body))));
  router.get('/:id/process', (req, res) => res.json(store.process(req.params.id)));
  router.post('/:id/process', readUpload, (req, res) => {
    if (typeof req.body?.payload !== 'string' || Object.keys(req.body).some(key => key !== 'payload')) throw error(400, '请通过 payload 字段提交过程记录。');
    let body;
    try { body = JSON.parse(req.body.payload); } catch { throw error(400, '过程记录 JSON 格式无效。'); }
    res.json(store.appendProcess(req.params.id, body, req.files ?? []));
  });
  router.get('/:id/process/:eventId/images/:imageId', (req, res) => {
    const image = store.processImage(req.params.id, req.params.eventId, req.params.imageId);
    if (!image) throw error(404, '未找到这张订单过程图片。');
    res.set('Content-Type', image.mimeType);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
    res.send(Buffer.from(image.content));
  });
  router.get('/:id/review', (req, res) => res.json(store.review(req.params.id)));
  router.put('/:id/review', json({ limit: '96kb' }), (req, res) => res.json(store.saveReview(req.params.id, req.body)));
  return router;
}
