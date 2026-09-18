import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;
export const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const publicError = (status, message) => Object.assign(new Error(message), { status });

function imageSignature(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && buffer.toString('ascii', 12, 16) === 'IHDR'
    && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0) return 'image/png';
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
    && buffer.readUInt32LE(4) + 8 === buffer.length) return 'image/webp';
  return null;
}

function imageName(originalName) {
  let name = originalName;
  // Busboy exposes multipart filenames as Latin-1; recover UTF-8 names when possible.
  if ([...name].every((char) => char.codePointAt(0) <= 255)) {
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1')); } catch { /* Keep the original name. */ }
  }
  return [...basename(name.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '')].slice(0, 180).join('') || '行情截图';
}

export function validateImages(files) {
  if (files.length > MAX_IMAGES) throw publicError(400, '每个计划最多保存 4 张截图。');
  return files.map((file) => {
    if (file.size > MAX_IMAGE_SIZE) throw publicError(413, '每张截图不能超过 5 MB。');
    const mimeType = imageSignature(file.buffer);
    if (!mimeType || !imageTypes.has(file.mimetype) || file.mimetype !== mimeType) {
      throw publicError(400, '截图内容与格式不符，仅支持有效的 PNG、JPEG 和 WebP 图片。');
    }
    return { id: randomUUID(), name: imageName(file.originalname), mimeType, size: file.size, buffer: file.buffer };
  });
}
