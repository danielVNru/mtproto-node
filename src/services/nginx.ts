import Docker from 'dockerode';
import { config } from '../config';
import { ProxyConfig, ConnectedIpInfo } from '../types';
import { pullImage } from './docker';
import * as store from '../store';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export function generateNginxConfig(proxies: ProxyConfig[]): string {
  const runningProxies = proxies.filter((p) => p.status === 'running');

  // Split into SNI-based (nginxPort) vs dedicated-port proxies
  const nginxPort = config.nginxPort;
  const sniProxies = runningProxies.filter((p) => !p.listenPort || p.listenPort === nginxPort);
  const portProxies = runningProxies.filter((p) => p.listenPort && p.listenPort !== nginxPort);

  // For SNI proxies with connection limits, assign internal loopback ports (10001+)
  const limitSniProxies = sniProxies.filter((p) => p.maxConnections && p.maxConnections > 0);
  const limitPortMap = new Map<string, number>();
  limitSniProxies.forEach((p, i) => {
    limitPortMap.set(p.domain, 10001 + i);
  });

  // SNI map entries (nginxPort)
  const mapEntries = sniProxies
    .map((p) => {
      const internalPort = limitPortMap.get(p.domain);
      if (internalPort) {
        return `        ${p.domain} 127.0.0.1:${internalPort};`;
      }
      return `        ${p.domain} ${p.containerName}:${nginxPort};`;
    })
    .join('\n');

  // Default backend: HTML fallback
  const defaultBackend = '127.0.0.1:8088';

  // Blacklisted IPs
  const blacklistedIps = store.getBlacklistedIps();
  const denyEntries = blacklistedIps.map((ip) => `        deny ${ip};`).join('\n');

  // Main SNI server block on nginxPort
  const mainServer = `    server {
        listen ${nginxPort};
        proxy_pass $backend;
        ssl_preread on;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
${denyEntries ? denyEntries + '\n' : ''}    }`;

  // Per-domain limit server blocks (loopback, for SNI proxies with limits)
  const limitBlocks = limitSniProxies
    .map((p) => {
      const zoneName = p.domain.replace(/\./g, '_');
      const internalPort = limitPortMap.get(p.domain)!;
      return `    limit_conn_zone $remote_addr zone=${zoneName}:1m;
    server {
        listen 127.0.0.1:${internalPort};
        set $target ${p.containerName}:${nginxPort};
        proxy_pass $target;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
        limit_conn ${zoneName} ${p.maxConnections};
    }`;
    })
    .join('\n\n');

  // Dedicated port server blocks
  const portBlocks = portProxies
    .map((p) => {
      if (p.maxConnections && p.maxConnections > 0) {
        return `
    limit_conn_zone $remote_addr zone=port_${p.listenPort}:1m;
    server {
        listen ${p.listenPort};
        set $target ${p.containerName}:${p.listenPort};
        proxy_pass $target;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
${denyEntries ? denyEntries + '\n' : ''}        limit_conn port_${p.listenPort} ${p.maxConnections};
    }`;
      }
      return `
    server {
        listen ${p.listenPort};
        set $target ${p.containerName}:${p.listenPort};
        proxy_pass $target;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
${denyEntries ? denyEntries + '\n' : ''}    }`;
    })
    .join('\n');

  // HTML fallback page served when no SNI/port match
  const fallbackHtml = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Welcome</title></head>'
    + '<body style="font-family:sans-serif;text-align:center;padding:60px">'
    + '<h1>Welcome</h1><p>This server is operating normally.</p>'
    + '</body></html>';

  return `user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    server {
        listen 127.0.0.1:8088;
        server_name _;
        location / {
            default_type "text/html";
            return 200 '${fallbackHtml}';
        }
    }
}

stream {
    resolver 127.0.0.11 valid=10s;

    log_format proxy '$remote_addr [$time_local] $ssl_preread_server_name $status';
    access_log /dev/stdout proxy;

    map $ssl_preread_server_name $backend {
${mapEntries}
        default ${defaultBackend};
    }

${mainServer}

${limitBlocks ? limitBlocks + '\n' : ''}${portBlocks ? portBlocks + '\n' : ''}}
`;
}

