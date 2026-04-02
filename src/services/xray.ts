import Docker from 'dockerode';
import { config } from '../config';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const XRAY_IMAGE = 'teddysun/xray';

export interface VlessConfig {
  uuid: string;
  host: string;
  port: number;
  security: string; // 'none' | 'tls' | 'reality'
  network: string;  // 'tcp' | 'ws' | 'grpc'
  sni: string;
  fingerprint: string;
  publicKey?: string; // REALITY public key
  shortId?: string;   // REALITY short ID
  flow?: string;
  wsPath?: string;
  wsHost?: string;
  grpcServiceName?: string;
}

export async function fetchAndParseSubscription(url: string): Promise<VlessConfig | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!resp.ok) return null;

    let content = (await resp.text()).trim();

    // Try base64 decode (common subscription format)
    try {
      const decoded = Buffer.from(content, 'base64').toString('utf-8');
      if (decoded.includes('vless://') || decoded.includes('vmess://')) {
        content = decoded;
      }
    } catch {}

    const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('vless://'));
    if (lines.length === 0) return null;

    return parseVlessUri(lines[0]);
  } catch {
    return null;
  }
}

function parseVlessUri(uri: string): VlessConfig | null {
  try {
    // vless://uuid@host:port?params#name
    const withoutScheme = uri.slice('vless://'.length);
    const atIdx = withoutScheme.lastIndexOf('@');
    const userinfo = withoutScheme.slice(0, atIdx);
    const rest = withoutScheme.slice(atIdx + 1);

    const hashIdx = rest.indexOf('#');
    const restNoHash = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;

    const qIdx = restNoHash.indexOf('?');
    const hostPart = qIdx >= 0 ? restNoHash.slice(0, qIdx) : restNoHash;
    const queryStr = qIdx >= 0 ? restNoHash.slice(qIdx + 1) : '';

    // Handle IPv6 addresses like [::1]:443
    let host: string;
    let portStr: string;
    if (hostPart.startsWith('[')) {
      const closeIdx = hostPart.indexOf(']');
      host = hostPart.slice(1, closeIdx);
      portStr = hostPart.slice(closeIdx + 2);
    } else {
      const colonIdx = hostPart.lastIndexOf(':');
      host = hostPart.slice(0, colonIdx);
      portStr = hostPart.slice(colonIdx + 1);
    }

    const port = parseInt(portStr) || 443;
    const uuid = decodeURIComponent(userinfo);
    const params = new URLSearchParams(queryStr);

    const security = params.get('security') || 'none';
    const network = params.get('type') || params.get('network') || 'tcp';
    const sni = params.get('sni') || params.get('peer') || params.get('servername') || host;
    const fingerprint = params.get('fp') || 'chrome';
    const publicKey = params.get('pbk') || undefined;
    const shortId = params.get('sid') || undefined;
    const flow = params.get('flow') || undefined;
    const wsPath = params.get('path') || '/';
    const wsHost = params.get('host') || sni;
    const grpcServiceName = params.get('serviceName') || params.get('mode') || '';

    return { uuid, host, port, security, network, sni, fingerprint, publicKey, shortId, flow, wsPath, wsHost, grpcServiceName };
  } catch {
    return null;
  }
}

function generateXrayConfig(vless: VlessConfig): string {
  const net = vless.network === 'ws' ? 'ws' : vless.network === 'grpc' ? 'grpc' : 'tcp';
  const streamSettings: Record<string, any> = { network: net };

  if (net === 'ws') {
    streamSettings.wsSettings = {
      path: vless.wsPath || '/',
      headers: { Host: vless.wsHost || vless.sni },
    };
  } else if (net === 'grpc') {
    streamSettings.grpcSettings = { serviceName: vless.grpcServiceName || '' };
  }

  if (vless.security === 'reality') {
    streamSettings.security = 'reality';
    streamSettings.realitySettings = {
      serverName: vless.sni,
      fingerprint: vless.fingerprint || 'chrome',
      publicKey: vless.publicKey || '',
      shortId: vless.shortId || '',
    };
  } else if (vless.security === 'tls') {
    streamSettings.security = 'tls';
    streamSettings.tlsSettings = {
      serverName: vless.sni,
      fingerprint: vless.fingerprint || 'chrome',
      allowInsecure: false,
    };
  }

  const outboundUser: Record<string, any> = {
    id: vless.uuid,
    encryption: 'none',
  };
  if (vless.flow) outboundUser.flow = vless.flow;

  const xrayConfig = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        listen: '0.0.0.0',
        port: 10808,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: false },
      },
    ],
    outbounds: [
      {
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: vless.host,
              port: vless.port,
              users: [outboundUser],
            },
          ],
        },
        streamSettings,
      },
    ],
  };

  return JSON.stringify(xrayConfig, null, 2);
}

async function pullXrayImage(): Promise<void> {
  try {
    await docker.getImage(XRAY_IMAGE).inspect();
  } catch {
    await new Promise<void>((resolve, reject) => {
      docker.pull(XRAY_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err2: Error | null) => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
  }
}

export async function createXrayContainer(containerName: string, vless: VlessConfig): Promise<void> {
  await pullXrayImage();

  const container = await docker.createContainer({
    Image: XRAY_IMAGE,
    name: containerName,
    HostConfig: {
      NetworkMode: config.dockerNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
    },
    ExposedPorts: { '10808/tcp': {} },
  });

  const configContent = generateXrayConfig(vless);
  const tarBuf = createTarBuffer('config.json', configContent);
  await container.putArchive(tarBuf, { path: '/etc/xray' });

  await container.start();
  console.log(`xray container ${containerName} started`);
}

export async function removeXrayContainer(containerName: string): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    try { await container.stop(); } catch {}
    await container.remove();
  } catch {
    // Container might not exist
  }
}

function createTarBuffer(filename: string, content: string): Buffer {
  const contentBuffer = Buffer.from(content, 'utf-8');
  const header = Buffer.alloc(512);
  header.write(filename, 0, 100);
  header.write('0000644\0', 100, 8);
  header.write('0000000\0', 108, 8);
  header.write('0000000\0', 116, 8);
  header.write(contentBuffer.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  header.write('        ', 148, 8);
  header.write('0', 156, 1);
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  const padding = 512 - (contentBuffer.length % 512);
  const paddingBuffer = padding < 512 ? Buffer.alloc(padding) : Buffer.alloc(0);
  const endBlock = Buffer.alloc(1024);
  return Buffer.concat([header, contentBuffer, paddingBuffer, endBlock]);
}
