import JSZip from 'jszip';

const statusLabels = { draft: '草稿', ready: '待执行', executed: '已执行', abandoned: '已放弃' };
const sideLabels = { buy: '做多', sell: '做空' };
const marketLabels = { uptrend: '上涨趋势', downtrend: '下跌趋势', range: '震荡', uncertain: '不确定' };
const imageExtensions = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]);
const fields = [
  ['id', '唯一标识'], ['createdAt', '创建时间（UTC）'], ['updatedAt', '更新时间（UTC）'],
  ['status', '状态', statusLabels], ['statusChangedAt', '状态变更时间（UTC）'],
  ['abandonReason', '放弃原因'], ['symbol', '品种'], ['side', '方向', sideLabels],
  ['timeframe', '分析周期'], ['marketState', '市场状态', marketLabels],
  ['keyStructure', '关键结构'], ['reason', '入场理由'],
  ['entryPrice', '计划入场价'], ['stopLoss', '止损价'], ['takeProfit', '止盈价'],
];
const knownFields = new Set([...fields.map(([key]) => key), 'images']);

// A fence longer than any user-supplied backtick run preserves Chinese,
// multiline text and Markdown/HTML characters as literal content.
function textBlock(value) {
  const text = value === null || value === undefined || value === '' ? '未填写'
    : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}text\n${text}\n${fence}`;
}

export async function exportPlansArchive(plans) {
  if (!plans.length) {
    throw Object.assign(new Error('还没有已保存的开仓计划，请先保存一份计划后再导出。'), { status: 409 });
  }
  const zip = new JSZip();
  zip.folder('images');
  const markdown = ['# 开仓计划', '', `共 ${plans.length} 份已保存计划，包含全部状态。`, '',
    '按创建时间从新到旧排列；创建时间相同按唯一标识降序排列。未保存的编辑内容不在本次导出中。', '',
    '“已执行”表示已实际开仓，不代表已平仓。状态变更时间缺失时显示“未记录”。', '',
    '解压整个 ZIP 后打开本文件，保留 images 文件夹的位置即可离线查看截图。', ''];

  plans.forEach((plan, planIndex) => {
    const planNumber = String(planIndex + 1).padStart(6, '0');
    markdown.push(`## 计划 ${planIndex + 1}`, '');
    for (const [key, label, labels] of fields) {
      const value = plan[key];
      if (key === 'abandonReason' && plan.status !== 'abandoned' && !value) continue;
      const display = key === 'statusChangedAt' && !value ? '未记录'
        : labels && Object.hasOwn(labels, value) ? `${labels[value]}（${value}）` : value;
      const fieldLabel = key === 'abandonReason' && plan.status !== 'abandoned' ? '上次放弃原因' : label;
      markdown.push(`### ${fieldLabel}`, '', textBlock(display), '');
    }
    const extra = Object.fromEntries(Object.entries(plan).filter(([key]) => !knownFields.has(key)));
    if (Object.keys(extra).length) markdown.push('### 其他已保存内容', '', textBlock(extra), '');
    markdown.push('### 行情截图', '');
    if (!plan.images.length) markdown.push('未添加截图。', '');
    plan.images.forEach((image, imageIndex) => {
      const extension = imageExtensions.get(image.mimeType);
      if (!extension || !image.content?.length) throw new Error('已保存截图的格式或内容无效。');
      // Never use original names or stored IDs as ZIP paths.
      const path = `images/plan-${planNumber}/image-${String(imageIndex + 1).padStart(2, '0')}.${extension}`;
      zip.file(path, Buffer.from(image.content), { compression: 'STORE' });
      markdown.push(`#### 截图 ${imageIndex + 1}`, '', '原始文件名：', '', textBlock(image.name), '',
        `![截图 ${imageIndex + 1}](${path})`, '');
    });
    markdown.push('---', '');
  });
  zip.file('开仓计划.md', markdown.join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/zip' });
}
