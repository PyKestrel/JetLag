import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import OverviewPage from './pages/OverviewPage'
import ClientsPage from './pages/ClientsPage'
import ProfilesPage from './pages/ProfilesPage'
import CapturesPage from './pages/CapturesPage'
import LogsPage from './pages/LogsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
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
      </Route>
    </Routes>
  )
}
