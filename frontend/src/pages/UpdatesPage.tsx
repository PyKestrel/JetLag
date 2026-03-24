import { useState, useEffect, useRef } from 'react'
import {
  Download,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowDownCircle,
  Undo2,
  Settings2,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import {
  checkForUpdate,
  applyUpdate,
  getUpdateStatus,
  rollbackUpdate,
  getUpdateHistory,
  getUpdateConfig,
  updateUpdateConfig,
  getVersion,
  type UpdateCheckResult,
  type UpdateStatus,
  type UpdateHistoryEntry,
  type UpdateConfig,
} from '@/lib/api'

const STEP_LABELS: Record<string, string> = {
  preflight: 'Pre-flight checks',
  backup: 'Creating backup',
  fetch: 'Fetching from GitHub',
  verify: 'Verifying release',
  stop_services: 'Stopping services',
  apply_code: 'Applying code',
  install_deps: 'Installing dependencies',
  build_frontend: 'Building frontend',
  run_migrations: 'Running migrations',
  restart_service: 'Restarting service',
  health_check: 'Health check',
  post_flight: 'Post-flight',
}

export default function UpdatesPage() {
  const [check, setCheck] = useState<UpdateCheckResult | null>(null)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [history, setHistory] = useState<UpdateHistoryEntry[]>([])
  const [config, setConfig] = useState<UpdateConfig | null>(null)
  const [currentVersion, setCurrentVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadAll()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [status?.log_lines])

  async function loadAll() {
    try {
      const [v, c, s, h, cfg] = await Promise.all([
        getVersion(),
        checkForUpdate(false),
        getUpdateStatus(),
        getUpdateHistory(),
        getUpdateConfig(),
      ])
      setCurrentVersion(v.version)
      setCheck(c)
      setStatus(s)
      setHistory(h.history)
      setConfig(cfg)

      if (s.state === 'in_progress' || s.state === 'restarting' || s.state === 'rolling_back') {
        startPolling()
      }
    } catch {
      setError('Failed to load update information')
    }
  }

  function startPolling() {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      try {
        const s = await getUpdateStatus()
        setStatus(s)
        if (s.state === 'completed' || s.state === 'failed' || s.state === 'idle') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          setApplying(false)
          const h = await getUpdateHistory()
          setHistory(h.history)
          const v = await getVersion()
          setCurrentVersion(v.version)
          const c = await checkForUpdate(true)
          setCheck(c)
        }
      } catch { /* service might be restarting */ }
    }, 2000)
  }

  async function handleCheck() {
    setChecking(true)
    setError('')
    try {
      const c = await checkForUpdate(true)
      setCheck(c)
    } catch {
      setError('Failed to check for updates')
    } finally {
      setChecking(false)
    }
  }

  async function handleApply() {
    if (!check?.latest_version) return
    setApplying(true)
    setError('')
    setShowLog(true)
    try {
      await applyUpdate(check.latest_version)
      startPolling()
    } catch (e: any) {
      setError(e.message || 'Failed to start update')
      setApplying(false)
    }
  }

  async function handleRollback() {
    if (!confirm('Are you sure you want to rollback to the previous version? This will restart the service.')) return
    setError('')
    try {
      await rollbackUpdate()
      startPolling()
    } catch (e: any) {
      setError(e.message || 'Failed to rollback')
    }
  }

  async function handleConfigSave(updates: Partial<UpdateConfig>) {
    try {
      const c = await updateUpdateConfig(updates)
      setConfig(c)
    } catch (e: any) {
      setError(e.message || 'Failed to save config')
    }
  }

  const isActive = status?.state === 'in_progress' || status?.state === 'restarting' || status?.state === 'rolling_back'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Updates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage appliance software updates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-1.5 text-[13px] rounded-md border border-input bg-background text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Settings
          </button>
          <button
            onClick={handleCheck}
            disabled={checking || isActive}
            className="px-3 py-1.5 text-[13px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Check for updates
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-[13px] text-destructive flex items-center gap-2">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Current version card */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-muted-foreground">Current version</div>
            <div className="text-2xl font-semibold text-foreground mt-0.5">
              v{currentVersion || '…'}
            </div>
          </div>
          <div className="text-right text-[12px] text-muted-foreground">
            {check?.checked_at && (
              <div>Last checked: {new Date(check.checked_at).toLocaleString()}</div>
            )}
          </div>
        </div>
      </div>

      {/* Available update banner */}
      {check?.available && check.latest_version && !isActive && status?.state !== 'completed' && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <ArrowDownCircle className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-[14px] font-medium text-foreground">
                  Update available: v{check.latest_version}
                </div>
                {check.prerelease && (
                  <span className="inline-block mt-1 px-2 py-0.5 text-[11px] rounded-full bg-amber-500/20 text-amber-600 font-medium">
                    Pre-release
                  </span>
                )}
                {check.published_at && (
                  <div className="text-[12px] text-muted-foreground mt-1">
                    Published {new Date(check.published_at).toLocaleDateString()}
                  </div>
                )}
                {check.release_notes && (
                  <div className="mt-3 text-[13px] text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto border-t border-border pt-3">
                    {check.release_notes}
                  </div>
                )}
                {check.html_url && (
                  <a
                    href={check.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-[12px] text-blue-500 hover:underline"
                  >
                    View on GitHub <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
            <button
              onClick={handleApply}
              disabled={applying}
              className="px-4 py-2 text-[13px] rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-2 flex-shrink-0 disabled:opacity-50"
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Update now
            </button>
          </div>
        </div>
      )}

      {/* No update available */}
      {check && !check.available && !isActive && status?.state !== 'completed' && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
          <div className="text-[13px] text-foreground">
            You're running the latest version{check.latest_version ? ` (v${check.latest_version})` : ''}.
          </div>
        </div>
      )}

      {/* Update progress */}
      {(isActive || status?.state === 'completed' || status?.state === 'failed') && status && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {status.state === 'in_progress' || status.state === 'restarting' ? (
                  <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                ) : status.state === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : status.state === 'failed' ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : status.state === 'rolling_back' ? (
                  <Undo2 className="h-4 w-4 text-amber-500 animate-pulse" />
                ) : null}
                <span className="text-[14px] font-medium text-foreground">
                  {status.state === 'in_progress' ? `Updating to v${status.target_version}` :
                   status.state === 'restarting' ? 'Restarting service...' :
                   status.state === 'completed' ? `Updated to v${status.target_version}` :
                   status.state === 'failed' ? 'Update failed' :
                   status.state === 'rolling_back' ? 'Rolling back...' : 'Update'}
                </span>
              </div>
              {status.step && (
                <span className="text-[12px] text-muted-foreground">
                  {STEP_LABELS[status.step] || status.step}
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full bg-muted rounded-full h-2 mb-3">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  status.state === 'failed' ? 'bg-destructive' :
                  status.state === 'completed' ? 'bg-emerald-500' :
                  status.state === 'rolling_back' ? 'bg-amber-500' :
                  'bg-blue-500'
                }`}
                style={{ width: `${status.progress_pct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>{status.message}</span>
              <span>{status.progress_pct}%</span>
            </div>

            {status.error && (
              <div className="mt-3 p-3 bg-destructive/10 rounded text-[12px] text-destructive">
                {status.error}
              </div>
            )}

            {/* Actions */}
            {status.state === 'failed' && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleRollback}
                  className="px-3 py-1.5 text-[13px] rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors flex items-center gap-1.5"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Rollback to previous version
                </button>
              </div>
            )}
          </div>

          {/* Log viewer */}
          {status.log_lines && status.log_lines.length > 0 && (
            <div className="border-t border-border">
              <button
                onClick={() => setShowLog(!showLog)}
                className="w-full px-5 py-2.5 flex items-center gap-2 text-[12px] text-muted-foreground hover:bg-accent/50 transition-colors"
              >
                {showLog ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Update log ({status.log_lines.length} entries)
              </button>
              {showLog && (
                <div className="px-5 pb-4 max-h-64 overflow-y-auto">
                  <div className="bg-[hsl(var(--sidebar-bg))] rounded-md p-3 font-mono text-[11px] text-[hsl(var(--sidebar-fg))] space-y-0.5">
                    {status.log_lines.map((line, i) => (
                      <div key={i} className={line.includes('FAILED') ? 'text-red-400' : ''}>{line}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Update settings */}
      {showSettings && config && (
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-[14px] font-medium text-foreground mb-4">Update Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] text-muted-foreground mb-1">GitHub repository</label>
              <input
                type="text"
                value={config.github_repo}
                onChange={(e) => setConfig({ ...config, github_repo: e.target.value })}
                onBlur={() => handleConfigSave({ github_repo: config.github_repo })}
                className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-[12px] text-muted-foreground mb-1">Channel</label>
              <select
                value={config.channel}
                onChange={(e) => {
                  setConfig({ ...config, channel: e.target.value })
                  handleConfigSave({ channel: e.target.value })
                }}
                className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="stable">Stable (releases only)</option>
                <option value="beta">Beta (include pre-releases)</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] text-muted-foreground mb-1">Check interval (hours)</label>
              <input
                type="number"
                min={1}
                max={168}
                value={config.check_interval_hours}
                onChange={(e) => setConfig({ ...config, check_interval_hours: parseInt(e.target.value) || 6 })}
                onBlur={() => handleConfigSave({ check_interval_hours: config.check_interval_hours })}
                className="w-full px-3 py-[7px] rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.auto_check}
                  onChange={(e) => {
                    setConfig({ ...config, auto_check: e.target.checked })
                    handleConfigSave({ auto_check: e.target.checked })
                  }}
                  className="rounded border-input"
                />
                <span className="text-[13px] text-foreground">Auto-check for updates</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Update history */}
      {history.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-[14px] font-medium text-foreground">Update History</h2>
          </div>
          <div className="divide-y divide-border">
            {history.map((entry, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {entry.outcome === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : entry.outcome === 'failed' ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : entry.outcome === 'rollback' ? (
                    <Undo2 className="h-4 w-4 text-amber-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <div className="text-[13px] text-foreground font-medium">
                      v{entry.version}
                      <span className={`ml-2 px-1.5 py-0.5 text-[11px] rounded-full font-medium ${
                        entry.outcome === 'success' ? 'bg-emerald-500/20 text-emerald-600' :
                        entry.outcome === 'failed' ? 'bg-destructive/20 text-destructive' :
                        'bg-amber-500/20 text-amber-600'
                      }`}>
                        {entry.outcome}
                      </span>
                    </div>
                    {entry.error && (
                      <div className="text-[11px] text-destructive mt-0.5 truncate max-w-md">
                        {entry.error}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-[12px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {entry.completed_at ? new Date(entry.completed_at).toLocaleString() : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
