import type { PlanStatus } from '../plan-status'
export interface Plan {
  id: string; symbol: string; side: '' | 'buy' | 'sell'; timeframe: string; marketState: string;
  keyStructure: string; reason: string; entryPrice: number | null; stopLoss: number | null; takeProfit: number | null;
  status: PlanStatus; statusChangedAt: string | null; abandonReason: string; createdAt: string; updatedAt: string;
  images: { id: string; name: string; url: string }[];
}
export type Purpose = 'unclassified' | 'initial' | 'add' | 'reentry'
export type Adherence = 'unrated' | 'yes' | 'partial' | 'no'
export interface Summary { adherence: Adherence; good: string; improve: string; state: 'draft' | 'completed' | 'needs_update'; completedAt: string | null; updatedAt: string | null; revision: number }
export interface Source { id: string; accountNumber: string; currency: string; broker: string; server: string; reportDate: string; mode: string }
export interface Position {
  id: string; ticket: string; symbol: string; side: 'buy' | 'sell'; volume: number;
  openTime: string; closeTime: string | null; openPrice: number; closePrice: number | null;
  reportedStopLoss: number | null; reportedTakeProfit: number | null; profit: number | null;
  commission: number | null; swap: number | null; fees: number; netProfit: number | null;
  resultState: 'closed' | 'open' | 'incomplete'; issues: string[]; sourceFile: string; reportDate: string; comment: string;
  source: Source; link: { planId: string; purpose: Purpose; note: string } | null;
}
export interface Total { source: Source; closed: number; open: number; incomplete: number; netProfit: number | null }
export interface ReviewDetailData { plan: Plan; positions: Position[]; totals: Total[]; review: Summary }
export interface QueuePlan extends Omit<Plan, 'images'> { positionCount: number; review: Summary }
export interface Board { accounts: Source[]; positions: Position[]; plans: QueuePlan[]; counts: { unlinked: number; pending: number; completed: number } }
export interface ImportResult { added: number; updated: number; duplicate: number; conflicts: { ticket: string; reason: string }[]; warnings: string[]; ignoredCashFlows: number; incomplete: number; source: Source }
export const purposes: { value: Purpose; label: string }[] = [{ value: 'unclassified', label: '未分类' }, { value: 'initial', label: '首次入场' }, { value: 'add', label: '加仓' }, { value: 'reentry', label: '重新入场' }]
export const adherenceOptions: { value: Adherence; label: string }[] = [{ value: 'unrated', label: '未评定' }, { value: 'yes', label: '是' }, { value: 'partial', label: '部分遵守' }, { value: 'no', label: '否' }]
export const reviewLabel = (state: Summary['state']) => ({ draft: '待复盘', completed: '已复盘', needs_update: '有更新待补充' })[state]
export const purposeLabel = (value: Purpose) => purposes.find(p => p.value === value)?.label || '未分类'
export const sideLabel = (side: string) => side === 'buy' ? '做多' : side === 'sell' ? '做空' : '未填方向'
export const timeLabel = (time: string | null) => time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '未记录'
export const amount = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 8 })
export const planLabel = (p: Pick<Plan, 'createdAt' | 'symbol' | 'side' | 'reason'>) => `${timeLabel(p.createdAt)} · ${p.symbol || '未填品种'} · ${sideLabel(p.side)} · ${p.reason || '未填写入场理由'}`
