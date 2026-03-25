import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { ProxyConfig, StoreData } from '../types';

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
