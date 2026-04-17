import { useState, useEffect } from 'react'
import { Switch } from '@/components/ui/Switch'
import {
  Plane,
  Globe,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertCircle,
  Loader2,
  Server,
  ExternalLink,
  Wifi,
  Radio,
} from 'lucide-react'
import {
  getSetupInterfaces,
  completeSetup,
  type NetworkInterface,
  type SetupRequest,
} from '@/lib/api'

/* ── Step definitions ───────────────────────────────────────────── */
const STEPS = [
  { id: 'interfaces', label: 'Select interfaces' },
  { id: 'lan',        label: 'Configure LAN' },
  { id: 'services',   label: 'Services' },
  { id: 'review',     label: 'Review & deploy' },
] as const
type StepId = (typeof STEPS)[number]['id']

/* ── Component ──────────────────────────────────────────────────── */
export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState<StepId>('interfaces')
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([])
  const [loadingIfaces, setLoadingIfaces] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [wanIface, setWanIface] = useState('')
  const [lanIface, setLanIface] = useState('')
  const [lanIp, setLanIp] = useState('10.0.1.1')
  const [lanSubnet, setLanSubnet] = useState('10.0.1.0/24')
  const [dhcpEnabled, setDhcpEnabled] = useState(true)
  const [dhcpStart, setDhcpStart] = useState('10.0.1.100')
  const [dhcpEnd, setDhcpEnd] = useState('10.0.1.250')
  const [dhcpLease, setDhcpLease] = useState('1h')
  const [dnsUpstream, setDnsUpstream] = useState('1.1.1.1, 8.8.8.8')
  const [dnsSpoofing, setDnsSpoofing] = useState(true)
  const [firewallEnabled, setFirewallEnabled] = useState(true)

  // Hotspot mode state
  const [hotspotMode, setHotspotMode] = useState(false)
  const [hotspotSsid, setHotspotSsid] = useState('JetLag-WiFi')
  const [hotspotPassword, setHotspotPassword] = useState('JetLag1234')
  const [hotspotChannel, setHotspotChannel] = useState(6)
  const [hotspotHidden, setHotspotHidden] = useState(false)

  // Auto-infer related fields when the user types a LAN IP
  const inferFromIp = (ip: string) => {
    // Only infer when we have a plausible IPv4 with at least 3 octets
    const parts = ip.split('.')
    if (parts.length === 4 && parts.every((p) => p !== '' && !isNaN(Number(p)))) {
      const prefix = parts.slice(0, 3).join('.')
      setLanSubnet(`${prefix}.0/24`)
      setDhcpStart(`${prefix}.100`)
      setDhcpEnd(`${prefix}.250`)
    }
  }

  const handleLanIpChange = (ip: string) => {
    setLanIp(ip)
    inferFromIp(ip)
  }

  // Deploy state
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deployDone, setDeployDone] = useState(false)
  const [countdown, setCountdown] = useState(5)

  // Countdown redirect after successful deploy
  useEffect(() => {
    if (!deployDone) return
    if (countdown <= 0) {
      window.location.href = '/'
      return
    }
    const timer = setTimeout(() => setCountdown((c: number) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [deployDone, countdown])

  useEffect(() => {
    loadInterfaces()
  }, [])

  const loadInterfaces = async () => {
    setLoadingIfaces(true)
    setError(null)
    try {
      const data = await getSetupInterfaces()
      setInterfaces(data.interfaces)
      if (data.interfaces.length === 2) {
        const withIp = data.interfaces.find((i: NetworkInterface) => i.ipv4_addresses.length > 0)
        const withoutIp = data.interfaces.find((i: NetworkInterface) => i.ipv4_addresses.length === 0)
        if (withIp && withoutIp) {
          setWanIface(withIp.name)
          setLanIface(withoutIp.name)
        }
      }
      // Auto-detect single-WLAN scenario: only one non-lo iface that is WLAN + AP-capable
      const wlanAp = data.interfaces.filter((i: NetworkInterface) => i.is_wlan && i.supports_ap)
      const nonWlan = data.interfaces.filter((i: NetworkInterface) => !i.is_wlan)
      if (wlanAp.length >= 1 && nonWlan.length === 0) {
        // Only WLAN cards available — auto-suggest hotspot mode
        setWanIface(wlanAp[0].name)
        setHotspotMode(true)
        setLanIface('')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to detect interfaces')
    }
    setLoadingIfaces(false)
  }

  // Derived: selected WAN interface object
  const selectedWan = interfaces.find((i: NetworkInterface) => i.name === wanIface)
  const wanIsApCapable = selectedWan?.is_wlan && selectedWan?.supports_ap

  const handleDeploy = async () => {
    setDeploying(true)
    setDeployError(null)
    const payload: SetupRequest = {
      wan_interface: wanIface,
      lan_interface: hotspotMode ? 'ap0' : lanIface,
      lan_ip: lanIp,
      lan_subnet: lanSubnet,
      dhcp_enabled: dhcpEnabled,
      dhcp_range_start: dhcpStart,
      dhcp_range_end: dhcpEnd,
      dhcp_lease_time: dhcpLease,
      dns_upstream: dnsUpstream.split(',').map((s: string) => s.trim()).filter(Boolean),
      hotspot_mode: hotspotMode,
      hotspot_ssid: hotspotSsid,
      hotspot_password: hotspotPassword,
      hotspot_channel: hotspotChannel,
      hotspot_hidden: hotspotHidden,
    }
    try {
      await completeSetup(payload)
      setDeployDone(true)
    } catch (err: unknown) {
      setDeployError(err instanceof Error ? err.message : 'Deployment failed')
      setDeploying(false)
    }
  }

  const stepIdx = STEPS.findIndex((s) => s.id === currentStep)
  const canGoNext = (): boolean => {
    if (currentStep === 'interfaces') {
      if (hotspotMode) return !!(wanIface && hotspotSsid && hotspotPassword.length >= 8)
      return !!(wanIface && lanIface && wanIface !== lanIface)
    }
    if (currentStep === 'lan') return !!(lanIp && lanSubnet)
    if (currentStep === 'services') return true
    return false
  }
  const goNext = () => {
    if (stepIdx < STEPS.length - 1) setCurrentStep(STEPS[stepIdx + 1].id)
  }
  const goBack = () => {
    if (stepIdx > 0) setCurrentStep(STEPS[stepIdx - 1].id)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top header bar ─── */}
      <header className="h-[52px] border-b border-border bg-card flex items-center px-6">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <Plane className="h-4 w-4 text-white" />
          </div>
          <span className="text-[14px] font-semibold text-foreground">JetLag</span>
          <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">Setup</span>
        </div>
      </header>

      <div className="max-w-[860px] mx-auto px-6 py-8">
        {/* ── Page heading ─── */}
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold text-foreground">Configure appliance</h1>
          <p className="text-[14px] text-muted-foreground mt-1">
            Set up the JetLag network appliance by selecting interfaces, configuring the LAN, and enabling services.
          </p>
        </div>

        {/* ── Step tabs ─── */}
        <div className="flex border-b border-border mb-8">
          {STEPS.map((s, i) => {
            const isActive = s.id === currentStep
            const isCompleted = i < stepIdx
            const isClickable = i <= stepIdx
            return (
              <button
                key={s.id}
                onClick={() => isClickable && setCurrentStep(s.id)}
                className={`relative flex items-center gap-2 px-5 py-3 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'text-foreground'
                    : isCompleted
                    ? 'text-primary cursor-pointer hover:text-primary/80'
                    : 'text-muted-foreground cursor-default'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full text-[11px] font-bold inline-flex items-center justify-center flex-shrink-0 ${
                    isCompleted
                      ? 'bg-primary text-white'
                      : isActive
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {s.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t" />
                )}
              </button>
            )
          })}
        </div>

        {/* ── Step 1: Select interfaces ─── */}
        {currentStep === 'interfaces' && (
          <div>
            <h2 className="text-[16px] font-semibold text-foreground mb-1">Select your network interfaces</h2>
            <p className="text-[13px] text-muted-foreground mb-6">
              Choose which physical interface connects to the internet (WAN) and which will serve your test clients (LAN).
            </p>

            {loadingIfaces && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-[13px] text-muted-foreground">Detecting network interfaces...</span>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 mb-6 text-[13px] text-red-800">
                {error}
              </div>
            )}

            {!loadingIfaces && interfaces.length > 0 && (
              <>
                {/* WAN */}
                <div className="mb-8">
                  <label className="text-[13px] font-medium text-foreground mb-3 block">
                    WAN interface <span className="text-muted-foreground font-normal">— internet uplink</span>
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {interfaces.map((iface: NetworkInterface) => {
                      const selected = wanIface === iface.name
                      const disabled = !hotspotMode && iface.name === lanIface
                      return (
                        <button
                          key={`wan-${iface.name}`}
                          onClick={() => { setWanIface(iface.name); if (lanIface === iface.name) setLanIface('') }}
                          disabled={disabled}
                          className={`text-left p-4 rounded-lg border transition-all ${
                            selected
                              ? 'border-primary ring-1 ring-primary bg-primary/[0.03]'
                              : disabled
                              ? 'border-border opacity-40 cursor-not-allowed'
                              : 'border-border hover:border-primary/40'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mt-0.5 ${
                              selected ? 'bg-primary/10' : 'bg-muted'
                            }`}>
                              {iface.is_wlan
                                ? <Wifi className={`h-4.5 w-4.5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                                : <Globe className={`h-4.5 w-4.5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[14px] font-semibold text-foreground">{iface.name}</span>
                                {iface.has_link && (
                                  <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-px">UP</span>
                                )}
                                {!iface.has_link && (
                                  <span className="text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-px">DOWN</span>
                                )}
                              </div>
                              <p className="text-[12px] text-muted-foreground mt-0.5">
                                {iface.ipv4_addresses.length > 0 ? iface.ipv4_addresses.join(', ') : 'No IP address assigned'}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{iface.mac}</p>
                              {iface.is_wlan && iface.supports_ap && (
                                <span className="inline-block mt-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-px">AP capable</span>
                              )}
                              {iface.is_wlan && !iface.supports_ap && (
                                <span className="inline-block mt-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-px">WiFi (no AP)</span>
                              )}
                            </div>
                          </div>
                          {selected && (
                            <div className="mt-3 pt-3 border-t border-primary/20">
                              <span className="text-[12px] text-primary font-medium">Selected as WAN</span>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Hotspot mode toggle — shown when WAN is a WLAN card with AP support */}
                {wanIsApCapable && (
                  <div className="mb-8">
                    <div className={`rounded-lg border p-5 transition-all ${hotspotMode ? 'border-violet-500 ring-1 ring-violet-500 bg-violet-500/[0.03]' : 'border-border'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${hotspotMode ? 'bg-violet-500/10' : 'bg-muted'}`}>
                            <Radio className={`h-4.5 w-4.5 ${hotspotMode ? 'text-violet-600' : 'text-muted-foreground'}`} />
                          </div>
                          <div>
                            <h3 className="text-[14px] font-semibold text-foreground">Hotspot mode</h3>
                            <p className="text-[12px] text-muted-foreground mt-0.5">
                              Your WAN interface (<span className="font-mono font-medium text-foreground">{wanIface}</span>) is
                              a wireless card that supports AP mode. Enable hotspot mode to create a virtual access point on the
                              same card — no second physical interface needed.
                            </p>
                          </div>
                        </div>
                        <Switch
                          variant="violet"
                          checked={hotspotMode}
                          onCheckedChange={(v) => { setHotspotMode(v); if (v) setLanIface('') }}
                          className="mt-1"
                          aria-label="Hotspot mode"
                        />
                      </div>

                      {hotspotMode && (
                        <div className="mt-4 pt-4 border-t border-violet-500/20 space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">SSID (network name)</label>
                              <input
                                type="text" value={hotspotSsid} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHotspotSsid(e.target.value)}
                                className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                            <div>
                              <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Password (min 8 chars)</label>
                              <input
                                type="text" value={hotspotPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHotspotPassword(e.target.value)}
                                className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Channel</label>
                              <select
                                value={hotspotChannel} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setHotspotChannel(Number(e.target.value))}
                                className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                              >
                                {[1,2,3,4,5,6,7,8,9,10,11].map((ch) => (
                                  <option key={ch} value={ch}>Channel {ch} (2.4 GHz)</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 text-[13px] text-foreground cursor-pointer">
                                <input
                                  type="checkbox" checked={hotspotHidden} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHotspotHidden(e.target.checked)}
                                  className="rounded border-input"
                                />
                                Hidden SSID
                              </label>
                            </div>
                          </div>
                          <div className="rounded-md border border-violet-200 bg-violet-50 p-3">
                            <div className="flex gap-2">
                              <Wifi className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                              <p className="text-[12px] text-violet-800">
                                A virtual interface <span className="font-mono font-medium">ap0</span> will be created on the
                                same radio as <span className="font-mono font-medium">{wanIface}</span>. Your internet connection
                                stays active while clients connect to the hotspot.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* LAN — hidden when hotspot mode is active */}
                {!hotspotMode && (
                  <div className="mb-6">
                    <label className="text-[13px] font-medium text-foreground mb-3 block">
                      LAN interface <span className="text-muted-foreground font-normal">— client-facing network</span>
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {interfaces.map((iface: NetworkInterface) => {
                        const selected = lanIface === iface.name
                        const disabled = iface.name === wanIface
                        return (
                          <button
                            key={`lan-${iface.name}`}
                            onClick={() => { setLanIface(iface.name); if (wanIface === iface.name) setWanIface('') }}
                            disabled={disabled}
                            className={`text-left p-4 rounded-lg border transition-all ${
                              selected
                                ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-500/[0.03]'
                                : disabled
                                ? 'border-border opacity-40 cursor-not-allowed'
                                : 'border-border hover:border-emerald-400/60'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mt-0.5 ${
                                selected ? 'bg-emerald-500/10' : 'bg-muted'
                              }`}>
                                <Server className={`h-4.5 w-4.5 ${selected ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] font-semibold text-foreground">{iface.name}</span>
                                  {iface.has_link && (
                                    <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-px">UP</span>
                                  )}
                                  {!iface.has_link && (
                                    <span className="text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-px">DOWN</span>
                                  )}
                                </div>
                                <p className="text-[12px] text-muted-foreground mt-0.5">
                                  {iface.ipv4_addresses.length > 0 ? iface.ipv4_addresses.join(', ') : 'No IP address assigned'}
                                </p>
                                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{iface.mac}</p>
                              </div>
                            </div>
                            {selected && (
                              <div className="mt-3 pt-3 border-t border-emerald-500/20">
                                <span className="text-[12px] text-emerald-600 font-medium">Selected as LAN</span>
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <p className="text-[12px] text-muted-foreground">
                  {hotspotMode ? (
                    <><strong>Hotspot mode:</strong> A virtual AP interface (ap0) will be created on the same radio as your WAN connection.
                    Clients will connect to the hotspot SSID and receive an IP from the DHCP server configured in the next step.</>
                  ) : (
                    <><strong>Note:</strong> The WAN interface will retain its existing IP configuration. The LAN interface will be
                    configured with a static IP in the next step.</>
                  )}
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Configure LAN ─── */}
        {currentStep === 'lan' && (
          <div>
            <h2 className="text-[16px] font-semibold text-foreground mb-1">Configure the LAN network</h2>
            <p className="text-[13px] text-muted-foreground mb-6">
              Set the IP address for the <span className="font-mono font-medium text-foreground">{lanIface}</span> interface
              and configure the DHCP server that will assign addresses to clients.
            </p>

            {/* IP settings */}
            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">Interface address</h3>
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">LAN IP address</label>
                  <input
                    type="text" value={lanIp} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleLanIpChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Subnet (CIDR)</label>
                  <input
                    type="text" value={lanSubnet} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLanSubnet(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </div>

            {/* DHCP */}
            <div className="rounded-lg border border-border overflow-hidden mb-6">
              <div className="bg-muted/40 px-5 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-foreground">DHCP server</h3>
                <Switch
                  checked={dhcpEnabled}
                  onCheckedChange={setDhcpEnabled}
                  aria-label="DHCP server enabled"
                />
              </div>
              {dhcpEnabled && (
                <div className="p-5 grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Range start</label>
                    <input
                      type="text" value={dhcpStart} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDhcpStart(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Range end</label>
                    <input
                      type="text" value={dhcpEnd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDhcpEnd(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Lease time</label>
                    <input
                      type="text" value={dhcpLease} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDhcpLease(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}
              {!dhcpEnabled && (
                <div className="p-5 text-[13px] text-muted-foreground">
                  DHCP is disabled. Clients will need static IP configuration.
                </div>
              )}
            </div>

            {/* DNS */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/40 px-5 py-3 border-b border-border">
                <h3 className="text-[13px] font-semibold text-foreground">DNS settings</h3>
              </div>
              <div className="p-5">
                <label className="text-[12px] font-medium text-muted-foreground mb-1.5 block">Upstream DNS servers</label>
                <input
                  type="text" value={dnsUpstream} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDnsUpstream(e.target.value)}
                  placeholder="e.g. 1.1.1.1, 8.8.8.8"
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">Comma-separated. Used for authenticated clients after they pass the captive portal.</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Services ─── */}
        {currentStep === 'services' && (
          <div>
            <h2 className="text-[16px] font-semibold text-foreground mb-1">Enable services</h2>
            <p className="text-[13px] text-muted-foreground mb-6">
              Choose which network services to activate on the LAN interface after setup completes.
            </p>

            <div className="space-y-3">
              {/* DNS spoofing card */}
              <div className={`rounded-lg border p-5 transition-all ${dnsSpoofing ? 'border-primary bg-primary/[0.02]' : 'border-border'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${dnsSpoofing ? 'bg-primary/10' : 'bg-muted'}`}>
                      <Globe className={`h-4 w-4 ${dnsSpoofing ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-semibold text-foreground">DNS spoofing</h3>
                      <p className="text-[12px] text-muted-foreground mt-0.5">Redirect all DNS queries to the captive portal IP until clients authenticate.</p>
                    </div>
                  </div>
                  <Switch
                    checked={dnsSpoofing}
                    onCheckedChange={setDnsSpoofing}
                    className="mt-1"
                    aria-label="DNS spoofing"
                  />
                </div>
              </div>

              {/* Firewall card */}
              <div className={`rounded-lg border p-5 transition-all ${firewallEnabled ? 'border-primary bg-primary/[0.02]' : 'border-border'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${firewallEnabled ? 'bg-primary/10' : 'bg-muted'}`}>
                      <Server className={`h-4 w-4 ${firewallEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-semibold text-foreground">Firewall (nftables)</h3>
                      <p className="text-[12px] text-muted-foreground mt-0.5">
                        Intercept HTTP/HTTPS traffic from unauthenticated clients and NAT authenticated traffic to WAN.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={firewallEnabled}
                    onCheckedChange={setFirewallEnabled}
                    className="mt-1"
                    aria-label="Firewall enabled"
                  />
                </div>
              </div>

              {/* DHCP read-only */}
              <div className={`rounded-lg border p-5 ${dhcpEnabled ? 'border-primary/40 bg-primary/[0.02]' : 'border-border'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${dhcpEnabled ? 'bg-primary/10' : 'bg-muted'}`}>
                    <ExternalLink className={`h-4 w-4 ${dhcpEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-foreground">DHCP server (dnsmasq)</h3>
                      <span className={`text-[10px] font-medium rounded px-1.5 py-px ${
                        dhcpEnabled
                          ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                          : 'text-gray-500 bg-gray-100 border border-gray-200'
                      }`}>{dhcpEnabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {dhcpEnabled
                        ? `Assigning ${dhcpStart} – ${dhcpEnd} on ${lanIface}`
                        : 'Configured in previous step. Go back to change.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 mt-6">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-[12px] text-blue-800">
                  After deployment, the admin UI will only be accessible from the LAN network (<strong>{lanSubnet}</strong>).
                  The WAN interface keeps its existing configuration for internet uplink only.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Review & deploy ─── */}
        {currentStep === 'review' && (
          <div>
            {!deploying && !deployDone && (
              <>
                <h2 className="text-[16px] font-semibold text-foreground mb-1">Review your configuration</h2>
                <p className="text-[13px] text-muted-foreground mb-6">
                  Verify the settings below, then deploy to apply the configuration to the appliance.
                </p>

                {/* Summary table */}
                <div className="rounded-lg border border-border overflow-hidden mb-4">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border">
                        <th className="text-left px-5 py-2.5 font-medium text-muted-foreground w-[200px]">Setting</th>
                        <th className="text-left px-5 py-2.5 font-medium text-muted-foreground">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr><td className="px-5 py-2.5 text-muted-foreground">WAN interface</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{wanIface}{selectedWan?.is_wlan ? ' (WiFi)' : ''}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">LAN interface</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{hotspotMode ? 'ap0 (virtual hotspot)' : lanIface}</td></tr>
                      {hotspotMode && (
                        <>
                          <tr><td className="px-5 py-2.5 text-muted-foreground">Hotspot SSID</td><td className="px-5 py-2.5 font-medium text-foreground">{hotspotSsid}</td></tr>
                          <tr><td className="px-5 py-2.5 text-muted-foreground">Hotspot channel</td><td className="px-5 py-2.5 font-medium text-foreground">{hotspotChannel}</td></tr>
                        </>
                      )}
                      <tr><td className="px-5 py-2.5 text-muted-foreground">LAN IP</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{lanIp}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Subnet</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{lanSubnet}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">DHCP</td><td className="px-5 py-2.5 font-medium text-foreground">{dhcpEnabled ? `${dhcpStart} – ${dhcpEnd} (${dhcpLease})` : 'Disabled'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Upstream DNS</td><td className="px-5 py-2.5 font-mono font-medium text-foreground">{dnsUpstream}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">DNS spoofing</td><td className="px-5 py-2.5 font-medium text-foreground">{dnsSpoofing ? 'Enabled' : 'Disabled'}</td></tr>
                      <tr><td className="px-5 py-2.5 text-muted-foreground">Firewall</td><td className="px-5 py-2.5 font-medium text-foreground">{firewallEnabled ? 'Enabled' : 'Disabled'}</td></tr>
                    </tbody>
                  </table>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 mb-6">
                  <div className="flex gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-[12px] text-amber-800">
                      Deploying will apply the configuration immediately. After this, the admin interface will only be reachable
                      from the LAN (<strong>{lanSubnet}</strong>). Ensure you have access from that network.
                    </p>
                  </div>
                </div>

                {deployError && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 mb-6">
                    <div className="flex gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <p className="text-[12px] text-red-800">{deployError}</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {deploying && !deployDone && (
              <div className="text-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
                <h2 className="text-[16px] font-semibold text-foreground mb-1">Deploying configuration...</h2>
                <p className="text-[13px] text-muted-foreground">
                  Saving settings, configuring interfaces, and starting services.
                </p>
              </div>
            )}

            {deployDone && (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 mb-4">
                  <Check className="h-6 w-6 text-emerald-600" />
                </div>
                <h2 className="text-[16px] font-semibold text-foreground mb-1">Configuration deployed!</h2>
                <p className="text-[13px] text-muted-foreground">
                  Redirecting to the dashboard in {countdown}s...
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Bottom navigation ─── */}
        {!(deploying || deployDone) && (
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
              {currentStep !== 'review' ? (
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
                  className="inline-flex items-center gap-2 px-5 py-2 text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Deploy appliance <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
