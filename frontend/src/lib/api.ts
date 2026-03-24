const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Overview
export const getOverview = () => request<OverviewData>('/overview');

// Clients
export const getClients = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<PaginatedResponse<Client>>(`/clients${qs}`);
};
export const getClient = (id: number) => request<Client>(`/clients/${id}`);
export const authenticateClient = (id: number) =>
  request<Client>(`/clients/${id}/authenticate`, { method: 'POST' });
export const deauthenticateClient = (id: number) =>
  request<Client>(`/clients/${id}/deauthenticate`, { method: 'POST' });
export const bulkResetClients = () =>
  request<{ message: string; count: number }>('/clients/bulk/reset', { method: 'POST' });

// Impairment Profiles
export const getProfiles = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<PaginatedResponse<ImpairmentProfile>>(`/profiles${qs}`);
};
export const getProfile = (id: number) => request<ImpairmentProfile>(`/profiles/${id}`);
export const createProfile = (data: ImpairmentProfileCreate) =>
  request<ImpairmentProfile>('/profiles', { method: 'POST', body: JSON.stringify(data) });
export const updateProfile = (id: number, data: Partial<ImpairmentProfileCreate>) =>
  request<ImpairmentProfile>(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProfile = (id: number) =>
  request<{ message: string }>(`/profiles/${id}`, { method: 'DELETE' });

// Captures
export const getCaptures = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<PaginatedResponse<Capture>>(`/captures${qs}`);
};
export const startCapture = (data: CaptureCreate) =>
  request<Capture>('/captures', { method: 'POST', body: JSON.stringify(data) });
export const stopCapture = (id: number) =>
  request<Capture>(`/captures/${id}/stop`, { method: 'POST' });
export const deleteCapture = (id: number) =>
  request<{ message: string }>(`/captures/${id}`, { method: 'DELETE' });
export const getCaptureDownloadUrl = (id: number) => `${API_BASE}/captures/${id}/download`;

// Logs
export const getLogs = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<PaginatedResponse<EventLog>>(`/logs${qs}`);
};
export const clearLogs = (category?: string) => {
  const qs = category ? `?category=${category}` : '';
  return request<{ message: string }>(`/logs${qs}`, { method: 'DELETE' });
};

// Settings
export const getSettings = () => request<SettingsData>('/settings');
export const updateSettings = (data: Partial<SettingsData>) =>
  request<SettingsData & { message: string }>('/settings', { method: 'PUT', body: JSON.stringify(data) });

// Setup
export const getSetupStatus = () => request<SetupStatus>('/setup/status');
export const getSetupInterfaces = () => request<{ interfaces: NetworkInterface[] }>('/setup/interfaces');
export const completeSetup = (data: SetupRequest) =>
  request<SetupCompleteResponse>('/setup/complete', { method: 'POST', body: JSON.stringify(data) });
export const resetSetup = () =>
  request<{ message: string; setup_completed: boolean }>('/setup/reset', { method: 'POST' });

// Version
export interface VersionInfo {
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}
export const getVersion = () => request<VersionInfo>('/version');

// Updates
export interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  latest_version: string | null;
  release_notes: string | null;
  published_at: string | null;
  download_url: string | null;
  html_url: string | null;
  checked_at: string | null;
  prerelease: boolean;
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'in_progress' | 'restarting' | 'completed' | 'failed' | 'rolling_back';
  step: string | null;
  progress_pct: number;
  message: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  target_version: string | null;
  log_lines: string[];
}

export interface UpdateHistoryEntry {
  version: string;
  outcome: string;
  started_at: string;
  completed_at: string;
  error: string | null;
}

export interface UpdateConfig {
  auto_check: boolean;
  check_interval_hours: number;
  github_repo: string;
  channel: string;
  auto_download: boolean;
}

export const checkForUpdate = (force = false) =>
  request<UpdateCheckResult>(`/updates/check?force=${force}`);
export const applyUpdate = (version: string) =>
  request<UpdateStatus>('/updates/apply', { method: 'POST', body: JSON.stringify({ version }) });
export const getUpdateStatus = () => request<UpdateStatus>('/updates/status');
export const rollbackUpdate = () =>
  request<{ message: string }>('/updates/rollback', { method: 'POST' });
export const getUpdateHistory = () =>
  request<{ history: UpdateHistoryEntry[] }>('/updates/history');
export const getUpdateConfig = () => request<UpdateConfig>('/updates/config');
export const updateUpdateConfig = (data: Partial<UpdateConfig>) =>
  request<UpdateConfig>('/updates/config', { method: 'PUT', body: JSON.stringify(data) });

// Port management
export const listPorts = () => request<{ wan_ports: WANPort[]; lan_ports: LANPort[] }>('/setup/ports');
export const addWANPort = (data: { interface: string; enabled?: boolean }) =>
  request<{ message: string; wan_ports: WANPort[] }>('/setup/ports/wan', { method: 'POST', body: JSON.stringify(data) });
export const removeWANPort = (iface: string) =>
  request<{ message: string; wan_ports: WANPort[] }>(`/setup/ports/wan/${iface}`, { method: 'DELETE' });
export const addLANPort = (data: AddLANPortRequest) =>
  request<{ message: string; lan_ports: LANPort[] }>('/setup/ports/lan', { method: 'POST', body: JSON.stringify(data) });
export const removeLANPort = (iface: string) =>
  request<{ message: string; lan_ports: LANPort[] }>(`/setup/ports/lan/${iface}`, { method: 'DELETE' });

// Types
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface Client {
  id: number;
  mac_address: string;
  ip_address: string | null;
  hostname: string | null;
  vlan_id: number | null;
  auth_state: 'pending' | 'authenticated';
  first_seen: string;
  last_seen: string;
  authenticated_at: string | null;
}

