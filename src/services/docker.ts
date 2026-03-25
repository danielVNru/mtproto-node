import Docker from 'dockerode';
import { config } from '../config';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export async function ensureNetwork(): Promise<void> {
  try {
    const network = docker.getNetwork(config.dockerNetwork);
    await network.inspect();
  } catch {
    await docker.createNetwork({
      Name: config.dockerNetwork,
      Driver: 'bridge',
    });
  }
}

export async function pullImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
  } catch {
    await new Promise<void>((resolve, reject) => {
      docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err2: Error | null) => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
  }
}

export async function createProxyContainer(
  containerName: string,
  secret: string,
  domain: string,
  tag?: string
): Promise<string> {
  await ensureNetwork();
  await pullImage(config.proxyImage);

  const cmd = ['/bin/start.sh', '-p', '443', '-s', secret, '-a', 'tls'];
  if (tag) {
    cmd.push('-t', tag);
  }

  const container = await docker.createContainer({
    Image: config.proxyImage,
    name: containerName,
    Cmd: cmd,
    HostConfig: {
      NetworkMode: config.dockerNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });

  await container.start();
  return container.id;
}

export async function removeProxyContainer(containerName: string): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    try {
      await container.stop();
    } catch {
      // Container might already be stopped
    }
    await container.remove();
  } catch {
    // Container might not exist
  }
}

export async function getContainerStats(containerName: string): Promise<{
  cpuPercent: string;
  memoryUsage: string;
  memoryLimit: string;
  networkRx: string;
  networkTx: string;
  networkRxBytes: number;
  networkTxBytes: number;
}> {
  const container = docker.getContainer(containerName);
  const stats = await container.stats({ stream: false });

  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  const cpuPercent = systemDelta > 0 ? ((cpuDelta / systemDelta) * cpuCount * 100).toFixed(2) : '0.00';

  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 0;

  let netRx = 0;
  let netTx = 0;
  if (stats.networks) {
    for (const iface of Object.values(stats.networks) as any[]) {
      netRx += iface.rx_bytes || 0;
      netTx += iface.tx_bytes || 0;
    }
  }

  return {
    cpuPercent: `${cpuPercent}%`,
    memoryUsage: formatBytes(memUsage),
    memoryLimit: formatBytes(memLimit),
    networkRx: formatBytes(netRx),
    networkTx: formatBytes(netTx),
    networkRxBytes: netRx,
    networkTxBytes: netTx,
  };
}

export async function getContainerStatus(containerName: string): Promise<string> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    return info.State.Status;
  } catch {
    return 'not_found';
  }
}

export async function getContainerUptime(containerName: string): Promise<string> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    const startedAt = new Date(info.State.StartedAt);
    const now = new Date();
    const diff = now.getTime() - startedAt.getTime();
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  } catch {
    return 'unknown';
  }
}

export async function restartContainer(containerName: string): Promise<void> {
  const container = docker.getContainer(containerName);
  await container.restart();
}

export async function connectContainerToNetwork(containerName: string): Promise<void> {
  const network = docker.getNetwork(config.dockerNetwork);
  await network.connect({ Container: containerName });
}

export async function getContainerConnectedIps(containerName: string): Promise<string[]> {
  try {
    const container = docker.getContainer(containerName);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 500,
    });
    const logStr = logs.toString('utf-8');
    const ipSet = new Set<string>();
    const ipRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
    let match;
    while ((match = ipRegex.exec(logStr)) !== null) {
      const ip = match[1];
      // Filter out common non-client IPs
      if (!ip.startsWith('127.') && !ip.startsWith('172.') && !ip.startsWith('10.') && ip !== '0.0.0.0') {
        ipSet.add(ip);
      }
    }
    return Array.from(ipSet);
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
