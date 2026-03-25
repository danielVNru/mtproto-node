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
}

export interface ProxyCreateRequest {
  port?: number;
  secret?: string;
  domain?: string;
  tag?: string;
  name?: string;
  note?: string;
}

export interface ProxyUpdateRequest {
  domain?: string;
  tag?: string;
  name?: string;
  note?: string;
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
  connectedIps: string[];
}

export interface StoreData {
  proxies: ProxyConfig[];
}
