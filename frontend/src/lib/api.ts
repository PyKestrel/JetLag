const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.message || `${res.statusText} (${res.status})`);
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
/** Reset kernel tc/netem and re-apply enabled profiles (fixes stale rules). */
export const reconcileImpairmentTc = () =>
  request<{
    message: string;
    enabled_count: number;
    errors: { profile_id: number; name: string; error: string }[];
  }>('/profiles/reconcile-tc', { method: 'POST' });

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

// Firewall Rules
export interface FirewallRule {
  id: number;
  name: string;
  enabled: boolean;
  priority: number;
  direction: string;
  action: string;
  protocol: string;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: string | null;
  dst_port: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface FirewallRuleCreate {
  name: string;
  enabled?: boolean;
  priority?: number;
  direction?: string;
  action?: string;
  protocol?: string;
  src_ip?: string | null;
  dst_ip?: string | null;
  src_port?: string | null;
  dst_port?: string | null;
  comment?: string | null;
}

export const getFirewallRules = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<PaginatedResponse<FirewallRule>>(`/firewall/rules${qs}`);
};
export const createFirewallRule = (data: FirewallRuleCreate) =>
  request<FirewallRule>('/firewall/rules', { method: 'POST', body: JSON.stringify(data) });
export const updateFirewallRule = (id: number, data: Partial<FirewallRuleCreate>) =>
  request<FirewallRule>(`/firewall/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteFirewallRule = (id: number) =>
  request<{ message: string }>(`/firewall/rules/${id}`, { method: 'DELETE' });
export const applyFirewallRules = () =>
  request<{ message: string }>('/firewall/rules/apply', { method: 'POST' });
export const getFirewallStatus = () =>
  request<{ ruleset: string; chains: number; rules_count: number }>('/firewall/status');

// Router Management
export interface StaticRoute {
  id: number; destination: string; gateway: string | null; interface: string | null;
  metric: number; enabled: boolean; comment: string | null;
}
export interface NatRule {
  id: number; name: string; type: string; protocol: string;
  src_ip: string | null; dst_ip: string | null; src_port: string | null; dst_port: string | null;
  to_address: string | null; to_port: string | null; interface: string | null;
  enabled: boolean; comment: string | null;
}
export interface DHCPReservation {
  id: number; mac_address: string; ip_address: string; hostname: string | null; comment: string | null;
}

/** GET /api/router/summary — appliance snapshot for the Router Summary tab. */
export interface RouterSummaryData {
  hostname: string;
  uptime_seconds: number | null;
  version: string;
  primary_ipv4: string | null;
  primary_interface: string | null;
  primary_mac: string | null;
  dnsmasq: { running: boolean; status?: string; note?: string };
  counts: {
    static_routes: number;
    nat_rules: number;
    dhcp_reservations: number;
    arp_entries: number;
  };
}

export const getRouterSummary = () => request<RouterSummaryData>('/router/summary');

export const getKernelRoutes = () => request<{ routes: unknown[] }>('/router/routes');
export const getStaticRoutes = () => request<{ items: StaticRoute[] }>('/router/routes/static');
export const addStaticRoute = (data: Partial<StaticRoute>) =>
  request<StaticRoute>('/router/routes/static', { method: 'POST', body: JSON.stringify(data) });
export const deleteStaticRoute = (id: number) =>
  request<{ message: string }>(`/router/routes/static/${id}`, { method: 'DELETE' });

export const getNatRules = () => request<{ items: NatRule[] }>('/router/nat');
export const addNatRule = (data: Partial<NatRule>) =>
  request<NatRule>('/router/nat', { method: 'POST', body: JSON.stringify(data) });
export const deleteNatRule = (id: number) =>
  request<{ message: string }>(`/router/nat/${id}`, { method: 'DELETE' });

export const getInterfaces = () => request<{ interfaces: unknown[] }>('/router/interfaces');
export const updateInterface = (name: string, data: { ip_address?: string; state?: string; mtu?: number }) =>
  request<{ interface: string; results: unknown[] }>(`/router/interfaces/${name}`, { method: 'PUT', body: JSON.stringify(data) });

export const getArpTable = () => request<{ entries: unknown[] }>('/router/arp');
export const flushArp = () => request<{ message: string }>('/router/arp', { method: 'DELETE' });

export const getSysctls = () => request<{ sysctls: Record<string, string | null> }>('/router/sysctl');
export const setSysctls = (values: Record<string, string>) =>
  request<{ results: Record<string, { success: boolean; error?: string }> }>('/router/sysctl', { method: 'PUT', body: JSON.stringify({ values }) });

// Portal Config
export interface PortalConfigData {
  portal_type: string;
  welcome_message: string;
  redirect_url: string;
  session_duration_minutes: number;
  tiered_plans: TieredPlan[];
  walled_garden_domains: string[];
  requires_login: boolean;
}

export interface TieredPlan {
  name: string;
  duration_minutes: number;
}

export interface PortalConfigUpdate {
  portal_type?: string;
  login_username?: string;
  login_password?: string;
  session_duration_minutes?: number;
  tiered_plans?: TieredPlan[];
  walled_garden_domains?: string[];
  redirect_url?: string;
  welcome_message?: string;
}

export const getPortalConfig = () => request<PortalConfigData>('/portal/config');
export const updatePortalConfig = (data: PortalConfigUpdate) =>
  request<{ message: string; portal_type: string }>('/portal/config', { method: 'PUT', body: JSON.stringify(data) });

/** LLDP/CDP neighbor row (from lldpd via GET /api/router/neighbors). */
export interface LldpNeighbor {
  local_interface: string | null;
  protocol: string | null;
  age: string | null;
  chassis_id: string | null;
  system_name: string | null;
  port_id: string | null;
  port_description: string | null;
  management_ip: string | null;
}

export const getLldpNeighbors = () =>
  request<{
    items: LldpNeighbor[];
    available?: boolean;
    message?: string | null;
    error?: string | null;
  }>('/router/neighbors');

export const getDhcpReservations = () => request<{ items: DHCPReservation[] }>('/router/dhcp/reservations');
export const addDhcpReservation = (data: Partial<DHCPReservation>) =>
  request<DHCPReservation>('/router/dhcp/reservations', { method: 'POST', body: JSON.stringify(data) });
export const deleteDhcpReservation = (id: number) =>
  request<{ message: string }>(`/router/dhcp/reservations/${id}`, { method: 'DELETE' });

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
  portal_type: string;
  login_username: string;
  login_password: string;
  session_duration_minutes: number;
  tiered_plans: TieredPlan[];
  walled_garden_domains: string[];
  redirect_url: string;
  welcome_message: string;
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
  is_wlan: boolean;
  supports_ap: boolean;
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
  hotspot_mode?: boolean;
  hotspot_ssid?: string;
  hotspot_password?: string;
  hotspot_channel?: number;
  hotspot_hidden?: boolean;
}

export interface SetupCompleteResponse {
  message: string;
  setup_completed: boolean;
  network: SettingsNetwork;
  dhcp: SettingsDHCP;
  dns: SettingsDNS;
  services_started?: string[];
  services_failed?: string[];
  hotspot_mode?: boolean;
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

// ── Wireless AP ──────────────────────────────────────────────

export interface WirelessConfig {
  enabled: boolean;
  interface: string;
  ssid: string;
  channel: number;
  hw_mode: string;
  ieee80211n: boolean;
  ieee80211ac: boolean;
  wpa: number;
  wpa_passphrase: string;
  wpa_key_mgmt: string;
  rsn_pairwise: string;
  country_code: string;
  ip: string;
  subnet: string;
  dhcp_range_start: string;
  dhcp_range_end: string;
  dhcp_lease_time: string;
  bridge_to_lan: boolean;
  max_clients: number;
  hidden: boolean;
}

export interface WirelessConfigUpdate {
  enabled?: boolean;
  interface?: string;
  ssid?: string;
  channel?: number;
  hw_mode?: string;
  ieee80211n?: boolean;
  ieee80211ac?: boolean;
  wpa?: number;
  wpa_passphrase?: string;
  wpa_key_mgmt?: string;
  rsn_pairwise?: string;
  country_code?: string;
  ip?: string;
  subnet?: string;
  dhcp_range_start?: string;
  dhcp_range_end?: string;
  dhcp_lease_time?: string;
  bridge_to_lan?: boolean;
  max_clients?: number;
  hidden?: boolean;
}

export interface WlanInterface {
  name: string;
  driver: string;
  phy: string;
  mac: string;
  mode: string;
}

export interface WirelessStatus {
  running: boolean;
  pid: number | null;
  interface: string;
  ssid: string;
  channel: number;
  clients_connected: number;
  uptime: string | null;
  error?: string;
}

export interface WirelessStation {
  mac: string;
  signal: string;
  rx_bytes: string;
  tx_bytes: string;
  connected_time: string;
}

export const getWirelessInterfaces = () =>
  request<{ interfaces: WlanInterface[]; count: number }>('/wireless/detect');

export const getWirelessCapabilities = (iface: string) =>
  request<Record<string, unknown>>(`/wireless/capabilities/${iface}`);

export const getWirelessConfig = () =>
  request<WirelessConfig>('/wireless/config');

export const updateWirelessConfig = (data: WirelessConfigUpdate) =>
  request<WirelessConfig>('/wireless/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const startWirelessAP = () =>
  request<{ success: boolean; message?: string }>('/wireless/start', { method: 'POST' });

export const stopWirelessAP = () =>
  request<{ success: boolean; message?: string }>('/wireless/stop', { method: 'POST' });

export const restartWirelessAP = () =>
  request<{ success: boolean; message?: string }>('/wireless/restart', { method: 'POST' });

export const getWirelessStatus = () =>
  request<WirelessStatus>('/wireless/status');

export const getWirelessStations = () =>
  request<{ stations: WirelessStation[]; count: number }>('/wireless/stations');

// ── Replay Engine ─────────────────────────────────────────────

export interface ReplayStep {
  id: number;
  scenario_id: number;
  step_index: number;
  offset_ms: number;
  duration_ms: number;
  latency_ms: number;
  jitter_ms: number;
  packet_loss_percent: number;
  bandwidth_kbps: number;
}

export interface ReplayScenario {
  id: number;
  name: string;
  description: string | null;
  default_direction: string;
  total_duration_ms: number;
  step_count: number;
  source_filename: string | null;
  created_at: string;
  updated_at: string;
  steps: ReplayStep[];
}

export interface ReplayScenarioListItem {
  id: number;
  name: string;
  description: string | null;
  default_direction: string;
  total_duration_ms: number;
  step_count: number;
  source_filename: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReplaySessionStart {
  profile_id: number;
  scenario_id: number;
  loop?: boolean;
  playback_speed?: number;
  start_offset_ms?: number | null;
  end_offset_ms?: number | null;
}

export interface ReplaySessionStatus {
  profile_id: number;
  scenario_id: number | null;
  scenario_name: string;
  state: 'idle' | 'running' | 'paused' | 'completed' | 'stopped';
  current_step_index: number;
  total_steps: number;
  elapsed_ms: number;
  total_ms: number;
  loop: boolean;
  loop_count: number;
  playback_speed: number;
  current_values: {
    latency_ms: number;
    jitter_ms: number;
    packet_loss_percent: number;
    bandwidth_kbps: number;
  } | null;
  has_snapshot: boolean;
}

export const importReplayScenario = async (file: File): Promise<ReplayScenario> => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/replay/scenarios/import`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.message || `${res.statusText} (${res.status})`);
  }
  return res.json();
};

