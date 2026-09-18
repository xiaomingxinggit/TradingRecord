import multer from 'multer';
import { MAX_IMAGE_SIZE, imageTypes, validateImages } from './images.mjs';
import { recognizeOrders } from './order-ocr.mjs';

const publicError = (status, message) => Object.assign(new Error(message), { status });

export function mountOrderOcr(app) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_SIZE + 1, files: 1, fields: 0, parts: 2 },
    fileFilter: (_req, file, done) => {
      if (!imageTypes.has(file.mimetype)) return done(publicError(400, '订单截图仅支持 PNG、JPEG 和 WebP。'));
      done(null, true);
    },
  }).single('image');
  app.post('/api/order-ocr', (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(publicError(400, '请通过 image 字段上传一张订单截图。'));
    upload(req, res, async error => {
      if (error instanceof multer.MulterError) {
        return next(publicError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          error.code === 'LIMIT_FILE_SIZE' ? '订单截图不能超过 5 MB。' : '每次只能上传一张订单截图。'));
      }
      if (error) return next(error.status ? error : publicError(400, '订单截图上传不完整。'));
      try {
        if (!req.file) throw publicError(400, '请选择一张订单截图。');
        const [image] = validateImages([req.file]);
        res.json(await recognizeOrders(image.buffer));
      } catch (problem) {
        if (problem?.status) return next(problem);
        next(publicError(422, '订单截图识别失败，请确认图片为清晰的完整宽度 MT5 单行截图后重试。'));
      }
    });
  });
}
