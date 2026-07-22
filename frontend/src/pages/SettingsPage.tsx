import { useState, useEffect } from 'react'
import { Save, RotateCcw, CheckCircle2, AlertTriangle, Plus, Trash2, Pencil, Network, Wifi } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { Switch } from '@/components/ui/Switch'
import {
  getSettings,
  updateSettings,
  listPorts,
  addWANPort,
  editWANPort,
  removeWANPort,
  addLANPort,
  editLANPort,
  removeLANPort,
  getSetupInterfaces,
  type SettingsData,
  type SettingsNetwork,
  type SettingsDHCP,
  type SettingsDNS,
  type SettingsPortal,
  type SettingsAdmin,
  type SettingsCaptures,
  type SettingsLogging,
  type WANPort,
  type LANPort,
  type NetworkInterface,
} from '@/lib/api'

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  help,
}: {
  label: string
  value: string | number | boolean
  onChange: (v: string) => void
  type?: 'text' | 'number' | 'toggle'
  placeholder?: string
  help?: string
}) {
  if (type === 'toggle') {
    const on = value === true || value === 'true'
    return (
      <div className="flex items-center justify-between py-2">
        <div>
          <label className="text-[13px] font-medium text-foreground">{label}</label>
          {help && <p className="text-[12px] text-muted-foreground mt-0.5">{help}</p>}
        </div>
        <Switch
          checked={on}
          onCheckedChange={(c) => onChange(c ? 'true' : 'false')}
          aria-label={label}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <label className="text-[13px] font-medium text-foreground">{label}</label>
      <input
        type={type === 'number' ? 'number' : 'text'}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
      />
      {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-card border border-border rounded-md">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-[13px] text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const { data, loading, error, refetch } = useApi<SettingsData>(getSettings)
  const [form, setForm] = useState<SettingsData | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)

  // Port management state
  const [wanPorts, setWanPorts] = useState<WANPort[]>([])
  const [lanPorts, setLanPorts] = useState<LANPort[]>([])
  const [availableIfaces, setAvailableIfaces] = useState<NetworkInterface[]>([])
  const [showAddWan, setShowAddWan] = useState(false)
  const [showAddLan, setShowAddLan] = useState(false)
  const [newWanIface, setNewWanIface] = useState('')
  const [newWanMtu, setNewWanMtu] = useState('')
  const [newLan, setNewLan] = useState({ interface: '', ip: '', subnet: '', vlan_id: '', vlan_name: '', mtu: '', dhcp_enabled: true, dhcp_range_start: '', dhcp_range_end: '' })
  const [portMsg, setPortMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // Edit state: identifier of the port currently being edited (interface for WAN, effective iface for LAN)
  const [editingWan, setEditingWan] = useState<string | null>(null)
  const [editWan, setEditWan] = useState({ enabled: true, mtu: '' })
  const [editingLan, setEditingLan] = useState<string | null>(null)
  const [editLan, setEditLan] = useState({ interface: '', ip: '', subnet: '', vlan_id: '', vlan_name: '', mtu: '', enabled: true, dhcp_enabled: true, dhcp_range_start: '', dhcp_range_end: '', dhcp_lease_time: '1h' })

  useEffect(() => {
    if (data) {
      setForm(structuredClone(data))
      setDirty(false)
      setWanPorts(data.wan_ports || [])
      setLanPorts(data.lan_ports || [])
    }
  }, [data])

  useEffect(() => {
    getSetupInterfaces().then((res) => setAvailableIfaces(res.interfaces || [])).catch(() => {})
  }, [])

  const refreshPorts = async () => {
    try {
      const res = await listPorts()
      setWanPorts(res.wan_ports)
      setLanPorts(res.lan_ports)
    } catch { /* ignore */ }
  }

  const handleAddWan = async () => {
    if (!newWanIface) return
    setPortMsg(null)
    try {
      const res = await addWANPort({ interface: newWanIface, mtu: newWanMtu ? Number(newWanMtu) : undefined })
      setWanPorts(res.wan_ports)
      setNewWanIface('')
      setNewWanMtu('')
      setShowAddWan(false)
      setPortMsg({ type: 'success', text: `WAN port ${newWanIface} added` })
    } catch (err) {
      setPortMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add WAN port' })
    }
  }

  const handleRemoveWan = async (iface: string) => {
    if (!confirm(`Remove WAN port ${iface}?`)) return
    setPortMsg(null)
    try {
      const res = await removeWANPort(iface)
      setWanPorts(res.wan_ports)
      setPortMsg({ type: 'success', text: `WAN port ${iface} removed` })
    } catch (err) {
      setPortMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove WAN port' })
    }
  }

  const handleAddLan = async () => {
    if (!newLan.interface || !newLan.ip || !newLan.subnet) return
    setPortMsg(null)
    try {
      const res = await addLANPort({
        interface: newLan.interface,
        ip: newLan.ip,
        subnet: newLan.subnet,
        vlan_id: newLan.vlan_id ? Number(newLan.vlan_id) : undefined,
        vlan_name: newLan.vlan_name || undefined,
        mtu: newLan.mtu ? Number(newLan.mtu) : undefined,
        dhcp_enabled: newLan.dhcp_enabled,
        dhcp_range_start: newLan.dhcp_range_start || undefined,
        dhcp_range_end: newLan.dhcp_range_end || undefined,
      })
      setLanPorts(res.lan_ports)
      setNewLan({ interface: '', ip: '', subnet: '', vlan_id: '', vlan_name: '', mtu: '', dhcp_enabled: true, dhcp_range_start: '', dhcp_range_end: '' })
      setShowAddLan(false)
      setPortMsg({ type: 'success', text: 'LAN port added' })
    } catch (err) {
      setPortMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to add LAN port' })
    }
  }

  const handleNewLanIpChange = (ip: string) => {
    const parts = ip.split('.')
    if (parts.length === 4 && parts.every((p) => p !== '' && !isNaN(Number(p)))) {
      const prefix = parts.slice(0, 3).join('.')
      setNewLan((prev) => ({
        ...prev,
        ip,
        subnet: `${prefix}.0/24`,
        dhcp_range_start: `${prefix}.100`,
        dhcp_range_end: `${prefix}.250`,
      }))
    } else {
      setNewLan((prev) => ({ ...prev, ip }))
    }
  }

  const handleRemoveLan = async (iface: string) => {
    if (!confirm(`Remove LAN port ${iface}?`)) return
    setPortMsg(null)
    try {
      const res = await removeLANPort(iface)
      setLanPorts(res.lan_ports)
      setPortMsg({ type: 'success', text: `LAN port ${iface} removed` })
    } catch (err) {
      setPortMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to remove LAN port' })
    }
  }

  const startEditWan = (p: WANPort) => {
    setEditingWan(p.interface)
    setEditWan({ enabled: p.enabled, mtu: p.mtu != null ? String(p.mtu) : '' })
    setPortMsg(null)
  }

  const handleSaveEditWan = async (iface: string) => {
    setPortMsg(null)
    try {
      const res = await editWANPort(iface, {
        enabled: editWan.enabled,
        mtu: editWan.mtu ? Number(editWan.mtu) : null,
      })
      setWanPorts(res.wan_ports)
      setEditingWan(null)
      setPortMsg({ type: 'success', text: `WAN port ${iface} updated` })
    } catch (err) {
      setPortMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update WAN port' })
    }
  }

  const startEditLan = (p: LANPort) => {
    setEditingLan(p.vlan_id ? `${p.interface}.${p.vlan_id}` : p.interface)
    setEditLan({
      interface: p.interface,
      ip: p.ip,
      subnet: p.subnet,
      vlan_id: p.vlan_id != null ? String(p.vlan_id) : '',
      vlan_name: p.vlan_name || '',
      mtu: p.mtu != null ? String(p.mtu) : '',
      enabled: p.enabled,
      dhcp_enabled: p.dhcp.enabled,
      dhcp_range_start: p.dhcp.range_start || '',
      dhcp_range_end: p.dhcp.range_end || '',
      dhcp_lease_time: p.dhcp.lease_time || '1h',
    })
    setPortMsg(null)
  }

  const handleSaveEditLan = async (iface: string) => {
    if (!editLan.interface || !editLan.ip || !editLan.subnet) return
    setPortMsg(null)
    try {
      const res = await editLANPort(iface, {
        interface: editLan.interface,
        ip: editLan.ip,
        subnet: editLan.subnet,
        vlan_id: editLan.vlan_id ? Number(editLan.vlan_id) : undefined,
        vlan_name: editLan.vlan_name || undefined,
        mtu: editLan.mtu ? Number(editLan.mtu) : undefined,
        enabled: editLan.enabled,
        dhcp_enabled: editLan.dhcp_enabled,
        dhcp_range_start: editLan.dhcp_range_start || undefined,
        dhcp_range_end: editLan.dhcp_range_end || undefined,
        dhcp_lease_time: editLan.dhcp_lease_time || undefined,
      })
      setLanPorts(res.lan_ports)
      setEditingLan(null)
      setPortMsg({ type: 'success', text: 'LAN port updated' })
    } catch (err) {
      setPortMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update LAN port' })
    }
  }

  const update = <K extends keyof SettingsData>(
    section: K,
    key: string,
    value: string
  ) => {
    if (!form) return
    setForm((prev) => {
      if (!prev) return prev
      const sectionData = { ...prev[section] } as Record<string, unknown>

      // Type coercion
      const currentVal = sectionData[key]
      if (typeof currentVal === 'number') {
        sectionData[key] = Number(value) || 0
      } else if (typeof currentVal === 'boolean') {
        sectionData[key] = value === 'true'
      } else {
        sectionData[key] = value
      }

      return { ...prev, [section]: sectionData } as SettingsData
    })
    setDirty(true)
    setSaveMsg(null)
  }

  const updateDnsList = (value: string) => {
    if (!form) return
    setForm((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        dns: {
          ...prev.dns,
          upstream_servers: value.split(',').map((s) => s.trim()).filter(Boolean),
        },
      }
    })
    setDirty(true)
    setSaveMsg(null)
  }

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await updateSettings(form)
      setSaveMsg({ type: 'success', text: 'Settings saved and written to jetlag.yaml' })
      setDirty(false)
      await refetch()
    } catch (err) {
      setSaveMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      })
    }
    setSaving(false)
  }

  const handleReset = () => {
    if (data) {
      setForm(structuredClone(data))
      setDirty(false)
      setSaveMsg(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
        Failed to load settings: {error}
      </div>
    )
  }

  if (!form) return null

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-foreground">Settings</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Configure your JetLag appliance. Changes are written to{' '}
            <code className="px-1 py-0.5 bg-muted rounded text-[12px]">config/jetlag.yaml</code>{' '}
            and take effect immediately.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleReset}
            disabled={!dirty}
            className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent disabled:opacity-40 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Save status banner */}
      {saveMsg && (
        <div
          className={`rounded-md border p-3 mb-6 text-[13px] flex items-center gap-2 ${
            saveMsg.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {saveMsg.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          )}
          {saveMsg.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Port management status */}
        {portMsg && (
          <div className={`rounded-md border p-3 text-[13px] flex items-center gap-2 ${
            portMsg.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            {portMsg.type === 'success' ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
            {portMsg.text}
          </div>
        )}

        {/* WAN Ports */}
        <Section title="WAN Ports" description="Upstream (internet-facing) interfaces">
          <div className="space-y-2">
            {wanPorts.map((p) => (
              editingWan === p.interface ? (
                <div key={p.interface} className="flex items-end gap-2 px-3 py-3 rounded-md border border-primary/40 bg-background">
                  <div className="flex items-center gap-2 flex-1">
                    <Network className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[13px] font-medium text-foreground">{p.interface}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={editWan.enabled} onCheckedChange={(v) => setEditWan({ ...editWan, enabled: v })} />
                    <span className="text-[12px] text-muted-foreground">Enabled</span>
                  </div>
                  <div className="w-28">
                    <label className="text-[12px] font-medium text-muted-foreground mb-1 block">MTU <span className="font-normal">(optional)</span></label>
                    <input type="number" min={576} max={9216} value={editWan.mtu} onChange={(e) => setEditWan({ ...editWan, mtu: e.target.value })} placeholder="1500" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <button onClick={() => handleSaveEditWan(p.interface)} className="px-3 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>
                  <button onClick={() => setEditingWan(null)} className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
                </div>
              ) : (
                <div key={p.interface} className="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-background">
                  <div className="flex items-center gap-2">
                    <Network className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[13px] font-medium text-foreground">{p.interface}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${p.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {p.mtu && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">MTU {p.mtu}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEditWan(p)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleRemoveWan(p.interface)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            ))}
            {wanPorts.length === 0 && <p className="text-[12px] text-muted-foreground">No WAN ports configured.</p>}
          </div>
          {showAddWan ? (
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Interface</label>
                <select value={newWanIface} onChange={(e) => setNewWanIface(e.target.value)} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Select interface...</option>
                  {availableIfaces.map((i) => <option key={i.name} value={i.name}>{i.name} ({i.state})</option>)}
                </select>
              </div>
              <div className="w-28">
                <label className="text-[12px] font-medium text-muted-foreground mb-1 block">MTU <span className="font-normal">(optional)</span></label>
                <input type="number" min={576} max={9216} value={newWanMtu} onChange={(e) => setNewWanMtu(e.target.value)} placeholder="1500" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <button onClick={handleAddWan} disabled={!newWanIface} className="px-3 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">Add</button>
              <button onClick={() => setShowAddWan(false)} className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowAddWan(true)} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:text-primary/80 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add WAN port
            </button>
          )}
        </Section>

        {/* LAN Ports */}
        <Section title="LAN Ports" description="Client-facing interfaces with per-port DHCP and optional VLAN tagging">
          <div className="space-y-3">
            {lanPorts.map((p) => {
              const effIface = p.vlan_id ? `${p.interface}.${p.vlan_id}` : p.interface
              if (editingLan === effIface) {
                return (
                  <div key={effIface} className="rounded-md border border-primary/40 bg-background p-4 space-y-3">
                    <p className="text-[13px] font-semibold text-foreground">Edit LAN Port <span className="font-normal text-muted-foreground">({effIface})</span></p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Interface</label>
                        <select value={editLan.interface} onChange={(e) => setEditLan({ ...editLan, interface: e.target.value })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value="">Select interface...</option>
                          {editLan.interface && !availableIfaces.some((i) => i.name === editLan.interface) && <option value={editLan.interface}>{editLan.interface}</option>}
                          {availableIfaces.map((i) => <option key={i.name} value={i.name}>{i.name} ({i.state})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">IP Address</label>
                        <input type="text" value={editLan.ip} onChange={(e) => setEditLan({ ...editLan, ip: e.target.value })} placeholder="10.0.2.1" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Subnet</label>
                        <input type="text" value={editLan.subnet} onChange={(e) => setEditLan({ ...editLan, subnet: e.target.value })} placeholder="10.0.2.0/24" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">VLAN ID <span className="font-normal text-muted-foreground">(optional)</span></label>
                        <input type="number" min={1} max={4094} value={editLan.vlan_id} onChange={(e) => setEditLan({ ...editLan, vlan_id: e.target.value })} placeholder="100" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">VLAN Name <span className="font-normal text-muted-foreground">(optional)</span></label>
                        <input type="text" value={editLan.vlan_name} onChange={(e) => setEditLan({ ...editLan, vlan_name: e.target.value })} placeholder="Guest WiFi" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">MTU <span className="font-normal text-muted-foreground">(optional)</span></label>
                        <input type="number" min={576} max={9216} value={editLan.mtu} onChange={(e) => setEditLan({ ...editLan, mtu: e.target.value })} placeholder="1500" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">DHCP Range Start</label>
                        <input type="text" value={editLan.dhcp_range_start} onChange={(e) => setEditLan({ ...editLan, dhcp_range_start: e.target.value })} placeholder="Auto" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-muted-foreground mb-1 block">DHCP Range End</label>
                        <input type="text" value={editLan.dhcp_range_end} onChange={(e) => setEditLan({ ...editLan, dhcp_range_end: e.target.value })} placeholder="Auto" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                      </div>
                    </div>
                    <div className="flex items-center gap-4 pt-1">
                      <label className="flex items-center gap-2">
                        <Switch checked={editLan.enabled} onCheckedChange={(v) => setEditLan({ ...editLan, enabled: v })} />
                        <span className="text-[12px] text-muted-foreground">Enabled</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <Switch checked={editLan.dhcp_enabled} onCheckedChange={(v) => setEditLan({ ...editLan, dhcp_enabled: v })} />
                        <span className="text-[12px] text-muted-foreground">DHCP</span>
                      </label>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => handleSaveEditLan(effIface)} disabled={!editLan.interface || !editLan.ip || !editLan.subnet} className="px-3 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">Save</button>
                      <button onClick={() => setEditingLan(null)} className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
                    </div>
                  </div>
                )
              }
              return (
                <div key={effIface} className="rounded-md border border-border bg-background">
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Wifi className="h-4 w-4 text-muted-foreground" />
                      <span className="text-[13px] font-medium text-foreground">{effIface}</span>
                      {p.vlan_id && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">VLAN {p.vlan_id}{p.vlan_name ? ` — ${p.vlan_name}` : ''}</span>}
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${p.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEditLan(p)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleRemoveLan(effIface)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors" title="Remove">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="px-3 pb-2 grid grid-cols-4 gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                    <span><strong>IP:</strong> {p.ip}</span>
                    <span><strong>Subnet:</strong> {p.subnet}</span>
                    <span><strong>DHCP:</strong> {p.dhcp.enabled ? `${p.dhcp.range_start || p.ip.replace(/\.\d+$/, '.100')} – ${p.dhcp.range_end || p.ip.replace(/\.\d+$/, '.250')}` : 'Off'}</span>
                    <span><strong>Lease:</strong> {p.dhcp.lease_time}</span>
                    {p.mtu && <span><strong>MTU:</strong> {p.mtu}</span>}
                  </div>
                </div>
              )
            })}
            {lanPorts.length === 0 && <p className="text-[12px] text-muted-foreground">No LAN ports configured.</p>}
          </div>
          {showAddLan ? (
            <div className="mt-3 rounded-md border border-dashed border-border p-4 space-y-3">
              <p className="text-[13px] font-semibold text-foreground">Add LAN Port</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Interface</label>
                  <select value={newLan.interface} onChange={(e) => setNewLan({ ...newLan, interface: e.target.value })} className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">Select interface...</option>
                    {availableIfaces.map((i) => <option key={i.name} value={i.name}>{i.name} ({i.state})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">IP Address</label>
                  <input type="text" value={newLan.ip} onChange={(e) => handleNewLanIpChange(e.target.value)} placeholder="10.0.2.1" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">Subnet</label>
                  <input type="text" value={newLan.subnet} onChange={(e) => setNewLan({ ...newLan, subnet: e.target.value })} placeholder="10.0.2.0/24" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">VLAN ID <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <input type="number" min={1} max={4094} value={newLan.vlan_id} onChange={(e) => setNewLan({ ...newLan, vlan_id: e.target.value })} placeholder="100" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">VLAN Name <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <input type="text" value={newLan.vlan_name} onChange={(e) => setNewLan({ ...newLan, vlan_name: e.target.value })} placeholder="Guest WiFi" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">MTU <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <input type="number" min={576} max={9216} value={newLan.mtu} onChange={(e) => setNewLan({ ...newLan, mtu: e.target.value })} placeholder="1500" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">DHCP Range Start</label>
                  <input type="text" value={newLan.dhcp_range_start} onChange={(e) => setNewLan({ ...newLan, dhcp_range_start: e.target.value })} placeholder="Auto" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1 block">DHCP Range End</label>
                  <input type="text" value={newLan.dhcp_range_end} onChange={(e) => setNewLan({ ...newLan, dhcp_range_end: e.target.value })} placeholder="Auto" className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleAddLan} disabled={!newLan.interface || !newLan.ip || !newLan.subnet} className="px-3 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">Add LAN Port</button>
                <button onClick={() => setShowAddLan(false)} className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddLan(true)} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:text-primary/80 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add LAN port
            </button>
          )}
        </Section>

        {/* Network (legacy single-interface view) */}
        <Section title="Network" description="Primary WAN/LAN interface configuration (legacy view)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="WAN Interface" value={form.network.wan_interface} onChange={(v) => update('network', 'wan_interface', v)} placeholder="eth0" help="External-facing interface" />
            <Field label="LAN Interface" value={form.network.lan_interface} onChange={(v) => update('network', 'lan_interface', v)} placeholder="eth1" help="Client-facing interface" />
            <Field label="LAN IP Address" value={form.network.lan_ip} onChange={(v) => update('network', 'lan_ip', v)} placeholder="10.0.1.1" />
            <Field label="LAN Subnet" value={form.network.lan_subnet} onChange={(v) => update('network', 'lan_subnet', v)} placeholder="10.0.1.0/24" />
          </div>
        </Section>

        {/* DHCP */}
        <Section title="DHCP" description="DHCP server settings for the LAN interface">
          <Field label="Enabled" value={form.dhcp.enabled} onChange={(v) => update('dhcp', 'enabled', v)} type="toggle" help="Enable or disable the DHCP server" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Range Start" value={form.dhcp.range_start} onChange={(v) => update('dhcp', 'range_start', v)} placeholder="10.0.1.100" />
            <Field label="Range End" value={form.dhcp.range_end} onChange={(v) => update('dhcp', 'range_end', v)} placeholder="10.0.1.250" />
            <Field label="Lease Time" value={form.dhcp.lease_time} onChange={(v) => update('dhcp', 'lease_time', v)} placeholder="1h" help="e.g. 1h, 30m, 12h" />
            <Field label="Gateway" value={form.dhcp.gateway} onChange={(v) => update('dhcp', 'gateway', v)} placeholder="10.0.1.1" />
            <Field label="DNS Server" value={form.dhcp.dns_server} onChange={(v) => update('dhcp', 'dns_server', v)} placeholder="10.0.1.1" help="DNS server advertised to clients" />
          </div>
        </Section>

        {/* DNS */}
        <Section title="DNS" description="DNS spoofing and upstream resolver configuration">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Spoof Target" value={form.dns.spoof_target} onChange={(v) => update('dns', 'spoof_target', v)} placeholder="10.0.1.1" help="IP all spoofed queries resolve to" />
            <Field
              label="Upstream Servers"
              value={form.dns.upstream_servers.join(', ')}
              onChange={updateDnsList}
              placeholder="1.1.1.1, 8.8.8.8"
              help="Comma-separated list of upstream DNS servers"
            />
          </div>
        </Section>

        {/* Portal */}
        <Section title="Captive Portal" description="HTTP/HTTPS interception and SSL certificate settings">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="HTTP Port" value={form.portal.http_port} onChange={(v) => update('portal', 'http_port', v)} type="number" />
            <Field label="HTTPS Port" value={form.portal.https_port} onChange={(v) => update('portal', 'https_port', v)} type="number" />
            <Field label="SSL Certificate" value={form.portal.ssl_cert} onChange={(v) => update('portal', 'ssl_cert', v)} help="Path to PEM certificate file" />
            <Field label="SSL Key" value={form.portal.ssl_key} onChange={(v) => update('portal', 'ssl_key', v)} help="Path to PEM private key file" />
            <Field label="SSL Common Name" value={form.portal.ssl_cn} onChange={(v) => update('portal', 'ssl_cn', v)} placeholder="wifi.airline.com" help="CN for the self-signed certificate" />
          </div>
        </Section>

        {/* Admin */}
        <Section title="Admin" description="API and frontend port configuration">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="API Port" value={form.admin.api_port} onChange={(v) => update('admin', 'api_port', v)} type="number" help="Port for the FastAPI backend" />
            <Field label="Frontend Port" value={form.admin.frontend_port} onChange={(v) => update('admin', 'frontend_port', v)} type="number" help="Dev server port (dev only)" />
          </div>
        </Section>

        {/* Captures */}
        <Section title="Captures" description="Packet capture output settings">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Output Directory" value={form.captures.output_dir} onChange={(v) => update('captures', 'output_dir', v)} help="Directory for PCAP files" />
            <Field label="Max File Size (MB)" value={form.captures.max_file_size_mb} onChange={(v) => update('captures', 'max_file_size_mb', v)} type="number" />
          </div>
        </Section>

        {/* Logging */}
        <Section title="Logging" description="Application logging configuration">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[13px] font-medium text-foreground">Log Level</label>
              <select
                value={form.logging.level}
                onChange={(e) => update('logging', 'level', e.target.value)}
                className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
            <Field label="Log File" value={form.logging.file} onChange={(v) => update('logging', 'file', v)} help="Path to log output file" />
            <Field label="Max Size (MB)" value={form.logging.max_size_mb} onChange={(v) => update('logging', 'max_size_mb', v)} type="number" />
            <Field label="Backup Count" value={form.logging.backup_count} onChange={(v) => update('logging', 'backup_count', v)} type="number" help="Number of rotated log files to keep" />
          </div>
        </Section>
      </div>

      {/* Bottom save bar (sticky) */}
      {dirty && (
        <div className="sticky bottom-0 mt-6 -mx-6 px-6 py-3 bg-card border-t border-border flex items-center justify-between">
          <span className="text-[13px] text-muted-foreground">You have unsaved changes</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-[7px] text-[13px] font-medium rounded-md border border-border hover:bg-accent transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
