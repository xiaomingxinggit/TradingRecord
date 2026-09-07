import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { summarize } from '../analytics'
import type { AppData, Note, Trade } from '../types'

export type Page = 'overview' | 'plans' | 'trades' | 'calendar' | 'journal' | 'imports'
const page = ref<Page>('overview')
const loading = ref(true), busy = ref(false), error = ref('')
const importModal = ref(false), help = ref(false), importWarnings = ref<string[]>([])
const data = ref<AppData>({ accounts: [], trades: [], cashFlows: [], imports: [], rootFiles: [] })
const accountId = ref(''), period = ref('all'), startDate = ref(''), endDate = ref('')
const search = ref(''), symbol = ref('all'), side = ref('all'), result = ref('all')
const currentPage = ref(1), sortProfit = ref(false), reviewMode = ref('all')
const selected = ref<Trade | null>(null), calendarMonth = ref('')
const account = computed(() => data.value.accounts.find(a => a.id === accountId.value))
const currency = computed(() => account.value?.currency || 'USD')
const accountTrades = computed(() => data.value.trades.filter(t => t.accountId === accountId.value))
const latestDate = computed(() => accountTrades.value.map(t => (t.closeTime || t.openTime).slice(0, 10)).sort().at(-1) || localDate(new Date()))
const scopedTrades = computed(() => accountTrades.value.filter(t => {
  const date = (t.closeTime || t.openTime).slice(0, 10)
  if (period.value === 'custom') return (!startDate.value || date >= startDate.value) && (!endDate.value || date <= endDate.value)
  if (period.value === 'all') return true
  const last = new Date(`${latestDate.value}T12:00:00`)
  last.setDate(last.getDate() - (period.value === '7' ? 6 : 29))
  return date >= localDate(last) && date <= latestDate.value
}))
const stats = computed(() => summarize(scopedTrades.value))
const overall = computed(() => summarize(accountTrades.value))
const reviewed = computed(() => accountTrades.value.filter(t => t.note?.content?.trim()).length)
const symbols = computed(() => [...new Set(accountTrades.value.map(t => t.symbol))].sort())
const filtered = computed(() => scopedTrades.value.filter(t =>
  (symbol.value === 'all' || t.symbol === symbol.value) &&
  (side.value === 'all' || t.side === side.value) &&
  (result.value === 'all' || (result.value === 'win' ? t.netProfit > 0 : result.value === 'loss' ? t.netProfit < 0 : t.netProfit === 0)) &&
  (!search.value || `${t.ticket} ${t.symbol} ${t.note?.strategy || ''} ${t.note?.content || ''} ${t.note?.tags?.join(' ') || ''}`.toLowerCase().includes(search.value.toLowerCase()))
).sort(tradeOrder))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)))
const tableTrades = computed(() => filtered.value.slice((currentPage.value - 1) * 10, currentPage.value * 10))
const recent = computed(() => [...scopedTrades.value].sort(tradeOrder).slice(0, 5))
const journalTrades = computed(() => filtered.value.filter(t => reviewMode.value === 'all' || (reviewMode.value === 'done' ? !!t.note?.content?.trim() : !t.note?.content?.trim())))
const calendarYear = computed(() => Number(calendarMonth.value.slice(0, 4)))
const calendarMonthNumber = computed(() => Number(calendarMonth.value.slice(5, 7)))
const monthStats = computed(() => summarize(accountTrades.value.filter(t => t.closeTime?.startsWith(calendarMonth.value))))
const cashflows = computed(() => data.value.cashFlows.filter(c => c.accountId === accountId.value))
const deposits = computed(() => cashflows.value.filter(c => c.amount > 0).reduce((s, c) => s + c.amount, 0))
const withdrawals = computed(() => -cashflows.value.filter(c => c.amount < 0).reduce((s, c) => s + c.amount, 0))
const dateLabel = computed(() => {
  const dates = scopedTrades.value.map(t => (t.closeTime || t.openTime).slice(0, 10)).sort()
  return dates.length ? `${dates[0]} — ${dates.at(-1)}` : '暂无交易数据'
})
const topSymbols = computed(() => symbols.value.map(s => {
  const trades = scopedTrades.value.filter(t => t.symbol === s && t.closeTime)
  return { symbol: s, count: trades.length, net: trades.reduce((n, t) => n + t.netProfit, 0) }
}).filter(s => s.count).sort((a, b) => b.count - a.count))

