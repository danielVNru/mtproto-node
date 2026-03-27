import Docker from 'dockerode';
import { config } from '../config';
import { ProxyConfig, ConnectedIpInfo } from '../types';
import { pullImage } from './docker';
import * as store from '../store';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export function generateNginxConfig(proxies: ProxyConfig[]): string {
  const runningProxies = proxies.filter((p) => p.status === 'running');

  // Separate proxies into those with and without connection limits
  const limitProxies = runningProxies.filter((p) => p.maxConnections && p.maxConnections > 0);
  const unlimitedProxies = runningProxies.filter((p) => !p.maxConnections || p.maxConnections <= 0);

  // For proxies with limits, assign internal ports starting from 10001
  const limitPortMap = new Map<string, number>();
  limitProxies.forEach((p, i) => {
    limitPortMap.set(p.domain, 10001 + i);
  });

  // Build SNI map: limited proxies → internal port, unlimited → direct backend
  const mapEntries = runningProxies
    .map((p) => {
      const internalPort = limitPortMap.get(p.domain);
      if (internalPort) {
        return `        ${p.domain} 127.0.0.1:${internalPort};`;
      }
      return `        ${p.domain} ${p.containerName}:443;`;
    })
    .join('\n');

  const defaultBackend =
    runningProxies.length > 0 ? `${runningProxies[0].containerName}:443` : '127.0.0.1:1';

  // Blacklisted IPs
  const blacklistedIps = store.getBlacklistedIps();
  const denyEntries = blacklistedIps.map((ip) => `        deny ${ip};`).join('\n');

  // Main server block (SNI routing on port 443)
  const mainServer = `    server {
        listen 443;
        proxy_pass $backend;
        ssl_preread on;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
${denyEntries ? denyEntries + '\n' : ''}    }`;

  // Per-domain limit server blocks on internal ports
  const limitBlocks = limitProxies
    .map((p) => {
      const zoneName = p.domain.replace(/\./g, '_');
      const internalPort = limitPortMap.get(p.domain)!;
      return `    limit_conn_zone $remote_addr zone=${zoneName}:1m;
    server {
        listen 127.0.0.1:${internalPort};
        proxy_pass ${p.containerName}:443;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
        limit_conn ${zoneName} ${p.maxConnections};
    }`;
    })
    .join('\n\n');

  return `user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
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

${limitBlocks ? limitBlocks + '\n' : ''}}
`;
}

export async function ensureNginxContainer(): Promise<void> {
  const containerName = config.nginxContainerName;

  // Remove any existing container that might be misconfigured
  try {
    const existing = docker.getContainer(containerName);
    const info = await existing.inspect();

    // Check if port 443 is properly bound
    const portBindings = info.HostConfig?.PortBindings?.['443/tcp'];
    const hasPort443 = Array.isArray(portBindings) && portBindings.some(
      (b: { HostPort?: string }) => b.HostPort === '443'
    );

    if (hasPort443 && info.State.Running) {
      return; // Container is healthy
    }

    if (hasPort443 && !info.State.Running) {
      // Right config, just not running — inject config and start
      const initialConf = generateNginxConfig([]);
      const tar = createTarBuffer('nginx.conf', initialConf);
      await existing.putArchive(tar, { path: '/etc/nginx' });
      await existing.start();
      return;
    }

    // Wrong port config — remove and recreate
    await existing.remove({ force: true });
  } catch {
    // Container doesn't exist — will create below
  }

  // Pull image if needed
  await pullImage('nginx:latest');

  // Create container (not started yet)
  const container = await docker.createContainer({
    Image: 'nginx:latest',
    name: containerName,
    HostConfig: {
      PortBindings: {
        '443/tcp': [{ HostPort: '443' }],
      },
      NetworkMode: config.dockerNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
    },
    ExposedPorts: {
      '443/tcp': {},
    },
  });

  // Inject stream config BEFORE starting so nginx starts with the correct config
  const initialConf = generateNginxConfig([]);
  const tar = createTarBuffer('nginx.conf', initialConf);
  await container.putArchive(tar, { path: '/etc/nginx' });

  await container.start();
  console.log('nginx container created and started with stream config on port 443');
}

export async function updateNginxConfig(proxies: ProxyConfig[]): Promise<void> {
  // Ensure nginx is up before updating
  await ensureNginxContainer();

  const nginxConf = generateNginxConfig(proxies);
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
