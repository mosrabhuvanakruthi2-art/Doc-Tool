// Tiered rate limiting.
//
// A global limiter caps every /api request; tighter limiters guard the
// brute-forceable auth routes and the resource-heavy upload routes. When
// REDIS_URL is set the counters live in Redis so limits hold across multiple
// server instances; otherwise they fall back to per-process memory (fine for a
// single instance).
const rateLimit = require('express-rate-limit');

let store;
if (process.env.REDIS_URL) {
  try {
    const { RedisStore } = require('rate-limit-redis');
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (e) => console.error('[rate-limit redis]', e.message));
    client.connect().catch((e) => console.error('[rate-limit redis connect]', e.message));
    store = new RedisStore({ sendCommand: (...args) => client.sendCommand(args) });
  } catch (e) {
    console.error('[rate-limit] Redis requested but unavailable, using memory:', e.message);
  }
}

const common = {
  standardHeaders: true,
  legacyHeaders: false,
  ...(store ? { store } : {}),
};

// Every API request. Generous for a normal admin session; blocks floods/scrapers.
const globalLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GLOBAL || 200),
  message: { error: 'Too many requests. Please slow down.' },
});

// Uploads: expensive (disk + parsing), so a much lower ceiling.
const uploadLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_UPLOAD || 120),
  message: { error: 'Upload rate exceeded. Please wait a moment.' },
});

// Authentication: brute-force protection.
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH || 20),
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

module.exports = { globalLimiter, uploadLimiter, authLimiter };
