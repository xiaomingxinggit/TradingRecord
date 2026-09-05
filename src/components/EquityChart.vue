<script setup lang="ts">
import { computed, ref } from 'vue'
const props=defineProps<{points:{time:string;value:number}[];currency:string}>()
const hover=ref<number|null>(null)
const w=900,h=242,pad={left:55,right:22,top:25,bottom:32}
const values=computed(()=>[0,...props.points.map(p=>p.value)])
const bounds=computed(()=>{ const lo=Math.min(...values.value),hi=Math.max(...values.value); const margin=Math.max((hi-lo)*.18,5);return {min:lo-margin,max:hi+margin} })
const x=(i:number)=>pad.left+i/Math.max(values.value.length-1,1)*(w-pad.left-pad.right)
const y=(v:number)=>pad.top+(bounds.value.max-v)/(bounds.value.max-bounds.value.min)*(h-pad.top-pad.bottom)
const line=computed(()=>values.value.map((v,i)=>`${i?'L':'M'}${x(i)},${y(v)}`).join(' '))
const area=computed(()=>`${line.value} L${x(values.value.length-1)},${h-pad.bottom} L${pad.left},${h-pad.bottom} Z`)
const ticks=computed(()=>Array.from({length:5},(_,i)=>bounds.value.min+(bounds.value.max-bounds.value.min)*i/4))
const labels=computed(()=>{const a=props.points; if(!a.length)return [];return [...new Set([0,Math.floor((a.length-1)/3),Math.floor((a.length-1)*2/3),a.length-1])].map(i=>({i:i+1,time:a[i]!.time.slice(5,10).replace('-','/')}))})
const selected=computed(()=>hover.value===null?null:props.points[hover.value-1])
function pointer(e:PointerEvent){const rect=(e.currentTarget as SVGElement).getBoundingClientRect();const offset=(e.clientX-rect.left)/rect.width*w;hover.value=Math.max(1,Math.min(props.points.length,Math.round((offset-pad.left)/(w-pad.left-pad.right)*(values.value.length-1))))}
</script>

<template>
  <div class="equity-plot">
    <svg :viewBox="`0 0 ${w} ${h}`" role="img" aria-label="按平仓顺序计算的累计净盈亏曲线" @pointermove="pointer" @pointerleave="hover=null">
      <defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8c72dc" stop-opacity=".21"/><stop offset="100%" stop-color="#8c72dc" stop-opacity=".015"/></linearGradient></defs>
      <g v-for="tick in ticks" :key="tick"><line :x1="pad.left" :x2="w-pad.right" :y1="y(tick)" :y2="y(tick)" stroke="#ececf2" stroke-dasharray="3 5"/><text x="0" :y="y(tick)+4" fill="#9293a4" font-size="11">{{ tick.toFixed(0) }}</text></g>
      <path :d="area" fill="url(#equityFill)"/><line :x1="pad.left" :x2="w-pad.right" :y1="y(0)" :y2="y(0)" stroke="#d8d5e3" stroke-dasharray="5 5"/>
      <path :d="line" fill="none" stroke="#8b70d8" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      <g v-for="label in labels" :key="label.i"><text :x="x(label.i)" :y="h-4" fill="#9293a4" font-size="11" text-anchor="middle">{{ label.time }}</text></g>
      <g v-if="selected && hover!==null"><line :x1="x(hover)" :x2="x(hover)" :y1="pad.top" :y2="h-pad.bottom" stroke="#b6a6e1" stroke-dasharray="4 4"/><circle :cx="x(hover)" :cy="y(selected.value)" r="5" fill="#8666d8" stroke="white" stroke-width="3"/></g>
    </svg>
    <div v-if="selected" class="chart-tooltip" :style="{left:`${Math.min(76,Math.max(9,x(hover!)/w*100))}%`}"><small>{{ selected.time }}</small><strong>{{ selected.value.toFixed(2) }} {{ currency }}</strong></div>
  </div>
</template>
