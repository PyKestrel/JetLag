import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { getSetupStatus, getAuthStatus, getToken, clearToken } from './lib/api'

// Route-level code-splitting. The heaviest pages (Profiles ~78k, Replay ~54k,
// Router ~48k, Settings/SetupWizard ~42k) are lazy-loaded so they no longer
// bloat the initial bundle — each is fetched on first navigation instead.
const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const ProfilesPage = lazy(() => import('./pages/ProfilesPage'))
const CapturesPage = lazy(() => import('./pages/CapturesPage'))
const LogsPage = lazy(() => import('./pages/LogsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const UpdatesPage = lazy(() => import('./pages/UpdatesPage'))
const FirewallPage = lazy(() => import('./pages/FirewallPage'))
const RouterPage = lazy(() => import('./pages/RouterPage'))
const CaptivePortalPage = lazy(() => import('./pages/CaptivePortalPage'))
const WirelessPage = lazy(() => import('./pages/WirelessPage'))
const SchedulesPage = lazy(() => import('./pages/SchedulesPage'))
const SetupWizard = lazy(() => import('./pages/SetupWizard'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const AdminSetupPage = lazy(() => import('./pages/AdminSetupPage'))

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  )
}

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
      <Suspense fallback={<PageFallback />}>
        <AdminSetupPage
          onComplete={() => {
            setNeedsAdminSetup(false)
            setAuthed(true)
          }}
        />
      </Suspense>
    )
  }

  // Show setup wizard if not yet configured
  if (!setupDone) {
    return (
      <Suspense fallback={<PageFallback />}>
        <SetupWizard onComplete={() => setSetupDone(true)} />
      </Suspense>
    )
  }

  // Require login when auth is enabled and we don't have a valid session
  if (authEnabled && !authed) {
    return (
      <Suspense fallback={<PageFallback />}>
        <LoginPage onAuthenticated={() => setAuthed(true)} />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<PageFallback />}>
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
    </Suspense>
  )
}
