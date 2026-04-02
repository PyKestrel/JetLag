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
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-2 text-sm text-gray-400">Loading portal config…</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Captive Portal</h1>
          <p className="text-sm text-gray-400 mt-1">Configure the captive portal type, behavior, and authentication method</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchConfig} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-zinc-700 text-gray-300 hover:bg-zinc-600">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {success}
        </div>
      )}

      {/* Portal Type Selector */}
      <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Portal Type</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {PORTAL_TYPES.map(({ value, label, icon: Icon, desc }) => (
            <button
              key={value}
              onClick={() => setPortalType(value)}
              className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                portalType === value
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-zinc-600 bg-zinc-700/50 text-gray-300 hover:border-zinc-500'
              }`}
            >
              <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${portalType === value ? 'text-blue-400' : 'text-gray-500'}`} />
              <div>
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-gray-400 mt-1">{desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Common Settings */}
      <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-4">General Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Welcome Message</label>
            <textarea
              value={welcomeMessage}
              onChange={e => setWelcomeMessage(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Welcome aboard! Please accept the terms to continue."
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Redirect URL (after auth)</label>
              <input
                type="text"
                value={redirectUrl}
                onChange={e => setRedirectUrl(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="https://www.google.com"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Web Login Settings */}
      {portalType === 'web_login' && (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-400" /> Web Login Credentials
          </h2>
          <p className="text-sm text-gray-400 mb-4">Set the username and password clients must enter to authenticate.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
              <input
                type="text"
                value={loginUsername}
                onChange={e => setLoginUsername(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
              <input
                type="text"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Time-Limited Settings */}
      {portalType === 'time_limited' && (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-400" /> Session Duration
          </h2>
          <p className="text-sm text-gray-400 mb-4">Clients are automatically disconnected after this duration.</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={sessionDuration}
              onChange={e => setSessionDuration(parseInt(e.target.value) || 0)}
              min={1}
              className="w-32 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-400">minutes</span>
            <span className="text-xs text-gray-500 ml-2">
              ({sessionDuration >= 60 ? `${Math.floor(sessionDuration / 60)}h ${sessionDuration % 60}m` : `${sessionDuration}m`})
            </span>
          </div>
        </div>
      )}

      {/* Tiered Plan Settings */}
      {portalType === 'tiered' && (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" /> Tiered Plans
          </h2>
          <p className="text-sm text-gray-400 mb-4">Define the available service plans. Duration of 0 = unlimited.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-zinc-700 text-gray-400">
                  <th className="px-3 py-2 font-medium">Plan Name</th>
                  <th className="px-3 py-2 font-medium">Duration (min)</th>
                  <th className="px-3 py-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {tieredPlans.map((plan, idx) => (
                  <tr key={idx} className="border-b border-zinc-700/50">
                    <td className="px-3 py-2 text-white">{plan.name}</td>
                    <td className="px-3 py-2 text-gray-300">
                      {plan.duration_minutes === 0 ? (
                        <span className="text-green-400">Unlimited</span>
                      ) : (
                        plan.duration_minutes
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => removePlan(idx)} className="p-1 text-red-400 hover:text-red-300">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {tieredPlans.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-gray-500">No plans defined</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-700">
            <input
              type="text"
              value={newPlanName}
              onChange={e => setNewPlanName(e.target.value)}
              placeholder="Plan name"
              className="flex-1 px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="number"
              value={newPlanDuration}
              onChange={e => setNewPlanDuration(parseInt(e.target.value) || 0)}
              min={0}
              placeholder="Minutes"
              className="w-28 px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={addPlan}
              disabled={!newPlanName.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>
      )}

      {/* Walled Garden Settings */}
      {portalType === 'walled_garden' && (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-400" /> Walled Garden Domains
          </h2>
          <p className="text-sm text-gray-400 mb-4">These domains are accessible even without authentication.</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {walledGardenDomains.map((domain, idx) => (
              <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-700 border border-zinc-600 rounded-full text-sm text-gray-300">
                {domain}
                <button onClick={() => removeDomain(idx)} className="text-gray-500 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
            {walledGardenDomains.length === 0 && (
              <span className="text-sm text-gray-500">No domains whitelisted</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDomain()}
              placeholder="example.com"
              className="flex-1 px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={addDomain}
              disabled={!newDomain.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>
      )}

      {/* Active Config Summary */}
      {config && (
        <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Current Active Config</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-400 block">Type</span>
              <span className="text-white font-medium">{config.portal_type.replace(/_/g, ' ')}</span>
            </div>
            <div>
              <span className="text-gray-400 block">Session Duration</span>
              <span className="text-white font-medium">{config.session_duration_minutes} min</span>
            </div>
            <div>
              <span className="text-gray-400 block">Plans</span>
              <span className="text-white font-medium">{config.tiered_plans?.length || 0} defined</span>
            </div>
            <div>
              <span className="text-gray-400 block">Walled Garden</span>
              <span className="text-white font-medium">{config.walled_garden_domains?.length || 0} domains</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
