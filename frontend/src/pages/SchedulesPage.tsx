import { useEffect, useState } from 'react'
import { CalendarClock, Plus, Trash2, Play, Power } from 'lucide-react'
import {
  getSchedules,
  createSchedule,
  deleteSchedule,
  runScheduleNow,
  updateSchedule,
  getProfiles,
  getReplayScenarios,
  type Schedule,
  type ScheduleAction,
  type ScheduleCreate,
  type ImpairmentProfile,
  type ReplayScenarioListItem,
} from '@/lib/api'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const ACTION_LABELS: Record<ScheduleAction, string> = {
  enable_profile: 'Enable profile',
  disable_profile: 'Disable profile',
  start_replay: 'Start replay',
  stop_replay: 'Stop replay',
}

function emptyForm(): ScheduleCreate {
  return {
    name: '',
    action: 'enable_profile',
    profile_id: null,
    scenario_id: null,
    loop: false,
    playback_speed: 1.0,
    trigger_type: 'once',
    run_at: '',
    days_of_week: '',
    time_of_day: '09:00',
  }
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [profiles, setProfiles] = useState<ImpairmentProfile[]>([])
  const [scenarios, setScenarios] = useState<ReplayScenarioListItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ScheduleCreate>(emptyForm())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const [s, p, sc] = await Promise.all([
        getSchedules(),
        getProfiles({ per_page: '100' }),
        getReplayScenarios({ per_page: '100' }),
      ])
      setSchedules(s.items)
      setProfiles(p.items)
      setScenarios(sc.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function toggleDay(idx: number) {
    const set = new Set((form.days_of_week || '').split(',').filter(Boolean))
    const key = String(idx)
    if (set.has(key)) set.delete(key)
    else set.add(key)
    setForm({ ...form, days_of_week: Array.from(set).sort().join(',') })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const payload: ScheduleCreate = { ...form }
    if (payload.trigger_type === 'once') {
      payload.days_of_week = null
      payload.time_of_day = null
    } else {
      payload.run_at = null
    }
    if (payload.action !== 'start_replay') payload.scenario_id = null
    try {
      await createSchedule(payload)
      setShowForm(false)
      setForm(emptyForm())
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create schedule')
    }
  }

  async function handleDelete(id: number) {
    await deleteSchedule(id)
    refresh()
  }

  async function handleToggle(s: Schedule) {
    await updateSchedule(s.id, { enabled: !s.enabled } as Partial<ScheduleCreate>)
    refresh()
  }

  async function handleRun(id: number) {
    try {
      await runScheduleNow(id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run schedule')
    }
  }

  const needsScenario = form.action === 'start_replay'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Schedules
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically enable profiles or run replay scenarios at set times.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> New schedule
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Action</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value as ScheduleAction })}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
              >
                {Object.entries(ACTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Profile</label>
              <select
                value={form.profile_id ?? ''}
                onChange={(e) => setForm({ ...form, profile_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                required
              >
                <option value="">Select a profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {needsScenario && (
              <div>
                <label className="block text-sm font-medium mb-1.5">Replay scenario</label>
                <select
                  value={form.scenario_id ?? ''}
                  onChange={(e) => setForm({ ...form, scenario_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
                  required
                >
                  <option value="">Select a scenario…</option>
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Trigger</label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={form.trigger_type === 'once'}
                  onChange={() => setForm({ ...form, trigger_type: 'once' })}
                />
                One-time
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={form.trigger_type === 'recurring'}
                  onChange={() => setForm({ ...form, trigger_type: 'recurring' })}
                />
                Recurring
              </label>
            </div>
          </div>

          {form.trigger_type === 'once' ? (
            <div>
              <label className="block text-sm font-medium mb-1.5">Run at</label>
              <input
                type="datetime-local"
                value={form.run_at ?? ''}
                onChange={(e) => setForm({ ...form, run_at: e.target.value })}
                className="px-3 py-2 text-sm rounded-md border border-input bg-background"
                required
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">Days</label>
                <div className="flex gap-1.5">
                  {DAYS.map((d, i) => {
                    const active = (form.days_of_week || '').split(',').includes(String(i))
                    return (
                      <button
                        type="button"
                        key={d}
                        onClick={() => toggleDay(i)}
                        className={
                          'px-2.5 py-1 text-xs rounded-md border transition-colors ' +
                          (active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-input text-muted-foreground hover:text-foreground')
                        }
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Time of day</label>
                <input
                  type="time"
                  value={form.time_of_day ?? ''}
                  onChange={(e) => setForm({ ...form, time_of_day: e.target.value })}
                  className="px-3 py-2 text-sm rounded-md border border-input bg-background"
                  required
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="submit" className="px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
              Create
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 text-sm rounded-md border border-input hover:bg-muted">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No schedules yet. Create one to automate impairment changes.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Name</th>
                <th className="text-left font-medium px-4 py-2.5">Action</th>
                <th className="text-left font-medium px-4 py-2.5">Trigger</th>
                <th className="text-left font-medium px-4 py-2.5">Next run</th>
                <th className="text-right font-medium px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-2.5">{ACTION_LABELS[s.action]}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {s.trigger_type === 'once'
                      ? `Once · ${s.run_at ? new Date(s.run_at).toLocaleString() : '—'}`
                      : `Weekly · ${(s.days_of_week || '')
                          .split(',')
                          .filter(Boolean)
                          .map((d) => DAYS[Number(d)])
                          .join(', ')} @ ${s.time_of_day}`}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {s.next_run ? new Date(s.next_run).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => handleRun(s.id)} title="Run now" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Play className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleToggle(s)} title={s.enabled ? 'Disable' : 'Enable'} className={'p-1.5 rounded hover:bg-muted ' + (s.enabled ? 'text-green-500' : 'text-muted-foreground')}>
                        <Power className="h-4 w-4" />
                      </button>
                      <button onClick={() => handleDelete(s.id)} title="Delete" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
