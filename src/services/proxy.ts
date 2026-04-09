import { v4 as uuidv4 } from 'uuid';
import { config, FAKE_TLS_DOMAINS } from '../config';
import { ProxyConfig, ProxyCreateRequest, ProxyStats, ProxyUpdateRequest, ConnectedIpInfo, StatsSnapshot, IpHistoryEntry } from '../types';
import { generateSecret, getRandomElement, getRandomPort, buildFullSecret } from '../utils/crypto';
import * as store from '../store';
import * as dockerService from './docker';
import * as nginxService from './nginx';
import * as xrayService from './xray';

export async function createProxy(req: ProxyCreateRequest): Promise<ProxyConfig> {
  const id = uuidv4().split('-')[0];
  const secret = req.secret || generateSecret();

  let domain: string;
  if (req.domain) {
    if (store.isDomainUsed(req.domain)) {
      throw new Error(`Domain ${req.domain} is already in use by another proxy`);
    }
    domain = req.domain;
  } else {
    const usedDomains = new Set(store.getUsedDomains());
    const customDomains = store.getCustomDomains();
    const domainPool = customDomains.length > 0 ? customDomains : FAKE_TLS_DOMAINS;
    const available = domainPool.filter((d) => !usedDomains.has(d));
    if (available.length === 0) {
      throw new Error('No available domains left. Delete a proxy or specify a custom domain.');
    }
    domain = getRandomElement(available);
  }

  let port = req.port || 0;
  if (!port) {
    do {
      port = getRandomPort(config.portRangeStart, config.portRangeEnd);
    } while (store.isPortUsed(port));
  } else if (store.isPortUsed(port)) {
    throw new Error(`Port ${port} is already in use`);
  }

  const containerName = `${config.proxyContainerPrefix}${id}`;

  // Handle VPN subscription
  let vpnContainerName: string | undefined;
  let socks5Host: string | undefined;
  if (req.vpnSubscription) {
    vpnContainerName = `${config.xrayContainerPrefix}${id}`;
    const vlessConfig = await xrayService.fetchAndParseSubscription(req.vpnSubscription);
    if (!vlessConfig) throw new Error('Failed to parse VPN subscription URL');
    await xrayService.createXrayContainer(vpnContainerName, vlessConfig);
    socks5Host = vpnContainerName;
  }

  const proxy: ProxyConfig = {
    id,
    name: req.name || `Proxy ${id}`,
    note: req.note || '',
    port,
    secret,
    domain,
    containerName,
    status: 'running',
    createdAt: new Date().toISOString(),
    tag: req.tag,
    trafficUp: 0,
    trafficDown: 0,
    connectedIps: [],
    maxConnections: req.maxConnections,
    listenPort: req.listenPort,
    vpnSubscription: req.vpnSubscription,
    vpnContainerName,
  };

  try {
    await dockerService.createProxyContainer(containerName, secret, domain, config.nginxPort, req.tag, socks5Host);
    store.addProxy(proxy);
    await nginxService.updateNginxConfig(store.getAllProxies());
    return proxy;
  } catch (error) {
    await dockerService.removeProxyContainer(containerName);
    if (vpnContainerName) await xrayService.removeXrayContainer(vpnContainerName);
    throw error;
  }
}

export async function listProxies(): Promise<ProxyConfig[]> {
  const proxies = store.getAllProxies();

  // Update status from Docker
  for (const proxy of proxies) {
    const status = await dockerService.getContainerStatus(proxy.containerName);
    if (status === 'running') {
      proxy.status = 'running';
    } else if (status === 'paused') {
      proxy.status = 'paused';
    } else if (status === 'not_found') {
      proxy.status = 'error';
    } else {
      proxy.status = 'stopped';
    }
  }

  return proxies;
}

