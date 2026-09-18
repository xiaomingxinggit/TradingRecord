export type PlanStatus = 'draft' | 'ready' | 'untriggered' | 'abandoned' | 'expired' | 'executed'

export const planStatuses: Record<PlanStatus, {
  label: string; tagType: 'info' | 'primary' | 'success' | 'warning'; description: string
}> = {
  draft: { label: '草稿', tagType: 'info', description: '想法尚未整理完成。' },
  ready: { label: '待触发', tagType: 'primary', description: '等待合适的入场时机。' },
  executed: { label: '已执行', tagType: 'success', description: '已按实际情况手动标记执行。' },
  untriggered: { label: '未触发', tagType: 'info', description: '本次计划未触发。' },
  abandoned: { label: '取消', tagType: 'warning', description: '决定不再执行此计划。' },
  expired: { label: '失效', tagType: 'warning', description: '原计划条件已不再适用。' },
}

export const planStatusOptions = Object.entries(planStatuses).map(([value, info]) => ({ value: value as PlanStatus, ...info }))
export const statusInfo = (status: PlanStatus) => planStatuses[status]
