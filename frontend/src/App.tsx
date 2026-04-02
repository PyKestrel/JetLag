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
import SetupWizard from './pages/SetupWizard'
import { getSetupStatus } from './lib/api'

export default function App() {
  const [setupDone, setSetupDone] = useState<boolean | null>(null)

  useEffect(() => {
    getSetupStatus()
      .then((s) => setSetupDone(s.setup_completed))
      .catch(() => setSetupDone(false))
  }, [])

  // Loading state while checking setup status
  if (setupDone === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // Show setup wizard if not yet configured
  if (!setupDone) {
    return <SetupWizard onComplete={() => setSetupDone(true)} />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/captures" element={<CapturesPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/updates" element={<UpdatesPage />} />
        <Route path="/firewall" element={<FirewallPage />} />
        <Route path="/router" element={<RouterPage />} />
        <Route path="/portal" element={<CaptivePortalPage />} />
      </Route>
    </Routes>
  )
}