export const getReplayScenarios = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<PaginatedResponse<ReplayScenarioListItem>>(`/replay/scenarios${qs}`);
};

export const getReplayScenario = (id: number) =>
  request<ReplayScenario>(`/replay/scenarios/${id}`);

export const updateReplayScenario = (id: number, data: { name?: string; description?: string; default_direction?: string; steps?: Omit<ReplayStep, 'id' | 'scenario_id' | 'step_index'>[] }) =>
  request<ReplayScenario>(`/replay/scenarios/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteReplayScenario = (id: number) =>
  request<{ message: string }>(`/replay/scenarios/${id}`, { method: 'DELETE' });

export const getReplayScenarioExportUrl = (id: number, format: 'json' | 'yaml' = 'json') =>
  `${API_BASE}/replay/scenarios/${id}/export?format=${format}`;

export const startReplaySession = (data: ReplaySessionStart) =>
  request<ReplaySessionStatus>('/replay/sessions/start', { method: 'POST', body: JSON.stringify(data) });

export const stopReplaySession = (profileId: number) =>
  request<ReplaySessionStatus>(`/replay/sessions/${profileId}/stop`, { method: 'POST' });

export const pauseReplaySession = (profileId: number) =>
  request<ReplaySessionStatus>(`/replay/sessions/${profileId}/pause`, { method: 'POST' });

export const resumeReplaySession = (profileId: number) =>
  request<ReplaySessionStatus>(`/replay/sessions/${profileId}/resume`, { method: 'POST' });

export const getReplaySessionStatus = (profileId: number) =>
  request<ReplaySessionStatus>(`/replay/sessions/${profileId}/status`);

export const revertReplayProfile = (profileId: number) =>
  request<{ message: string; profile_id: number }>(`/replay/sessions/${profileId}/revert`, { method: 'POST' });

export const getActiveReplaySessions = () =>
  request<ReplaySessionStatus[]>('/replay/sessions/active');

export interface ReplayHistoryEntry {
  id: number;
  profile_id: number;
  profile_name: string;
  scenario_id: number;
  scenario_name: string;
  state: string;
  steps_played: number;
  total_steps: number;
  elapsed_ms: number;
  total_ms: number;
  loop_count: number;
  playback_speed: number;
  started_at: string;
  ended_at: string;
}

export const getReplayHistory = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<PaginatedResponse<ReplayHistoryEntry>>(`/replay/history${qs}`);
};
