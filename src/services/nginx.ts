import Docker from 'dockerode';
import { config } from '../config';
import { ProxyConfig } from '../types';
import { pullImage } from './docker';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export function generateNginxConfig(proxies: ProxyConfig[]): string {
  const runningProxies = proxies.filter((p) => p.status === 'running');
  const mapEntries = runningProxies
    .map((p) => `        ${p.domain} ${p.containerName}:443;`)
    .join('\n');

  const defaultBackend =
    runningProxies.length > 0 ? `${runningProxies[0].containerName}:443` : '127.0.0.1:1';

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

    server {
        listen 443;
        proxy_pass $backend;
        ssl_preread on;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
    }
}
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

export async function getNginxConnectedIps(domain: string): Promise<string[]> {
  try {
    const container = docker.getContainer(config.nginxContainerName);
    const logs = await container.logs({
      stdout: true,
      stderr: false,
      tail: 2000,
    });
    const logStr = logs.toString('utf-8');
    const ipSet = new Set<string>();
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
          !isTelegramIp(ip)
        ) {
          ipSet.add(ip);
        }
      }
    }
    return Array.from(ipSet);
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
