import { useState, useRef, useEffect } from 'react'
import {
  Plus, Trash2, Pencil, RefreshCw, Search, MoreVertical, Power, PowerOff,
  ChevronLeft, ChevronRight, ArrowRight, ArrowLeft, Check, AlertCircle, Loader2,
} from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  getProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  type ImpairmentProfile,
  type ImpairmentProfileCreate,
  type MatchRule,
  type PaginatedResponse,
} from '@/lib/api'

/* ── Constants ──────────────────────────────────────────────────── */
type RuleMatchType = 'ip' | 'subnet' | 'mac'
const MATCH_TYPES: { value: RuleMatchType; label: string; desc: string }[] = [
  { value: 'ip',     label: 'Single IP',   desc: 'Match traffic by specific source and/or destination IP address' },
  { value: 'subnet', label: 'Subnet',       desc: 'Match traffic by source and/or destination subnet (CIDR)' },
  { value: 'mac',    label: 'MAC Address',  desc: 'Match traffic by source MAC address' },
]

const emptyRule: Omit<MatchRule, 'id' | 'profile_id'> = {
  src_ip: null, dst_ip: null, src_subnet: null, dst_subnet: null,
  mac_address: null, vlan_id: null, protocol: null, port: null,
}

function inferMatchType(rule: Omit<MatchRule, 'id' | 'profile_id'>): RuleMatchType {
  if (rule.mac_address) return 'mac'
  if (rule.src_subnet || rule.dst_subnet) return 'subnet'
  return 'ip'
}

const emptyForm: ImpairmentProfileCreate = {
  name: '', description: '', enabled: false, direction: 'outbound',
  latency_ms: 0, jitter_ms: 0, latency_correlation: 0, latency_distribution: '',
  packet_loss_percent: 0, loss_correlation: 0,
  corruption_percent: 0, corruption_correlation: 0,
  reorder_percent: 0, reorder_correlation: 0,
  duplicate_percent: 0, duplicate_correlation: 0,
  bandwidth_limit_kbps: 0, bandwidth_burst_kbytes: 0, bandwidth_ceil_kbps: 0,
  match_rules: [],
}

/* ── Wizard step definitions ────────────────────────────────────── */
const WIZARD_STEPS = [
  { id: 'info',       label: 'Profile info' },
  { id: 'impairment', label: 'Impairments' },
  { id: 'rate',       label: 'Rate control' },
  { id: 'match',      label: 'Traffic match' },
  { id: 'review',     label: 'Review & save' },
] as const
type WizardStepId = (typeof WIZARD_STEPS)[number]['id']

/* ── Shared input class ─────────────────────────────────────────── */
const inputCls = "w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
const labelCls = "text-[12px] font-medium text-muted-foreground mb-1.5 block"

