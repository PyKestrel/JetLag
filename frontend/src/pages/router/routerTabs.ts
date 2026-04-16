import type { LucideIcon } from 'lucide-react'
import {
  LayoutGrid,
  Router,
  Globe,
  Network,
  Link2,
  Cable,
  Cpu,
  HardDrive,
} from 'lucide-react'

export type RouterTab =
  | 'summary'
  | 'l3'
  | 'nat'
  | 'interfaces'
  | 'neighbors'
  | 'dhcp'
  | 'arp'
  | 'sysctl'

export const ROUTER_TABS: { key: RouterTab; label: string; icon: LucideIcon }[] = [
  { key: 'summary', label: 'Summary', icon: LayoutGrid },
  { key: 'l3', label: 'L3 routing', icon: Router },
  { key: 'nat', label: 'NAT', icon: Globe },
  { key: 'interfaces', label: 'Interfaces', icon: Network },
  { key: 'neighbors', label: 'LLDP / CDP', icon: Link2 },
  { key: 'dhcp', label: 'DHCP', icon: Cable },
  { key: 'arp', label: 'ARP', icon: Cpu },
  { key: 'sysctl', label: 'Sysctl', icon: HardDrive },
]
