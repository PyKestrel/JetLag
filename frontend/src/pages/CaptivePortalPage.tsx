import { useState, useEffect } from 'react'
import {
  Save,
  RefreshCw,
  Plus,
  Trash2,
  Wifi,
  LogIn,
  Clock,
  Layers,
  Globe,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import {
  getPortalConfig,
  updatePortalConfig,
  type PortalConfigData,
  type PortalConfigUpdate,
  type TieredPlan,
} from '@/lib/api'

const PORTAL_TYPES = [
  { value: 'click_through', label: 'Click-Through', icon: Wifi, desc: 'Users accept terms to connect. No credentials required.' },
  { value: 'web_login', label: 'Web Login', icon: LogIn, desc: 'Users must enter a username and password.' },
  { value: 'tiered', label: 'Tiered Plans', icon: Layers, desc: 'Users select a plan with different durations.' },
  { value: 'time_limited', label: 'Time-Limited', icon: Clock, desc: 'Users get a fixed session duration after accepting.' },
  { value: 'walled_garden', label: 'Walled Garden', icon: Globe, desc: 'Specified domains are accessible without authentication.' },
] as const

export default function CaptivePortalPage() {
  const [config, setConfig] = useState<PortalConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Form state
  const [portalType, setPortalType] = useState('click_through')
  const [welcomeMessage, setWelcomeMessage] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [loginUsername, setLoginUsername] = useState('guest')
  const [loginPassword, setLoginPassword] = useState('guest')
  const [sessionDuration, setSessionDuration] = useState(60)
  const [tieredPlans, setTieredPlans] = useState<TieredPlan[]>([])
  const [walledGardenDomains, setWalledGardenDomains] = useState<string[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [newPlanName, setNewPlanName] = useState('')
  const [newPlanDuration, setNewPlanDuration] = useState(30)

  const fetchConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getPortalConfig()
      setConfig(data)
      setPortalType(data.portal_type)
      setWelcomeMessage(data.welcome_message)
      setRedirectUrl(data.redirect_url)
      setSessionDuration(data.session_duration_minutes)
      setTieredPlans(data.tiered_plans || [])
      setWalledGardenDomains(data.walled_garden_domains || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load portal config')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchConfig() }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const payload: PortalConfigUpdate = {
        portal_type: portalType,
        welcome_message: welcomeMessage,
        redirect_url: redirectUrl,
        login_username: loginUsername,
        login_password: loginPassword,
        session_duration_minutes: sessionDuration,
        tiered_plans: tieredPlans,
        walled_garden_domains: walledGardenDomains,
      }
      await updatePortalConfig(payload)
      setSuccess('Portal configuration saved successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e: any) {
      setError(e.message || 'Failed to save portal config')
    } finally {
      setSaving(false)
    }
  }

  const addDomain = () => {
    const d = newDomain.trim()
    if (d && !walledGardenDomains.includes(d)) {
      setWalledGardenDomains([...walledGardenDomains, d])
      setNewDomain('')
    }
  }

  const removeDomain = (idx: number) => {
    setWalledGardenDomains(walledGardenDomains.filter((_, i) => i !== idx))
  }

  const addPlan = () => {
    const name = newPlanName.trim()
    if (name) {
      setTieredPlans([...tieredPlans, { name, duration_minutes: newPlanDuration }])
      setNewPlanName('')
      setNewPlanDuration(30)
    }
  }

  const removePlan = (idx: number) => {
    setTieredPlans(tieredPlans.filter((_, i) => i !== idx))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-foreground">Captive Portal</h1>
          <p className="text-[14px] text-muted-foreground mt-1">Configure the captive portal type, behavior, and authentication method</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={fetchConfig} className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Portal Type Selector */}
      <div className="bg-card border border-border rounded-md p-5">
        <h2 className="text-[14px] font-semibold text-foreground mb-4">Portal Type</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {PORTAL_TYPES.map(({ value, label, icon: Icon, desc }) => (
            <button
              key={value}
              onClick={() => setPortalType(value)}
              className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                portalType === value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/30'
              }`}
            >
              <Icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${portalType === value ? 'text-primary' : 'text-muted-foreground'}`} />
              <div>
                <div className="text-[13px] font-medium text-foreground">{label}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Common Settings */}
      <div className="bg-card border border-border rounded-md p-5">
        <h2 className="text-[14px] font-semibold text-foreground mb-4">General Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="text-[13px] font-medium text-foreground mb-1 block">Welcome Message</label>
            <textarea
              value={welcomeMessage}
              onChange={e => setWelcomeMessage(e.target.value)}
              rows={3}
              className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Welcome aboard! Please accept the terms to continue."
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-medium text-foreground mb-1 block">Redirect URL (after auth)</label>
              <input
                type="text"
                value={redirectUrl}
                onChange={e => setRedirectUrl(e.target.value)}
                className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="https://www.google.com"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Web Login Settings */}
      {portalType === 'web_login' && (
        <div className="bg-card border border-border rounded-md p-5">
          <h2 className="text-[14px] font-semibold text-foreground mb-4 flex items-center gap-2">
            <LogIn className="h-4 w-4 text-primary" /> Web Login Credentials
          </h2>
          <p className="text-[13px] text-muted-foreground mb-4">Set the username and password clients must enter to authenticate.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-medium text-foreground mb-1 block">Username</label>
              <input
                type="text"
                value={loginUsername}
                onChange={e => setLoginUsername(e.target.value)}
                className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[13px] font-medium text-foreground mb-1 block">Password</label>
              <input
                type="text"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>
      )}

      {/* Time-Limited Settings */}
      {portalType === 'time_limited' && (
        <div className="bg-card border border-border rounded-md p-5">
          <h2 className="text-[14px] font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Session Duration
          </h2>
          <p className="text-[13px] text-muted-foreground mb-4">Clients are automatically disconnected after this duration.</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={sessionDuration}
              onChange={e => setSessionDuration(parseInt(e.target.value) || 0)}
              min={1}
              className="w-32 px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-[13px] text-muted-foreground">minutes</span>
            <span className="text-[12px] text-muted-foreground ml-2">
              ({sessionDuration >= 60 ? `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m` : `${sessionDuration}m`})
            </span>
          </div>
        </div>
      )}

      {/* Tiered Plan Settings */}
      {portalType === 'tiered' && (
        <div className="bg-card border border-border rounded-md p-5">
          <h2 className="text-[14px] font-semibold text-foreground mb-4 flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Tiered Plans
          </h2>
          <p className="text-[13px] text-muted-foreground mb-4">Define the available service plans. Duration of 0 = unlimited.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-[12px] text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Plan Name</th>
                  <th className="px-4 py-3 font-medium">Duration (min)</th>
                  <th className="px-4 py-3 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {tieredPlans.map((plan, idx) => (
                  <tr key={idx} className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3 text-[13px] font-medium text-foreground">{plan.name}</td>
                    <td className="px-4 py-3 text-[13px] text-foreground">
                      {plan.duration_minutes === 0 ? (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Unlimited</span>
                      ) : (
                        plan.duration_minutes
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => removePlan(idx)} className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {tieredPlans.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-[13px] text-muted-foreground">No plans defined</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <input
              type="text"
              value={newPlanName}
              onChange={e => setNewPlanName(e.target.value)}
              placeholder="Plan name"
              className="flex-1 px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="number"
              value={newPlanDuration}
              onChange={e => setNewPlanDuration(parseInt(e.target.value) || 0)}
              min={0}
              placeholder="Minutes"
              className="w-28 px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={addPlan}
              disabled={!newPlanName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        </div>
      )}

      {/* Walled Garden Settings */}
      {portalType === 'walled_garden' && (
        <div className="bg-card border border-border rounded-md p-5">
          <h2 className="text-[14px] font-semibold text-foreground mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" /> Walled Garden Domains
          </h2>
          <p className="text-[13px] text-muted-foreground mb-4">These domains are accessible even without authentication.</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {walledGardenDomains.map((domain, idx) => (
              <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-muted border border-border rounded-full text-[13px] text-foreground">
                {domain}
                <button onClick={() => removeDomain(idx)} className="text-muted-foreground hover:text-red-500 transition-colors">
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
            {walledGardenDomains.length === 0 && (
              <span className="text-[13px] text-muted-foreground">No domains whitelisted</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDomain()}
              placeholder="example.com"
              className="flex-1 px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={addDomain}
              disabled={!newDomain.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-[7px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        </div>
      )}

      {/* Active Config Summary */}
      {config && (
        <div className="bg-card border border-border rounded-md p-5">
          <h2 className="text-[14px] font-semibold text-foreground mb-3">Current Active Config</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
            <div>
              <span className="text-muted-foreground block text-[12px]">Type</span>
              <span className="text-foreground font-medium capitalize">{config.portal_type.replace(/_/g, ' ')}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[12px]">Session Duration</span>
              <span className="text-foreground font-medium">{config.session_duration_minutes} min</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[12px]">Plans</span>
              <span className="text-foreground font-medium">{config.tiered_plans?.length || 0} defined</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[12px]">Walled Garden</span>
              <span className="text-foreground font-medium">{config.walled_garden_domains?.length || 0} domains</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
