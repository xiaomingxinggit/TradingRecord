const states = { draft: '草稿', open: '模拟持仓中', closed: '已平仓' };
const reviews = { draft: '待复盘 / 草稿', completed: '已复盘', needs_update: '待补充' };
const sides = { buy: '做多', sell: '做空' };
const adherence = { unrated: '未评价', yes: '是', partial: '部分', no: '否' };
const markets = { uptrend: '上涨趋势', downtrend: '下跌趋势', range: '震荡', uncertain: '不确定' };
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export function appendPracticeArchive(zip, records, textBlock) {
  if (!records.length) return;
  const md = ['# 模拟练习', '', '这些是用户在外部工具回放行情时手工填写的模拟记录，与真实交易、MT5 持仓和开仓计划独立。', '',
    `共 ${records.length} 条已保存记录，包含全部状态，按真实创建时间从新到旧排列。回放时间为用户填写的行情时钟，不转换时区。`, '',
    '净盈亏（含费用）由用户填写，不由成交价推算。仅已平仓的明确净盈亏参与统计；胜率为净盈利笔数 / 已平仓笔数，持平计入分母；不同币种不相加。', '',
    '复盘完成后记录或截图有改动会标记待补充，原总结保留；状态退回草稿 / 模拟持仓中后不进入已平仓复盘队列。未保存修改不在导出内。', ''];
  for (const [index, record] of records.entries()) {
    md.push(`## 模拟记录 ${index + 1}`, '', textBlock({ 唯一标识: record.id, 状态: states[record.status], 品种: record.symbol, 方向: sides[record.side] || '未填写', 分析周期: record.timeframe,
      创建时间UTC: record.createdAt, 更新时间UTC: record.updatedAt, 模拟开仓时间: record.openTime, 模拟开仓价: record.openPrice, 仓位手数: record.volume,
      模拟平仓时间: record.closeTime, 模拟平仓价: record.closePrice, 手填净盈亏含费用: record.netProfit, 币种: record.currency,
      市场状态: markets[record.marketState], 关键结构: record.keyStructure, 开仓分析: record.reason, 计划止损: record.stopLoss, 计划止盈: record.takeProfit }), '',
      '### 复盘', '', textBlock({ 状态: reviews[record.review.state], 是否进入已平仓复盘队列: record.status === 'closed', 是否按自己的分析执行: adherence[record.review.adherence],
        做得好的地方: record.review.good, 问题与改进: record.review.improve, 上次完成时间UTC: record.review.completedAt, 复盘更新时间UTC: record.review.updatedAt }), '', '### 行情截图', '');
    if (!record.images.length) md.push('未添加截图。', '');
    record.images.forEach((image, imageIndex) => {
      const extension = extensions[image.mimeType];
      if (!extension || !image.content?.length) throw new Error('模拟截图内容无效，未生成完整导出。');
      const path = `practice-images/record-${String(index + 1).padStart(6, '0')}/image-${imageIndex + 1}.${extension}`;
      zip.file(path, Buffer.from(image.content), { compression: 'STORE' });
      md.push(textBlock({ 原始文件名: image.name, 用途: image.purpose === 'review' ? '复盘' : '开仓前' }), '', `![模拟截图 ${imageIndex + 1}](${path})`, '');
    });
    md.push('---', '');
  }
  zip.file('模拟练习.md', md.join('\n'), { compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
