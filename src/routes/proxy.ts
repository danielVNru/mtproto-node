import { Router, Request, Response } from 'express';
import * as proxyService from '../services/proxy';

const router = Router();

// List all proxies
router.get('/', async (_req: Request, res: Response) => {
  try {
    const proxies = await proxyService.listProxies();
    res.json(proxies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create proxy
router.post('/', async (req: Request, res: Response) => {
  try {
    const proxy = await proxyService.createProxy(req.body);
    res.status(201).json(proxy);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Get proxy by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const proxy = await proxyService.getProxy(req.params.id);
    if (!proxy) {
      res.status(404).json({ error: 'Proxy not found' });
      return;
    }
    res.json(proxy);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update proxy
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const proxy = await proxyService.updateProxy(req.params.id, req.body);
    if (!proxy) {
      res.status(404).json({ error: 'Proxy not found' });
      return;
    }
    res.json(proxy);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Delete proxy
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await proxyService.deleteProxy(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Proxy not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Restart proxy
router.post('/:id/restart', async (req: Request, res: Response) => {
  try {
    const proxy = await proxyService.restartProxy(req.params.id);
    if (!proxy) {
      res.status(404).json({ error: 'Proxy not found' });
      return;
    }
    res.json(proxy);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get proxy stats
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const stats = await proxyService.getProxyStats(req.params.id);
    if (!stats) {
      res.status(404).json({ error: 'Proxy not found' });
      return;
    }
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get proxy link
router.get('/:id/link', async (req: Request, res: Response) => {
  const serverIp = req.query.server_ip as string;
  if (!serverIp) {
    res.status(400).json({ error: 'server_ip query parameter is required' });
    return;
  }

  const link = proxyService.getProxyLink(req.params.id, serverIp);
  if (!link) {
    res.status(404).json({ error: 'Proxy not found' });
    return;
  }
  res.json({ link });
});

export default router;