/* ── Action menu (unchanged) ────────────────────────────────────── */
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
  const [editMode, setEditMode] = useState<'wizard' | 'flat'>('wizard')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ImpairmentProfileCreate>({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const { data, loading, error, refetch } = useApi<PaginatedResponse<ImpairmentProfile>>(
    () => getProfiles({ page: String(page), per_page: '10' }),
    [page]
  )

  const [ruleTypes, setRuleTypes] = useState<RuleMatchType[]>([])

  const openCreate = () => {
    setEditingId(null)
    setEditMode('wizard')
    setForm({ ...emptyForm })
    setRuleTypes([])
    setShowForm(true)
  }

  const openEdit = (p: ImpairmentProfile) => {
    setEditingId(p.id)
    setEditMode('flat')
    setForm({
      name: p.name,
      description: p.description || '',
      enabled: p.enabled,
      direction: p.direction || 'outbound',
      latency_ms: p.latency_ms,
      jitter_ms: p.jitter_ms,
      latency_correlation: p.latency_correlation,
      latency_distribution: p.latency_distribution,
      packet_loss_percent: p.packet_loss_percent,
      loss_correlation: p.loss_correlation,
      corruption_percent: p.corruption_percent,
      corruption_correlation: p.corruption_correlation,
      reorder_percent: p.reorder_percent,
      reorder_correlation: p.reorder_correlation,
      duplicate_percent: p.duplicate_percent,
      duplicate_correlation: p.duplicate_correlation,
      bandwidth_limit_kbps: p.bandwidth_limit_kbps,
      bandwidth_burst_kbytes: p.bandwidth_burst_kbytes,
      bandwidth_ceil_kbps: p.bandwidth_ceil_kbps,
      match_rules: p.match_rules.map(({ src_ip, dst_ip, src_subnet, dst_subnet, mac_address, vlan_id, protocol, port }) => ({
        src_ip, dst_ip, src_subnet, dst_subnet, mac_address, vlan_id, protocol, port,
      })),
    })
    setRuleTypes(p.match_rules.map((r) => inferMatchType(r)))
    setShowForm(true)
  }

  const normalizeRules = () => {
    return (form.match_rules || []).map((rule, idx) => {
      const mt = ruleTypes[idx] || 'ip'
      const r = { ...rule }
      if (mt === 'ip') {
        if (!r.src_ip && !r.dst_ip && !r.protocol && !r.port && !r.vlan_id) {
          r.src_ip = '0.0.0.0'
        }
        r.src_subnet = null; r.dst_subnet = null; r.mac_address = null
      } else if (mt === 'subnet') {
        if (!r.src_subnet) r.src_subnet = '0.0.0.0/0'
        if (!r.dst_subnet) r.dst_subnet = '0.0.0.0/0'
        r.src_ip = null; r.dst_ip = null; r.mac_address = null
      } else if (mt === 'mac') {
        r.src_ip = null; r.dst_ip = null; r.src_subnet = null; r.dst_subnet = null
      }
      return r
    })
  }

  const handleSave = async () => {
    setSaving(true)
    const payload = { ...form, match_rules: normalizeRules() }
    try {
      if (editingId) {
        await updateProfile(editingId, payload)
      } else {
        await createProfile(payload)
      }
      await refetch()
      if (editMode === 'flat') {
        setShowForm(false)
      } else {
        setTimeout(() => setShowForm(false), 2000)
      }
    } catch (err) {
      setSaving(false)
      throw err
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
          Create and manage network impairment rules using Linux tc/netem. Profiles support latency, jitter, packet loss, corruption, reordering, duplication, and rate control.
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
          <div className="bg-card border border-border rounded-md">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Profile name</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Direction</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Latency</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Loss</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Corrupt</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Reorder</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Rate</th>
                  <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  <th className="text-right text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
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
                      <td className="px-4 py-2.5 text-[13px] text-foreground capitalize">{p.direction || 'outbound'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.latency_ms > 0 ? `${p.latency_ms}ms${p.jitter_ms > 0 ? ` ±${p.jitter_ms}ms` : ''}` : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.packet_loss_percent > 0 ? `${p.packet_loss_percent}%` : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.corruption_percent > 0 ? `${p.corruption_percent}%` : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.reorder_percent > 0 ? `${p.reorder_percent}%` : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-foreground">{p.bandwidth_limit_kbps > 0 ? `${p.bandwidth_limit_kbps} kbps` : '—'}</td>
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

      {/* ── Form overlay: wizard for create, flat editor for edit ── */}
      {showForm && editMode === 'wizard' && (
        <ProfileWizard
          editingId={editingId}
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          ruleTypes={ruleTypes}
          setRuleTypes={setRuleTypes}
        />
      )}
      {showForm && editMode === 'flat' && editingId && (
        <ProfileFlatEditor
          editingId={editingId}
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={handleSave}
          onClose={() => setShowForm(false)}
          ruleTypes={ruleTypes}
          setRuleTypes={setRuleTypes}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Profile Wizard — Cloudflare-style multi-step create / edit
   ══════════════════════════════════════════════════════════════════ */

function ProfileWizard({ editingId, form, setForm, saving, onSave, onClose, ruleTypes, setRuleTypes }: {
  editingId: number | null
  form: ImpairmentProfileCreate
  setForm: (f: ImpairmentProfileCreate) => void
  saving: boolean
  onSave: () => Promise<void>
  onClose: () => void
  ruleTypes: RuleMatchType[]
  setRuleTypes: React.Dispatch<React.SetStateAction<RuleMatchType[]>>
}) {
  const [step, setStep] = useState<WizardStepId>('info')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveDone, setSaveDone] = useState(false)

  const stepIdx = WIZARD_STEPS.findIndex((s) => s.id === step)

  const canGoNext = (): boolean => {
    if (step === 'info') return !!form.name.trim()
    return true
  }

  const goNext = () => { if (stepIdx < WIZARD_STEPS.length - 1) setStep(WIZARD_STEPS[stepIdx + 1].id) }
  const goBack = () => { if (stepIdx > 0) setStep(WIZARD_STEPS[stepIdx - 1].id) }

  const handleDeploy = async () => {
    setSaveError(null)
    try {
      await onSave()
      setSaveDone(true)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const updateRule = (idx: number, patch: Record<string, unknown>) => {
    const rules = [...(form.match_rules || [])]
    rules[idx] = { ...rules[idx], ...patch }
    setForm({ ...form, match_rules: rules })
  }

  const removeRule = (idx: number) => {
    const rules = [...(form.match_rules || [])]
    rules.splice(idx, 1)
    setForm({ ...form, match_rules: rules })
    setRuleTypes((prev) => { const n = [...prev]; n.splice(idx, 1); return n })
  }

  const setRuleType = (idx: number, type: RuleMatchType) => {
    setRuleTypes((prev) => { const n = [...prev]; n[idx] = type; return n })
    // Clear fields that don't belong to the new type
    const cleared: Record<string, unknown> = {}
    if (type === 'ip') {
      cleared.src_subnet = null; cleared.dst_subnet = null; cleared.mac_address = null
    } else if (type === 'subnet') {
      cleared.src_ip = null; cleared.dst_ip = null; cleared.mac_address = null
    } else if (type === 'mac') {
      cleared.src_ip = null; cleared.dst_ip = null; cleared.src_subnet = null; cleared.dst_subnet = null
    }
    updateRule(idx, cleared)
  }

  const addRule = () => {
    setForm({ ...form, match_rules: [...(form.match_rules || []), { ...emptyRule }] })
    setRuleTypes((prev) => [...prev, 'ip'])
  }

  /* ── Summary helpers ── */
  const hasImpairments = (form.latency_ms || 0) > 0 || (form.packet_loss_percent || 0) > 0 ||
    (form.corruption_percent || 0) > 0 || (form.reorder_percent || 0) > 0 || (form.duplicate_percent || 0) > 0
  const hasRate = (form.bandwidth_limit_kbps || 0) > 0

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      {/* ── Top header bar ── */}
      <header className="sticky top-0 z-10 h-[52px] border-b border-border bg-card flex items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-semibold text-foreground">
            {editingId ? 'Edit Profile' : 'Create Profile'}
          </span>
          <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">Wizard</span>
        </div>
        <button onClick={onClose} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </header>

      <div className="max-w-[860px] mx-auto px-6 py-8">
        {/* ── Page heading ── */}
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold text-foreground">
            {editingId ? 'Edit impairment profile' : 'Create impairment profile'}
          </h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Configure network impairment parameters step by step. All settings use Linux tc/netem under the hood.
          </p>
        </div>

        {/* ── Step tabs ── */}
        <div className="flex border-b border-border mb-8">
          {WIZARD_STEPS.map((s, i) => {
            const isActive = s.id === step
            const isCompleted = i < stepIdx
            const isClickable = i <= stepIdx
            return (
              <button
                key={s.id}
                onClick={() => isClickable && setStep(s.id)}
                className={`relative flex items-center gap-2 px-5 py-3 text-[13px] font-medium transition-colors ${
                  isActive ? 'text-foreground'
                    : isCompleted ? 'text-primary cursor-pointer hover:text-primary/80'
                    : 'text-muted-foreground cursor-default'
                }`}
              >
                <span className={`w-5 h-5 rounded-full text-[11px] font-bold inline-flex items-center justify-center flex-shrink-0 ${
                  isCompleted ? 'bg-primary text-white'
                    : isActive ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {isCompleted ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {s.label}
                {isActive && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t" />}
              </button>
            )
          })}
        </div>

        {/* ═══ Step 1: Profile info ═══ */}
        {step === 'info' && (
          <div>
            <h2 className="text-[16px] font-semibold text-foreground mb-1">Profile information</h2>
            <p className="text-[13px] text-muted-foreground mb-6">
              Give this profile a descriptive name so you can easily identify it later.
            </p>

            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">General</h3>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className={labelCls}>Profile name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. Delta Economy Class"
                  />
                </div>
                <div>
                  <label className={labelCls}>Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <textarea
                    value={form.description || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })}
                    rows={3}
                    className={inputCls}
                    placeholder="Brief description of this impairment scenario"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Traffic direction</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Choose which direction of traffic this profile should impair</p>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { value: 'outbound', label: 'Outbound', desc: 'Egress traffic leaving the LAN interface' },
                    { value: 'inbound', label: 'Inbound', desc: 'Ingress traffic arriving on the LAN interface (via IFB)' },
                    { value: 'both', label: 'Both', desc: 'Apply impairments in both directions' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, direction: opt.value })}
                      className={`text-left rounded-lg border p-4 transition-colors ${
                        form.direction === opt.value
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-foreground">{opt.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Step 2: Impairments ═══ */}
        {step === 'impairment' && (
          <div>
            <h2 className="text-[16px] font-semibold text-foreground mb-1">Network impairments</h2>
            <p className="text-[13px] text-muted-foreground mb-6">
              Configure latency, jitter, packet loss, corruption, reordering, and duplication. Leave values at 0 to skip.
            </p>

            {/* Latency / Jitter */}
            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Latency / Jitter</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Add fixed or variable delay to packets (tc netem delay)</p>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Delay (ms)</label>
                  <input type="number" min={0} value={form.latency_ms} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, latency_ms: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Jitter (ms)</label>
                  <input type="number" min={0} value={form.jitter_ms} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, jitter_ms: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Correlation (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.latency_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, latency_correlation: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Distribution</label>
                  <select value={form.latency_distribution} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, latency_distribution: e.target.value })} className={inputCls}>
                    <option value="">None</option>
                    <option value="normal">Normal</option>
                    <option value="pareto">Pareto</option>
                    <option value="paretonormal">Pareto-Normal</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Packet Loss */}
            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Packet Loss</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Randomly drop packets (tc netem loss)</p>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Loss (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.packet_loss_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, packet_loss_percent: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Correlation (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.loss_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, loss_correlation: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
            </div>

            {/* Corruption */}
            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Packet Corruption</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Randomly flip bits in packets (tc netem corrupt)</p>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Corruption (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.corruption_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, corruption_percent: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Correlation (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.corruption_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, corruption_correlation: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
            </div>

            {/* Reordering */}
            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Packet Reordering</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Reorder packets (tc netem reorder). Requires delay &gt; 0.</p>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Reorder (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.reorder_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, reorder_percent: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Correlation (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.reorder_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, reorder_correlation: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
            </div>

            {/* Duplication */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Packet Duplication</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">Randomly duplicate packets (tc netem duplicate)</p>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Duplication (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.duplicate_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, duplicate_percent: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Correlation (%)</label>
                  <input type="number" min={0} max={100} step={0.1} value={form.duplicate_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, duplicate_correlation: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Step 3: Rate control ═══ */}
        {step === 'rate' && (
          <div>
            <h2 className="text-[16px] font-semibold text-foreground mb-1">Rate control</h2>
            <p className="text-[13px] text-muted-foreground mb-6">
              Limit bandwidth using HTB qdisc. Set all values to 0 for unlimited throughput.
            </p>

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Bandwidth shaping</h3>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Rate limit (kbps)</label>
                  <input type="number" min={0} value={form.bandwidth_limit_kbps} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bandwidth_limit_kbps: Number(e.target.value) })} className={inputCls} placeholder="0 = unlimited" />
                  <p className="text-[11px] text-muted-foreground mt-1">Guaranteed minimum bandwidth</p>
                </div>
                <div>
                  <label className={labelCls}>Ceil (kbps)</label>
                  <input type="number" min={0} value={form.bandwidth_ceil_kbps} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bandwidth_ceil_kbps: Number(e.target.value) })} className={inputCls} placeholder="0 = same as rate" />
                  <p className="text-[11px] text-muted-foreground mt-1">Maximum burst bandwidth when available</p>
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Burst (KB)</label>
                  <input type="number" min={0} value={form.bandwidth_burst_kbytes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bandwidth_burst_kbytes: Number(e.target.value) })} className={inputCls} placeholder="0 = auto" />
                  <p className="text-[11px] text-muted-foreground mt-1">Bytes that can be sent at ceil speed before throttling (0 = kernel default)</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Step 4: Traffic match ═══ */}
        {step === 'match' && (
          <div>
            <h2 className="text-[16px] font-semibold text-foreground mb-1">Traffic match rules</h2>
            <p className="text-[13px] text-muted-foreground mb-6">
              Define which traffic this profile applies to. Without rules, the profile will match all traffic on the LAN interface.
            </p>

            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] font-medium text-foreground">{(form.match_rules || []).length} rule{(form.match_rules || []).length !== 1 ? 's' : ''} defined</span>
              <button
                type="button"
                onClick={addRule}
                className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Add rule
              </button>
            </div>

            {(form.match_rules || []).length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-[13px] text-muted-foreground">No match rules defined.</p>
                <p className="text-[12px] text-muted-foreground mt-1">This profile will apply to <strong>all traffic</strong> on the LAN interface.</p>
              </div>
            )}

            <div className="space-y-4">
              {(form.match_rules || []).map((rule, idx) => {
                const matchType = ruleTypes[idx] || 'ip'
                return (
                <div key={idx} className="rounded-lg border border-border overflow-hidden">
                  <div className="bg-muted/40 px-5 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold text-foreground">Rule {idx + 1}</h3>
                    <button type="button" onClick={() => removeRule(idx)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="p-5">
                    {/* Match type selector */}
                    <div className="mb-5">
                      <label className={labelCls}>Match type</label>
                      <div className="grid grid-cols-3 gap-3 mt-1">
                        {MATCH_TYPES.map((mt) => (
                          <button
                            key={mt.value}
                            type="button"
                            onClick={() => setRuleType(idx, mt.value)}
                            className={`text-left rounded-lg border p-3 transition-colors ${
                              matchType === mt.value
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'border-border hover:border-muted-foreground/30'
                            }`}
                          >
                            <div className="text-[13px] font-semibold text-foreground">{mt.label}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">{mt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Type-specific fields */}
                    {matchType === 'ip' && (
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className={labelCls}>Source IP</label>
                          <input type="text" value={rule.src_ip || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { src_ip: e.target.value || null })} placeholder="e.g. 10.0.1.50" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>Destination IP</label>
                          <input type="text" value={rule.dst_ip || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { dst_ip: e.target.value || null })} placeholder="e.g. 8.8.8.8" className={inputCls} />
                        </div>
                      </div>
                    )}

                    {matchType === 'subnet' && (
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className={labelCls}>Source Subnet</label>
                          <input type="text" value={rule.src_subnet || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { src_subnet: e.target.value || null })} placeholder="10.100.123.0/24" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>Destination Subnet</label>
                          <input type="text" value={rule.dst_subnet || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { dst_subnet: e.target.value || null })} placeholder="0.0.0.0/0" className={inputCls} />
                        </div>
                      </div>
                    )}

                    {matchType === 'mac' && (
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className={labelCls}>MAC Address</label>
                          <input type="text" value={rule.mac_address || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { mac_address: e.target.value || null })} placeholder="e.g. aa:bb:cc:dd:ee:ff" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>VLAN ID</label>
                          <input type="number" min={0} max={4094} value={rule.vlan_id ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { vlan_id: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 100" className={inputCls} />
                        </div>
                      </div>
                    )}

                    {/* Common fields: VLAN (for ip/subnet), Protocol, Port */}
                    <div className="grid grid-cols-2 gap-4">
                      {matchType !== 'mac' && (
                        <div>
                          <label className={labelCls}>VLAN ID</label>
                          <input type="number" min={0} max={4094} value={rule.vlan_id ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { vlan_id: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 100" className={inputCls} />
                        </div>
                      )}
                      <div>
                        <label className={labelCls}>Protocol</label>
                        <select value={rule.protocol || ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateRule(idx, { protocol: e.target.value || null })} className={inputCls}>
                          <option value="">Any</option>
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                          <option value="icmp">ICMP</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Port</label>
                        <input type="number" min={0} max={65535} value={rule.port ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { port: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 443" className={inputCls} />
                      </div>
                    </div>
                  </div>
                </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ═══ Step 5: Review & save ═══ */}
        {step === 'review' && (
          <div>
            {!saving && !saveDone && (
              <>
                <h2 className="text-[16px] font-semibold text-foreground mb-1">Review your profile</h2>
                <p className="text-[13px] text-muted-foreground mb-6">
                  Verify the settings below, then save to {editingId ? 'update' : 'create'} the profile.
                </p>

                {/* Summary table */}
                <div className="rounded-lg border border-border overflow-hidden mb-6">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border">
                        <th className="text-left px-5 py-2.5 font-medium text-muted-foreground w-[200px]">Setting</th>
                        <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Name</td><td className="px-5 py-2.5 font-medium text-foreground">{form.name}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Description</td><td className="px-5 py-2.5 text-foreground">{form.description || '—'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Direction</td><td className="px-5 py-2.5 font-medium text-foreground capitalize">{form.direction || 'outbound'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Latency</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{(form.latency_ms || 0) > 0 ? `${form.latency_ms}ms${(form.jitter_ms || 0) > 0 ? ` ±${form.jitter_ms}ms` : ''}` : '—'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Packet loss</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{(form.packet_loss_percent || 0) > 0 ? `${form.packet_loss_percent}%` : '—'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Corruption</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{(form.corruption_percent || 0) > 0 ? `${form.corruption_percent}%` : '—'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Reordering</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{(form.reorder_percent || 0) > 0 ? `${form.reorder_percent}%` : '—'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Duplication</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{(form.duplicate_percent || 0) > 0 ? `${form.duplicate_percent}%` : '—'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Bandwidth</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{hasRate ? `${form.bandwidth_limit_kbps} kbps` : 'Unlimited'}</td></tr>
                      <tr>
                        <td className="px-5 py-2.5 text-muted-foreground align-top">Match rules</td>
                        <td className="px-5 py-2.5 font-medium text-foreground">
                          {(form.match_rules || []).length === 0
                            ? 'All traffic'
                            : (form.match_rules || []).map((r, i) => {
                                const mt = ruleTypes[i] || inferMatchType(r)
                                const parts: string[] = []
                                if (mt === 'ip') {
                                  if (r.src_ip) parts.push(`src ${r.src_ip}`)
                                  if (r.dst_ip) parts.push(`dst ${r.dst_ip}`)
                                } else if (mt === 'subnet') {
                                  if (r.src_subnet) parts.push(`src ${r.src_subnet}`)
                                  if (r.dst_subnet) parts.push(`dst ${r.dst_subnet}`)
                                } else if (mt === 'mac') {
                                  if (r.mac_address) parts.push(`mac ${r.mac_address}`)
                                }
                                if (r.protocol) parts.push(r.protocol.toUpperCase())
                                if (r.port) parts.push(`port ${r.port}`)
                                if (r.vlan_id) parts.push(`vlan ${r.vlan_id}`)
                                return (
                                  <div key={i} className="text-[12px] font-mono">
                                    Rule {i + 1}: {parts.length > 0 ? parts.join(', ') : 'match all'}
                                  </div>
                                )
                              })
                          }
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Enable toggle */}
                <div className="rounded-lg border border-border overflow-hidden mb-6">
                  <div className="px-5 py-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-[13px] font-semibold text-foreground">Enable immediately</h3>
                      <p className="text-[12px] text-muted-foreground mt-0.5">Apply tc/netem rules as soon as the profile is saved</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, enabled: !form.enabled })}
                      className={`relative w-9 h-5 rounded-full transition-colors ${form.enabled ? 'bg-primary' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                </div>

                {!hasImpairments && !hasRate && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 mb-6">
                    <div className="flex gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-[12px] text-amber-800">
                        No impairments or rate limits are configured. This profile will not affect traffic until you add some parameters.
                      </p>
                    </div>
                  </div>
                )}

                {saveError && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 mb-6">
                    <div className="flex gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <p className="text-[12px] text-red-800">{saveError}</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {saving && !saveDone && (
              <div className="text-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
                <h2 className="text-[16px] font-semibold text-foreground mb-1">Saving profile...</h2>
                <p className="text-[13px] text-muted-foreground">
                  {form.enabled ? 'Saving configuration and applying tc/netem rules.' : 'Saving configuration.'}
                </p>
              </div>
            )}

            {saveDone && (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 mb-4">
                  <Check className="h-6 w-6 text-emerald-600" />
                </div>
                <h2 className="text-[16px] font-semibold text-foreground mb-1">
                  Profile {editingId ? 'updated' : 'created'}!
                </h2>
                <p className="text-[13px] text-muted-foreground">
                  {form.enabled ? 'The impairment rules are now active.' : 'The profile is saved but not yet enabled.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Bottom navigation ── */}
        {!(saving || saveDone) && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
            <div>
              {stepIdx > 0 && (
                <button
                  onClick={goBack}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              )}
            </div>
            <div>
              {step !== 'review' ? (
                <button
                  onClick={goNext}
                  disabled={!canGoNext()}
                  className="inline-flex items-center gap-2 px-5 py-2 text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleDeploy}
                  disabled={saving || !form.name.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2 text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {editingId ? 'Update profile' : 'Create profile'} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════════
   Profile Flat Editor — Single-page edit view for existing profiles
   ══════════════════════════════════════════════════════════════════ */

function ProfileFlatEditor({ editingId, form, setForm, saving, onSave, onClose, ruleTypes, setRuleTypes }: {
  editingId: number
  form: ImpairmentProfileCreate
  setForm: (f: ImpairmentProfileCreate) => void
  saving: boolean
  onSave: () => Promise<void>
  onClose: () => void
  ruleTypes: RuleMatchType[]
  setRuleTypes: React.Dispatch<React.SetStateAction<RuleMatchType[]>>
}) {
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setSaveError(null)
    try {
      await onSave()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const updateRule = (idx: number, patch: Record<string, unknown>) => {
    const rules = [...(form.match_rules || [])]
    rules[idx] = { ...rules[idx], ...patch }
    setForm({ ...form, match_rules: rules })
  }

  const removeRule = (idx: number) => {
    const rules = [...(form.match_rules || [])]
    rules.splice(idx, 1)
    setForm({ ...form, match_rules: rules })
    setRuleTypes((prev: RuleMatchType[]) => { const n = [...prev]; n.splice(idx, 1); return n })
  }

  const setRuleType = (idx: number, type: RuleMatchType) => {
    setRuleTypes((prev: RuleMatchType[]) => { const n = [...prev]; n[idx] = type; return n })
    const cleared: Record<string, unknown> = {}
    if (type === 'ip') {
      cleared.src_subnet = null; cleared.dst_subnet = null; cleared.mac_address = null
    } else if (type === 'subnet') {
      cleared.src_ip = null; cleared.dst_ip = null; cleared.mac_address = null
    } else if (type === 'mac') {
      cleared.src_ip = null; cleared.dst_ip = null; cleared.src_subnet = null; cleared.dst_subnet = null
    }
    updateRule(idx, cleared)
  }

  const addRule = () => {
    setForm({ ...form, match_rules: [...(form.match_rules || []), { ...emptyRule }] })
    setRuleTypes((prev: RuleMatchType[]) => [...prev, 'ip'])
  }

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      {/* Top header bar */}
      <header className="sticky top-0 z-10 h-[52px] border-b border-border bg-card flex items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-semibold text-foreground">Edit Profile</span>
          <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">#{editingId}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-[6px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save changes
          </button>
        </div>
      </header>

      <div className="max-w-[860px] mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold text-foreground">Edit impairment profile</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            All settings are shown on a single page. Make your changes and save.
          </p>
        </div>

        {saveError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 mb-6">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-[12px] text-red-800">{saveError}</p>
            </div>
          </div>
        )}

        {/* ── Section: Profile info ── */}
        <div className="rounded-lg border border-border overflow-hidden mb-6">
          <div className="bg-muted/40 px-5 py-3 border-b border-border">
            <h3 className="text-[13px] font-semibold text-foreground">Profile information</h3>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Profile name</label>
                <input type="text" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Direction</label>
                <select value={form.direction} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, direction: e.target.value as 'outbound' | 'inbound' | 'both' })} className={inputCls}>
                  <option value="outbound">Outbound</option>
                  <option value="inbound">Inbound</option>
                  <option value="both">Both</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <textarea value={form.description || ''} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })} rows={2} className={inputCls} />
            </div>
            <div className="flex items-center justify-between pt-2">
              <div>
                <span className="text-[13px] font-medium text-foreground">Enabled</span>
                <p className="text-[11px] text-muted-foreground">Apply tc/netem rules immediately</p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, enabled: !form.enabled })}
                className={`relative w-9 h-5 rounded-full transition-colors ${form.enabled ? 'bg-primary' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Section: Latency / Jitter ── */}
        <div className="rounded-lg border border-border overflow-hidden mb-6">
          <div className="bg-muted/40 px-5 py-3 border-b border-border">
            <h3 className="text-[13px] font-semibold text-foreground">Latency / Jitter</h3>
          </div>
          <div className="p-5 grid grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Delay (ms)</label>
              <input type="number" min={0} value={form.latency_ms} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, latency_ms: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Jitter (ms)</label>
              <input type="number" min={0} value={form.jitter_ms} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, jitter_ms: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Correlation (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.latency_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, latency_correlation: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Distribution</label>
              <select value={form.latency_distribution} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, latency_distribution: e.target.value })} className={inputCls}>
                <option value="">None</option>
                <option value="normal">Normal</option>
                <option value="pareto">Pareto</option>
                <option value="paretonormal">Pareto-Normal</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Section: Packet Loss / Corruption / Reorder / Duplicate (compact) ── */}
        <div className="rounded-lg border border-border overflow-hidden mb-6">
          <div className="bg-muted/40 px-5 py-3 border-b border-border">
            <h3 className="text-[13px] font-semibold text-foreground">Loss, Corruption, Reorder & Duplication</h3>
          </div>
          <div className="p-5 grid grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Loss (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.packet_loss_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, packet_loss_percent: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Loss corr. (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.loss_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, loss_correlation: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Corruption (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.corruption_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, corruption_percent: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Corrupt corr. (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.corruption_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, corruption_correlation: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Reorder (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.reorder_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, reorder_percent: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Reorder corr. (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.reorder_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, reorder_correlation: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Duplicate (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.duplicate_percent} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, duplicate_percent: Number(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Dup. corr. (%)</label>
              <input type="number" min={0} max={100} step={0.1} value={form.duplicate_correlation} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, duplicate_correlation: Number(e.target.value) })} className={inputCls} />
            </div>
          </div>
        </div>

        {/* ── Section: Rate control ── */}
        <div className="rounded-lg border border-border overflow-hidden mb-6">
          <div className="bg-muted/40 px-5 py-3 border-b border-border">
            <h3 className="text-[13px] font-semibold text-foreground">Rate control</h3>
          </div>
          <div className="p-5 grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Rate limit (kbps)</label>
              <input type="number" min={0} value={form.bandwidth_limit_kbps} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bandwidth_limit_kbps: Number(e.target.value) })} className={inputCls} placeholder="0 = unlimited" />
            </div>
            <div>
              <label className={labelCls}>Ceil (kbps)</label>
              <input type="number" min={0} value={form.bandwidth_ceil_kbps} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bandwidth_ceil_kbps: Number(e.target.value) })} className={inputCls} placeholder="0 = same as rate" />
            </div>
            <div>
              <label className={labelCls}>Burst (KB)</label>
              <input type="number" min={0} value={form.bandwidth_burst_kbytes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, bandwidth_burst_kbytes: Number(e.target.value) })} className={inputCls} placeholder="0 = auto" />
            </div>
          </div>
        </div>

        {/* ── Section: Traffic match rules ── */}
        <div className="rounded-lg border border-border overflow-hidden mb-6">
          <div className="bg-muted/40 px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">Traffic match rules ({(form.match_rules || []).length})</h3>
            <button type="button" onClick={addRule} className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              <Plus className="h-3 w-3" /> Add rule
            </button>
          </div>
          <div className="p-5">
            {(form.match_rules || []).length === 0 && (
              <p className="text-[13px] text-muted-foreground text-center py-4">No match rules — profile applies to all traffic.</p>
            )}
            <div className="space-y-4">
              {(form.match_rules || []).map((rule, idx) => {
                const matchType = ruleTypes[idx] || 'ip'
                return (
                  <div key={idx} className="rounded border border-border p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[12px] font-semibold text-foreground">Rule {idx + 1}</span>
                      <button type="button" onClick={() => removeRule(idx)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className={labelCls}>Match type</label>
                        <select value={matchType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRuleType(idx, e.target.value as RuleMatchType)} className={inputCls}>
                          <option value="ip">Single IP</option>
                          <option value="subnet">Subnet</option>
                          <option value="mac">MAC</option>
                        </select>
                      </div>
                      {matchType === 'ip' && (
                        <>
                          <div>
                            <label className={labelCls}>Source IP</label>
                            <input type="text" value={rule.src_ip || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { src_ip: e.target.value || null })} placeholder="10.0.1.50" className={inputCls} />
                          </div>
                          <div>
                            <label className={labelCls}>Destination IP</label>
                            <input type="text" value={rule.dst_ip || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { dst_ip: e.target.value || null })} placeholder="8.8.8.8" className={inputCls} />
                          </div>
                        </>
                      )}
                      {matchType === 'subnet' && (
                        <>
                          <div>
                            <label className={labelCls}>Source Subnet</label>
                            <input type="text" value={rule.src_subnet || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { src_subnet: e.target.value || null })} placeholder="10.0.1.0/24" className={inputCls} />
                          </div>
                          <div>
                            <label className={labelCls}>Dest Subnet</label>
                            <input type="text" value={rule.dst_subnet || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { dst_subnet: e.target.value || null })} placeholder="0.0.0.0/0" className={inputCls} />
                          </div>
                        </>
                      )}
                      {matchType === 'mac' && (
                        <div>
                          <label className={labelCls}>MAC Address</label>
                          <input type="text" value={rule.mac_address || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { mac_address: e.target.value || null })} placeholder="aa:bb:cc:dd:ee:ff" className={inputCls} />
                        </div>
                      )}
                      <div>
                        <label className={labelCls}>Protocol</label>
                        <select value={rule.protocol || ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateRule(idx, { protocol: e.target.value || null })} className={inputCls}>
                          <option value="">Any</option>
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                          <option value="icmp">ICMP</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3 mt-3">
                      <div>
                        <label className={labelCls}>Port</label>
                        <input type="number" min={0} max={65535} value={rule.port ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { port: e.target.value ? Number(e.target.value) : null })} placeholder="443" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>VLAN ID</label>
                        <input type="number" min={0} max={4094} value={rule.vlan_id ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRule(idx, { vlan_id: e.target.value ? Number(e.target.value) : null })} placeholder="100" className={inputCls} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Bottom save bar */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
