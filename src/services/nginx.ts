import Docker from 'dockerode';
import { config } from '../config';
import { ProxyConfig } from '../types';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export function generateNginxConfig(proxies: ProxyConfig[]): string {
  const mapEntries = proxies
    .filter((p) => p.status === 'running')
    .map((p) => `        ${p.domain} ${p.containerName}:443;`)
    .join('\n');

  const defaultBackend =
    proxies.length > 0 ? `${proxies[0].containerName}:443` : '127.0.0.1:1';

  return `user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
}

stream {
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
  try {
    const container = docker.getContainer(config.nginxContainerName);
    await container.inspect();
  } catch {
    await docker.createContainer({
      Image: 'nginx:alpine',
      name: config.nginxContainerName,
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

    const container = docker.getContainer(config.nginxContainerName);
    await container.start();
  }
}

export async function updateNginxConfig(proxies: ProxyConfig[]): Promise<void> {
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
