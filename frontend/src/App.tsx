import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import OverviewPage from './pages/OverviewPage'
import ClientsPage from './pages/ClientsPage'
import ProfilesPage from './pages/ProfilesPage'
import CapturesPage from './pages/CapturesPage'
import LogsPage from './pages/LogsPage'
import SettingsPage from './pages/SettingsPage'
import UpdatesPage from './pages/UpdatesPage'
import FirewallPage from './pages/FirewallPage'
import RouterPage from './pages/RouterPage'
import CaptivePortalPage from './pages/CaptivePortalPage'
import WirelessPage from './pages/WirelessPage'
import SchedulesPage from './pages/SchedulesPage'
import SetupWizard from './pages/SetupWizard'
import LoginPage from './pages/LoginPage'
import AdminSetupPage from './pages/AdminSetupPage'
import { getSetupStatus, getAuthStatus, getToken, clearToken } from './lib/api'

export default function App() {
  const [setupDone, setSetupDone] = useState<boolean | null>(null)
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null)
  const [needsAdminSetup, setNeedsAdminSetup] = useState<boolean>(false)
  const [authed, setAuthed] = useState<boolean>(!!getToken())

  useEffect(() => {
    Promise.all([
      getSetupStatus().then((s) => s.setup_completed).catch(() => false),
      getAuthStatus().catch(() => ({ auth_enabled: false, needs_admin_setup: false })),
    ]).then(([setup, auth]) => {
      setSetupDone(setup)
      setAuthEnabled(auth.auth_enabled)
      setNeedsAdminSetup(auth.needs_admin_setup)
    })
  }, [])

  // Global 401 handler — bounce back to login when a token expires.
  useEffect(() => {
    const handler = () => {
      clearToken()
      setAuthed(false)
    }
    window.addEventListener('jetlag:unauthorized', handler)
    return () => window.removeEventListener('jetlag:unauthorized', handler)
  }, [])

  // Loading state while checking setup + auth status
  if (setupDone === null || authEnabled === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // No admin account yet (fresh install or upgraded instance) — create one first.
  if (needsAdminSetup) {
    return (
      <AdminSetupPage
        onComplete={() => {
          setNeedsAdminSetup(false)
          setAuthed(true)
        }}
      />
    )
  }

  // Show setup wizard if not yet configured
  if (!setupDone) {
    return <SetupWizard onComplete={() => setSetupDone(true)} />
  }

  // Require login when auth is enabled and we don't have a valid session
  if (authEnabled && !authed) {
    return <LoginPage onAuthenticated={() => setAuthed(true)} />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/captures" element={<CapturesPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/updates" element={<UpdatesPage />} />
        <Route path="/firewall" element={<FirewallPage />} />
        <Route path="/router" element={<RouterPage />} />
        <Route path="/portal" element={<CaptivePortalPage />} />
        <Route path="/wireless" element={<WirelessPage />} />
      </Route>
    </Routes>
  )
}
