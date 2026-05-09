/**
 * User identity middleware for /recovery/* routes.
 *
 * Farcaster path: verifies Authorization: Bearer <jwt> via @farcaster/quick-auth
 *   → req.user = { type: 'farcaster', identity: 'fid:<sub>' }
 * Web path: reads trusted X-User-Id: web:<uuid> forwarded by the Next.js BFF
 *   → req.user = { type: 'web', identity: 'web:<uuid>' }
 *
 * Must run after requireApiKey (reads req.auth.keyName to branch).
 * JWT verification results are cached by jti for the JWT lifetime to avoid
 * repeated remote-JWKS round-trips on update polling.
 */

import { createClient } from '@farcaster/quick-auth';

const farcasterClient = createClient();
const WEB_UUID_RE = /^web:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// jti → { identity, expiresAt } — simple in-process cache; safe for single-instance Railway
const jwtCache = new Map();

// Prune expired entries lazily (once per 50 calls on average)
function maybeEvictExpired() {
  if (Math.random() > 0.02) return;
  const now = Date.now();
  for (const [jti, entry] of jwtCache) {
    if (entry.expiresAt <= now) jwtCache.delete(jti);
  }
}

async function verifyFarcasterJwt(token) {
  // Quick path: decode header/payload to check cache before hitting JWKS endpoint
  const [, payloadB64] = token.split('.');
  let jti, exp;
  try {
    const raw = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    jti = raw.jti;
    exp = raw.exp;
  } catch {
    // Malformed — fall through to full verify which will reject it
  }

  if (jti) {
    maybeEvictExpired();
    const cached = jwtCache.get(jti);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.identity;
    }
  }

  const domain = process.env.FARCASTER_AUTH_DOMAIN;
  if (!domain) {
    throw new Error('FARCASTER_AUTH_DOMAIN env var is required for JWT verification');
  }

  const payload = await farcasterClient.verifyJwt({ token, domain });
  const sub = payload.sub;
  if (!sub) throw new Error('JWT missing sub claim');

  const identity = `fid:${sub}`;

  if (jti && exp) {
    jwtCache.set(jti, { identity, expiresAt: exp * 1000 });
  }

  return identity;
}

export async function requireIdentity(req, res, next) {
  const keyName = req.auth?.keyName;

  try {
    if (keyName === 'farcaster') {
      const authHeader = req.headers['authorization'];
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'farcaster_jwt_required' });
      }
      const token = authHeader.slice(7);
      const identity = await verifyFarcasterJwt(token);
      req.user = { type: 'farcaster', identity };
      return next();
    }

    if (keyName === 'web') {
      const header = req.headers['x-user-id'];
      if (!header || !WEB_UUID_RE.test(header)) {
        return res.status(401).json({ error: 'x_user_id_required' });
      }
      req.user = { type: 'web', identity: header };
      return next();
    }

    // Admin key calling recovery routes — require explicit user header
    if (keyName === 'admin') {
      const header = req.headers['x-user-id'];
      if (header && WEB_UUID_RE.test(header)) {
        req.user = { type: 'web', identity: header };
        return next();
      }
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        const identity = await verifyFarcasterJwt(authHeader.slice(7));
        req.user = { type: 'farcaster', identity };
        return next();
      }
    }

    return res.status(401).json({ error: 'user_identity_required' });
  } catch (err) {
    return res.status(401).json({ error: 'identity_verification_failed' });
  }
}
