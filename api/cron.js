import { Redis } from '@upstash/redis';
import webpush from 'web-push';

const redis = Redis.fromEnv();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:mfransdonk@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  // Two crons fire (08:00 and 09:00 UTC) to cover both CET and CEST.
  // Only the one that hits 10:00 Amsterdam local sends.
  const hourAms = parseInt(
    new Date().toLocaleString('en-US', {
      timeZone: 'Europe/Amsterdam',
      hour: 'numeric',
      hour12: false,
    }),
    10
  );
  if (hourAms !== 10) {
    return res.status(200).json({ skipped: true, hourAms });
  }

  const subs = (await redis.hgetall('subscriptions')) || {};
  const payload = JSON.stringify({
    title: 'Hero Training',
    body: "Check today's daily challenge in the app",
    url: '/',
  });

  let sent = 0;
  let failed = 0;
  for (const [id, subStr] of Object.entries(subs)) {
    try {
      const sub = typeof subStr === 'string' ? JSON.parse(subStr) : subStr;
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        await redis.hdel('subscriptions', id);
      }
    }
  }

  return res.status(200).json({ sent, failed });
}
