import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '8443', 10),
  authToken: process.env.AUTH_TOKEN || '',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  dockerNetwork: 'mtproto-net',
  nginxContainerName: 'mtproto-nginx',
  proxyImage: 'telemt/telemt:latest',
  proxyContainerPrefix: 'mtproto-proxy-',
  portRangeStart: 10001,
  portRangeEnd: 19999,
};

export const FAKE_TLS_DOMAINS = [
  'www.google.com',
  'www.microsoft.com',
  'www.apple.com',
  'www.cloudflare.com',
  'cdnjs.cloudflare.com',
  'ajax.googleapis.com',
  'fonts.googleapis.com',
  'www.wikipedia.org',
  'en.wikipedia.org',
  'www.amazon.com',
  'www.github.com',
  'cdn.jsdelivr.net',
  'www.youtube.com',
  'static.cloudflareinsights.com',
  'update.googleapis.com',
];
