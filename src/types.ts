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
  nginxPort?: number;        // effective nginx listen port (config.nginxPort)
  listenPort?: number;       // if set and != 443, proxy gets its own TCP port
  vpnSubscription?: string;  // VLESS subscription URL
  vpnContainerName?: string; // xray container name when VPN is active
  maskHost?: string;         // self-steal fallback host:port (non-MTProto traffic redirect)
  natIp?: string;            // tunnel exit node public IP (overrides node-level NAT_IP)
  tunnelInterface?: string;  // tunnel interface name, e.g. tun0 (for reference/future automation)
  useMiddleProxy?: boolean;
  fastMode?: boolean;
  me2dcFallback?: boolean;
  me2dcFast?: boolean;
  meKeepaliveEnabled?: boolean;
  meKeepaliveIntervalSecs?: number;
  meKeepaliveJitterSecs?: number;
  meKeepalivePayloadRandom?: boolean;
  meReconnectBackoffBaseMs?: number;
  meReconnectBackoffCapMs?: number;
  meReconnectFastRetryCount?: number;
  desyncAllFull?: boolean;
  meWriterPickMode?: 'sorted_rr' | 'p2c' | string;
  meWarmupStaggerEnabled?: boolean;
  meWarmupStepDelayMs?: number;
  meWarmupStepJitterMs?: number;
  beobachten?: boolean;
  beobachtenMinutes?: number;
  beobachtenFlushSecs?: number;
  beobachtenFile?: string;
  upstreamConnectRetryAttempts?: number;
  upstreamConnectRetryBackoffMs?: number;
  tgConnect?: number;
  rstOnClose?: string;
  logLevel?: string;
  unknownDcFileLogEnabled?: boolean;
  updateEvery?: number;
  networkPrefer?: string;
  stunServers?: string[];
  serverClientMss?: number;
  censorshipTlsDomain?: string;
  censorshipTlsEmulation?: boolean;
  censorshipTlsFrontDir?: string;
  meInitRetryAttempts?: number;
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
  maskHost?: string;
  natIp?: string;
  tunnelInterface?: string;
  useMiddleProxy?: boolean;
  fastMode?: boolean;
  me2dcFallback?: boolean;
  me2dcFast?: boolean;
  meKeepaliveEnabled?: boolean;
  meKeepaliveIntervalSecs?: number;
  meKeepaliveJitterSecs?: number;
  meKeepalivePayloadRandom?: boolean;
  meReconnectBackoffBaseMs?: number;
  meReconnectBackoffCapMs?: number;
  meReconnectFastRetryCount?: number;
  desyncAllFull?: boolean;
  meWriterPickMode?: 'sorted_rr' | 'p2c' | string;
  meWarmupStaggerEnabled?: boolean;
  meWarmupStepDelayMs?: number;
  meWarmupStepJitterMs?: number;
  beobachten?: boolean;
  beobachtenMinutes?: number;
  beobachtenFlushSecs?: number;
  beobachtenFile?: string;
  upstreamConnectRetryAttempts?: number;
  upstreamConnectRetryBackoffMs?: number;
  tgConnect?: number;
  rstOnClose?: string;
  logLevel?: string;
  unknownDcFileLogEnabled?: boolean;
  updateEvery?: number;
  networkPrefer?: string;
  stunServers?: string[];
  serverClientMss?: number;
  censorshipTlsDomain?: string;
  censorshipTlsEmulation?: boolean;
  censorshipTlsFrontDir?: string;
  meInitRetryAttempts?: number;
}

export interface ProxyUpdateRequest {
  domain?: string;
  tag?: string;
  name?: string;
  note?: string;
  maxConnections?: number;
  listenPort?: number;
  vpnSubscription?: string;
  maskHost?: string;
  natIp?: string;
  tunnelInterface?: string;
  useMiddleProxy?: boolean;
  fastMode?: boolean;
  me2dcFallback?: boolean;
  me2dcFast?: boolean;
  meKeepaliveEnabled?: boolean;
  meKeepaliveIntervalSecs?: number;
  meKeepaliveJitterSecs?: number;
  meKeepalivePayloadRandom?: boolean;
  meReconnectBackoffBaseMs?: number;
  meReconnectBackoffCapMs?: number;
  meReconnectFastRetryCount?: number;
  desyncAllFull?: boolean;
  meWriterPickMode?: 'sorted_rr' | 'p2c' | string;
  meWarmupStaggerEnabled?: boolean;
  meWarmupStepDelayMs?: number;
  meWarmupStepJitterMs?: number;
  beobachten?: boolean;
  beobachtenMinutes?: number;
  beobachtenFlushSecs?: number;
  beobachtenFile?: string;
  upstreamConnectRetryAttempts?: number;
  upstreamConnectRetryBackoffMs?: number;
  tgConnect?: number;
  rstOnClose?: string;
  logLevel?: string;
  unknownDcFileLogEnabled?: boolean;
  updateEvery?: number;
  networkPrefer?: string;
  stunServers?: string[];
  serverClientMss?: number;
  censorshipTlsDomain?: string;
  censorshipTlsEmulation?: boolean;
  censorshipTlsFrontDir?: string;
  meInitRetryAttempts?: number;
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
