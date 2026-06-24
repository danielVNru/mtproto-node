import Docker from 'dockerode';
import { config } from '../config';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const XRAY_IMAGE = 'teddysun/xray';

export interface VlessConfig {
  uuid: string;
  host: string;
  port: number;
  security: string; // 'none' | 'tls' | 'reality'
  network: string;  // 'tcp' | 'ws' | 'grpc' | 'xhttp'
  sni: string;
  fingerprint: string;
  publicKey?: string; // REALITY public key
  shortId?: string;   // REALITY short ID
  flow?: string;
  path?: string;
  hostHeader?: string;
  grpcServiceName?: string;
  mode?: string;
  extra?: Record<string, any>;
  alpn?: string[];
  protocol?: 'vless' | 'trojan'; // default: 'vless'
  password?: string;             // for trojan
}

export async function fetchAndParseSubscription(input: string): Promise<VlessConfig> {
  // Raw vless:// link — parse directly
  if (input.startsWith('vless://')) {
    const cfg = parseVlessUri(input);
    if (!cfg) throw new Error('Failed to parse vless:// link');
    return cfg;
  }
  // Raw trojan:// link — parse directly
  if (input.startsWith('trojan://')) {
    const cfg = parseTrojanUri(input);
    if (!cfg) throw new Error('Failed to parse trojan:// link');
    return cfg;
  }

  let resp: Response;
  try {
    resp = await fetch(input, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
  } catch (err: any) {
    throw new Error(`Не удалось получить подписку: ${err?.message || err}`);
  }

  if (!resp.ok) {
    throw new Error(`Сервер подписки вернул ${resp.status} ${resp.statusText}`);
  }

  let content = (await resp.text()).trim();

  // Try base64 decode (common subscription format)
  try {
    const decoded = Buffer.from(content, 'base64').toString('utf-8');
    if (decoded.includes('vless://') || decoded.includes('vmess://')) {
      content = decoded;
    }
  } catch {}

  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('vless://'));
  const trojanLines = content.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('trojan://'));
  if (lines.length === 0 && trojanLines.length === 0) {
    throw new Error('No vless:// or trojan:// entries found in subscription');
  }

  if (lines.length > 0) {
    const cfg = parseVlessUri(lines[0]);
    if (!cfg) throw new Error('Failed to parse vless:// link from subscription');
    return cfg;
  }
  const cfg = parseTrojanUri(trojanLines[0]);
  if (!cfg) throw new Error('Failed to parse trojan:// link from subscription');
  return cfg;

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
    const networkParam = (params.get('type') || params.get('network') || 'tcp').toLowerCase();
    const network = ['ws', 'grpc', 'xhttp'].includes(networkParam) ? networkParam : 'tcp';
    const sni = params.get('sni') || params.get('peer') || params.get('servername') || host;
    const fingerprint = params.get('fp') || 'chrome';
    const publicKey = params.get('pbk') || undefined;
    const shortId = params.get('sid') || undefined;
    const flow = params.get('flow') || undefined;
    const path = params.get('path') || '/';
    const hostHeader = params.get('host') || sni;
    const grpcServiceName = params.get('serviceName') || params.get('mode') || '';
    const mode = params.get('mode') || undefined;
    const extraRaw = params.get('extra');
    const alpn = params.get('alpn')
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    let extra: Record<string, any> | undefined;
    if (extraRaw) {
      try {
        extra = JSON.parse(extraRaw);
      } catch {
        extra = undefined;
      }
    }

    return {
      uuid,
      host,
      port,
      security,
      network,
      sni,
      fingerprint,
      publicKey,
      shortId,
      flow,
      path,
      hostHeader,
      grpcServiceName,
      mode,
      extra,
      alpn,
    };
  } catch {
    return null;
  }
}

