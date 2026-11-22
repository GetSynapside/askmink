import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import crypto from 'node:crypto';

export const CSRF_COOKIE_NAME = 'askmink_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function securityHeadersMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Widget static bundle may be embedded from authorized domains; admin panel denies framing
    if (!c.req.path.startsWith('/widget') && !c.req.path.startsWith('/api/widget')) {
      c.header('X-Frame-Options', 'DENY');
      c.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';"
      );
    }
    if (c.req.path.startsWith('/api/')) {
      c.header('Cache-Control', 'no-store');
    }
  };
}

// Double Submit Cookie CSRF verification for all state-changing authenticated/auth requests
export function csrfMiddleware(): MiddlewareHandler {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) {
      return next();
    }
    // Public widget endpoints use Origin allowlist + rate limiting (no admin cookie auth)
    if (c.req.path.startsWith('/api/widget/')) {
      return next();
    }

    const cookieToken = getCookie(c, CSRF_COOKIE_NAME);
    const headerToken = c.req.header(CSRF_HEADER_NAME);
    if (!cookieToken || !headerToken) {
      return c.json({ error: 'Invalid or missing CSRF token' }, 403);
    }
    const a = Buffer.from(cookieToken);
    const b = Buffer.from(headerToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return c.json({ error: 'Invalid or missing CSRF token' }, 403);
    }
    return next();
  };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyFn?: (c: Context) => string;
}): MiddlewareHandler {
  const buckets = new Map<string, RateBucket>();

  return async (c, next) => {
    const now = Date.now();
    const key =
      options.keyFn?.(c) ??
      `${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'}:${c.req.path}`;
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    } else {
      existing.count += 1;
      if (existing.count > options.maxRequests) {
        c.header('Retry-After', String(Math.ceil((existing.resetAt - now) / 1000)));
        return c.json({ error: 'Rate limit exceeded. Please try again later.' }, 429);
      }
    }
    // Periodic cleanup
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets.entries()) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }
    return next();
  };
}
