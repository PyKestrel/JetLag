import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus,
  Trash2,
  RefreshCw,
  Globe,
  Cpu,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import {
  getKernelRoutes,
  getStaticRoutes,
  addStaticRoute,
  deleteStaticRoute,
  getNatRules,
  addNatRule,
  deleteNatRule,
  getInterfaces,
  getArpTable,
  flushArp,
  getSysctls,
  setSysctls,
  getDhcpReservations,
  addDhcpReservation,
  deleteDhcpReservation,
  getLldpNeighbors,
  getRouterSummary,
  type StaticRoute,
  type NatRule,
  type DHCPReservation,
  type LldpNeighbor,
  type RouterSummaryData,
} from '@/lib/api'
import { ROUTER_TABS, type RouterTab } from './router/routerTabs'
import RouterSummary from './router/RouterSummary'

const VALID_TABS = new Set<RouterTab>(ROUTER_TABS.map((t) => t.key))

function parseTabParam(s: string | null): RouterTab {
  if (!s || s === 'summary') return 'summary'
  if (s === 'routes') return 'l3' // legacy tab id before revamp
  if (VALID_TABS.has(s as RouterTab)) return s as RouterTab
  return 'summary'
}

export default function RouterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = useMemo(() => parseTabParam(searchParams.get('tab')), [searchParams])

  const setTab = useCallback(
    (t: RouterTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (t === 'summary') next.delete('tab')
          else next.set('tab', t)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [summary, setSummary] = useState<RouterSummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const loadSummary = useCallback(() => {
    setSummaryLoading(true)
    setSummaryError(null)
    getRouterSummary()
      .then(setSummary)
      .catch((e) => setSummaryError(e instanceof Error ? e.message : 'Failed to load summary'))
      .finally(() => setSummaryLoading(false))
  }, [])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  // Keep URL in sync: legacy `routes` → `l3`; unknown `tab` values → drop (we show Summary)
  useEffect(() => {
    const raw = searchParams.get('tab')
    if (!raw) return
    if (raw === 'routes') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', 'l3')
          return next
        },
        { replace: true },
      )
      return
    }
    if (raw !== 'summary' && parseTabParam(raw) === 'summary') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('tab')
          return next
        },
        { replace: true },
      )
    }
  }, [searchParams, setSearchParams])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-foreground">Router</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Layer 3, NAT, interfaces, LLDP/CDP, DHCP reservations, and diagnostics for this appliance.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[16px] font-semibold text-foreground truncate">
            {summaryLoading && !summary ? '…' : summary?.hostname ?? 'Appliance'}
          </span>
          <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            Online
          </span>
        </div>
        {summary?.primary_mac && (
          <span className="text-[12px] font-mono text-muted-foreground">{summary.primary_mac}</span>
        )}
        <span className="text-[12px] text-muted-foreground">Configuration: local</span>
      </div>

      {msg && (
        <div className={`rounded-md border p-3 mb-4 text-[13px] flex items-center gap-2 ${
          msg.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {msg.type === 'success' ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap border-b border-border mb-4 gap-0">
        {ROUTER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-3.5 w-3.5 shrink-0" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <RouterSummary
          data={summary}
          loading={summaryLoading}
          error={summaryError}
          onRefresh={loadSummary}
          onSelectTab={setTab}
        />
      )}
      {tab === 'l3' && <RoutesTab setMsg={setMsg} />}
      {tab === 'nat' && <NatTab setMsg={setMsg} />}
      {tab === 'interfaces' && <InterfacesTab />}
      {tab === 'neighbors' && <NeighborsTab />}
      {tab === 'dhcp' && <DhcpTab setMsg={setMsg} />}
      {tab === 'arp' && <ArpTab setMsg={setMsg} />}
      {tab === 'sysctl' && <SysctlTab setMsg={setMsg} />}
    </div>
  )
}

// ── Routes Tab ──────────────────────────────────────────────────

function RoutesTab({ setMsg }: { setMsg: (m: { type: 'success' | 'error'; text: string } | null) => void }) {
  const [kernelRoutes, setKernelRoutes] = useState<unknown[]>([])
  const [staticRoutes, setStaticRoutes] = useState<StaticRoute[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ destination: '', gateway: '', interface: '', metric: '100', comment: '' })

  const load = () => {
    getKernelRoutes().then((r) => setKernelRoutes(r.routes)).catch(() => {})
    getStaticRoutes().then((r) => setStaticRoutes(r.items)).catch(() => {})
  }
  useEffect(load, [])

  const handleAdd = async () => {
    if (!form.destination) return
    try {
      await addStaticRoute({
        destination: form.destination,
        gateway: form.gateway || null,
        interface: form.interface || null,
        metric: parseInt(form.metric) || 100,
        comment: form.comment || null,
      })
      setMsg({ type: 'success', text: 'Static route added' })
      setShowForm(false)
      setForm({ destination: '', gateway: '', interface: '', metric: '100', comment: '' })
      load()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed to add route' })
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this static route?')) return
    try {
      await deleteStaticRoute(id)
      setMsg({ type: 'success', text: 'Route deleted' })
      load()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed' })
    }
  }

  return (
    <div className="space-y-4">
      {/* Static Routes */}
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Static Routes</h2>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Add Route
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-md p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Destination (CIDR)</label>
              <input type="text" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="10.0.0.0/24" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Gateway</label>
              <input type="text" value={form.gateway} onChange={(e) => setForm({ ...form, gateway: e.target.value })} placeholder="192.168.1.1" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Interface</label>
              <input type="text" value={form.interface} onChange={(e) => setForm({ ...form, interface: e.target.value })} placeholder="eth0" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Metric</label>
              <input type="number" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={!form.destination} className="px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">Add</button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-md">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-[12px] text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Destination</th>
              <th className="px-4 py-3 font-medium">Gateway</th>
              <th className="px-4 py-3 font-medium">Interface</th>
              <th className="px-4 py-3 font-medium">Metric</th>
              <th className="px-4 py-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {staticRoutes.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted-foreground">No static routes configured</td></tr>
            )}
            {staticRoutes.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                <td className="px-4 py-3 text-[13px] font-mono text-foreground">{r.destination}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{r.gateway || '-'}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{r.interface || '-'}</td>
                <td className="px-4 py-3 text-[13px] text-muted-foreground">{r.metric}</td>
                <td className="px-4 py-3">
                  <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kernel Routing Table */}
      <h2 className="text-[15px] font-semibold text-foreground mt-6">Kernel Routing Table</h2>
      <div className="bg-card border border-border rounded-md p-4">
        <pre className="text-[12px] font-mono text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
          {kernelRoutes.length === 0
            ? 'No routes (or not running on Linux)'
            : JSON.stringify(kernelRoutes, null, 2)}
        </pre>
      </div>
    </div>
  )
}

// ── NAT Tab ─────────────────────────────────────────────────────

function NatTab({ setMsg }: { setMsg: (m: { type: 'success' | 'error'; text: string } | null) => void }) {
  const [rules, setRules] = useState<NatRule[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'masquerade', protocol: 'any', src_ip: '', dst_ip: '', dst_port: '', to_address: '', to_port: '', interface: '', comment: '' })

  const load = () => { getNatRules().then((r) => setRules(r.items)).catch(() => {}) }
  useEffect(load, [])

  const handleAdd = async () => {
    if (!form.name) return
    try {
      await addNatRule({
        name: form.name, type: form.type, protocol: form.protocol,
        src_ip: form.src_ip || null, dst_ip: form.dst_ip || null, dst_port: form.dst_port || null,
        to_address: form.to_address || null, to_port: form.to_port || null,
        interface: form.interface || null, comment: form.comment || null,
      })
      setMsg({ type: 'success', text: 'NAT rule added' })
      setShowForm(false)
      setForm({ name: '', type: 'masquerade', protocol: 'any', src_ip: '', dst_ip: '', dst_port: '', to_address: '', to_port: '', interface: '', comment: '' })
      load()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed' })
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this NAT rule?')) return
    try { await deleteNatRule(id); setMsg({ type: 'success', text: 'NAT rule deleted' }); load() }
    catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed' }) }
  }

  const typeBadge = (t: string) => {
    const m: Record<string, string> = { masquerade: 'bg-blue-100 text-blue-700', snat: 'bg-purple-100 text-purple-700', dnat: 'bg-amber-100 text-amber-700' }
    return m[t] || 'bg-gray-100 text-gray-700'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">NAT Rules</h2>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
          <Plus className="h-3.5 w-3.5" /> Add NAT Rule
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-md p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Port Forward SSH" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="masquerade">Masquerade</option>
                <option value="snat">SNAT</option>
                <option value="dnat">DNAT</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Protocol</label>
              <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="any">Any</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Dest IP</label>
              <input type="text" value={form.dst_ip} onChange={(e) => setForm({ ...form, dst_ip: e.target.value })} placeholder="0.0.0.0/0" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Dest Port</label>
              <input type="text" value={form.dst_port} onChange={(e) => setForm({ ...form, dst_port: e.target.value })} placeholder="22" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">To Address</label>
              <input type="text" value={form.to_address} onChange={(e) => setForm({ ...form, to_address: e.target.value })} placeholder="192.168.1.100" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">To Port</label>
              <input type="text" value={form.to_port} onChange={(e) => setForm({ ...form, to_port: e.target.value })} placeholder="2222" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={!form.name} className="px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">Add</button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-md">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-[12px] text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Protocol</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Destination</th>
              <th className="px-4 py-3 font-medium">Translate To</th>
              <th className="px-4 py-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[13px] text-muted-foreground">No custom NAT rules</td></tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                <td className="px-4 py-3 text-[13px] font-medium text-foreground">{r.name}</td>
                <td className="px-4 py-3"><span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${typeBadge(r.type)}`}>{r.type}</span></td>
                <td className="px-4 py-3 text-[13px] text-foreground">{r.protocol}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{r.src_ip || '*'}{r.src_port ? `:${r.src_port}` : ''}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{r.dst_ip || '*'}{r.dst_port ? `:${r.dst_port}` : ''}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{r.to_address || '-'}{r.to_port ? `:${r.to_port}` : ''}</td>
                <td className="px-4 py-3">
                  <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Interfaces Tab ──────────────────────────────────────────────

function InterfacesTab() {
  const [interfaces, setInterfaces] = useState<unknown[]>([])
  const load = () => { getInterfaces().then((r) => setInterfaces(r.interfaces)).catch(() => {}) }
  useEffect(load, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Network Interfaces</h2>
        <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <pre className="text-[12px] font-mono text-foreground whitespace-pre-wrap max-h-[500px] overflow-y-auto">
          {interfaces.length === 0
            ? 'No interfaces (or not running on Linux)'
            : JSON.stringify(interfaces, null, 2)}
        </pre>
      </div>
    </div>
  )
}

// ── LLDP / CDP Neighbors Tab ────────────────────────────────────

function NeighborsTab() {
  const [rows, setRows] = useState<LldpNeighbor[]>([])
  const [available, setAvailable] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = () => {
    getLldpNeighbors()
      .then((r) => {
        setRows(r.items)
        setAvailable(r.available !== false)
        setHint(r.message || null)
        setErr(r.error || null)
      })
      .catch((e) => {
        setRows([])
        setErr(e instanceof Error ? e.message : 'Failed to load neighbors')
        setHint(null)
      })
  }
  useEffect(load, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Link-layer neighbors</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Data from <span className="font-mono">lldpd</span> (LLDP; CDP/EDP/FDP when enabled in lldpd). Install and run the{' '}
            <span className="font-mono">lldpd</span> service on the appliance to populate this table.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {!available && hint && (
        <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[13px]">{hint}</div>
      )}
      {available && err && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-[13px]">{err}</div>
      )}
      {available && hint && !err && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">{hint}</div>
      )}

      <div className="bg-card border border-border rounded-md overflow-x-auto">
        <table className="w-full text-left min-w-[720px]">
          <thead>
            <tr className="border-b border-border text-[12px] text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Local interface</th>
              <th className="px-4 py-3 font-medium">Protocol</th>
              <th className="px-4 py-3 font-medium">Remote system</th>
              <th className="px-4 py-3 font-medium">Remote port</th>
              <th className="px-4 py-3 font-medium">Chassis ID</th>
              <th className="px-4 py-3 font-medium">Mgmt IP</th>
              <th className="px-4 py-3 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !err && available && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  No neighbors discovered yet
                </td>
              </tr>
            )}
            {rows.map((n, i) => (
              <tr key={`${n.local_interface}-${n.protocol}-${i}`} className="border-b border-border last:border-0 hover:bg-accent/50">
                <td className="px-4 py-3 text-[13px] font-mono text-foreground">{n.local_interface || '—'}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{n.protocol || '—'}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{n.system_name || '—'}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">
                  {n.port_id || '—'}
                  {n.port_description ? <span className="block text-[11px] text-muted-foreground">{n.port_description}</span> : null}
                </td>
                <td className="px-4 py-3 text-[13px] font-mono text-muted-foreground">{n.chassis_id || '—'}</td>
                <td className="px-4 py-3 text-[13px] font-mono text-foreground">{n.management_ip || '—'}</td>
                <td className="px-4 py-3 text-[13px] text-muted-foreground whitespace-nowrap">{n.age || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── ARP Tab ─────────────────────────────────────────────────────

function ArpTab({ setMsg }: { setMsg: (m: { type: 'success' | 'error'; text: string } | null) => void }) {
  const [entries, setEntries] = useState<unknown[]>([])
  const load = () => { getArpTable().then((r) => setEntries(r.entries)).catch(() => {}) }
  useEffect(load, [])

  const handleFlush = async () => {
    if (!confirm('Flush the entire ARP cache?')) return
    try { await flushArp(); setMsg({ type: 'success', text: 'ARP cache flushed' }); load() }
    catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">ARP / Neighbor Table</h2>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={handleFlush} className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors">
            <Trash2 className="h-3.5 w-3.5" /> Flush ARP
          </button>
        </div>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <pre className="text-[12px] font-mono text-foreground whitespace-pre-wrap max-h-[400px] overflow-y-auto">
          {entries.length === 0
            ? 'No ARP entries (or not running on Linux)'
            : JSON.stringify(entries, null, 2)}
        </pre>
      </div>
    </div>
  )
}

// ── Sysctl Tab ──────────────────────────────────────────────────

function SysctlTab({ setMsg }: { setMsg: (m: { type: 'success' | 'error'; text: string } | null) => void }) {
  const [sysctls, setSysctlState] = useState<Record<string, string | null>>({})
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = () => { getSysctls().then((r) => { setSysctlState(r.sysctls); setEdits({}) }).catch(() => {}) }
  useEffect(load, [])

  const handleSave = async () => {
    if (Object.keys(edits).length === 0) return
    setSaving(true)
    try {
      const res = await setSysctls(edits)
      const failed = Object.entries(res.results).filter(([, v]) => !v.success)
      if (failed.length > 0) {
        setMsg({ type: 'error', text: `Failed: ${failed.map(([k]) => k).join(', ')}` })
      } else {
        setMsg({ type: 'success', text: 'Sysctl values updated' })
      }
      load()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed' })
    }
    setSaving(false)
  }

  const keys = Object.keys(sysctls).sort()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Kernel Parameters (sysctl)</h2>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={handleSave} disabled={saving || Object.keys(edits).length === 0} className="inline-flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
            {saving ? 'Saving...' : 'Apply Changes'}
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-md divide-y divide-border">
        {keys.map((key) => {
          const current = sysctls[key]
          const edited = edits[key]
          return (
            <div key={key} className="flex items-center justify-between px-4 py-3">
              <div className="text-[13px] font-mono text-foreground">{key}</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={edited !== undefined ? edited : (current ?? '')}
                  onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}
                  className={`w-20 px-2 py-1 rounded-md border text-[13px] text-center font-mono focus:outline-none focus:ring-2 focus:ring-ring ${
                    edited !== undefined ? 'border-primary bg-primary/5' : 'border-input bg-background'
                  } text-foreground`}
                />
                {current !== null && <span className="text-[11px] text-muted-foreground">current: {current}</span>}
              </div>
            </div>
          )
        })}
        {keys.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            No sysctl values available (not running on Linux)
          </div>
        )}
      </div>
    </div>
  )
}

// ── DHCP Reservations Tab ───────────────────────────────────────

function DhcpTab({ setMsg }: { setMsg: (m: { type: 'success' | 'error'; text: string } | null) => void }) {
  const [reservations, setReservations] = useState<DHCPReservation[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ mac_address: '', ip_address: '', hostname: '', comment: '' })

  const load = () => { getDhcpReservations().then((r) => setReservations(r.items)).catch(() => {}) }
  useEffect(load, [])

  const handleAdd = async () => {
    if (!form.mac_address || !form.ip_address) return
    try {
      await addDhcpReservation({
        mac_address: form.mac_address, ip_address: form.ip_address,
        hostname: form.hostname || null, comment: form.comment || null,
      })
      setMsg({ type: 'success', text: 'DHCP reservation added (dnsmasq restarted)' })
      setShowForm(false)
      setForm({ mac_address: '', ip_address: '', hostname: '', comment: '' })
      load()
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed' })
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this DHCP reservation?')) return
    try { await deleteDhcpReservation(id); setMsg({ type: 'success', text: 'Reservation deleted' }); load() }
    catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed' }) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">DHCP Reservations</h2>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
          <Plus className="h-3.5 w-3.5" /> Add Reservation
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-md p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">MAC Address</label>
              <input type="text" value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">IP Address</label>
              <input type="text" value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="10.0.1.100" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Hostname</label>
              <input type="text" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} placeholder="printer" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground">Comment</label>
              <input type="text" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="Office printer" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
            <button onClick={handleAdd} disabled={!form.mac_address || !form.ip_address} className="px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">Add</button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-md">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-[12px] text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">MAC Address</th>
              <th className="px-4 py-3 font-medium">IP Address</th>
              <th className="px-4 py-3 font-medium">Hostname</th>
              <th className="px-4 py-3 font-medium">Comment</th>
              <th className="px-4 py-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {reservations.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted-foreground">No DHCP reservations configured</td></tr>
            )}
            {reservations.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                <td className="px-4 py-3 text-[13px] font-mono text-foreground">{r.mac_address}</td>
                <td className="px-4 py-3 text-[13px] font-mono text-foreground">{r.ip_address}</td>
                <td className="px-4 py-3 text-[13px] text-foreground">{r.hostname || '-'}</td>
                <td className="px-4 py-3 text-[13px] text-muted-foreground">{r.comment || '-'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
