import { useState, useRef, useEffect } from 'react'
import {
  Upload, Trash2, Download, Play, Square, Pause, RotateCcw, RefreshCw,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock, Activity,
  Repeat, Loader2, AlertCircle, FileJson, Pencil, Plus, Save, X, History,
} from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import {
  getReplayScenarios, getReplayScenario, importReplayScenario,
  deleteReplayScenario, getReplayScenarioExportUrl, getProfiles,
  startReplaySession, stopReplaySession, pauseReplaySession,
  resumeReplaySession, getReplaySessionStatus, revertReplayProfile,
  updateReplayScenario, getReplayHistory,
  type ReplayScenarioListItem, type ReplayScenario, type ReplaySessionStatus,
  type ReplayHistoryEntry, type ImpairmentProfile, type PaginatedResponse,
} from '@/lib/api'

const inputCls = "w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
const labelCls = "text-[12px] font-medium text-muted-foreground mb-1.5 block"

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtBw(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    running: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    paused: 'text-amber-700 bg-amber-50 border-amber-200',
    completed: 'text-blue-700 bg-blue-50 border-blue-200',
    stopped: 'text-gray-600 bg-gray-100 border-gray-200',
    idle: 'text-gray-500 bg-gray-50 border-gray-200',
  }
  const dotColors: Record<string, string> = {
    running: 'bg-emerald-500', paused: 'bg-amber-500', completed: 'bg-blue-500',
    stopped: 'bg-gray-400', idle: 'bg-gray-400',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium border rounded-full px-2 py-0.5 ${colors[state] || colors.idle}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${state === 'running' ? 'animate-pulse' : ''} ${dotColors[state] || dotColors.idle}`} />
      {state.toUpperCase()}
    </span>
  )
}

function ExportDropdown({ id }: { id: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen(!open)} className="p-1 rounded hover:bg-accent transition-colors" title="Export">
        <Download className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-32 bg-card border border-border rounded-md shadow-lg z-20 py-1">
          <a href={getReplayScenarioExportUrl(id, 'json')} download onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors">JSON</a>
          <a href={getReplayScenarioExportUrl(id, 'yaml')} download onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors">YAML</a>
        </div>
      )}
    </div>
  )
}

export default function ReplayEngineTab() {
  const [scenarioPage, setScenarioPage] = useState(1)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedScenario, setExpandedScenario] = useState<ReplayScenario | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: scenarioData, loading: scenariosLoading, refetch: refetchScenarios } = useApi<PaginatedResponse<ReplayScenarioListItem>>(
    () => getReplayScenarios({ page: String(scenarioPage), per_page: '10' }), [scenarioPage]
  )
  const { data: profileData } = useApi<PaginatedResponse<ImpairmentProfile>>(
    () => getProfiles({ page: '1', per_page: '100' }), []
  )

  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null)
  const [loop, setLoop] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0)
  const [startOffsetSec, setStartOffsetSec] = useState('')
  const [endOffsetSec, setEndOffsetSec] = useState('')
  const [controlError, setControlError] = useState<string | null>(null)
  const [controlLoading, setControlLoading] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<ReplaySessionStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Step editor state
  const [editingScenario, setEditingScenario] = useState<ReplayScenario | null>(null)
  type EditStep = { offset_ms: number; duration_ms: number; latency_ms: number; jitter_ms: number; packet_loss_percent: number; bandwidth_kbps: number }
  const [editSteps, setEditSteps] = useState<EditStep[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Selected scenario full data (for timeline)
  const [selectedScenarioData, setSelectedScenarioData] = useState<ReplayScenario | null>(null)
  useEffect(() => {
    if (!selectedScenarioId) { setSelectedScenarioData(null); return }
    getReplayScenario(selectedScenarioId).then(setSelectedScenarioData).catch(() => setSelectedScenarioData(null))
  }, [selectedScenarioId])

  // History state
  const [historyPage, setHistoryPage] = useState(1)
  const { data: historyData, loading: historyLoading, refetch: refetchHistory } = useApi<PaginatedResponse<ReplayHistoryEntry>>(
    () => getReplayHistory({ page: String(historyPage), per_page: '10' }), [historyPage]
  )

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (!selectedProfileId) { setSessionStatus(null); return }
    const poll = async () => {
      try { setSessionStatus(await getReplaySessionStatus(selectedProfileId)) } catch {}
    }
    poll()
    pollRef.current = setInterval(poll, 1000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [selectedProfileId])

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setImportError(null)
    try { await importReplayScenario(file); await refetchScenarios() }
    catch (err) { setImportError(err instanceof Error ? err.message : 'Import failed') }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete scenario "${name}"?`)) return
    try {
      await deleteReplayScenario(id)
      if (expandedId === id) { setExpandedId(null); setExpandedScenario(null) }
      if (selectedScenarioId === id) setSelectedScenarioId(null)
      await refetchScenarios()
    } catch (err) { alert(err instanceof Error ? err.message : 'Delete failed') }
  }

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); setExpandedScenario(null); return }
    try { setExpandedScenario(await getReplayScenario(id)); setExpandedId(id) } catch {}
  }

  const handleStart = async () => {
    if (!selectedProfileId || !selectedScenarioId) return
    setControlLoading(true); setControlError(null)
    try {
      setSessionStatus(await startReplaySession({
        profile_id: selectedProfileId, scenario_id: selectedScenarioId,
        loop, playback_speed: playbackSpeed,
        start_offset_ms: startOffsetSec ? Number(startOffsetSec) * 1000 : null,
        end_offset_ms: endOffsetSec ? Number(endOffsetSec) * 1000 : null,
      }))
    } catch (err) { setControlError(err instanceof Error ? err.message : 'Start failed') }
    setControlLoading(false)
  }

  const handleStop = async () => {
    if (!selectedProfileId) return
    setControlLoading(true)
    try { setSessionStatus(await stopReplaySession(selectedProfileId)) }
    catch (err) { setControlError(err instanceof Error ? err.message : 'Stop failed') }
    setControlLoading(false)
  }

  const handlePause = async () => {
    if (!selectedProfileId) return
    try { setSessionStatus(await pauseReplaySession(selectedProfileId)) }
    catch (err) { setControlError(err instanceof Error ? err.message : 'Pause failed') }
  }

  const handleResume = async () => {
    if (!selectedProfileId) return
    try { setSessionStatus(await resumeReplaySession(selectedProfileId)) }
    catch (err) { setControlError(err instanceof Error ? err.message : 'Resume failed') }
  }

  const handleRevert = async () => {
    if (!selectedProfileId) return
    if (!confirm('Revert this profile to its pre-replay static values?')) return
    setControlLoading(true)
    try { await revertReplayProfile(selectedProfileId); setSessionStatus(null) }
    catch (err) { setControlError(err instanceof Error ? err.message : 'Revert failed') }
    setControlLoading(false)
  }

  const openStepEditor = async (id: number) => {
    try {
      const s = await getReplayScenario(id)
      setEditingScenario(s)
      setEditSteps(s.steps.map(st => ({
        offset_ms: st.offset_ms, duration_ms: st.duration_ms, latency_ms: st.latency_ms,
        jitter_ms: st.jitter_ms, packet_loss_percent: st.packet_loss_percent, bandwidth_kbps: st.bandwidth_kbps,
      })))
      setEditError(null)
    } catch { setEditError('Failed to load scenario for editing') }
  }

  const updateEditStep = (idx: number, field: keyof EditStep, value: number) => {
    setEditSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  const addEditStep = () => {
    const last = editSteps[editSteps.length - 1]
    setEditSteps(prev => [...prev, {
      offset_ms: last ? last.offset_ms + last.duration_ms : 0,
      duration_ms: 1000, latency_ms: 0, jitter_ms: 0, packet_loss_percent: 0, bandwidth_kbps: 0,
    }])
  }

  const removeEditStep = (idx: number) => {
    if (editSteps.length <= 1) return
    setEditSteps(prev => prev.filter((_, i) => i !== idx))
  }

  const saveSteps = async () => {
    if (!editingScenario) return
    setEditSaving(true); setEditError(null)
    try {
      await updateReplayScenario(editingScenario.id, { steps: editSteps })
      setEditingScenario(null); setEditSteps([])
      await refetchScenarios()
    } catch (err) { setEditError(err instanceof Error ? err.message : 'Save failed') }
    setEditSaving(false)
  }

  const isActive = sessionStatus && (sessionStatus.state === 'running' || sessionStatus.state === 'paused')

  return (
    <div className="space-y-6">
      {/* ═══ Step Editor Modal ═══ */}
      {editingScenario && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-lg shadow-xl w-[900px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-[14px] font-semibold text-foreground flex items-center gap-2">
                <Pencil className="h-4 w-4" /> Edit Steps — {editingScenario.name}
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={addEditStep} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
                  <Plus className="h-3 w-3" /> Add Step
                </button>
                <button onClick={saveSteps} disabled={editSaving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                </button>
                <button onClick={() => { setEditingScenario(null); setEditSteps([]) }}
                  className="p-1.5 rounded-md hover:bg-accent transition-colors">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            </div>
            {editError && (
              <div className="mx-5 mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-800 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" /> {editError}
              </div>
            )}
            <div className="overflow-auto flex-1 p-5">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left px-2 py-1.5 font-medium w-8">#</th>
                    <th className="text-left px-2 py-1.5 font-medium">Offset (ms)</th>
                    <th className="text-left px-2 py-1.5 font-medium">Duration (ms)</th>
                    <th className="text-left px-2 py-1.5 font-medium">Latency</th>
                    <th className="text-left px-2 py-1.5 font-medium">Jitter</th>
                    <th className="text-left px-2 py-1.5 font-medium">Loss %</th>
                    <th className="text-left px-2 py-1.5 font-medium">BW (kbps)</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {editSteps.map((st, i) => (
                    <tr key={i} className="group">
                      <td className="px-2 py-1 text-muted-foreground font-mono">{i + 1}</td>
                      {(['offset_ms', 'duration_ms', 'latency_ms', 'jitter_ms', 'packet_loss_percent', 'bandwidth_kbps'] as const).map(f => (
                        <td key={f} className="px-1 py-1">
                          <input type="number" value={st[f]}
                            onChange={e => updateEditStep(i, f, f === 'packet_loss_percent' ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)}
                            className="w-full px-2 py-1 rounded border border-transparent hover:border-input focus:border-primary bg-transparent text-foreground text-[12px] font-mono focus:outline-none"
                            step={f === 'packet_loss_percent' ? 0.1 : 1} min={0} />
                        </td>
                      ))}
                      <td className="px-1 py-1">
                        <button onClick={() => removeEditStep(i)} disabled={editSteps.length <= 1}
                          className="p-0.5 rounded hover:bg-red-50 disabled:opacity-20 transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ A. Scenario Library ═══ */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">
            Scenario Library{' '}
            {scenarioData && <span className="text-[13px] font-normal text-muted-foreground">({scenarioData.total})</span>}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={() => refetchScenarios()} className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <input ref={fileRef} type="file" accept=".json,.yaml,.yml" onChange={handleImport} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={importing}
              className="inline-flex items-center gap-1.5 px-3 py-[6px] text-[13px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Import Scenario
            </button>
          </div>
        </div>

        {importError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 mb-4 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-500" />
            <span>{importError}</span>
          </div>
        )}

        {scenariosLoading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        )}

        {scenarioData && (
          <>
            <div className="bg-card border border-border rounded-md">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-8"></th>
                    <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Name</th>
                    <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Direction</th>
                    <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Steps</th>
                    <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Duration</th>
                    <th className="text-left text-[12px] font-medium text-muted-foreground px-4 py-2.5">Source</th>
                    <th className="text-right text-[12px] font-medium text-muted-foreground px-4 py-2.5 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scenarioData.items.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                      No scenarios imported yet. Upload a JSON or YAML file to get started.
                    </td></tr>
                  ) : scenarioData.items.map((s) => (
                    <ScenarioRow key={s.id} scenario={s} expanded={expandedId === s.id}
                      expandedData={expandedId === s.id ? expandedScenario : null}
                      onToggleExpand={() => toggleExpand(s.id)}
                      onDelete={() => handleDelete(s.id, s.name)}
                      onSelect={() => setSelectedScenarioId(s.id)}
                      onEdit={() => openStepEditor(s.id)}
                      isSelected={selectedScenarioId === s.id} />
                  ))}
                </tbody>
              </table>
            </div>

            {scenarioData.pages > 1 && (
              <div className="flex items-center justify-between mt-3 text-[12px] text-muted-foreground">
                <span>Page {scenarioPage} of {scenarioData.pages}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setScenarioPage(p => Math.max(1, p - 1))} disabled={scenarioPage === 1}
                    className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button onClick={() => setScenarioPage(p => Math.min(scenarioData.pages, p + 1))} disabled={scenarioPage >= scenarioData.pages}
                    className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ B. Replay Controls ═══ */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-muted/40 px-5 py-3 border-b border-border">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4" /> Replay Controls
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Target Profile</label>
              <select value={selectedProfileId ?? ''} onChange={e => setSelectedProfileId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                <option value="">Select a profile...</option>
                {profileData?.items.map(p => (
                  <option key={p.id} value={p.id}>{p.name} {p.enabled ? '(active)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Scenario</label>
              <select value={selectedScenarioId ?? ''} onChange={e => setSelectedScenarioId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                <option value="">Select a scenario...</option>
                {scenarioData?.items.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.step_count} steps, {fmtDur(s.total_duration_ms)})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Playback Speed</label>
              <div className="flex items-center gap-1">
                {[0.5, 1, 2, 5, 10].map(s => (
                  <button key={s} type="button" onClick={() => setPlaybackSpeed(s)}
                    className={`px-2 py-2 text-[12px] font-medium rounded-md border transition-colors ${playbackSpeed === s ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background text-muted-foreground hover:bg-accent'}`}>
                    {s}x
                  </button>
                ))}
                <input type="number" min={0.1} max={20} step={0.1} value={playbackSpeed}
                  onChange={e => { const v = parseFloat(e.target.value); if (v >= 0.1 && v <= 20) setPlaybackSpeed(v) }}
                  className="w-16 px-2 py-2 rounded-md border border-input bg-background text-foreground text-[12px] text-center focus:outline-none focus:ring-2 focus:ring-ring"
                  title="Custom speed (0.1-20x)" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Mode</label>
              <button type="button" onClick={() => setLoop(!loop)}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-[13px] font-medium transition-colors ${loop ? 'border-primary bg-primary/5 text-primary' : 'border-input bg-background text-foreground hover:bg-accent'}`}>
                <Repeat className="h-3.5 w-3.5" /> {loop ? 'Loop' : 'Single'}
              </button>
            </div>
            <div>
              <label className={labelCls}>Start offset (s)</label>
              <input type="number" min={0} value={startOffsetSec} onChange={e => setStartOffsetSec(e.target.value)} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>End offset (s)</label>
              <input type="number" min={0} value={endOffsetSec} onChange={e => setEndOffsetSec(e.target.value)} placeholder="end" className={inputCls} />
            </div>
          </div>

          {controlError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] text-red-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-500" />
              <span>{controlError}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            {!isActive ? (
              <button onClick={handleStart} disabled={!selectedProfileId || !selectedScenarioId || controlLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {controlLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Start Replay
              </button>
            ) : (
              <>
                {sessionStatus?.state === 'running' ? (
                  <button onClick={handlePause} className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </button>
                ) : (
                  <button onClick={handleResume} className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                    <Play className="h-3.5 w-3.5" /> Resume
                  </button>
                )}
                <button onClick={handleStop} disabled={controlLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              </>
            )}
            {sessionStatus?.has_snapshot && !isActive && (
              <button onClick={handleRevert} disabled={controlLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent disabled:opacity-50 transition-colors">
                <RotateCcw className="h-3.5 w-3.5" /> Revert to Static
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ C. Live Status ═══ */}
      {sessionStatus && sessionStatus.state !== 'idle' && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="bg-muted/40 px-5 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> Live Status
            </h3>
            <StateBadge state={sessionStatus.state} />
          </div>
          <div className="p-5 space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-[12px] text-muted-foreground mb-1.5">
                <span>Step {sessionStatus.current_step_index + 1} / {sessionStatus.total_steps}</span>
                <span>{fmtDur(sessionStatus.elapsed_ms)} / {fmtDur(sessionStatus.total_ms)}</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${sessionStatus.state === 'running' ? 'bg-emerald-500' : sessionStatus.state === 'paused' ? 'bg-amber-500' : 'bg-blue-500'}`}
                  style={{ width: `${sessionStatus.total_ms > 0 ? Math.min(100, (sessionStatus.elapsed_ms / sessionStatus.total_ms) * 100) : 0}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                {sessionStatus.loop && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <Repeat className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Loop count:</span>
                    <span className="font-medium text-foreground">{sessionStatus.loop_count}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[12px]">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Speed:</span>
                  <span className="font-medium text-foreground">{sessionStatus.playback_speed}x</span>
                </div>
              </div>

              {sessionStatus.current_values && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border p-2.5 text-center">
                    <div className="text-[11px] text-muted-foreground">Latency</div>
                    <div className="text-[15px] font-semibold text-foreground font-mono">{sessionStatus.current_values.latency_ms}ms</div>
                  </div>
                  <div className="rounded-md border border-border p-2.5 text-center">
                    <div className="text-[11px] text-muted-foreground">Jitter</div>
                    <div className="text-[15px] font-semibold text-foreground font-mono">{sessionStatus.current_values.jitter_ms}ms</div>
                  </div>
                  <div className="rounded-md border border-border p-2.5 text-center">
                    <div className="text-[11px] text-muted-foreground">Loss</div>
                    <div className="text-[15px] font-semibold text-foreground font-mono">{sessionStatus.current_values.packet_loss_percent}%</div>
                  </div>
                  <div className="rounded-md border border-border p-2.5 text-center">
                    <div className="text-[11px] text-muted-foreground">Bandwidth</div>
                    <div className="text-[15px] font-semibold text-foreground font-mono">{fmtBw(sessionStatus.current_values.bandwidth_kbps)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* ═══ D. Visual Timeline ═══ */}
            {selectedScenarioData && selectedScenarioData.steps.length > 0 && (
              <StepTimeline steps={selectedScenarioData.steps} currentIndex={sessionStatus.current_step_index} />
            )}
          </div>
        </div>
      )}

      {/* ═══ E. Replay History ═══ */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-muted/40 px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <History className="h-4 w-4" /> Replay History
            {historyData && <span className="text-[12px] font-normal text-muted-foreground">({historyData.total})</span>}
          </h3>
          <button onClick={() => refetchHistory()} className="p-1.5 rounded hover:bg-accent transition-colors" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="p-0">
          {historyLoading && (
            <div className="flex items-center justify-center h-20">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
            </div>
          )}
          {historyData && (
            <>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left px-4 py-2 font-medium">Profile</th>
                    <th className="text-left px-4 py-2 font-medium">Scenario</th>
                    <th className="text-left px-4 py-2 font-medium">State</th>
                    <th className="text-left px-4 py-2 font-medium">Progress</th>
                    <th className="text-left px-4 py-2 font-medium">Speed</th>
                    <th className="text-left px-4 py-2 font-medium">Loops</th>
                    <th className="text-left px-4 py-2 font-medium">Duration</th>
                    <th className="text-left px-4 py-2 font-medium">Ended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyData.items.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                      No replay history yet.
                    </td></tr>
                  ) : historyData.items.map((h) => (
                    <tr key={h.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 text-foreground">{h.profile_name || `#${h.profile_id}`}</td>
                      <td className="px-4 py-2 text-foreground">{h.scenario_name || `#${h.scenario_id}`}</td>
                      <td className="px-4 py-2"><StateBadge state={h.state} /></td>
                      <td className="px-4 py-2 font-mono text-foreground">{h.steps_played}/{h.total_steps}</td>
                      <td className="px-4 py-2 font-mono text-foreground">{h.playback_speed}x</td>
                      <td className="px-4 py-2 font-mono text-foreground">{h.loop_count}</td>
                      <td className="px-4 py-2 text-foreground">{fmtDur(h.elapsed_ms)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{h.ended_at ? new Date(h.ended_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {historyData.pages > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-border text-[12px] text-muted-foreground">
                  <span>Page {historyPage} of {historyData.pages}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage === 1}
                      className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button onClick={() => setHistoryPage(p => Math.min(historyData.pages, p + 1))} disabled={historyPage >= historyData.pages}
                      className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Scenario table row with expand ── */
function ScenarioRow({ scenario, expanded, expandedData, onToggleExpand, onDelete, onSelect, onEdit, isSelected }: {
  scenario: ReplayScenarioListItem
  expanded: boolean
  expandedData: ReplayScenario | null
  onToggleExpand: () => void
  onDelete: () => void
  onSelect: () => void
  onEdit: () => void
  isSelected: boolean
}) {
  return (
    <>
      <tr className={`hover:bg-muted/30 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}>
        <td className="px-4 py-2.5">
          <button onClick={onToggleExpand} className="p-0.5 rounded hover:bg-accent transition-colors">
            {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </td>
        <td className="px-4 py-2.5">
          <button onClick={onSelect} className="text-[13px] font-medium text-primary hover:underline text-left">{scenario.name}</button>
          {scenario.description && <p className="text-[12px] text-muted-foreground mt-0.5 truncate max-w-[250px]">{scenario.description}</p>}
        </td>
        <td className="px-4 py-2.5 text-[13px] text-foreground capitalize">{scenario.default_direction}</td>
        <td className="px-4 py-2.5 text-[13px] text-foreground font-mono">{scenario.step_count}</td>
        <td className="px-4 py-2.5 text-[13px] text-foreground">{fmtDur(scenario.total_duration_ms)}</td>
        <td className="px-4 py-2.5 text-[12px] text-muted-foreground truncate max-w-[150px]">{scenario.source_filename || '—'}</td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={onEdit} className="p-1 rounded hover:bg-accent transition-colors" title="Edit Steps">
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <ExportDropdown id={scenario.id} />
            <button onClick={onDelete} className="p-1 rounded hover:bg-red-50 transition-colors" title="Delete">
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && expandedData && (
        <tr>
          <td colSpan={7} className="px-4 py-3 bg-muted/20">
            <div className="text-[12px] font-medium text-muted-foreground mb-2">Steps Preview (first 20)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left px-2 py-1 font-medium">#</th>
                    <th className="text-left px-2 py-1 font-medium">Offset</th>
                    <th className="text-left px-2 py-1 font-medium">Duration</th>
                    <th className="text-left px-2 py-1 font-medium">Latency</th>
                    <th className="text-left px-2 py-1 font-medium">Jitter</th>
                    <th className="text-left px-2 py-1 font-medium">Loss</th>
                    <th className="text-left px-2 py-1 font-medium">Bandwidth</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {expandedData.steps.slice(0, 20).map((st, i) => (
                    <tr key={st.id} className="text-foreground">
                      <td className="px-2 py-1 text-muted-foreground">{st.step_index + 1}</td>
                      <td className="px-2 py-1">{fmtDur(st.offset_ms)}</td>
                      <td className="px-2 py-1">{fmtDur(st.duration_ms)}</td>
                      <td className="px-2 py-1">{st.latency_ms}ms</td>
                      <td className="px-2 py-1">{st.jitter_ms}ms</td>
                      <td className="px-2 py-1">{st.packet_loss_percent}%</td>
                      <td className="px-2 py-1">{st.bandwidth_kbps > 0 ? fmtBw(st.bandwidth_kbps) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {expandedData.steps.length > 20 && (
                <p className="text-[11px] text-muted-foreground mt-1">... and {expandedData.steps.length - 20} more steps</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/* ── Visual step timeline (P9d) ── */
function StepTimeline({ steps, currentIndex }: { steps: { offset_ms: number; duration_ms: number; latency_ms: number; jitter_ms: number; packet_loss_percent: number; bandwidth_kbps: number }[]; currentIndex: number }) {
  const W = 700, H = 100, PAD = 24
  const totalMs = steps.reduce((a, s) => Math.max(a, s.offset_ms + s.duration_ms), 0) || 1
  const maxLat = Math.max(1, ...steps.map(s => s.latency_ms))
  const maxBw = Math.max(1, ...steps.map(s => s.bandwidth_kbps))

  const xFor = (ms: number) => PAD + ((ms / totalMs) * (W - PAD * 2))
  const yLat = (v: number) => H - PAD - ((v / maxLat) * (H - PAD * 2))
  const yBw = (v: number) => H - PAD - ((v / maxBw) * (H - PAD * 2))

  const latPath = steps.map((s, i) => {
    const x1 = xFor(s.offset_ms), x2 = xFor(s.offset_ms + s.duration_ms), y = yLat(s.latency_ms)
    return `${i === 0 ? 'M' : 'L'}${x1},${y} L${x2},${y}`
  }).join(' ')

  const bwPath = steps.map((s, i) => {
    const x1 = xFor(s.offset_ms), x2 = xFor(s.offset_ms + s.duration_ms), y = yBw(s.bandwidth_kbps)
    return `${i === 0 ? 'M' : 'L'}${x1},${y} L${x2},${y}`
  }).join(' ')

  const curStep = steps[currentIndex]
  const curX = curStep ? xFor(curStep.offset_ms) : PAD

  return (
    <div className="mt-4">
      <div className="text-[11px] font-medium text-muted-foreground mb-1.5 flex items-center gap-4">
        Step Timeline
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-emerald-500 rounded" /> Latency</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-blue-500 rounded" /> Bandwidth</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[100px] rounded-md border border-border bg-muted/20">
        {/* Grid lines */}
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="currentColor" strokeOpacity={0.1} />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="currentColor" strokeOpacity={0.1} />
        {/* Current step indicator */}
        <line x1={curX} y1={PAD} x2={curX} y2={H - PAD} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3,2" opacity={0.7} />
        {/* Latency line */}
        {latPath && <path d={latPath} fill="none" stroke="#10b981" strokeWidth={1.5} strokeLinejoin="round" />}
        {/* Bandwidth line */}
        {bwPath && <path d={bwPath} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinejoin="round" />}
        {/* Step dividers */}
        {steps.map((s, i) => (
          <line key={i} x1={xFor(s.offset_ms)} y1={PAD} x2={xFor(s.offset_ms)} y2={H - PAD}
            stroke="currentColor" strokeOpacity={i === currentIndex ? 0.4 : 0.08} strokeWidth={i === currentIndex ? 1 : 0.5} />
        ))}
        {/* Axis labels */}
        <text x={PAD} y={H - 6} fontSize={8} fill="currentColor" opacity={0.4}>0s</text>
        <text x={W - PAD} y={H - 6} fontSize={8} fill="currentColor" opacity={0.4} textAnchor="end">{(totalMs / 1000).toFixed(0)}s</text>
        <text x={4} y={PAD + 3} fontSize={7} fill="#10b981" opacity={0.6}>{maxLat}ms</text>
        <text x={W - 4} y={PAD + 3} fontSize={7} fill="#3b82f6" opacity={0.6} textAnchor="end">{maxBw > 1000 ? `${(maxBw / 1000).toFixed(0)}M` : `${maxBw}k`}</text>
      </svg>
    </div>
  )
}
