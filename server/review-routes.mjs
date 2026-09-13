import { Router, json } from 'express';
import { basename, extname } from 'node:path';
import multer from 'multer';
import { parseReport } from './review-parser.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function createReviewsRouter(store) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 + 1, files: 1, fields: 0, parts: 2 },
    fileFilter: (_req, file, done) => done(['.html', '.htm', '.xlsx'].includes(extname(file.originalname).toLowerCase()) ? null : fail(400, '报告仅支持 HTML、HTM 或 XLSX。'), true),
  }).single('report');
  let importing = false;
  router.post('/import', (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(fail(400, '请上传 MT5 报告文件。'));
    if (importing) return next(fail(409, '另一份报告正在解析，请稍后重试。'));
    importing = true;
    let finished = false, parsing = false, aborted = false;
    const release = () => { if (!finished) { finished = true; importing = false; } };
    const abort = () => { if (!res.writableEnded) { aborted = true; if (!parsing) release(); } };
    req.once('aborted', abort);
    res.once('close', abort);
    upload(req, res, async error => {
      try {
        if (aborted) return;
        parsing = true;
        if (error) throw error.status ? error : fail(400, error.code === 'LIMIT_FILE_SIZE' ? '报告不能超过 25 MB。' : '请一次上传一份报告，字段名称为 report。');
        if (!req.file) throw fail(400, '请选择报告文件。');
        let filename = req.file.originalname;
        if ([...filename].every(char => char.codePointAt(0) <= 255)) {
          try { filename = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(filename, 'latin1')); } catch { /* Keep the original filename. */ }
        }
        filename = basename(filename.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
        let report;
        try { report = await parseReport(req.file.buffer, filename); }
        catch (parseError) { throw fail(422, parseError.message); }
        if (aborted) return;
        res.json(store.importReport(report));
      } catch (failure) { next(failure); }
      finally { release(); req.off('aborted', abort); res.off('close', abort); }
    });
  });
  // Accommodate 100 association notes of up to 300 Chinese characters each.
  router.use(json({ limit: '192kb' }));
  router.get('/', (_req, res) => res.json(store.workspace()));
  router.get('/plans/:id', (req, res) => res.json(store.detail(req.params.id)));
  router.put('/plans/:id/summary', (req, res) => res.json(store.saveReview(req.params.id, req.body)));
  router.post('/links', (req, res) => res.json(store.link(req.body)));
  router.post('/links/move', (req, res) => res.json(store.move(req.body)));
  router.patch('/links/:id', (req, res) => res.json(store.editLink(req.params.id, req.body)));
  router.delete('/links/:id', (req, res) => res.json(store.unlink(req.params.id, req.body)));
  return router;
}