export interface MatchRule {
  id?: number;
  profile_id?: number;
  src_ip?: string | null;
  dst_ip?: string | null;
  src_subnet?: string | null;
  dst_subnet?: string | null;
  mac_address?: string | null;
  vlan_id?: number | null;
  protocol?: string | null;
  port?: number | null;
}

export interface ImpairmentProfile {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  direction: string;
  // Latency / Jitter
  latency_ms: number;
  jitter_ms: number;
  latency_correlation: number;
  latency_distribution: string;
  // Packet Loss
  packet_loss_percent: number;
  loss_correlation: number;
  // Corruption
  corruption_percent: number;
  corruption_correlation: number;
  // Reordering
  reorder_percent: number;
  reorder_correlation: number;
  // Duplication
  duplicate_percent: number;
  duplicate_correlation: number;
  // Rate Control
  bandwidth_limit_kbps: number;
  bandwidth_burst_kbytes: number;
  bandwidth_ceil_kbps: number;
  match_rules: MatchRule[];
  created_at: string;
  updated_at: string;
}

export interface ImpairmentProfileCreate {
  name: string;
  description?: string;
  enabled?: boolean;
  direction?: string;
  latency_ms?: number;
  jitter_ms?: number;
  latency_correlation?: number;
  latency_distribution?: string;
  packet_loss_percent?: number;
  loss_correlation?: number;
  corruption_percent?: number;
  corruption_correlation?: number;
  reorder_percent?: number;
  reorder_correlation?: number;
  duplicate_percent?: number;
  duplicate_correlation?: number;
  bandwidth_limit_kbps?: number;
  bandwidth_burst_kbytes?: number;
  bandwidth_ceil_kbps?: number;
  match_rules?: Omit<MatchRule, 'id' | 'profile_id'>[];
}

export interface Capture {
  id: number;
  name: string;
  state: 'running' | 'stopped' | 'error';
  file_path: string;
  file_size_bytes: number;
  filter_ip: string | null;
  filter_mac: string | null;
  filter_vlan: number | null;
  filter_expression: string | null;
  pid: number | null;
  started_at: string;
  stopped_at: string | null;
}

export interface CaptureCreate {
  name: string;
  filter_ip?: string;
  filter_mac?: string;
  filter_vlan?: number;
  filter_expression?: string;
}

export interface EventLog {
  id: number;
  category: string;
  level: string;
  message: string;
  source_ip: string | null;
  source_mac: string | null;
  details: string | null;
  created_at: string;
}

export interface PortDHCPConfig {
  enabled: boolean;
  range_start: string;
  range_end: string;
  lease_time: string;
  gateway: string;
  dns_server: string;
}

export interface WANPort {
  interface: string;
  enabled: boolean;
}

export interface LANPort {
  interface: string;
  ip: string;
  subnet: string;
  vlan_id: number | null;
  vlan_name: string;
  enabled: boolean;
  dhcp: PortDHCPConfig;
}

export interface AddLANPortRequest {
  interface: string;
  ip: string;
  subnet: string;
  vlan_id?: number | null;
  vlan_name?: string;
  enabled?: boolean;
  dhcp_enabled?: boolean;
  dhcp_range_start?: string;
  dhcp_range_end?: string;
  dhcp_lease_time?: string;
}

export interface OverviewData {
  clients: { total: number; pending: number; authenticated: number };
  profiles: { total: number; active: number };
  captures: { active: number };
  services: { dnsmasq: { running: boolean; status: string } };
}

export interface SettingsNetwork {
  wan_interface: string;
  lan_interface: string;
  lan_ip: string;
  lan_subnet: string;
}

export interface SettingsDHCP {
  enabled: boolean;
  range_start: string;
  range_end: string;
  lease_time: string;
  gateway: string;
  dns_server: string;
}

export interface SettingsVLAN {
  id: number;
  name: string;
  interface: string;
  ip: string;
  subnet: string;
  dhcp_range_start: string;
  dhcp_range_end: string;
}

export interface SettingsDNS {
  spoof_target: string;
  upstream_servers: string[];
}

export interface SettingsPortal {
  http_port: number;
  https_port: number;
  ssl_cert: string;
  ssl_key: string;
  ssl_cn: string;
}

export interface SettingsAdmin {
  api_port: number;
  frontend_port: number;
}

export interface SettingsCaptures {
  output_dir: string;
  max_file_size_mb: number;
}

export interface SettingsLogging {
  level: string;
  file: string;
  max_size_mb: number;
  backup_count: number;
}

export interface SetupStatus {
  setup_completed: boolean;
  wan_interface: string | null;
  lan_interface: string | null;
  lan_ip: string | null;
}

export interface NetworkInterface {
  name: string;
  mac: string;
  state: string;
  ipv4_addresses: string[];
  has_link: boolean;
}

export interface SetupRequest {
  wan_interface: string;
  lan_interface: string;
  lan_ip?: string;
  lan_subnet?: string;
  dhcp_enabled?: boolean;
  dhcp_range_start?: string;
  dhcp_range_end?: string;
  dhcp_lease_time?: string;
  dns_upstream?: string[];
}

export interface SetupCompleteResponse {
  message: string;
  setup_completed: boolean;
  network: SettingsNetwork;
  dhcp: SettingsDHCP;
  dns: SettingsDNS;
  services_note: string;
}

export interface SettingsData {
  wan_ports: WANPort[];
  lan_ports: LANPort[];
  network: SettingsNetwork;
  dhcp: SettingsDHCP;
  vlans: SettingsVLAN[];
  dns: SettingsDNS;
  portal: SettingsPortal;
  admin: SettingsAdmin;
  captures: SettingsCaptures;
  logging: SettingsLogging;
}
