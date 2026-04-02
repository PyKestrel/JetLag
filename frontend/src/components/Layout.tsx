import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Monitor,
  Gauge,
  FileDown,
  ScrollText,
  Settings,
  Plane,
  Network,
  Shield,
  ChevronDown,
  ChevronRight,
  Search,
  HelpCircle,
  User,
  BarChart3,
  Bug,
  ArrowDownCircle,
  ShieldAlert,
  Router,
  Wifi,
  Radio,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getVersion } from '@/lib/api'

interface NavSection {
  label: string
  icon: React.ComponentType<{ className?: string }>
  items: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[]
  defaultOpen?: boolean
}

const navSections: NavSection[] = [
  {
    label: 'Overview',
    icon: LayoutDashboard,
    defaultOpen: true,
    items: [
      { to: '/overview', label: 'Overview', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Networks',
    icon: Network,
    defaultOpen: true,
    items: [
      { to: '/clients', label: 'Clients', icon: Monitor },
      { to: '/router', label: 'Router', icon: Router },
      { to: '/portal', label: 'Captive Portal', icon: Wifi },
      { to: '/wireless', label: 'Wireless AP', icon: Radio },
    ],
  },
  {
    label: 'Traffic policies',
    icon: Shield,
    defaultOpen: false,
    items: [
      { to: '/profiles', label: 'Impairment Profiles', icon: Gauge },
      { to: '/firewall', label: 'Firewall Rules', icon: ShieldAlert },
    ],
  },
  {
    label: 'Diagnostics',
    icon: Bug,
    defaultOpen: false,
    items: [
      { to: '/captures', label: 'Captures', icon: FileDown },
      { to: '/logs', label: 'Logs', icon: ScrollText },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    defaultOpen: false,
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/updates', label: 'Updates', icon: ArrowDownCircle },
    ],
  },
]

const breadcrumbMap: Record<string, string[]> = {
  '/overview': ['Overview'],
  '/clients': ['Networks', 'Clients'],
  '/profiles': ['Traffic policies', 'Impairment Profiles'],
  '/firewall': ['Traffic policies', 'Firewall Rules'],
  '/router': ['Networks', 'Router'],
  '/portal': ['Networks', 'Captive Portal'],
  '/wireless': ['Networks', 'Wireless AP'],
  '/captures': ['Diagnostics', 'Captures'],
  '/logs': ['Diagnostics', 'Logs'],
  '/settings': ['Settings'],
  '/updates': ['Settings', 'Updates'],
}

function SidebarSection({ section }: { section: NavSection }) {
  const location = useLocation()
  const isChildActive = section.items.some((item) => location.pathname === item.to)
  const [open, setOpen] = useState(section.defaultOpen || isChildActive)

  // If section has only one item, render it directly without collapsible
  if (section.items.length === 1 && section.items[0].to === '/overview') {
    const item = section.items[0]
    return (
      <NavLink
        to={item.to}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 px-3 py-[7px] text-[13px] font-medium rounded transition-colors',
            isActive
              ? 'text-white bg-[hsl(var(--sidebar-hover))]'
              : 'text-[hsl(var(--sidebar-fg))] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]'
          )
        }
      >
        <item.icon className="h-4 w-4 flex-shrink-0 opacity-70" />
        {item.label}
      </NavLink>
    )
  }

  const SectionIcon = section.icon

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-[7px] text-[13px] font-medium rounded transition-colors',
          isChildActive
            ? 'text-white'
            : 'text-[hsl(var(--sidebar-fg))] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]'
        )}
      >
        <SectionIcon className="h-4 w-4 flex-shrink-0 opacity-70" />
        <span className="flex-1 text-left">{section.label}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-[hsl(var(--sidebar-border))] pl-3">
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-2 py-[5px] text-[13px] rounded transition-colors',
                  isActive
                    ? 'text-white bg-[hsl(var(--sidebar-hover))]'
                    : 'text-[hsl(var(--sidebar-fg))] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const location = useLocation()
  const crumbs = breadcrumbMap[location.pathname] || ['Overview']
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v.version))
      .catch(() => setAppVersion('unknown'))
  }, [])

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar — Cloudflare dark style */}
      <aside className="w-[220px] flex-shrink-0 bg-[hsl(var(--sidebar-bg))] flex flex-col">
        {/* Logo / account area */}
        <div className="h-[52px] flex items-center gap-2 px-4 border-b border-[hsl(var(--sidebar-border))]">
          <div className="w-7 h-7 rounded bg-[hsl(var(--sidebar-active))] flex items-center justify-center">
            <Plane className="h-4 w-4 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-white truncate leading-tight">
              JetLag
            </span>
            <span className="text-[10px] text-[hsl(var(--sidebar-fg))] leading-tight">
              Lab Appliance
            </span>
          </div>
        </div>

        {/* Quick search */}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[hsl(var(--sidebar-hover))] text-[hsl(var(--sidebar-fg))]">
            <Search className="h-3.5 w-3.5 opacity-60" />
            <span className="text-[12px]">Quick search...</span>
            <span className="ml-auto text-[10px] opacity-40 font-mono">/</span>
          </div>
        </div>

        {/* Nav sections */}
        <nav className="flex-1 px-2 pb-4 space-y-1 overflow-y-auto">
          {navSections.map((section) => (
            <SidebarSection key={section.label} section={section} />
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-3 border-t border-[hsl(var(--sidebar-border))]">
          <div className="flex items-center gap-2 text-[hsl(var(--sidebar-fg))]">
            <div className="w-6 h-6 rounded-full bg-[hsl(var(--sidebar-hover))] flex items-center justify-center">
              <User className="h-3.5 w-3.5" />
            </div>
            <span className="text-[11px]">admin</span>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="h-[52px] flex-shrink-0 bg-card border-b border-[hsl(var(--header-border))] flex items-center justify-between px-6">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1.5 text-[13px]">
            {crumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground">/</span>}
                <span
                  className={cn(
                    i === crumbs.length - 1
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                  )}
                >
                  {crumb}
                </span>
              </span>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <button className="text-[13px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
              <HelpCircle className="h-4 w-4" />
              Support
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto px-6 py-6">
            <Outlet />
          </div>
        </main>

        {/* Footer */}
        <footer className="flex-shrink-0 border-t border-[hsl(var(--header-border))] bg-card px-6 py-2.5">
          <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
            <span>JetLag v{appVersion || '…'}</span>
            <span className="opacity-30">|</span>
            <a href="/settings" className="hover:text-foreground transition-colors">Settings</a>
            <span className="opacity-30">|</span>
            <a href="/logs" className="hover:text-foreground transition-colors">Logs</a>
          </div>
        </footer>
      </div>
    </div>
  )
}
