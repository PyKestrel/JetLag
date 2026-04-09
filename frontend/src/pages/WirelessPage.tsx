import { useState, useEffect, useCallback } from 'react'
import {
  Wifi,
  WifiOff,
  Play,
  Square,
  RotateCcw,
  Save,
  Radio,
  Shield,
  Users,
  Settings,
  Signal,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  WirelessConfig,
  WirelessStatus,
  WirelessStation,
  WlanInterface,
  getWirelessConfig,
  updateWirelessConfig,
  getWirelessStatus,
  getWirelessStations,
  getWirelessInterfaces,
  startWirelessAP,
  stopWirelessAP,
  restartWirelessAP,
} from '@/lib/api'

function StatusBadge({ running }: { running: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ${
        running
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          : 'bg-gray-100 text-gray-500 border border-gray-200'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
      {running ? 'Running' : 'Stopped'}
    </span>
  )
}

export default function WirelessPage() {
  const [config, setConfig] = useState<WirelessConfig | null>(null)
  const [status, setStatus] = useState<WirelessStatus | null>(null)
  const [stations, setStations] = useState<WirelessStation[]>([])
  const [interfaces, setInterfaces] = useState<WlanInterface[]>([])
  const [editConfig, setEditConfig] = useState<Partial<WirelessConfig>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [activeTab, setActiveTab] = useState<'config' | 'stations'>('config')

  const clearMessages = () => {
    setError(null)
    setSuccess(null)
  }

  const fetchAll = useCallback(async () => {
    try {
      const [cfg, st, stn, ifaces] = await Promise.all([
        getWirelessConfig(),
        getWirelessStatus().catch(() => null),
        getWirelessStations().catch(() => ({ stations: [] })),
        getWirelessInterfaces().catch(() => ({ interfaces: [] })),
      ])
      setConfig(cfg)
      setEditConfig(cfg)
      setStatus(st)
      setStations(stn.stations)
      setInterfaces(ifaces.interfaces)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load wireless data')
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(async () => {
      try {
        const [st, stn] = await Promise.all([
          getWirelessStatus().catch(() => null),
          getWirelessStations().catch(() => ({ stations: [] })),
        ])
        setStatus(st)
        setStations(stn.stations)
      } catch { /* ignore polling errors */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const handleChange = (field: string, value: string | number | boolean) => {
    setEditConfig((prev) => ({ ...prev, [field]: value }))
    setDirty(true)
    clearMessages()
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    clearMessages()
    try {
      const changes: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(editConfig)) {
        if (val !== (config as Record<string, unknown>)[key]) {
          changes[key] = val
        }
      }
      if (Object.keys(changes).length === 0) {
        setDirty(false)
        setSaving(false)
        return
      }
      const updated = await updateWirelessConfig(changes)
      setConfig(updated)
      setEditConfig(updated)
      setDirty(false)
      setSuccess('Configuration saved. Restart the AP to apply changes.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save config')
    }
    setSaving(false)
  }

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionLoading(action)
    clearMessages()
    try {
      const fn = action === 'start' ? startWirelessAP : action === 'stop' ? stopWirelessAP : restartWirelessAP
      await fn()
      setSuccess(`AP ${action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted'} successfully`)
      // Refresh status
      setTimeout(async () => {
        try {
          const [st, stn] = await Promise.all([getWirelessStatus(), getWirelessStations().catch(() => ({ stations: [] }))])
          setStatus(st)
          setStations(stn.stations)
        } catch { /* ignore */ }
      }, 1500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `Failed to ${action} AP`)
    }
    setActionLoading(null)
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isRunning = status?.running ?? false

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-foreground flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Wireless Access Point
          </h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Configure and manage the WLAN access point for wireless captive portal testing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge running={isRunning} />
          <button
            onClick={fetchAll}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Status Card */}
      <div className="rounded-md border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Radio className="h-4 w-4 text-muted-foreground" />
            AP Control
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAction('start')}
              disabled={isRunning || actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Start
            </button>
            <button
              onClick={() => handleAction('stop')}
              disabled={!isRunning || actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              Stop
            </button>
            <button
              onClick={() => handleAction('restart')}
              disabled={!isRunning || actionLoading !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-600 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading === 'restart' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Restart
            </button>
          </div>
        </div>

        {/* Status info grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Interface</div>
            <div className="text-sm font-medium mt-1">{status?.interface || config.interface}</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">SSID</div>
            <div className="text-sm font-medium mt-1">{status?.ssid || config.ssid}</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Channel</div>
            <div className="text-sm font-medium mt-1">{status?.channel || config.channel}</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Clients</div>
            <div className="text-sm font-medium mt-1 flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              {status?.clients_connected ?? 0}
            </div>
          </div>
        </div>

        {/* Detected interfaces */}
        {interfaces.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-xs text-muted-foreground mb-2">Detected WLAN interfaces:</div>
            <div className="flex flex-wrap gap-2">
              {interfaces.map((iface) => (
                <span key={iface.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-xs text-foreground">
                  <Signal className="h-3 w-3" />
                  {iface.name}
                  <span className="text-muted-foreground">({iface.driver})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('config')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'config'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Settings className="h-3.5 w-3.5 inline mr-1.5" />
          Configuration
        </button>
        <button
          onClick={() => setActiveTab('stations')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'stations'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="h-3.5 w-3.5 inline mr-1.5" />
          Connected Stations ({stations.length})
        </button>
      </div>

      {/* Config Tab */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* General Settings */}
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
              <Wifi className="h-4 w-4 text-muted-foreground" />
              General Settings
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs text-muted-foreground">Enabled</span>
                <select
                  value={editConfig.enabled ? 'true' : 'false'}
                  onChange={(e) => handleChange('enabled', e.target.value === 'true')}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Interface</span>
                <select
                  value={editConfig.interface || ''}
                  onChange={(e) => handleChange('interface', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value={editConfig.interface}>{editConfig.interface}</option>
                  {interfaces
                    .filter((i) => i.name !== editConfig.interface)
                    .map((i) => (
                      <option key={i.name} value={i.name}>{i.name}</option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">SSID</span>
                <input
                  type="text"
                  value={editConfig.ssid || ''}
                  onChange={(e) => handleChange('ssid', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Channel</span>
                <input
                  type="number"
                  min={1}
                  max={196}
                  value={editConfig.channel ?? 6}
                  onChange={(e) => handleChange('channel', parseInt(e.target.value) || 6)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Band (hw_mode)</span>
                <select
                  value={editConfig.hw_mode || 'g'}
                  onChange={(e) => handleChange('hw_mode', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="g">2.4 GHz (802.11g)</option>
                  <option value="a">5 GHz (802.11a)</option>
                  <option value="b">2.4 GHz (802.11b)</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Country Code</span>
                <input
                  type="text"
                  maxLength={2}
                  value={editConfig.country_code || 'US'}
                  onChange={(e) => handleChange('country_code', e.target.value.toUpperCase())}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 mt-5">
                <input
                  type="checkbox"
                  checked={editConfig.ieee80211n ?? true}
                  onChange={(e) => handleChange('ieee80211n', e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-sm">802.11n (HT)</span>
              </label>
              <label className="flex items-center gap-2 mt-5">
                <input
                  type="checkbox"
                  checked={editConfig.ieee80211ac ?? false}
                  onChange={(e) => handleChange('ieee80211ac', e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-sm">802.11ac (VHT)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editConfig.hidden ?? false}
                  onChange={(e) => handleChange('hidden', e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-sm">Hidden SSID</span>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Max Clients</span>
                <input
                  type="number"
                  min={1}
                  max={255}
                  value={editConfig.max_clients ?? 10}
                  onChange={(e) => handleChange('max_clients', parseInt(e.target.value) || 10)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>

          {/* Security Settings */}
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Security
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs text-muted-foreground">WPA Version</span>
                <select
                  value={editConfig.wpa ?? 2}
                  onChange={(e) => handleChange('wpa', parseInt(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value={0}>None (Open)</option>
                  <option value={1}>WPA</option>
                  <option value={2}>WPA2</option>
                  <option value={3}>WPA/WPA2 Mixed</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Passphrase</span>
                <div className="relative mt-1">
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={editConfig.wpa_passphrase || ''}
                    onChange={(e) => handleChange('wpa_passphrase', e.target.value)}
                    disabled={(editConfig.wpa ?? 2) === 0}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Key Management</span>
                <input
                  type="text"
                  value={editConfig.wpa_key_mgmt || 'WPA-PSK'}
                  onChange={(e) => handleChange('wpa_key_mgmt', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">RSN Pairwise Cipher</span>
                <input
                  type="text"
                  value={editConfig.rsn_pairwise || 'CCMP'}
                  onChange={(e) => handleChange('rsn_pairwise', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>

          {/* Network Settings */}
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
              <Signal className="h-4 w-4 text-muted-foreground" />
              Network & DHCP
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs text-muted-foreground">AP IP Address</span>
                <input
                  type="text"
                  value={editConfig.ip || ''}
                  onChange={(e) => handleChange('ip', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Subnet</span>
                <input
                  type="text"
                  value={editConfig.subnet || ''}
                  onChange={(e) => handleChange('subnet', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">DHCP Range Start</span>
                <input
                  type="text"
                  value={editConfig.dhcp_range_start || ''}
                  onChange={(e) => handleChange('dhcp_range_start', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">DHCP Range End</span>
                <input
                  type="text"
                  value={editConfig.dhcp_range_end || ''}
                  onChange={(e) => handleChange('dhcp_range_end', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">DHCP Lease Time</span>
                <input
                  type="text"
                  value={editConfig.dhcp_lease_time || ''}
                  onChange={(e) => handleChange('dhcp_lease_time', e.target.value)}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 mt-5">
                <input
                  type="checkbox"
                  checked={editConfig.bridge_to_lan ?? false}
                  onChange={(e) => handleChange('bridge_to_lan', e.target.checked)}
                  className="rounded border-input"
                />
                <span className="text-sm">Bridge to LAN</span>
              </label>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            {dirty && (
              <span className="text-xs text-amber-400 self-center">Unsaved changes</span>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {/* Stations Tab */}
      {activeTab === 'stations' && (
        <div className="rounded-md border border-border bg-card">
          {stations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              {isRunning ? (
                <>
                  <WifiOff className="h-10 w-10 mb-3 opacity-40" />
                  <p className="text-sm">No clients connected</p>
                </>
              ) : (
                <>
                  <WifiOff className="h-10 w-10 mb-3 opacity-40" />
                  <p className="text-sm">AP is not running</p>
                  <p className="text-xs mt-1">Start the AP to see connected stations</p>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">MAC Address</th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Signal</th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">RX Bytes</th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">TX Bytes</th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Connected Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stations.map((s) => (
                    <tr key={s.mac} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{s.mac}</td>
                      <td className="px-4 py-3">{s.signal}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.rx_bytes}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.tx_bytes}</td>
                      <td className="px-4 py-3">{s.connected_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
