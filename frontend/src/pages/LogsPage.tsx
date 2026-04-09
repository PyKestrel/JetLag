import { useState } from 'react'
import { RefreshCw, Trash2, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { getLogs, clearLogs, type EventLog, type PaginatedResponse } from '@/lib/api'

const CATEGORIES = ['', 'dhcp', 'dns', 'auth', 'firewall', 'impairment', 'capture', 'system']

const levelStyle = (level: string) => {
  switch (level.toUpperCase()) {
    case 'ERROR':
      return { dot: 'bg-red-500', badge: 'text-red-700 bg-red-50 border-red-200' }
    case 'WARNING':
      return { dot: 'bg-amber-500', badge: 'text-amber-700 bg-amber-50 border-amber-200' }
    case 'INFO':
      return { dot: 'bg-blue-500', badge: 'text-blue-700 bg-blue-50 border-blue-200' }
    default:
      return { dot: 'bg-gray-400', badge: 'text-gray-500 bg-gray-100 border-gray-200' }
  }
}

const categoryColor = (cat: string) => {
  const colors: Record<string, string> = {
    dhcp: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    dns: 'bg-violet-50 text-violet-700 border-violet-200',
    auth: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    firewall: 'bg-orange-50 text-orange-700 border-orange-200',
    impairment: 'bg-pink-50 text-pink-700 border-pink-200',
    capture: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    system: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return colors[cat] || 'bg-gray-100 text-gray-700 border-gray-200'
}

export default function LogsPage() {
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const { data, loading, error, refetch } = useApi<PaginatedResponse<EventLog>>(
    () => {
      const params: Record<string, string> = { page: String(page), per_page: '50' }
      if (category) params.category = category
      return getLogs(params)
    },
    [page, category]
  )

  const handleClear = async () => {
    const target = category || 'all'
    if (!confirm(`Clear ${target} logs?`)) return
    try {
      await clearLogs(category || undefined)
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clear logs')
    }
  }

  const filtered = data?.items.filter((log) => {
    if (!search) return true
    const q = search.toLowerCase()
    return log.message.toLowerCase().includes(q) || (log.source_ip || '').includes(q)
  })

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-foreground">Event Logs</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Real-time event stream for DHCP, DNS, authentication, firewall, impairment, and system events.
        </p>
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          Log Entries{' '}
          {data && <span className="text-[13px] font-normal text-muted-foreground">{data.total} total</span>}
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1) }}
            className="px-3 py-[6px] text-[13px] rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Categories</option>
            {CATEGORIES.filter(Boolean).map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={handleClear} className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search log messages..."
            className="w-full pl-9 pr-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          Failed to load logs: {error}
        </div>
      )}

      {data && filtered && (
        <>
          <div className="bg-card border border-border rounded-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-40">Timestamp</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-24">Level</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-28">Category</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Message</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-28">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                      {search ? 'No logs match your search' : 'No log entries'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => {
                    const ls = levelStyle(log.level)
                    return (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 text-[12px] text-muted-foreground font-mono">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium border rounded-full px-2 py-0.5 ${ls.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ls.dot}`} />
                            {log.level.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${categoryColor(log.category)}`}>
                            {log.category}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-[13px] text-foreground">{log.message}</td>
                        <td className="px-4 py-2 text-[12px] text-muted-foreground font-mono">
                          {log.source_ip || '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-3 text-[12px] text-muted-foreground">
            <span>
              {(page - 1) * 50 + 1}–{(page - 1) * 50 + filtered.length} of {data.total} items
              <span className="mx-2">|</span>
              Items per page: 50
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2">{page} of {data.pages || 1} pages</span>
              <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page >= data.pages} className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
