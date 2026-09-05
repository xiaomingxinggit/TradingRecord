import express from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { parseReport } from './parser.mjs';
import { createPlansRouter } from './plans.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const extensions = new Set(['.html', '.htm', '.xlsx']);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const supported = (filename) => extensions.has(extname(filename).toLowerCase());
const publicError = (status, message) => Object.assign(new Error(message), { status });
const fingerprint = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function listRootFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.isFile() && supported(entry.name)
    && entry.name.toLowerCase() !== 'index.html').map(async (entry) => ({
    name: entry.name, size: (await stat(join(rootDir, entry.name))).size,
  })));
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function validateNote(body, previous) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw publicError(400, '复盘内容必须是 JSON 对象。');
  const allowed = new Set(['strategy', 'tags', 'rating', 'content']);
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.has(key))) {
    throw publicError(400, '请提供 strategy、tags、rating 或 content 字段。');
  }
  const note = { ...previous, ...body };
  if (typeof note.strategy !== 'string' || note.strategy.length > 120) throw publicError(400, '策略名称不能超过 120 字。');
  if (typeof note.content !== 'string' || note.content.length > 10000) throw publicError(400, '复盘内容不能超过 10000 字。');
  if (!Number.isInteger(note.rating) || note.rating < 0 || note.rating > 5) throw publicError(400, '评分必须是 0 到 5 的整数。');
  if (!Array.isArray(note.tags) || note.tags.length > 20
    || note.tags.some((tag) => typeof tag !== 'string' || tag.length > 40)) {
    throw publicError(400, '最多添加 20 个标签，每个标签不能超过 40 字。');
  }
  return { strategy: note.strategy.trim(), tags: [...new Set(note.tags.map((tag) => tag.trim()).filter(Boolean))],
    rating: note.rating, content: note.content };
}

