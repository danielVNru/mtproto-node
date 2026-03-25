import express from 'express';
import cors from 'cors';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import proxyRoutes from './routes/proxy';
import healthRoutes from './routes/health';
import { ensureNetwork } from './services/docker';
import { ensureNginxContainer, updateNginxConfig } from './services/nginx';
import { getAllProxies } from './store';

const app = express();

app.use(cors());
app.use(express.json());

// Health check (no auth)
app.use('/api/health', healthRoutes);

// Protected routes
app.use('/api/proxies', authMiddleware, proxyRoutes);

async function bootstrap(): Promise<void> {
  try {
    console.log('Initializing Docker network...');
    await ensureNetwork();

    console.log('Initializing nginx container...');
    await ensureNginxContainer();

    const proxies = getAllProxies();
    if (proxies.length > 0) {
      console.log(`Restoring nginx config for ${proxies.length} proxies...`);
      await updateNginxConfig(proxies);
    }

    app.listen(config.port, '0.0.0.0', () => {
      console.log(`Service node running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start service node:', error);
    process.exit(1);
  }
}

bootstrap();
