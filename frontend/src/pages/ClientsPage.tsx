import { useState, useRef, useEffect } from 'react'
import { RefreshCw, Shield, ShieldOff, RotateCcw, Search, MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  getClients,
  authenticateClient,
  deauthenticateClient,
  bulkResetClients,
  type Client,
  type PaginatedResponse,
} from '@/lib/api'

function ActionMenu({ client, onAuth, onDeauth, loading }: {
  client: Client
  onAuth: (id: number) => void
  onDeauth: (id: number) => void
  loading: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded hover:bg-accent transition-colors"
      >
        <MoreVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-md shadow-lg z-20 py-1">
          {client.auth_state === 'pending' ? (
            <button
              onClick={() => { onAuth(client.id); setOpen(false) }}
              disabled={loading}
              className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors flex items-center gap-2"
            >
              <Shield className="h-3.5 w-3.5 text-emerald-600" />
              Authenticate
            </button>
          ) : (
            <button
              onClick={() => { onDeauth(client.id); setOpen(false) }}
              disabled={loading}
              className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors flex items-center gap-2"
            >
              <ShieldOff className="h-3.5 w-3.5 text-red-500" />
              Revoke Access
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function ClientsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const { data, loading, error, refetch } = useApi<PaginatedResponse<Client>>(
    () => getClients({ page: String(page), per_page: '10' }),
    [page]
  )

  const handleAuth = async (id: number) => {
    setActionLoading(id)
    try {
      await authenticateClient(id)
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed')
    }
    setActionLoading(null)
  }

  const handleDeauth = async (id: number) => {
    setActionLoading(id)
    try {
      await deauthenticateClient(id)
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed')
    }
    setActionLoading(null)
  }

  const handleBulkReset = async () => {
    if (!confirm('Reset all client sessions? This will force all clients back to captive portal.')) return
    try {
      await bulkResetClients()
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bulk reset failed')
    }
  }

  // Client-side search filter
  const filtered = data?.items.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.mac_address.toLowerCase().includes(q) ||
      (c.ip_address || '').toLowerCase().includes(q) ||
      (c.hostname || '').toLowerCase().includes(q)
    )
  })

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-foreground">Clients</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          View and manage connected devices on the LAN. Authenticate clients to grant internet access or revoke to force captive portal re-authentication.
        </p>
      </div>

      {/* Section header with count */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          Your Clients{' '}
          {data && (
            <span className="text-[13px] font-normal text-muted-foreground">
              Showing {filtered?.length ?? 0} of {data.total}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            onClick={handleBulkReset}
            className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset All
          </button>
        </div>
      </div>

      {/* Search / Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by MAC, IP, or hostname..."
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
          Failed to load clients: {error}
        </div>
      )}

      {data && filtered && (
        <>
          <div className="bg-card border border-border rounded-md">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">MAC Address</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">IP Address</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Hostname</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">VLAN</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Last Seen</th>
                  <th className="text-right text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                      {search ? 'No clients match your search' : 'No clients connected'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((client) => (
                    <tr key={client.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-[13px] font-medium text-primary cursor-pointer hover:underline">{client.mac_address}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{client.ip_address || '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{client.hostname || '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{client.vlan_id ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {client.auth_state === 'authenticated' ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            HEALTHY
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                            INACTIVE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                        {new Date(client.last_seen).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ActionMenu
                          client={client}
                          onAuth={handleAuth}
                          onDeauth={handleDeauth}
                          loading={actionLoading === client.id}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination — Cloudflare style */}
          <div className="flex items-center justify-between mt-3 text-[12px] text-muted-foreground">
            <span>
              1–{filtered.length} of {data.total} items
              <span className="mx-2">|</span>
              Items per page: 10
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2">{page} of {data.pages || 1} pages</span>
              <button
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={page >= data.pages}
                className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
