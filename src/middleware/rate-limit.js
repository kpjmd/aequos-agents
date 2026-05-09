/**
 * Rate limiting tiers.
 *
 * All limiters key on X-API-Key when present, falling back to IP.
 * Memory store is correct for single-instance Railway. If/when scaling
 * out to multiple instances, swap to a Redis store (e.g. rate-limit-redis).
 *
 * Tiers:
 *   strict  — cost-amplifying LLM endpoints (5/min per key)
 *   medium  — state-mutating / polling endpoints (30/min per IP)
 *   loose   — read-only endpoints (120/min per IP)
 */

import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

// Key on X-API-Key when present, falling back to IP (using the library's
// IPv6-safe ipKeyGenerator to avoid ERR_ERL_KEY_GEN_IPV6 validation errors)
const keyGenerator = (req) => req.headers['x-api-key'] ?? ipKeyGenerator(req);

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', retryAfterSeconds: 60 },
});

export const mediumLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', retryAfterSeconds: 60 },
});

export const looseLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', retryAfterSeconds: 60 },
});
