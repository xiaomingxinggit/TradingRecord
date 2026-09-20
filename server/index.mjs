import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createPlansRouter } from './plans.mjs';
import { createPlanOrdersRouter } from './plan-orders.mjs';
import { createPlanEventsRouter } from './plan-events-router.mjs';
import { createPlanReviewsRouter } from './plan-reviews-router.mjs';
import { mountOrderOcr } from './order-ocr-route.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicError = (status, message) => Object.assign(new Error(message), { status });

export function createApp({ dataDir = join(projectDir, 'data') } = {}) {
  const app = express();
  app.locals.store = createStore(dataDir);
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin) {
      try {
        if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
          return next(publicError(403, '只允许本机页面访问计划数据。'));
        }
      } catch {
        return next(publicError(403, '请求来源无效。'));
      }
    }
    next();
  });
  mountOrderOcr(app);
  app.get('/api/overview', (_req, res) => res.json(app.locals.store.overview.get()));
  app.use('/api/plans/:planId/orders', createPlanOrdersRouter(app.locals.store.orders));
  app.use('/api/plans/:planId/events', createPlanEventsRouter(app.locals.store.events));
  app.use('/api/plans/:planId/review', createPlanReviewsRouter(app.locals.store.reviews));
  app.use('/api/plans', createPlansRouter(app.locals.store.plans));
  app.use('/api', (_req, _res, next) => next(publicError(404, '接口不存在。')));

  const distDir = join(projectDir, 'dist');
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res, next) => {
    res.sendFile(join(distDir, 'index.html'), (error) => {
      if (error) next(publicError(404, '前端尚未构建，请运行 npm run dev 或 npm run build。'));
    });
  });
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '请求的 JSON 格式无效。' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求内容过大，请缩短文字后重试。' });
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? '处理失败，请稍后重试。' : error.message });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3001);
  const app = createApp();
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`开仓计划服务：http://127.0.0.1:${port}`);
  });
  const shutdown = () => server.close(() => { app.locals.store.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
