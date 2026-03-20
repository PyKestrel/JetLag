import { Link } from 'react-router-dom'
import { Monitor, Gauge, FileDown, Wifi, WifiOff, Activity, ArrowRight, ExternalLink } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { getOverview, type OverviewData } from '@/lib/api'

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string | number
  sub?: string
  color: string
}) {
  return (
    <div className="bg-card border border-border rounded-md p-5">
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full mt-1.5 ${color}`} />
        <div>
          <p className="text-[13px] text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground mt-0.5">{value}</p>
          {sub && <p className="text-[12px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  )
}

export default function OverviewPage() {
  const { data, loading, error } = useApi<OverviewData>(getOverview)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800 flex items-start gap-2">
        <span className="font-medium">Error:</span> Failed to load overview — {error}
      </div>
    )
  }

  const d = data!

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-foreground">Overview</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Monitor client connections, impairment profiles, and system services for your JetLag captive portal appliance.
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 mb-6 text-[13px] text-blue-800 flex items-center gap-2">
        <svg className="h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
        <span>
          Configure network interfaces and DHCP settings in{' '}
          <Link to="/settings" className="underline font-medium hover:text-blue-900">Settings</Link>
          {' '}before connecting test devices.
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Total Clients"
          value={d.clients.total}
          sub={`${d.clients.authenticated} authenticated, ${d.clients.pending} pending`}
          color="bg-blue-500"
        />
        <StatCard
          label="Authenticated"
          value={d.clients.authenticated}
          sub="Clients past captive portal"
          color="bg-emerald-500"
        />
        <StatCard
          label="Pending (Intercepted)"
          value={d.clients.pending}
          sub="DNS/HTTP traffic intercepted"
          color="bg-amber-500"
        />
        <StatCard
          label="Active Profiles"
          value={`${d.profiles.active} / ${d.profiles.total}`}
          sub="Impairment rules applied"
          color="bg-purple-500"
        />
        <StatCard
          label="Active Captures"
          value={d.captures.active}
          sub="tcpdump sessions running"
          color="bg-indigo-500"
        />
        <StatCard
          label="dnsmasq"
          value={d.services.dnsmasq.running ? 'Running' : d.services.dnsmasq.status === 'not available' || d.services.dnsmasq.status === 'not installed' ? 'Not available' : 'Stopped'}
          sub={d.services.dnsmasq.status === 'not available' ? 'Requires Linux appliance' : d.services.dnsmasq.status === 'not installed' ? 'dnsmasq not installed' : d.services.dnsmasq.status}
          color={d.services.dnsmasq.running ? 'bg-emerald-500' : d.services.dnsmasq.status === 'not available' || d.services.dnsmasq.status === 'not installed' ? 'bg-gray-400' : 'bg-red-500'}
        />
      </div>

      {/* Quick navigation — Cloudflare card style */}
      <div className="mb-2">
        <h2 className="text-[15px] font-semibold text-foreground mb-3">Quick navigation</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          to="/clients"
          className="group block bg-card border border-border rounded-md p-4 hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-[14px] font-medium text-foreground">Clients</h3>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            View connected devices, authenticate or revoke access
          </p>
        </Link>
        <Link
          to="/profiles"
          className="group block bg-card border border-border rounded-md p-4 hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-[14px] font-medium text-foreground">Impairment Profiles</h3>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Create and manage network impairment rules
          </p>
        </Link>
        <Link
          to="/captures"
          className="group block bg-card border border-border rounded-md p-4 hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileDown className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-[14px] font-medium text-foreground">Packet Captures</h3>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Start tcpdump captures for diagnostics
          </p>
        </Link>
      </div>
    </div>
  )
}
