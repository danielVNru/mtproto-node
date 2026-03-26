import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { ProxyConfig, StoreData, StatsSnapshot, StatsHistoryData, IpHistoryEntry, IpHistoryData } from '../types';

const STORE_FILE = path.join(config.dataDir, 'store.json');

function ensureDataDir(): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

function readStore(): StoreData {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) {
    const initial: StoreData = { proxies: [] };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const data = fs.readFileSync(STORE_FILE, 'utf-8');
  return JSON.parse(data);
}

function writeStore(data: StoreData): void {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

export function getAllProxies(): ProxyConfig[] {
  return readStore().proxies;
}

export function getProxyById(id: string): ProxyConfig | undefined {
  return readStore().proxies.find((p) => p.id === id);
}

export function addProxy(proxy: ProxyConfig): void {
  const store = readStore();
  store.proxies.push(proxy);
  writeStore(store);
}

export function updateProxy(id: string, updates: Partial<ProxyConfig>): ProxyConfig | undefined {
  const store = readStore();
  const index = store.proxies.findIndex((p) => p.id === id);
  if (index === -1) return undefined;
  store.proxies[index] = { ...store.proxies[index], ...updates };
  writeStore(store);
  return store.proxies[index];
}

export function removeProxy(id: string): boolean {
  const store = readStore();
  const index = store.proxies.findIndex((p) => p.id === id);
  if (index === -1) return false;
  store.proxies.splice(index, 1);
  writeStore(store);
  return true;
}

export function isPortUsed(port: number): boolean {
  return readStore().proxies.some((p) => p.port === port);
}

export function isDomainUsed(domain: string): boolean {
  return readStore().proxies.some((p) => p.domain === domain);
}

export function getUsedDomains(): string[] {
  return readStore().proxies.map((p) => p.domain);
}

export function getCustomDomains(): string[] {
  return readStore().customDomains || [];
}

export function setCustomDomains(domains: string[]): void {
  const store = readStore();
  store.customDomains = domains;
  writeStore(store);
}

export function getBlacklistedIps(): string[] {
  return readStore().blacklistedIps || [];
}

export function setBlacklistedIps(ips: string[]): void {
  const store = readStore();
  store.blacklistedIps = ips;
  writeStore(store);
}

// --- Stats History (separate file) ---

const STATS_HISTORY_FILE = path.join(config.dataDir, 'stats-history.json');
const STATS_SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_SNAPSHOTS_PER_PROXY = 2016; // ~7 days at 5-min intervals

function readStatsHistory(): StatsHistoryData {
  ensureDataDir();
  if (!fs.existsSync(STATS_HISTORY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATS_HISTORY_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeStatsHistory(data: StatsHistoryData): void {
  ensureDataDir();
  fs.writeFileSync(STATS_HISTORY_FILE, JSON.stringify(data));
}

export function addStatsSnapshot(proxyId: string, snapshot: StatsSnapshot): void {
  const history = readStatsHistory();
  if (!history[proxyId]) history[proxyId] = [];
  const arr = history[proxyId];

  // Only save if enough time has passed since last snapshot
  if (arr.length > 0) {
    const lastTs = new Date(arr[arr.length - 1].timestamp).getTime();
    if (Date.now() - lastTs < STATS_SNAPSHOT_INTERVAL) return;
  }

  arr.push(snapshot);

  // Trim old entries
  if (arr.length > MAX_SNAPSHOTS_PER_PROXY) {
    history[proxyId] = arr.slice(-MAX_SNAPSHOTS_PER_PROXY);
  }

  writeStatsHistory(history);
}

export function getStatsHistory(proxyId: string): StatsSnapshot[] {
  const history = readStatsHistory();
  return history[proxyId] || [];
}

export function removeStatsHistory(proxyId: string): void {
  const history = readStatsHistory();
  delete history[proxyId];
  writeStatsHistory(history);
}

// --- IP History (separate file) ---

const IP_HISTORY_FILE = path.join(config.dataDir, 'ip-history.json');

function readIpHistory(): IpHistoryData {
  ensureDataDir();
  if (!fs.existsSync(IP_HISTORY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(IP_HISTORY_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeIpHistory(data: IpHistoryData): void {
  ensureDataDir();
  fs.writeFileSync(IP_HISTORY_FILE, JSON.stringify(data));
}

export function updateIpHistory(proxyId: string, connectedIps: { ip: string; country?: string; countryCode?: string }[]): void {
  const history = readIpHistory();
  if (!history[proxyId]) history[proxyId] = [];
  const arr = history[proxyId];
  const now = new Date().toISOString();

  for (const info of connectedIps) {
    const existing = arr.find((e) => e.ip === info.ip);
    if (existing) {
      existing.lastSeen = now;
      if (info.country) existing.country = info.country;
      if (info.countryCode) existing.countryCode = info.countryCode;
    } else {
      arr.push({
        ip: info.ip,
        country: info.country,
        countryCode: info.countryCode,
        firstSeen: now,
        lastSeen: now,
      });
    }
  }

  writeIpHistory(history);
}

export function getIpHistory(proxyId: string): IpHistoryEntry[] {
  const history = readIpHistory();
  return history[proxyId] || [];
}

export function removeIpHistory(proxyId: string): void {
  const history = readIpHistory();
  delete history[proxyId];
  writeIpHistory(history);
}
