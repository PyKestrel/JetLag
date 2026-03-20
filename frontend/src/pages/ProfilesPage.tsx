import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, Pencil, RefreshCw, Search, MoreVertical, Power, PowerOff, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  getProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  type ImpairmentProfile,
  type ImpairmentProfileCreate,
  type PaginatedResponse,
} from '@/lib/api'

const emptyForm: ImpairmentProfileCreate = {
  name: '',
  description: '',
  enabled: false,
  latency_ms: 0,
  jitter_ms: 0,
  packet_loss_percent: 0,
  bandwidth_limit_kbps: 0,
  match_rules: [],
}

function ProfileActionMenu({ profile, onEdit, onToggle, onDelete }: {
  profile: ImpairmentProfile
  onEdit: () => void
  onToggle: () => void
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
          <button onClick={() => { onEdit(); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors flex items-center gap-2">
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> Edit
          </button>
          <button onClick={() => { onToggle(); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors flex items-center gap-2">
            {profile.enabled ? <PowerOff className="h-3.5 w-3.5 text-red-500" /> : <Power className="h-3.5 w-3.5 text-emerald-500" />}
            {profile.enabled ? 'Disable' : 'Enable'}
          </button>
          <div className="my-1 border-t border-border" />
          <button onClick={() => { onDelete(); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

export default function ProfilesPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ImpairmentProfileCreate>({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const { data, loading, error, refetch } = useApi<PaginatedResponse<ImpairmentProfile>>(
    () => getProfiles({ page: String(page), per_page: '10' }),
    [page]
  )

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setShowForm(true)
  }

  const openEdit = (p: ImpairmentProfile) => {
    setEditingId(p.id)
    setForm({
      name: p.name,
      description: p.description || '',
      enabled: p.enabled,
      latency_ms: p.latency_ms,
      jitter_ms: p.jitter_ms,
      packet_loss_percent: p.packet_loss_percent,
      bandwidth_limit_kbps: p.bandwidth_limit_kbps,
      match_rules: p.match_rules.map(({ src_ip, dst_ip, src_subnet, dst_subnet, mac_address, vlan_id, protocol, port }) => ({
        src_ip, dst_ip, src_subnet, dst_subnet, mac_address, vlan_id, protocol, port,
      })),
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editingId) {
        await updateProfile(editingId, form)
      } else {
        await createProfile(form)
      }
      setShowForm(false)
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed')
    }
    setSaving(false)
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete profile "${name}"?`)) return
    try {
      await deleteProfile(id)
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const handleToggle = async (p: ImpairmentProfile) => {
    try {
      await updateProfile(p.id, { enabled: !p.enabled })
      await refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Toggle failed')
    }
  }

  const filtered = data?.items.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
  })

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-foreground">Impairment Profiles</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Create and manage network impairment rules. Profiles apply latency, jitter, packet loss, and bandwidth throttling to matched traffic.
        </p>
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          Your Profiles{' '}
          {data && <span className="text-[13px] font-normal text-muted-foreground">Showing {filtered?.length ?? 0} of {data.total}</span>}
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Create a profile
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by profile name..."
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
          Failed to load profiles: {error}
        </div>
      )}

      {data && filtered && (
        <>
          <div className="bg-card border border-border rounded-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Profile name</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Latency</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Jitter</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Loss</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">BW Limit</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Rules</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  <th className="text-right text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                      {search ? 'No profiles match your search' : 'No impairment profiles yet. Create one to get started.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <div>
                          <span className="text-[13px] font-medium text-primary cursor-pointer hover:underline" onClick={() => openEdit(p)}>{p.name}</span>
                          {p.description && <p className="text-[12px] text-muted-foreground mt-0.5 truncate max-w-[250px]">{p.description}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.latency_ms}ms</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.jitter_ms}ms</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.packet_loss_percent}%</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.bandwidth_limit_kbps ? `${p.bandwidth_limit_kbps} kbps` : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.match_rules.length}</td>
                      <td className="px-4 py-2.5">
                        {p.enabled ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                            INACTIVE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ProfileActionMenu
                          profile={p}
                          onEdit={() => openEdit(p)}
                          onToggle={() => handleToggle(p)}
                          onDelete={() => handleDelete(p.id, p.name)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-3 text-[12px] text-muted-foreground">
            <span>1–{filtered.length} of {data.total} items <span className="mx-2">|</span> Items per page: 10</span>
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

      {/* Slide-out panel for create/edit */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative w-full max-w-lg bg-card border-l border-border shadow-xl overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-[16px] font-semibold text-foreground">
                  {editingId ? 'Edit Profile' : 'Create Profile'}
                </h2>
                <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-accent transition-colors">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g. Delta Economy Class"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Description</label>
                  <textarea
                    value={form.description || ''}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Optional description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[13px] font-medium text-foreground">Latency (ms)</label>
                    <input type="number" min={0} value={form.latency_ms} onChange={(e) => setForm({ ...form, latency_ms: Number(e.target.value) })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[13px] font-medium text-foreground">Jitter (ms)</label>
                    <input type="number" min={0} value={form.jitter_ms} onChange={(e) => setForm({ ...form, jitter_ms: Number(e.target.value) })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[13px] font-medium text-foreground">Packet Loss (%)</label>
                    <input type="number" min={0} max={100} step={0.1} value={form.packet_loss_percent} onChange={(e) => setForm({ ...form, packet_loss_percent: Number(e.target.value) })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[13px] font-medium text-foreground">BW Limit (kbps)</label>
                    <input type="number" min={0} value={form.bandwidth_limit_kbps} onChange={(e) => setForm({ ...form, bandwidth_limit_kbps: Number(e.target.value) })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" placeholder="0 = unlimited" />
                  </div>
                </div>
                <div className="flex items-center justify-between py-2">
                  <label className="text-[13px] font-medium text-foreground">Enable immediately</label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, enabled: !form.enabled })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.enabled ? 'bg-primary' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${form.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                  </button>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button onClick={handleSave} disabled={saving || !form.name} className="flex-1 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {saving ? 'Saving...' : editingId ? 'Update Profile' : 'Create Profile'}
                </button>
                <button onClick={() => setShowForm(false)} className="px-4 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
