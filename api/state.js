import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const token = req.headers['x-sync-token'];
  if (!token || typeof token !== 'string' || token.length < 8 || token.length > 128) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  const key = `state:${token}`;

  if (req.method === 'GET') {
    const raw = await redis.get(key);
    if (!raw) return res.status(200).json({ state: null, updatedAt: null });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Body required' });
    }
    const updatedAt = Date.now();
    await redis.set(key, JSON.stringify({ state: req.body, updatedAt }));
    return res.status(200).json({ ok: true, updatedAt });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