export async function getProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = store.getProxyById(id);
  if (proxy) {
    const status = await dockerService.getContainerStatus(proxy.containerName);
    if (status === 'running') proxy.status = 'running';
    else if (status === 'paused') proxy.status = 'paused';
    else if (status === 'not_found') proxy.status = 'error';
    else proxy.status = 'stopped';
  }
  return proxy;
}

export async function updateProxy(id: string, req: ProxyUpdateRequest): Promise<ProxyConfig | undefined> {
  const proxy = store.getProxyById(id);
  if (!proxy) return undefined;

  let needsRestart = !!(req.domain && req.domain !== proxy.domain);
  const updates: Partial<ProxyConfig> = {};

  if (req.domain) updates.domain = req.domain;
  if (req.tag !== undefined) updates.tag = req.tag;
  if (req.name !== undefined) updates.name = req.name;
  if (req.note !== undefined) updates.note = req.note;
  if (req.maxConnections !== undefined) updates.maxConnections = req.maxConnections;

  // Handle VPN subscription change
  let newSocks5Host: string | undefined = proxy.vpnContainerName;
  if (req.vpnSubscription !== undefined && req.vpnSubscription !== proxy.vpnSubscription) {
    // Remove old xray container
    if (proxy.vpnContainerName) {
      await xrayService.removeXrayContainer(proxy.vpnContainerName);
      updates.vpnContainerName = undefined;
      newSocks5Host = undefined;
    }

    if (req.vpnSubscription) {
      const newVpnName = `${config.xrayContainerPrefix}${id}`;
      const vlessConfig = await xrayService.fetchAndParseSubscription(req.vpnSubscription);
      if (!vlessConfig) throw new Error('Failed to parse VPN subscription URL');
      await xrayService.createXrayContainer(newVpnName, vlessConfig);
      updates.vpnContainerName = newVpnName;
      updates.vpnSubscription = req.vpnSubscription;
      newSocks5Host = newVpnName;
    } else {
      updates.vpnSubscription = '';
    }
    needsRestart = true;
  }

  if (needsRestart) {
    await dockerService.removeProxyContainer(proxy.containerName);
    await dockerService.createProxyContainer(
      proxy.containerName,
      proxy.secret,
      updates.domain || proxy.domain,
      config.nginxPort,
      updates.tag !== undefined ? updates.tag : proxy.tag,
      newSocks5Host
    );
  }

  const updated = store.updateProxy(id, updates);
  await nginxService.updateNginxConfig(store.getAllProxies());
  return updated;
}

export async function restartProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = store.getProxyById(id);
  if (!proxy) return undefined;

  // Удаляем старый контейнер если существует
  await dockerService.removeProxyContainer(proxy.containerName).catch(() => {});

  // Создаём контейнер заново (с VPN если настроен)
  await dockerService.createProxyContainer(
    proxy.containerName,
    proxy.secret,
    proxy.domain,
    config.nginxPort,
    proxy.tag,
    proxy.vpnContainerName
  );

  const updated = store.updateProxy(id, { status: 'running' });
  await nginxService.updateNginxConfig(store.getAllProxies());
  return updated;
}

export async function deleteProxy(id: string): Promise<boolean> {
  const proxy = store.getProxyById(id);
  if (!proxy) return false;

  await dockerService.removeProxyContainer(proxy.containerName);
  if (proxy.vpnContainerName) {
    await xrayService.removeXrayContainer(proxy.vpnContainerName);
  }
  store.removeProxy(id);
  store.removeStatsHistory(id);
  store.removeIpHistory(id);
  await nginxService.updateNginxConfig(store.getAllProxies());
  return true;
}

export async function pauseProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = store.getProxyById(id);
  if (!proxy) return undefined;

  await dockerService.pauseContainer(proxy.containerName);
  return store.updateProxy(id, { status: 'paused' });
}

export async function unpauseProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = store.getProxyById(id);
  if (!proxy) return undefined;

  await dockerService.unpauseContainer(proxy.containerName);
  return store.updateProxy(id, { status: 'running' });
}

