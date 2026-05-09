/**
 * API key authentication middleware.
 *
 * Expects X-API-Key header on every protected route.
 * Sets req.auth = { keyName: 'farcaster' | 'web' | 'admin' } so downstream
 * middleware (identity.js) can branch on the calling frontend.
 */

const VALID_KEYS = new Map();

function loadKeys() {
  VALID_KEYS.clear();
  const { FARCASTER_API_KEY, WEB_API_KEY, ADMIN_API_KEY } = process.env;
  if (FARCASTER_API_KEY) VALID_KEYS.set(FARCASTER_API_KEY, 'farcaster');
  if (WEB_API_KEY) VALID_KEYS.set(WEB_API_KEY, 'web');
  if (ADMIN_API_KEY) VALID_KEYS.set(ADMIN_API_KEY, 'admin');
}

loadKeys();

export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({ error: 'missing_api_key' });
  }
  const keyName = VALID_KEYS.get(key);
  if (!keyName) {
    return res.status(401).json({ error: 'invalid_api_key' });
  }
  req.auth = { keyName };
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.keyName !== 'admin') {
    return res.status(403).json({ error: 'admin_required' });
  }
  next();
}
