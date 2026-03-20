import { useState, useEffect } from 'react'
import { Save, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  getSettings,
  updateSettings,
  type SettingsData,
  type SettingsNetwork,
  type SettingsDHCP,
  type SettingsDNS,
  type SettingsPortal,
  type SettingsAdmin,
  type SettingsCaptures,
  type SettingsLogging,
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
    return (
      <div className="flex items-center justify-between py-2">
        <div>
          <label className="text-[13px] font-medium text-foreground">{label}</label>
          {help && <p className="text-[12px] text-muted-foreground mt-0.5">{help}</p>}
        </div>
        <button
          type="button"
          onClick={() => onChange(value ? 'false' : 'true')}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            value ? 'bg-primary' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              value ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
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

  useEffect(() => {
    if (data) {
      setForm(structuredClone(data))
      setDirty(false)
    }
  }, [data])

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
        {/* Network */}
        <Section title="Network" description="WAN/LAN interface configuration">
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