export async function getProxyStats(id: string): Promise<ProxyStats | null> {
  const proxy = store.getProxyById(id);
  if (!proxy) return null;

  try {
    const status = await dockerService.getContainerStatus(proxy.containerName);
    if (status !== 'running') {
      return {
        id: proxy.id,
        containerName: proxy.containerName,
        status,
        cpuPercent: '0%',
        memoryUsage: '0 B',
        memoryLimit: '0 B',
        networkRx: '0 B',
        networkTx: '0 B',
        networkRxBytes: 0,
        networkTxBytes: 0,
        uptime: '0h 0m',
        connectedIps: [] as ConnectedIpInfo[],
      };
    }

    const stats = await dockerService.getContainerStats(proxy.containerName);
    const uptime = await dockerService.getContainerUptime(proxy.containerName);
    const connectedIps = await nginxService.getNginxConnectedIps(proxy.domain);

    // Update stored traffic and IPs
    store.updateProxy(id, {
      trafficUp: stats.networkTxBytes,
      trafficDown: stats.networkRxBytes,
      connectedIps: connectedIps.map((c) => c.ip),
    });

    // Save stats snapshot (throttled to 5-min intervals in store)
    const cpuNum = parseFloat(stats.cpuPercent.replace('%', '')) || 0;
    const memMatch = stats.memoryUsage.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
    let memBytes = 0;
    if (memMatch) {
      const val = parseFloat(memMatch[1]);
      const unit = memMatch[2].toUpperCase();
      memBytes = unit === 'GB' ? val * 1073741824 : unit === 'MB' ? val * 1048576 : unit === 'KB' ? val * 1024 : val;
    }
    store.addStatsSnapshot(id, {
      timestamp: new Date().toISOString(),
      cpuPercent: cpuNum,
      memoryBytes: memBytes,
      networkRxBytes: stats.networkRxBytes,
      networkTxBytes: stats.networkTxBytes,
      connectedCount: connectedIps.length,
    });

    // Update IP history
    if (connectedIps.length > 0) {
      store.updateIpHistory(id, connectedIps);
    }

    return {
      id: proxy.id,
      containerName: proxy.containerName,
      status,
      ...stats,
      uptime,
      connectedIps,
    };
  } catch {
    return {
      id: proxy.id,
      containerName: proxy.containerName,
      status: 'error',
      cpuPercent: '0%',
      memoryUsage: '0 B',
      memoryLimit: '0 B',
      networkRx: '0 B',
      networkTx: '0 B',
      networkRxBytes: 0,
      networkTxBytes: 0,
      uptime: 'unknown',
      connectedIps: [] as ConnectedIpInfo[],
    };
  }
}

export function getProxyLink(id: string, serverIp: string): string | null {
  const proxy = store.getProxyById(id);
  if (!proxy) return null;

  const fullSecret = buildFullSecret(proxy.secret, proxy.domain);
  const port = proxy.listenPort || config.nginxPort;
  return `tg://proxy?server=${encodeURIComponent(serverIp)}&port=${port}&secret=${fullSecret}`;
}

export function getProxyStatsHistory(id: string): StatsSnapshot[] {
  return store.getStatsHistory(id);
}

export function getProxyIpHistory(id: string): IpHistoryEntry[] {
  return store.getIpHistory(id);
}

export function clearProxyHistory(id: string): boolean {
  const proxy = store.getProxyById(id);
  if (!proxy) return false;
  store.removeStatsHistory(id);
  store.removeIpHistory(id);
  return true;
}

// Background collector: gather stats + IPs for ALL running proxies
export async function collectAllProxyStats(): Promise<void> {
  const proxies = store.getAllProxies();
  for (const proxy of proxies) {
    try {
      await getProxyStats(proxy.id);
    } catch {
      // skip failed proxies silently
    }
  }
}
