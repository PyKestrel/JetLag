import { useState, useRef, useEffect } from 'react'
import { Play, Square, Download, Trash2, RefreshCw, Plus, MoreVertical, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  getCaptures,
  startCapture,
  stopCapture,
  deleteCapture,
  getCaptureDownloadUrl,
  type Capture,
  type CaptureCreate,
  type PaginatedResponse,
} from '@/lib/api'

function CaptureActionMenu({ capture, onStop, onDelete }: {
  capture: Capture
  onStop: () => void
  onDelete: () => void
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
      <button onClick={() => setOpen(!open)} className="p-1 rounded hover:bg-accent transition-colors">
        <MoreVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-card border border-border rounded-md shadow-lg z-20 py-1">
          {capture.state === 'running' && (
            <button onClick={() => { onStop(); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors flex items-center gap-2">
              <Square className="h-3.5 w-3.5 text-red-500" /> Stop Capture
            </button>
          )}
          {capture.state === 'stopped' && (
            <a href={getCaptureDownloadUrl(capture.id)} download className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors flex items-center gap-2" onClick={() => setOpen(false)}>
              <Download className="h-3.5 w-3.5 text-blue-500" /> Download PCAP
            </a>
          )}
          <div className="my-1 border-t border-border" />
          <button onClick={() => { onDelete(); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const stateStyle = (state: string) => {
  switch (state) {
    case 'running':
      return { dot: 'bg-blue-500', badge: 'text-blue-700 bg-blue-50 border-blue-200', label: 'RUNNING' }
    case 'stopped':
      return { dot: 'bg-gray-400', badge: 'text-gray-500 bg-gray-100 border-gray-200', label: 'STOPPED' }
    case 'error':
      return { dot: 'bg-red-500', badge: 'text-red-700 bg-red-50 border-red-200', label: 'ERROR' }
    default:
      return { dot: 'bg-gray-400', badge: 'text-gray-500 bg-gray-100 border-gray-200', label: state.toUpperCase() }
  }
}

export default function CapturesPage() {
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CaptureCreate>({ name: '' })
  const [saving, setSaving] = useState(false)

  const { data, loading, error, refetch } = useApi<PaginatedResponse<Capture>>(
    () => getCaptures({ page: String(page), per_page: '10' }),
    [page]
  )

  const handleStart = async () => {
    if (!form.name) return
    setSaving(true)
    try {
      await startCapture(form)
      setShowForm(false)
      setForm({ name: '' })
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start capture')
    }
    setSaving(false)
  }

  const handleStop = async (id: number) => {
    try {
      await stopCapture(id)
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to stop capture')
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete capture "${name}"?`)) return
    try {
      await deleteCapture(id)
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-foreground">Packet Captures</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          On-demand tcpdump captures for network diagnostics. Start a capture, download the PCAP when finished, and analyze in Wireshark.
        </p>
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          Your Captures{' '}
          {data && <span className="text-[13px] font-normal text-muted-foreground">{data.total} total</span>}
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="h-3.5 w-3.5" /> New Capture
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          Failed to load captures: {error}
        </div>
      )}

      {data && (
        <>
          <div className="bg-card border border-border rounded-md">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Name</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">State</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Filter</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Size</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Started</th>
                  <th className="text-right text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                      No captures yet. Start one to begin recording traffic.
                    </td>
                  </tr>
                ) : (
                  data.items.map((cap) => {
                    const s = stateStyle(cap.state)
                    return (
                      <tr key={cap.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 text-[13px] font-medium text-primary">{cap.name}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-[12px] font-medium border rounded-full px-2 py-0.5 ${s.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            {s.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-muted-foreground font-mono">
                          {cap.filter_ip || cap.filter_mac || cap.filter_expression || '(all)'}
                        </td>
                        <td className="px-4 py-2.5 text-[13px] text-foreground">{formatBytes(cap.file_size_bytes)}</td>
                        <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                          {new Date(cap.started_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <CaptureActionMenu
                            capture={cap}
                            onStop={() => handleStop(cap.id)}
                            onDelete={() => handleDelete(cap.id, cap.name)}
                          />
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
            <span>{(page - 1) * 10 + 1}–{(page - 1) * 10 + data.items.length} of {data.total} items <span className="mx-2">|</span> Items per page: 10</span>
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

      {/* New capture modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative bg-card border border-border rounded-md shadow-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-foreground">Start Packet Capture</h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-accent transition-colors">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-foreground">Capture Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" placeholder="e.g. warp-handshake-test" />
              </div>
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-foreground">Filter by IP <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input type="text" value={form.filter_ip || ''} onChange={(e) => setForm({ ...form, filter_ip: e.target.value || undefined })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" placeholder="e.g. 10.0.1.105" />
              </div>
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-foreground">Filter by MAC <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input type="text" value={form.filter_mac || ''} onChange={(e) => setForm({ ...form, filter_mac: e.target.value || undefined })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" placeholder="e.g. aa:bb:cc:dd:ee:ff" />
              </div>
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-foreground">BPF expression <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input type="text" value={form.filter_expression || ''} onChange={(e) => setForm({ ...form, filter_expression: e.target.value || undefined })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" placeholder="e.g. port 443 and host 10.0.1.105" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleStart} disabled={saving || !form.name} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                <Play className="h-3.5 w-3.5" /> {saving ? 'Starting...' : 'Start Capture'}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
