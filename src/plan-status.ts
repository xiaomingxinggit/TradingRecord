export type PlanStatus = 'draft' | 'ready' | 'untriggered' | 'abandoned' | 'expired' | 'executed'

export const planStatuses: Record<PlanStatus, {
  label: string; tagType: 'info' | 'primary' | 'success' | 'warning'; description: string
}> = {
  draft: { label: '草稿', tagType: 'info', description: '想法尚未整理完成。' },
  ready: { label: '待触发', tagType: 'primary', description: '等待合适的入场时机，不代表已下单；执行进度由关联订单体现。' },
  untriggered: { label: '未触发', tagType: 'info', description: '计划未触发，不计为真实交易。' },
  abandoned: { label: '取消', tagType: 'warning', description: '结束此计划的未来执行意图，不会取消任何关联订单。' },
  expired: { label: '失效', tagType: 'warning', description: '原计划条件已不再适用，已有订单和成交仍保留。' },
  executed: { label: '旧人工执行标记', tagType: 'info', description: '旧版人工标记，不作为成交证据。请关联或补录真实订单；不会自动生成订单。' },
}

export const planStatusOptions = Object.entries(planStatuses).filter(([value]) => value !== 'executed').map(([value, info]) => ({ value: value as PlanStatus, ...info }))
export const statusInfo = (status: PlanStatus) => planStatuses[status]
