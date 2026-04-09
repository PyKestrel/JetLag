import { useState, useEffect, useRef } from 'react'
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  getFirewallRules,
  createFirewallRule,
  updateFirewallRule,
  deleteFirewallRule,
  applyFirewallRules,
  getFirewallStatus,
  type FirewallRule,
  type FirewallRuleCreate,
  type PaginatedResponse,
} from '@/lib/api'

const EMPTY_FORM: FirewallRuleCreate = {
  name: '',
  enabled: true,
  priority: 100,
  direction: 'forward',
  action: 'drop',
  protocol: 'any',
  src_ip: null,
  dst_ip: null,
  src_port: null,
  dst_port: null,
  comment: null,
}

const PRESETS: { label: string; desc: string; rule: Partial<FirewallRuleCreate> }[] = [
  {
    label: 'Block UDP MASQUE (443)',
    desc: 'Block MASQUE/QUIC tunneling on UDP port 443',
    rule: { name: 'Block UDP MASQUE', protocol: 'udp', dst_port: '443', action: 'drop', direction: 'forward', comment: 'Block MASQUE/QUIC tunneling' },
  },
  {
    label: 'Block all QUIC',
    desc: 'Drop all UDP traffic on port 443 (forces TCP HTTPS fallback)',
    rule: { name: 'Block QUIC', protocol: 'udp', dst_port: '443', action: 'reject', direction: 'forward', comment: 'Force TCP HTTPS fallback' },
  },
  {
    label: 'Block DNS over HTTPS',
    desc: 'Block common DoH providers to enforce local DNS',
    rule: { name: 'Block DoH', protocol: 'tcp', dst_port: '443', dst_ip: '1.1.1.1', action: 'drop', direction: 'forward', comment: 'Block Cloudflare DoH' },
  },
  {
    label: 'Block BitTorrent',
    desc: 'Block common BitTorrent port range',
    rule: { name: 'Block BitTorrent', protocol: 'tcp', dst_port: '6881-6889', action: 'drop', direction: 'forward', comment: 'Block BitTorrent traffic' },
  },
]

const directionBadge = (d: string) => {
  const cls: Record<string, string> = {
    forward: 'bg-blue-100 text-blue-700',
    inbound: 'bg-purple-100 text-purple-700',
    outbound: 'bg-amber-100 text-amber-700',
  }
  return cls[d] || 'bg-gray-100 text-gray-700'
}

const actionBadge = (a: string) => {
  const cls: Record<string, string> = {
    drop: 'bg-red-100 text-red-700',
    reject: 'bg-orange-100 text-orange-700',
    accept: 'bg-emerald-100 text-emerald-700',
  }
  return cls[a] || 'bg-gray-100 text-gray-700'
}

