export interface ConnectedIpInfo {
  ip: string;
  country?: string;
  countryCode?: string;
}

export interface ProxyConfig {
  id: string;
  name: string;
  note: string;
  port: number;
  secret: string;
  domain: string;
  containerName: string;
  status: 'running' | 'stopped' | 'paused' | 'error';
  createdAt: string;
  tag?: string;
  trafficUp: number;
  trafficDown: number;
  connectedIps: string[];
  maxConnections?: number;
  listenPort?: number;       // if set and != 443, proxy gets its own TCP port
  vpnSubscription?: string;  // VLESS subscription URL
  vpnContainerName?: string; // xray container name when VPN is active
}

export interface ProxyCreateRequest {
  port?: number;
  secret?: string;
  domain?: string;
  tag?: string;
  name?: string;
  note?: string;
  maxConnections?: number;
  listenPort?: number;
  vpnSubscription?: string;
}

export interface ProxyUpdateRequest {
  domain?: string;
  tag?: string;
  name?: string;
  note?: string;
  maxConnections?: number;
  vpnSubscription?: string;
}

export interface ProxyStats {
  id: string;
  containerName: string;
  status: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryLimit: string;
  networkRx: string;
  networkTx: string;
  networkRxBytes: number;
  networkTxBytes: number;
  uptime: string;
  connectedIps: ConnectedIpInfo[];
}

export interface StoreData {
  proxies: ProxyConfig[];
  customDomains?: string[];
  blacklistedIps?: string[];
}

export interface StatsSnapshot {
  timestamp: string;
  cpuPercent: number;
  memoryBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  connectedCount: number;
}

export interface IpHistoryEntry {
  ip: string;
  country?: string;
  countryCode?: string;
  firstSeen: string;
  lastSeen: string;
}

export interface StatsHistoryData {
  [proxyId: string]: StatsSnapshot[];
}

export interface IpHistoryData {
  [proxyId: string]: IpHistoryEntry[];
}
