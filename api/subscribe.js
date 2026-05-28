import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

  const id = Buffer.from(sub.endpoint).toString('base64').slice(0, 48);
  await redis.hset('subscriptions', { [id]: JSON.stringify(sub) });
  return res.status(200).json({ ok: true });
}