export async function ensureNginxContainer(extraPorts: number[] = []): Promise<void> {
  const containerName = config.nginxContainerName;
  const requiredPorts = [config.nginxPort, ...extraPorts.filter((p) => p !== config.nginxPort)];

  // Remove any existing container that might be misconfigured
  try {
    const existing = docker.getContainer(containerName);
    const info = await existing.inspect();

    // Check if all required ports are bound
    const portBindings = info.HostConfig?.PortBindings || {};
    const boundPorts = Object.keys(portBindings).map((k) => parseInt(k));
    const hasAllPorts = requiredPorts.every((p) => boundPorts.includes(p));

    if (hasAllPorts && info.State.Running) {
      return; // Container is healthy with correct ports
    }

    if (hasAllPorts && !info.State.Running) {
      // Right config, just not running — inject config and start
      const initialConf = generateNginxConfig([]);
      const tar = createTarBuffer('nginx.conf', initialConf);
      await existing.putArchive(tar, { path: '/etc/nginx' });
      await existing.start();
      return;
    }

    // Wrong port config or missing ports — remove and recreate
    await existing.remove({ force: true });
  } catch {
    // Container doesn't exist — will create below
  }

  // Build portBindings for all required ports
  const portBindings: Record<string, [{ HostPort: string }]> = {};
  const exposedPorts: Record<string, {}> = {};
  for (const p of requiredPorts) {
    portBindings[`${p}/tcp`] = [{ HostPort: String(p) }];
    exposedPorts[`${p}/tcp`] = {};
  }

  // Pull image if needed
  await pullImage('nginx:latest');

  // Create container (not started yet)
  const container = await docker.createContainer({
    Image: 'nginx:latest',
    name: containerName,
    HostConfig: {
      PortBindings: portBindings,
      NetworkMode: config.dockerNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
    },
    ExposedPorts: exposedPorts,
  });

  // Inject stream config BEFORE starting so nginx starts with the correct config
  const initialConf = generateNginxConfig([]);
  const tar = createTarBuffer('nginx.conf', initialConf);
  await container.putArchive(tar, { path: '/etc/nginx' });

  await container.start();
  console.log(`nginx container created with ports: ${requiredPorts.join(', ')}`);
}

export async function updateNginxConfig(proxies: ProxyConfig[]): Promise<void> {
  // Filter out proxies whose containers don't exist (stale data)
  const aliveProxies: ProxyConfig[] = [];
  for (const p of proxies) {
    try {
      const container = docker.getContainer(p.containerName);
      await container.inspect();
      aliveProxies.push(p);
    } catch {
      console.warn(`Skipping proxy ${p.id}: container ${p.containerName} not found, excluding from nginx config`);
    }
  }

  // Collect all required ports: nginxPort + any custom listenPorts
  const extraPorts = aliveProxies
    .filter((p) => p.listenPort && p.listenPort !== config.nginxPort)
    .map((p) => p.listenPort!);

  // Ensure nginx is up with correct port bindings before updating
  await ensureNginxContainer(extraPorts);

  const nginxConf = generateNginxConfig(aliveProxies);
  const container = docker.getContainer(config.nginxContainerName);

  // Write config to container
  const tarStream = createTarBuffer('nginx.conf', nginxConf);
  await container.putArchive(tarStream, { path: '/etc/nginx' });

  // Reload nginx
  const exec = await container.exec({
    Cmd: ['nginx', '-s', 'reload'],
    AttachStdout: true,
    AttachStderr: true,
  });
  await exec.start({});
}

// Telegram DC IP ranges to filter out
const TELEGRAM_DC_RANGES = [
  '149.154.160.', '149.154.161.', '149.154.162.', '149.154.163.',
  '149.154.164.', '149.154.165.', '149.154.166.', '149.154.167.',
  '149.154.168.', '149.154.169.', '149.154.170.', '149.154.171.',
  '149.154.172.', '149.154.173.', '149.154.174.', '149.154.175.',
  '91.108.4.', '91.108.5.', '91.108.6.', '91.108.7.', '91.108.8.',
  '91.108.9.', '91.108.10.', '91.108.11.', '91.108.12.', '91.108.13.',
  '91.108.16.', '91.108.17.', '91.108.18.', '91.108.19.', '91.108.20.',
  '91.108.56.', '91.108.57.', '91.108.58.', '91.108.59.',
  '91.105.192.', '91.105.193.', '91.105.194.', '91.105.195.',
  '185.76.151.',
  '95.161.64.',
];

function isTelegramIp(ip: string): boolean {
  return TELEGRAM_DC_RANGES.some((prefix) => ip.startsWith(prefix));
}

// Simple in-memory geo cache to avoid hammering the API
const geoCache = new Map<string, { country: string; countryCode: string; ts: number }>();
const GEO_CACHE_TTL = 3600000; // 1 hour

async function lookupGeo(ips: string[]): Promise<Map<string, { country: string; countryCode: string }>> {
  const result = new Map<string, { country: string; countryCode: string }>();
  const toFetch: string[] = [];

  for (const ip of ips) {
    const cached = geoCache.get(ip);
    if (cached && Date.now() - cached.ts < GEO_CACHE_TTL) {
      result.set(ip, { country: cached.country, countryCode: cached.countryCode });
    } else {
      toFetch.push(ip);
    }
  }

  if (toFetch.length > 0) {
    try {
      const resp = await fetch('http://ip-api.com/batch?fields=query,country,countryCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toFetch.map((ip) => ({ query: ip }))),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json() as Array<{ query: string; country?: string; countryCode?: string }>;
        for (const entry of data) {
          if (entry.country && entry.countryCode) {
            geoCache.set(entry.query, { country: entry.country, countryCode: entry.countryCode, ts: Date.now() });
            result.set(entry.query, { country: entry.country, countryCode: entry.countryCode });
          }
        }
      }
    } catch {
      // Geo lookup failed — return without country info
    }
  }

  return result;
}

