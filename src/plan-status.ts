export type PlanStatus = 'draft' | 'ready' | 'executed' | 'abandoned'

export const planStatuses: Record<PlanStatus, {
  label: string; tagType: 'info' | 'primary' | 'success' | 'warning'; description: string
}> = {
  draft: { label: '草稿', tagType: 'info', description: '想法尚未整理完成。' },
  ready: { label: '待执行', tagType: 'primary', description: '等待入场条件。' },
  executed: { label: '已执行', tagType: 'success', description: '已实际开仓，不代表已平仓。' },
  abandoned: { label: '已放弃', tagType: 'warning', description: '已决定不执行这份计划。' },
}

export const planStatusOptions = Object.entries(planStatuses).map(([value, info]) => ({ value: value as PlanStatus, ...info }))
export const statusInfo = (status: PlanStatus) => planStatuses[status]
