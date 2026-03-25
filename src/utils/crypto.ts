import crypto from 'crypto';

export function generateSecret(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function buildFullSecret(secret: string, domain: string): string {
  const domainHex = Buffer.from(domain, 'utf-8').toString('hex');
  return 'ee' + secret + domainHex;
}

export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

export function getRandomPort(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
