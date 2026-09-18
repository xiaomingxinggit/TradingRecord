import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import english from '@tesseract.js-data/eng';
import multer from 'multer';
import { recognizeOrders } from './order-ocr.mjs';

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
// Fixed positions in the supplied 2533px-wide MT5 positions screenshot.
// Deliberately exclude the second price column (current market price).
const baseColumns = { side: [0.30, 0.387], entryPrice: [0.50, 0.587], stopLoss: [0.60, 0.680], takeProfit: [0.70, 0.780] };

export async function recognizePrices(buffer) {
  let pixels, info;
  try {
    ({ data: pixels, info } = await sharp(buffer, { limitInputPixels: 12_000_000 })
      .flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true }));
  } catch { throw fail('图片无法读取，请使用 PNG、JPEG 或 WEBP 截图。'); }
  const { width, height } = info;
  if (width < 1000 || width > 6000 || height < 12 || height > 1000) throw fail('请截取完整宽度的持仓行，保持示例的列布局。');
  // The combined positions/orders view has an extra left gutter. Locate the
  // symbol/order separator so both supplied layouts use the same column map.
  let separator = Math.round(width * 0.1295), best = 0;
  for (let x = Math.floor(width * 0.12); x < width * 0.15; x++) {
    let score = 0;
    for (let y = 0; y < height; y++) {
      const p = pixels[y * width + x];
      if (p > 140 && p < 225 && pixels[y * width + x - 1] > p + 10 && pixels[y * width + x + 1] > p + 10) score++;
    }
    if (score > best) { best = score; separator = x; }
  }
  const offset = best > height * 0.5 ? Math.max(0, (separator / width - 0.1295) / 0.8705) : 0;
  const columns = Object.fromEntries(Object.entries(baseColumns).map(([key, bounds]) => [key, bounds.map(x => offset + x * (1 - offset))]));
  const left = Math.round(width * columns.entryPrice[0]), right = Math.round(width * columns.entryPrice[1]);
  const bands = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    let ink = 0;
    if (y < height) for (let x = left; x < right; x++) if (pixels[y * width + x] < 160) ink++;
    // Reject horizontal grid lines; text has both light and dark pixels.
    const active = ink >= 2 && ink < (right - left) * 0.7;
    if (active && start < 0) start = y;
    if (!active && start >= 0) { if (y - start >= 5) bands.push([start, y]); start = -1; }
  }
  if (!bands.length || bands.length > 21) throw fail('未找到清晰的持仓行，一次最多识别 20 行。');
  const worker = await createWorker('eng', 1, { langPath: english.langPath, gzip: true, cacheMethod: 'none' });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const read = async (key, top, bottom) => {
      const [from, to] = columns[key];
      const x = Math.round(from * width), w = Math.round(to * width) - x;
      const y = Math.max(0, top - 2), h = Math.min(height, bottom + 2) - y;
      let ink = 0;
      for (let yy = top; yy < bottom; yy++) for (let xx = x; xx < x + w; xx++) if (pixels[yy * width + xx] < 160) ink++;
      if (ink < 3) return { text: '', confidence: 100 };
      const crop = await sharp(pixels, { raw: { width, height, channels: 1 } })
        .extract({ left: x, top: y, width: w, height: h }).resize(w * 4, h * 4)
        .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#fff' }).png().toBuffer();
      return (await worker.recognize(crop)).data;
    };
    const rows = [];
    for (const [top, bottom] of bands) {
      const direction = await read('side', top, bottom);
      const orderType = direction.text.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!/^(buy|sell)( limit| stop| stop limit)?$/.test(orderType)) continue;
      const side = orderType.startsWith('buy') ? 'buy' : 'sell';
      const row = { side, orderType, entryPrice: null, stopLoss: null, takeProfit: null };
      for (const key of ['entryPrice', 'stopLoss', 'takeProfit']) {
        const result = await read(key, top, bottom);
        const value = result.text.trim();
        if (!value && key !== 'entryPrice' && result.confidence === 100) continue;
        if (!/^\d+(?:\.\d+)?$/.test(value) || result.confidence < 65 || Number(value) <= 0) {
          throw fail('有价位无法可靠识别，请使用清晰的原始截图，或手动填写。');
        }
        row[key] = Number(value);
      }
      rows.push(row);
    }
    if (!rows.length) throw fail('未识别到持仓或挂单，请保留完整列宽及交易类型列。');
    return rows;
  } finally { await worker.terminate(); }
}

export function mountPriceOcr(app) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
  let busy = false;
  app.post('/api/price-ocr', (req, res, next) => {
    upload.single('image')(req, res, async (error) => {
      if (error) return next(fail('请上传一张不超过 5 MB 的图片。', 400));
      if (!req.file || !['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) return next(fail('请选择 PNG、JPEG 或 WEBP 图片。', 400));
      if (busy) return next(fail('正在识别另一张图片，请稍后重试。', 429));
      busy = true;
      try { res.json({ rows: await recognizePrices(req.file.buffer) }); }
      catch (e) { next(e); }
      finally { busy = false; }
    });
  });
  // Both OCR endpoints share this lock: separate workers must not contend for
  // local CPU/memory when a price request and an order request arrive together.
  app.post('/api/order-ocr/:mode', (req, res, next) => {
    if (!['pending', 'open', 'closed'].includes(req.params.mode)) return next(fail('请选择挂单、持仓或已平仓识别模式。', 400));
    upload.single('image')(req, res, async (error) => {
      if (error) return next(fail('请上传一张不超过 5 MB 的图片。', 400));
      if (!req.file || !['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) return next(fail('请选择 PNG、JPEG 或 WEBP 图片。', 400));
      if (busy) return next(fail('正在识别另一张图片，请稍后重试。', 429));
      busy = true;
      try { res.json(await recognizeOrders(req.file.buffer, req.params.mode)); }
      catch (e) { next(e); }
      finally { busy = false; }
    });
  });
}