export default function FirewallPage() {
  const { data, loading, error, refetch } = useApi<PaginatedResponse<FirewallRule>>(getFirewallRules)
  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null)
  const [form, setForm] = useState<FirewallRuleCreate>({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [statusData, setStatusData] = useState<{ chains: number; rules_count: number } | null>(null)
  const presetsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getFirewallStatus().then(setStatusData).catch(() => {})
  }, [data])

  useEffect(() => {
    if (!showPresets) return
    const handler = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setShowPresets(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPresets])

  const openCreate = () => {
    setEditingRule(null)
    setForm({ ...EMPTY_FORM })
    setShowModal(true)
  }

  const openEdit = (rule: FirewallRule) => {
    setEditingRule(rule)
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      priority: rule.priority,
      direction: rule.direction,
      action: rule.action,
      protocol: rule.protocol,
      src_ip: rule.src_ip,
      dst_ip: rule.dst_ip,
      src_port: rule.src_port,
      dst_port: rule.dst_port,
      comment: rule.comment,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name) return
    setSaving(true)
    setMsg(null)
    try {
      if (editingRule) {
        await updateFirewallRule(editingRule.id, form)
        setMsg({ type: 'success', text: `Rule "${form.name}" updated` })
      } else {
        await createFirewallRule(form)
        setMsg({ type: 'success', text: `Rule "${form.name}" created` })
      }
      setShowModal(false)
      await refetch()
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save rule' })
    }
    setSaving(false)
  }

  const handleDelete = async (rule: FirewallRule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return
    setMsg(null)
    try {
      await deleteFirewallRule(rule.id)
      setMsg({ type: 'success', text: `Rule "${rule.name}" deleted` })
      await refetch()
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete' })
    }
  }

  const handleToggle = async (rule: FirewallRule) => {
    try {
      await updateFirewallRule(rule.id, { enabled: !rule.enabled })
      await refetch()
    } catch { /* ignore */ }
  }

  const handleApply = async () => {
    setApplying(true)
    setMsg(null)
    try {
      const res = await applyFirewallRules()
      setMsg({ type: 'success', text: res.message })
      getFirewallStatus().then(setStatusData).catch(() => {})
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to apply rules' })
    }
    setApplying(false)
  }

  const handlePreset = (preset: typeof PRESETS[0]) => {
    setEditingRule(null)
    setForm({ ...EMPTY_FORM, ...preset.rule })
    setShowPresets(false)
    setShowModal(true)
  }

  const rules = data?.items || []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-foreground">Firewall Rules</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Manage custom nftables filter rules. Rules are evaluated in priority order before the base captive portal ruleset.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleApply}
            disabled={applying}
            className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent disabled:opacity-40 transition-colors"
          >
            <Zap className="h-3.5 w-3.5" />
            {applying ? 'Applying...' : 'Apply Rules'}
          </button>
          <div className="relative" ref={presetsRef}>
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Presets
              <ChevronDown className="h-3 w-3" />
            </button>
            {showPresets && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-md shadow-lg z-50">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handlePreset(p)}
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors border-b last:border-0 border-border"
                  >
                    <div className="text-[13px] font-medium text-foreground">{p.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Rule
          </button>
        </div>
      </div>

      {/* Status banner */}
      {msg && (
        <div className={`rounded-md border p-3 mb-4 text-[13px] flex items-center gap-2 ${
          msg.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
          {msg.text}
        </div>
      )}

      {/* Stats bar */}
      {statusData && (
        <div className="flex items-center gap-4 mb-4 text-[12px] text-muted-foreground">
          <span>nftables: <strong>{statusData.chains}</strong> chains, <strong>{statusData.rules_count}</strong> rules active</span>
          <span>|</span>
          <span>Custom rules in DB: <strong>{data?.total || 0}</strong></span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 mb-4 text-[13px] text-red-800">
          Failed to load rules: {error}
        </div>
      )}

      {/* Rules table */}
      <div className="bg-card border border-border rounded-md">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-[12px] text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3 font-medium w-8"></th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Direction</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Protocol</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Destination</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-[13px] text-muted-foreground">
                  <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No firewall rules configured. Click "Add Rule" or use a preset to get started.
                </td>
              </tr>
            )}
            {rules.map((rule) => (
              <tr key={rule.id} className={`border-b border-border last:border-0 hover:bg-accent/50 transition-colors ${!rule.enabled ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleToggle(rule)}
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                      rule.enabled ? 'bg-primary' : 'bg-gray-300'
                    }`}
                    title={rule.enabled ? 'Disable' : 'Enable'}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                      rule.enabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
                    }`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="text-[13px] font-medium text-foreground">{rule.name}</div>
                  {rule.comment && <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">{rule.comment}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${directionBadge(rule.direction)}`}>{rule.direction}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${actionBadge(rule.action)}`}>{rule.action}</span>
                </td>
                <td className="px-4 py-3 text-[13px] text-foreground">{rule.protocol}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">
                  {rule.src_ip || '*'}{rule.src_port ? `:${rule.src_port}` : ''}
                </td>
                <td className="px-4 py-3 text-[13px] text-foreground">
                  {rule.dst_ip || '*'}{rule.dst_port ? `:${rule.dst_port}` : ''}
                </td>
                <td className="px-4 py-3 text-[13px] text-muted-foreground">{rule.priority}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(rule)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(rule)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-[15px] font-semibold text-foreground">
                {editingRule ? 'Edit Firewall Rule' : 'Create Firewall Rule'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-accent transition-colors">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-foreground">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Block UDP MASQUE"
                  className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Direction + Action row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Direction</label>
                  <select
                    value={form.direction}
                    onChange={(e) => setForm({ ...form, direction: e.target.value })}
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="forward">Forward (LAN↔WAN)</option>
                    <option value="inbound">Inbound (to appliance)</option>
                    <option value="outbound">Outbound (from appliance)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Action</label>
                  <select
                    value={form.action}
                    onChange={(e) => setForm({ ...form, action: e.target.value })}
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="drop">Drop (silent)</option>
                    <option value="reject">Reject (ICMP error)</option>
                    <option value="accept">Accept</option>
                  </select>
                </div>
              </div>

              {/* Protocol */}
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-foreground">Protocol</label>
                <select
                  value={form.protocol}
                  onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                  className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="any">Any</option>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                </select>
              </div>

              {/* Source IP + Port */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Source IP</label>
                  <input
                    type="text"
                    value={form.src_ip || ''}
                    onChange={(e) => setForm({ ...form, src_ip: e.target.value || null })}
                    placeholder="Any (e.g. 10.0.1.0/24)"
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Source Port</label>
                  <input
                    type="text"
                    value={form.src_port || ''}
                    onChange={(e) => setForm({ ...form, src_port: e.target.value || null })}
                    placeholder="Any (e.g. 1024-65535)"
                    disabled={form.protocol === 'any' || form.protocol === 'icmp'}
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-40"
                  />
                </div>
              </div>

              {/* Dest IP + Port */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Destination IP</label>
                  <input
                    type="text"
                    value={form.dst_ip || ''}
                    onChange={(e) => setForm({ ...form, dst_ip: e.target.value || null })}
                    placeholder="Any (e.g. 1.1.1.1)"
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Destination Port</label>
                  <input
                    type="text"
                    value={form.dst_port || ''}
                    onChange={(e) => setForm({ ...form, dst_port: e.target.value || null })}
                    placeholder="Any (e.g. 443)"
                    disabled={form.protocol === 'any' || form.protocol === 'icmp'}
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-40"
                  />
                </div>
              </div>

              {/* Priority + Enabled */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[13px] font-medium text-foreground">Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 100 })}
                    min={1}
                    max={9999}
                    className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-[11px] text-muted-foreground">Lower = evaluated first</p>
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, enabled: !form.enabled })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      form.enabled ? 'bg-primary' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      form.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`} />
                  </button>
                  <span className="text-[13px] text-foreground">{form.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>

              {/* Comment */}
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-foreground">Comment</label>
                <input
                  type="text"
                  value={form.comment || ''}
                  onChange={(e) => setForm({ ...form, comment: e.target.value || null })}
                  placeholder="Optional description"
                  className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={() => setShowModal(false)}
                className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name || saving}
                className="px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
