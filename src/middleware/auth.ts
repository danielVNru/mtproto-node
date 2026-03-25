import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.slice(7);

  if (!config.authToken) {
    res.status(500).json({ error: 'Server auth token not configured' });
    return;
  }

  if (token.length !== config.authToken.length) {
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ config.authToken.charCodeAt(i);
  }

  if (mismatch !== 0) {
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  next();
}