export function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Escape spreadsheet formulas in imported comments, strategy names and other text.
  if (typeof value === 'string' && (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportCsv(trades) {
  const columns = [
    ['账户', (t) => t.accountId], ['交易编号', (t) => t.ticket], ['品种', (t) => t.symbol],
    ['方向', (t) => t.side], ['手数', (t) => t.volume], ['开仓时间', (t) => t.openTime],
    ['平仓时间', (t) => t.closeTime], ['开仓价格', (t) => t.openPrice], ['平仓价格', (t) => t.closePrice],
    ['止损', (t) => t.stopLoss], ['止盈', (t) => t.takeProfit], ['佣金', (t) => t.commission],
    ['隔夜利息', (t) => t.swap], ['费用', (t) => t.fees], ['交易盈亏', (t) => t.profit],
    ['净盈亏', (t) => t.netProfit], ['原始备注', (t) => t.comment], ['策略', (t) => t.note.strategy],
    ['标签', (t) => t.note.tags.join(' | ')], ['评分', (t) => t.note.rating], ['复盘笔记', (t) => t.note.content],
    ['来源文件', (t) => t.sourceFile],
  ];
  return '\uFEFF' + [columns.map(([name]) => csvCell(name)).join(','),
    ...trades.map((trade) => columns.map(([, read]) => csvCell(read(trade))).join(','))].join('\r\n') + '\r\n';
}

export async function createApp({ dataDir = join(projectDir, 'data'), rootDir = projectDir,
  autoImport = true, parser = parseReport } = {}) {
  const app = express();
  const store = createStore(dataDir);
  app.locals.store = store;
  app.locals.startupWarnings = [];
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
          return next(publicError(403, '只允许本机页面访问交易数据。'));
        }
      } catch {
        return next(publicError(403, '请求来源无效。'));
      }
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  async function importBuffer(buffer, filename, skipUnchanged = false) {
    const hash = fingerprint(buffer);
    if (skipUnchanged && store.hasImported(filename, hash)) return null;
    const report = await parser(buffer, filename);
    return store.importReport(report, filename, hash);
  }

  async function importRoot(skipUnchanged = false) {
    const files = [];
    const warnings = [];
    const rootFiles = await listRootFiles(rootDir);
    for (const file of rootFiles) {
      try {
        if (file.size > MAX_FILE_SIZE) throw new Error('文件超过 20 MB 限制。');
        const buffer = await readFile(join(rootDir, file.name));
        if (buffer.length > MAX_FILE_SIZE) throw new Error('文件超过 20 MB 限制。');
        const result = await importBuffer(buffer, file.name, skipUnchanged);
        if (result) {
          files.push(result);
          warnings.push(...result.warnings.map((warning) => `${file.name}：${warning}`));
        }
      } catch (error) {
        warnings.push(`${file.name}：${error.message}`);
      }
    }
    return { addedCount: files.reduce((sum, file) => sum + file.addedCount, 0),
      updatedCount: files.reduce((sum, file) => sum + file.updatedCount, 0),
      duplicateCount: files.reduce((sum, file) => sum + file.duplicateCount, 0), files, warnings };
  }

  app.get('/api/data', asyncRoute(async (_req, res) => {
    const rootFiles = await listRootFiles(rootDir);
    res.json({ ...store.getData(), rootFiles, warnings: app.locals.startupWarnings });
  }));
  app.post('/api/import-root', asyncRoute(async (_req, res) => {
    const result = await importRoot();
    app.locals.startupWarnings = result.warnings;
    res.json(result);
  }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 10, fields: 0 },
    fileFilter: (_req, file, done) => {
      if (!supported(file.originalname)) return done(publicError(400, '仅支持 MT5 导出的 HTML、HTM 和 XLSX 文件。'));
      done(null, true);
    },
  });
  app.post('/api/import', upload.array('files', 10), asyncRoute(async (req, res) => {
    if (!req.files?.length) throw publicError(400, '请选择至少一个报告文件。');
    const files = [];
    const warnings = [];
    for (const file of req.files) {
      // Multer strips paths by default; also normalize both separators for stored filenames.
      const filename = basename(file.originalname.replaceAll('\\', '/'));
      try {
        const result = await importBuffer(file.buffer, filename);
        files.push(result);
        warnings.push(...result.warnings.map((warning) => `${filename}：${warning}`));
      } catch (error) {
        warnings.push(`${filename}：${error.message}`);
      }
    }
    res.status(files.length ? 200 : 422).json({
      addedCount: files.reduce((sum, file) => sum + file.addedCount, 0),
      updatedCount: files.reduce((sum, file) => sum + file.updatedCount, 0),
      duplicateCount: files.reduce((sum, file) => sum + file.duplicateCount, 0), files, warnings,
      ...(files.length ? {} : { error: `报告解析失败或无法导入：${warnings.join('；')}` }),
    });
  }));
  app.put('/api/trades/:id/note', (req, res, next) => {
    try {
      const trade = store.getTrade(req.params.id);
      if (!trade) throw publicError(404, '未找到这笔交易。');
      const note = store.updateNote(req.params.id, validateNote(req.body, trade.note));
      res.json({ id: trade.id, note });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/export', (_req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="trading-records.csv"');
    res.send(exportCsv(store.getData().trades));
  });
  app.use('/api/plans', createPlansRouter(store.plans));
  app.use('/api', (_req, _res, next) => next(publicError(404, '接口不存在。')));
  const distDir = join(projectDir, 'dist');
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res, next) => {
    res.sendFile(join(distDir, 'index.html'), (error) => {
      if (error) next(publicError(404, '前端尚未构建，请运行 npm run dev 或 npm run build。'));
    });
  });
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? '每个文件不能超过 20 MB。'
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? '一次最多上传 10 个文件，请使用 files 字段。' : '上传请求不符合要求。';
      return res.status(400).json({ error: message });
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式无效。' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求内容过大。' });
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? '处理失败，请检查报告格式或稍后重试。' : error.message });
  });

  if (autoImport) {
    try {
      const result = await importRoot(true);
      app.locals.startupWarnings = result.warnings;
      if (result.files.length) console.log(`已导入 ${result.files.length} 份报告，新增 ${result.addedCount} 笔，更新 ${result.updatedCount} 笔交易。`);
    } catch (error) {
      app.locals.startupWarnings = [`根目录扫描失败：${error.message}`];
    }
  }
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3001);
  const app = await createApp();
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`交易记录服务：http://127.0.0.1:${port}`);
  });
  const shutdown = () => server.close(() => { app.locals.store.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
