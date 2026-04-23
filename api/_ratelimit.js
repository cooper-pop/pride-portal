// api/_ratelimit.js
// Rate limiting via Upstash Redis. Used to slow down brute-force login
// attempts, credential stuffing, and general API abuse.
//
// Graceful fallback: if UPSTASH_REDIS_REST_URL or _TOKEN are not set,
// the module is a no-op — every check returns "allowed". This lets the
// portal keep running during/after deploy even if the env vars haven't
// been configured yet.
//
// Pre-configured limiters:
//   login_ip      — 10 login attempts per 15 min per IP
//   login_user    — 5  login attempts per 15 min per company:username
//   passkey_ip    — 10 passkey-auth attempts per 15 min per IP
//   api_user      — 300 requests per minute per authenticated user
//
// How to use in an endpoint:
//
//   const rl = require('./_ratelimit');
//   const ipResult = await rl.check(req, res, 'login_ip', rl.getClientIp(req));
//   if (ipResult && !ipResult.success) return;   // 429 already sent
//
// Note: `check()` sends the 429 response itself on block. Caller just
// returns early. Rate-limit-relevant headers (X-RateLimit-*, Retry-After)
// are set on every call so even successful requests carry usage info.

let _limiters = null;
let _redis = null;

// Lazy-load so that missing env vars don't crash the module at require-time.
function getLimiters() {
  if (_limiters !== null) return _limiters;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Mark as initialized-but-disabled so we don't try again every request.
    _limiters = false;
    return _limiters;
  }

  try {
    const { Ratelimit } = require('@upstash/ratelimit');
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({ url, token });

    _limiters = {
      login_ip: new Ratelimit({
        redis: _redis,
        limiter: Ratelimit.slidingWindow(10, '15 m'),
        prefix: 'potp:rl:login_ip',
        analytics: true
      }),
      login_user: new Ratelimit({
        redis: _redis,
        limiter: Ratelimit.slidingWindow(5, '15 m'),
        prefix: 'potp:rl:login_user',
        analytics: true
      }),
      passkey_ip: new Ratelimit({
        redis: _redis,
        limiter: Ratelimit.slidingWindow(10, '15 m'),
        prefix: 'potp:rl:passkey_ip',
        analytics: true
      }),
      api_user: new Ratelimit({
        redis: _redis,
        limiter: Ratelimit.slidingWindow(300, '1 m'),
        prefix: 'potp:rl:api_user',
        analytics: true
      })
    };
    return _limiters;
  } catch (e) {
    // Package not installed or init failed — log once and disable.
    console.error('[ratelimit] init failed, rate limiting disabled:', e && e.message);
    _limiters = false;
    return _limiters;
  }
}

function getClientIp(req) {
  const fwd = (req.headers && req.headers['x-forwarded-for']) || '';
  const first = fwd.split(',')[0].trim();
  return first
    || (req.headers && req.headers['x-real-ip'])
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

// Set standard rate limit response headers from a limiter result.
function setHeaders(res, result) {
  if (!result) return;
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
  if (result.reset) res.setHeader('X-RateLimit-Reset', Math.ceil(result.reset / 1000));
  if (!result.success && result.reset) {
    res.setHeader('Retry-After', Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)));
  }
}

/**
 * Check a rate limit. If the request is over the limit, sends a 429 response
 * and returns { success: false, ... }. Caller should return immediately in
 * that case.
 *
 * If Upstash isn't configured (or the package isn't installed), this is a
 * no-op — returns null and lets the request through.
 *
 * @param req           incoming request
 * @param res           response (for headers + 429)
 * @param limiterKey    one of: login_ip, login_user, passkey_ip, api_user
 * @param identifier    opaque key for the bucket, e.g. ip or user_id
 * @returns             { success, limit, remaining, reset } or null if disabled
 */
async function check(req, res, limiterKey, identifier) {
  const limiters = getLimiters();
  if (!limiters) return null; // disabled
  const limiter = limiters[limiterKey];
  if (!limiter) {
    console.error('[ratelimit] unknown limiter key:', limiterKey);
    return null;
  }
  if (!identifier) return null; // nothing to key on — skip
  const result = await limiter.limit(String(identifier));
  setHeaders(res, result);
  if (!result.success) {
    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    res.status(429).json({
      error: 'Too many requests. Please wait and try again.',
      retry_after_seconds: retryAfter,
      limit: result.limit
    });
  }
  return result;
}

module.exports = { check, getClientIp, setHeaders };
