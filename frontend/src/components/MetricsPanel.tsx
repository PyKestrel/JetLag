import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowDown, ArrowUp, Users } from 'lucide-react'
import {
  getInterfaceMetrics,
  getMetricsHistory,
  getMetricsRange,
  type MetricsSnapshot,
  type MetricsHistory,
  type MetricsRange,
} from '@/lib/api'

type RangeKey = 'live' | '60' | '360' | '1440'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: '60', label: '1h' },
  { key: '360', label: '6h' },
  { key: '1440', label: '24h' },
]

function formatBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} Gb/s`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mb/s`
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kb/s`
  return `${Math.round(bps)} b/s`
}

/** Lightweight SVG area chart — avoids pulling in a charting dependency. */
function Sparkline({
  values,
  color,
  height = 64,
}: {
  values: number[]
  color: string
  height?: number
}) {
  const width = 600
  const max = Math.max(1, ...values)
  const n = values.length
  if (n === 0) {
    return <div className="text-xs text-muted-foreground py-6 text-center">Collecting data…</div>
  }
  const step = n > 1 ? width / (n - 1) : width
  const points = values.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`)
  const linePath = `M ${points.join(' L ')}`
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <path d={areaPath} fill={color} fillOpacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function MetricsPanel() {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null)
  const [history, setHistory] = useState<MetricsHistory | null>(null)
  const [rangeData, setRangeData] = useState<MetricsRange | null>(null)
  const [range, setRange] = useState<RangeKey>('live')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const rangeTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live snapshot (current rates + per-interface table) — always polling.
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const [snap, hist] = await Promise.all([getInterfaceMetrics(), getMetricsHistory()])
        if (!cancelled) {
          setSnapshot(snap)
          setHistory(hist)
        }
      } catch {
        /* transient — keep last values */
      }
    }
    poll()
    timer.current = setInterval(poll, 2000)
    return () => {
      cancelled = true
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  // Historical range fetch — only active when a non-live range is selected.
  useEffect(() => {
    if (rangeTimer.current) {
      clearInterval(rangeTimer.current)
      rangeTimer.current = null
    }
    if (range === 'live') {
      setRangeData(null)
      return
    }
    let cancelled = false
    async function fetchRange() {
      try {
        const data = await getMetricsRange(Number(range))
        if (!cancelled) setRangeData(data)
      } catch {
        /* transient — keep last values */
      }
    }
    fetchRange()
    rangeTimer.current = setInterval(fetchRange, 15000)
    return () => {
      cancelled = true
      if (rangeTimer.current) clearInterval(rangeTimer.current)
    }
  }, [range])

  const chartSamples = range === 'live' ? history?.samples : rangeData?.samples
  const rxSeries = (chartSamples || []).map((s) => s.rx_bps)
  const txSeries = (chartSamples || []).map((s) => s.tx_bps)
  const agg = snapshot?.aggregate

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
          <Activity className="h-4 w-4" /> Throughput
        </h2>
        <div className="flex items-center gap-2">
          {snapshot && !snapshot.supported && (
            <span className="text-[12px] text-muted-foreground">Live metrics require the Linux appliance</span>
          )}
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={
                  'px-2.5 py-1 text-[12px] transition-colors ' +
                  (range === r.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] text-muted-foreground flex items-center gap-1.5">
              <ArrowDown className="h-3.5 w-3.5 text-emerald-500" /> Download (RX)
            </span>
            <span className="text-[15px] font-semibold text-foreground">{formatBps(agg?.rx_bps || 0)}</span>
          </div>
          <Sparkline values={rxSeries} color="#10b981" />
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] text-muted-foreground flex items-center gap-1.5">
              <ArrowUp className="h-3.5 w-3.5 text-blue-500" /> Upload (TX)
            </span>
            <span className="text-[15px] font-semibold text-foreground">{formatBps(agg?.tx_bps || 0)}</span>
          </div>
          <Sparkline values={txSeries} color="#3b82f6" />
        </div>
      </div>

      {snapshot && snapshot.interfaces.length > 0 && (
        <div className="bg-card border border-border rounded-md mt-4 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2">Interface</th>
                <th className="text-right font-medium px-4 py-2">RX</th>
                <th className="text-right font-medium px-4 py-2">TX</th>
                <th className="text-right font-medium px-4 py-2">RX pkt/s</th>
                <th className="text-right font-medium px-4 py-2">TX pkt/s</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.interfaces.map((i) => (
                <tr key={i.interface} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-foreground">{i.interface}</td>
                  <td className="px-4 py-2 text-right">{formatBps(i.rx_bps)}</td>
                  <td className="px-4 py-2 text-right">{formatBps(i.tx_bps)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{i.rx_pps}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{i.tx_pps}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.clients && (
            <div className="px-4 py-2 border-t border-border text-[12px] text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {snapshot.clients.authenticated} authenticated / {snapshot.clients.total} total clients
            </div>
          )}
        </div>
      )}
    </div>
  )
}
