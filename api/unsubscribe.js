import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const id = Buffer.from(endpoint).toString('base64').slice(0, 48);
  await redis.hdel('subscriptions', id);
  return res.status(200).json({ ok: true });
}
