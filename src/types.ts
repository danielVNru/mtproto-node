export interface ProxyConfig {
  id: string;
  port: number;
  secret: string;
  domain: string;
  containerName: string;
  status: 'running' | 'stopped' | 'error';
  createdAt: string;
  tag?: string;
}

export interface ProxyCreateRequest {
  port?: number;
  secret?: string;
  domain?: string;
  tag?: string;
}

export interface ProxyUpdateRequest {
  domain?: string;
  tag?: string;
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
  uptime: string;
}

export interface StoreData {
  proxies: ProxyConfig[];
}
