import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '8443', 10),
  nginxPort: parseInt(process.env.NGINX_PORT || '443', 10),
  authToken: process.env.AUTH_TOKEN || '',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  dockerNetwork: 'mtproto-net',
  nginxContainerName: 'mtproto-nginx',
  proxyImageName: 'telemt-proxy-v2',
  proxyContainerPrefix: 'mtproto-proxy-',
  xrayContainerPrefix: 'mtproto-xray-',
  portRangeStart: 10001,
  portRangeEnd: 19999,
};

export const FAKE_TLS_DOMAINS = [
  // Google
  'www.google.com',
  'ajax.googleapis.com',
  'fonts.googleapis.com',
  'update.googleapis.com',
  'maps.googleapis.com',
  'play.google.com',
  'apis.google.com',
  'accounts.google.com',
  'ssl.gstatic.com',
  'fonts.gstatic.com',
  // Microsoft
  'www.microsoft.com',
  'login.microsoftonline.com',
  'graph.microsoft.com',
  'outlook.office365.com',
  'cdn.office.net',
  'www.bing.com',
  'assets.msn.com',
  // Apple
  'www.apple.com',
  'support.apple.com',
  'developer.apple.com',
  // CDN / Infra
  'www.cloudflare.com',
  'cdnjs.cloudflare.com',
  'static.cloudflareinsights.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdn.akamai.com',
  'fastly.net',
  // Social / Media
  'www.youtube.com',
  'www.instagram.com',
  'www.facebook.com',
  'static.xx.fbcdn.net',
  'abs.twimg.com',
  'pbs.twimg.com',
  'www.reddit.com',
  'www.linkedin.com',
  // E-commerce / Services
  'www.amazon.com',
  'images-na.ssl-images-amazon.com',
  'www.ebay.com',
  'www.paypal.com',
  // Dev / Tech
  'www.github.com',
  'raw.githubusercontent.com',
  'stackoverflow.com',
  'cdn.stackoverflow.com',
  // Reference
  'www.wikipedia.org',
  'en.wikipedia.org',
  'upload.wikimedia.org',
  // News / Other
  'www.bbc.com',
  'www.reuters.com',
  'www.nytimes.com',
  'www.theguardian.com',
  'www.forbes.com',
];