function tradeOrder(a: Trade, b: Trade) { return sortProfit.value ? b.netProfit - a.netProfit : (b.closeTime || b.openTime).localeCompare(a.closeTime || a.openTime) }
function localDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function money(n: number, signed = false) { return `${signed && n > 0 ? '+' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function go(next: Page) { page.value = next; window.scrollTo({ top: 0 }) }
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  const body = await response.json().catch(() => ({ error: '服务返回了无效响应。' }))
  if (!response.ok) throw new Error(body.warnings?.length ? body.warnings.join('；') : body.error || body.message || '请求失败。')
  return body as T
}
async function load(): Promise<boolean> {
  error.value = ''
  try {
    data.value = await request<AppData>('/api/data')
    if (!data.value.accounts.some(a => a.id === accountId.value)) accountId.value = data.value.accounts[0]?.id || ''
    if (!calendarMonth.value) calendarMonth.value = latestDate.value.slice(0, 7)
    return true
  } catch (e) { error.value = (e as Error).message; return false }
  finally { loading.value = false }
}
async function importFiles(files?: File[] | FileList): Promise<boolean> {
  if (busy.value || (files && !files.length)) return false
  busy.value = true; error.value = ''
  try {
    const form = new FormData()
    if (files) for (const file of Array.from(files)) form.append('files', file)
    const imported = await request<{ addedCount: number; updatedCount: number; duplicateCount: number; warnings: string[] }>(files ? '/api/import' : '/api/import-root', { method: 'POST', ...(files ? { body: form } : {}) })
    importWarnings.value = imported.warnings || []
    await load()
    ElMessage({ type: imported.warnings?.length ? 'warning' : 'success', duration: 6000,
      message: `${imported.warnings?.length ? '导入已处理，请查看提示' : '导入完成'}：新增 ${imported.addedCount || 0} 笔${imported.updatedCount ? `，更新 ${imported.updatedCount} 笔` : ''}，已存在 ${imported.duplicateCount || 0} 笔` })
    importModal.value = false; go('imports'); return true
  } catch (e) { error.value = (e as Error).message; return false }
  finally { busy.value = false }
}
function openTrade(trade: Trade) { selected.value = trade }
async function saveTradeNote(id: string, note: Pick<Note, 'strategy' | 'tags' | 'rating' | 'content'>): Promise<Note> {
  const saved = await request<{ id: string; note: Note }>(`/api/trades/${encodeURIComponent(id)}/note`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note) })
  const trade = data.value.trades.find(t => t.id === id)
  if (trade) trade.note = saved.note
  return saved.note
}
function changeMonth(offset: number) { calendarMonth.value = localDate(new Date(calendarYear.value, calendarMonthNumber.value - 1 + offset, 1)).slice(0, 7) }
function selectDay(date: string) { resetFilters(); period.value = 'custom'; startDate.value = date; endDate.value = date; go('trades') }
function resetFilters() { search.value = ''; symbol.value = 'all'; side.value = 'all'; result.value = 'all'; period.value = 'all'; startDate.value = ''; endDate.value = ''; sortProfit.value = false }
watch([search, symbol, side, result, period, startDate, endDate, accountId], () => currentPage.value = 1)
watch(pageCount, value => currentPage.value = Math.min(currentPage.value, value))
watch(accountId, () => { calendarMonth.value = latestDate.value.slice(0, 7); resetFilters() })

const workspace = { page, loading, busy, error, importModal, help, importWarnings, data,
  accountId, period, startDate, endDate, search, symbol, side, result, currentPage, sortProfit, reviewMode,
  selected, calendarMonth, account, currency, accountTrades, latestDate, scopedTrades, stats, overall,
  reviewed, symbols, filtered, pageCount, tableTrades, recent, journalTrades, calendarYear, calendarMonthNumber,
  monthStats, cashflows, deposits, withdrawals, dateLabel, topSymbols,
  localDate, money, go, request, load, importFiles, openTrade, saveTradeNote, changeMonth, selectDay, resetFilters }
export function useWorkspace() { return workspace }
