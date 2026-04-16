import { Link } from 'react-router-dom'
import {
  RefreshCw,
  MapPin,
  Clock,
  Package,
  Activity,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import type { RouterSummaryData } from '@/lib/api'
import type { RouterTab } from './routerTabs'
import { cn } from '@/lib/utils'

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (d > 0 || h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

type QuickRow = {
  label: string
  value: number
  tab: RouterTab
}

export default function RouterSummary({
  data,
  loading,
  error,
  onRefresh,
  onSelectTab,
}: {
  data: RouterSummaryData | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onSelectTab: (t: RouterTab) => void
}) {
  const quickRows: QuickRow[] = data
    ? [
        { label: 'Static routes', value: data.counts.static_routes, tab: 'l3' },
        { label: 'NAT rules', value: data.counts.nat_rules, tab: 'nat' },
        { label: 'DHCP reservations', value: data.counts.dhcp_reservations, tab: 'dhcp' },
        { label: 'ARP entries', value: data.counts.arp_entries, tab: 'arp' },
      ]
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Status and shortcuts for this appliance. Deep configuration lives in the tabs above.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        {/* Left column — system cards */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              Location
            </div>
            <div className="p-4 text-[13px] text-muted-foreground">
              No site label configured. Set a friendly name in{' '}
              <Link to="/settings" className="text-primary hover:underline">
                Settings
              </Link>{' '}
              if you add that field later.
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Uptime
            </div>
            <div className="p-4">
              {loading && !data ? (
                <div className="h-6 w-40 animate-pulse rounded bg-muted" />
              ) : data?.uptime_seconds != null ? (
                <p className="text-[15px] font-semibold text-foreground tabular-nums">
                  {formatUptime(data.uptime_seconds)}
                </p>
              ) : (
                <p className="text-[13px] text-muted-foreground">Unavailable</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Package className="h-3.5 w-3.5" />
              Software
            </div>
            <div className="p-4 space-y-1">
              {loading && !data ? (
                <div className="h-5 w-24 animate-pulse rounded bg-muted" />
              ) : (
                <>
                  <p className="text-[15px] font-semibold text-foreground">JetLag {data?.version ?? '—'}</p>
                  <p className="text-[12px] text-muted-foreground">Local appliance</p>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              LAN / primary IPv4
            </div>
            <div className="p-4 space-y-2 text-[13px]">
              {loading && !data ? (
                <div className="space-y-2">
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                </div>
              ) : (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Interface</span>
                    <span className="font-mono text-foreground">{data?.primary_interface ?? '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">IPv4</span>
                    <span className="font-mono text-foreground">{data?.primary_ipv4 ?? '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">MAC</span>
                    <span className="font-mono text-foreground text-[12px]">{data?.primary_mac ?? '—'}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              dnsmasq (DHCP/DNS)
            </div>
            <div className="p-4 flex items-center gap-2">
              {loading && !data ? (
                <div className="h-5 w-20 animate-pulse rounded bg-muted" />
              ) : (
                <>
                  <span
                    className={cn(
                      'inline-flex h-2 w-2 rounded-full',
                      data?.dnsmasq.running ? 'bg-emerald-500' : 'bg-amber-500',
                    )}
                  />
                  <span className="text-[13px] text-foreground">
                    {data?.dnsmasq.running ? 'Running' : data?.dnsmasq.status ?? 'Stopped'}
                  </span>
                  {data?.dnsmasq.note && (
                    <span className="text-[12px] text-muted-foreground">({data.dnsmasq.note})</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right column — quick counts & connectivity strip */}
        <div className="space-y-4 min-w-0">
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Configuration overview
            </div>
            <div className="divide-y divide-border">
              {loading && !data
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3">
                      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-8 animate-pulse rounded bg-muted" />
                    </div>
                  ))
                : !data && error
                  ? (
                      <div className="px-4 py-6 text-[13px] text-muted-foreground text-center">
                        Overview counts are unavailable until the summary loads successfully.
                      </div>
                    )
                : quickRows.map((row) => (
                    <button
                      key={row.label}
                      type="button"
                      onClick={() => onSelectTab(row.tab)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/60 transition-colors"
                    >
                      <span className="text-[13px] text-foreground">{row.label}</span>
                      <span className="flex items-center gap-2 text-[13px] tabular-nums text-muted-foreground">
                        {row.value}
                        <ChevronRight className="h-4 w-4 opacity-50" />
                      </span>
                    </button>
                  ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Connectivity
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  error ? 'w-0 bg-red-400' : 'w-full bg-emerald-500',
                )}
              />
            </div>
            <p className="text-[12px] text-muted-foreground">
              {error
                ? 'Summary request failed; refresh or check that the API is running.'
                : 'Last summary request succeeded — historical throughput charts can be added in a later release.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/logs"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Event log
            </Link>
            <button
              type="button"
              onClick={() => onSelectTab('l3')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              L3 routing
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
