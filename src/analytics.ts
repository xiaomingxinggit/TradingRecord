import type { Trade } from './types'

export function summarize(trades: Trade[]) {
  const closed = trades.filter(t => t.closeTime).sort((a,b) => a.closeTime!.localeCompare(b.closeTime!) || a.id.localeCompare(b.id))
  const wins = closed.filter(t => t.netProfit > 0)
  const losses = closed.filter(t => t.netProfit < 0)
  const grossWin = wins.reduce((s,t) => s+t.netProfit, 0)
  const grossLoss = -losses.reduce((s,t) => s+t.netProfit, 0)
  let total=0, peak=0, drawdown=0
  const curve = closed.map(t => { total += t.netProfit; peak=Math.max(peak,total); drawdown=Math.max(drawdown,peak-total); return {time:t.closeTime!,value:total,trade:t} })
  const daily = new Map<string,{date:string;profit:number;count:number;wins:number}>()
  for (const t of closed) {
    const date=t.closeTime!.slice(0,10)
    const day=daily.get(date) || {date,profit:0,count:0,wins:0}
    day.profit+=t.netProfit; day.count++; if(t.netProfit>0) day.wins++
    daily.set(date,day)
  }
  const days=[...daily.values()]
  const hold=closed.reduce((s,t)=>s+Math.max(0,(new Date(t.closeTime!.replace(' ','T')).getTime()-new Date(t.openTime.replace(' ','T')).getTime())/60000),0)
  return { closed, wins, losses, net:total, grossWin,grossLoss, winRate:closed.length?wins.length/closed.length*100:0,
    profitFactor:grossLoss?grossWin/grossLoss:grossWin?Infinity:0, drawdown,curve,days,
    average:closed.length?total/closed.length:0, averageHold:closed.length?hold/closed.length:0,
    best:closed.length?Math.max(...closed.map(t=>t.netProfit)):0, worst:closed.length?Math.min(...closed.map(t=>t.netProfit)):0,
    fees:closed.reduce((s,t)=>s+t.commission+t.swap+t.fees,0),
  }
}