export async function getNginxConnectedIps(domain: string): Promise<ConnectedIpInfo[]> {
  try {
    const container = docker.getContainer(config.nginxContainerName);
    const logs = await container.logs({
      stdout: true,
      stderr: false,
      tail: 2000,
    });
    const logStr = logs.toString('utf-8');
    const ipSet = new Set<string>();
    const blacklisted = new Set(store.getBlacklistedIps());
    // Log format: "<ip> [<date>] <domain> <status>"
    // Docker stream header (8 bytes) may prefix each line
    for (const line of logStr.split('\n')) {
      if (!line.includes(domain)) continue;
      const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (match) {
        const ip = match[1];
        if (
          !ip.startsWith('127.') &&
          !ip.startsWith('172.') &&
          !ip.startsWith('10.') &&
          !ip.startsWith('192.168.') &&
          ip !== '0.0.0.0' &&
          !isTelegramIp(ip) &&
          !blacklisted.has(ip)
        ) {
          ipSet.add(ip);
        }
      }
    }

    const ips = Array.from(ipSet);
    const geoMap = await lookupGeo(ips);

    return ips.map((ip) => {
      const geo = geoMap.get(ip);
      return {
        ip,
        country: geo?.country,
        countryCode: geo?.countryCode,
      };
    });
  } catch {
    return [];
  }
}

function createTarBuffer(filename: string, content: string): Buffer {
  const contentBuffer = Buffer.from(content, 'utf-8');
  const header = Buffer.alloc(512);

  // Filename
  header.write(filename, 0, 100);
  // File mode
  header.write('0000644\0', 100, 8);
  // Owner UID
  header.write('0000000\0', 108, 8);
  // Group GID
  header.write('0000000\0', 116, 8);
  // File size in octal
  header.write(contentBuffer.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  // Modification time
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  // Blank checksum
  header.write('        ', 148, 8);
  // Type flag - normal file
  header.write('0', 156, 1);

  // Calculate checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);

  // Pad content to 512-byte boundary
  const padding = 512 - (contentBuffer.length % 512);
  const paddingBuffer = padding < 512 ? Buffer.alloc(padding) : Buffer.alloc(0);
  const endBlock = Buffer.alloc(1024);

  return Buffer.concat([header, contentBuffer, paddingBuffer, endBlock]);
}

// --- Real-time IP watcher via nginx log streaming ---

// Cache domain→proxyId to avoid reading disk on every log line
let domainToProxyCache: Map<string, string> = new Map();
let domainCacheTs = 0;

function getProxyIdByDomain(domain: string): string | undefined {
  if (Date.now() - domainCacheTs > 30000) {
    const proxies = store.getAllProxies();
    domainToProxyCache = new Map(proxies.map((p) => [p.domain, p.id]));
    domainCacheTs = Date.now();
  }
  return domainToProxyCache.get(domain);
}

function processNginxLogLine(line: string): void {
  // Log format: "<ip> [<date>] <domain> <status>"
  const match = line.match(
    /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+\[.*?\]\s+(\S+)/
  );
  if (!match) return;
  const [, ip, domain] = match;

  if (
    ip.startsWith('127.') ||
    ip.startsWith('172.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip === '0.0.0.0' ||
    isTelegramIp(ip)
  ) return;

  if (domain === '-' || domain === '') return;

  const proxyId = getProxyIdByDomain(domain);
  if (!proxyId) return;

  if (store.getBlacklistedIps().includes(ip)) return;

  // Geo lookup is async; record immediately without geo, then update with geo
  store.updateIpHistory(proxyId, [{ ip }]);
  lookupGeo([ip]).then((geoMap) => {
    const geo = geoMap.get(ip);
    if (geo) store.updateIpHistory(proxyId, [{ ip, country: geo.country, countryCode: geo.countryCode }]);
  }).catch(() => {});
}

async function watchNginxLogs(): Promise<void> {
  const container = docker.getContainer(config.nginxContainerName);
  const stream = await container.logs({
    follow: true,
    stdout: true,
    stderr: false,
    since: Math.floor(Date.now() / 1000),
  }) as unknown as NodeJS.ReadableStream;

  let buf = '';
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      // Docker log stream has 8-byte frame headers; strip control chars and parse lines
      buf += chunk.toString('utf-8').replace(/[\x00-\x08\x0e-\x1f]/g, '');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) processNginxLogLine(trimmed);
      }
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

export function startNginxLogWatcher(): void {
  const reconnect = (delay = 0) => {
    setTimeout(async () => {
      try {
        await watchNginxLogs();
      } catch {
        // container not ready yet or stream ended — will retry
      }
      reconnect(5000);
    }, delay);
  };
  reconnect(3000); // small initial delay to let nginx fully start
}