function parseTrojanUri(uri: string): VlessConfig | null {
  try {
    // trojan://password@host:port?params#name
    const withoutScheme = uri.slice('trojan://'.length);
    const hashIdx = withoutScheme.indexOf('#');
    const withoutHash = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;
    const atIdx = withoutHash.lastIndexOf('@');
    const password = decodeURIComponent(withoutHash.slice(0, atIdx));
    const rest = withoutHash.slice(atIdx + 1);
    const qIdx = rest.indexOf('?');
    const hostPart = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
    const queryStr = qIdx >= 0 ? rest.slice(qIdx + 1) : '';

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
    const params = new URLSearchParams(queryStr);
    const security = params.get('security') || 'tls';
    const networkParam = (params.get('type') || params.get('network') || 'tcp').toLowerCase();
    const network = ['ws', 'grpc', 'xhttp'].includes(networkParam) ? networkParam : 'tcp';
    const sni = params.get('sni') || params.get('peer') || params.get('servername') || host;
    const fingerprint = params.get('fp') || 'chrome';
    const publicKey = params.get('pbk') || undefined;
    const shortId = params.get('sid') || undefined;
    const path = params.get('path') || '/';
    const hostHeader = params.get('host') || sni;
    const grpcServiceName = params.get('serviceName') || '';
    const mode = params.get('mode') || undefined;
    const alpnRaw = params.get('alpn');
    const alpn = alpnRaw ? alpnRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    return {
      protocol: 'trojan',
      password,
      uuid: '',
      host,
      port,
      security,
      network,
      sni,
      fingerprint,
      publicKey,
      shortId,
      path,
      hostHeader,
      grpcServiceName,
      mode,
      alpn,
    };
  } catch {
    return null;
  }
}

function generateXrayConfig(vless: VlessConfig): string {
  const net =
    vless.network === 'ws'
      ? 'ws'
      : vless.network === 'grpc'
        ? 'grpc'
        : vless.network === 'xhttp'
          ? 'xhttp'
          : 'tcp';
  const streamSettings: Record<string, any> = { network: net };

  if (net === 'ws') {
    streamSettings.wsSettings = {
      path: vless.path || '/',
      headers: { Host: vless.hostHeader || vless.sni },
    };
  } else if (net === 'grpc') {
    streamSettings.grpcSettings = { serviceName: vless.grpcServiceName || '' };
  } else if (net === 'xhttp') {
    const xhttpSettings: Record<string, any> = {
      path: vless.path || '/',
    };

    if (vless.hostHeader) xhttpSettings.host = vless.hostHeader;
    if (vless.mode) xhttpSettings.mode = vless.mode;
    if (vless.extra) xhttpSettings.extra = vless.extra;

    streamSettings.xhttpSettings = xhttpSettings;
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
    if (vless.alpn?.length) {
      streamSettings.tlsSettings.alpn = vless.alpn;
    }
  }

  const outbound =
    vless.protocol === 'trojan'
      ? {
          protocol: 'trojan',
          settings: {
            servers: [
              {
                address: vless.host,
                port: vless.port,
                password: vless.password || '',
              },
            ],
          },
          streamSettings,
        }
      : {
          protocol: 'vless',
          settings: {
            vnext: [
              {
                address: vless.host,
                port: vless.port,
                users: [
                  {
                    id: vless.uuid,
                    encryption: 'none',
                    ...(vless.flow ? { flow: vless.flow } : {}),
                  },
                ],
              },
            ],
          },
          streamSettings,
        };

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
    outbounds: [outbound],
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
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': '5m', 'max-file': '2' },
      },
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

/**
 * Called on bootstrap: ensures all xray containers are running before telemt
 * containers start. Without this, after a server reboot telemt may start before
 * xray is ready and proxychains fails to connect — requiring a manual config save.
 */
export async function ensureXrayContainersRunning(containerNames: string[]): Promise<void> {
  const toStart: string[] = [];

  for (const name of containerNames) {
    try {
      const container = docker.getContainer(name);
      const info = await container.inspect();
      if (!info.State.Running) {
        await container.start();
        toStart.push(name);
        console.log(`Started xray container ${name}`);
      }
    } catch (err: any) {
      console.error(`Could not ensure xray container ${name}:`, err.message);
    }
  }

  // Give xray containers a moment to bind their SOCKS5 port before telemt connects
  if (toStart.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
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
