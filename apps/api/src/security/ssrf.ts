import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return -1;
  }
  return (((parts[0]! << 24) >>> 0) + ((parts[1]! << 16) >>> 0) + ((parts[2]! << 8) >>> 0) + parts[3]!) >>> 0;
}

function isInCidr4(ipInt: number, baseIp: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(baseIp);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    if (net.isIPv4(mapped)) {
      return isPrivateOrReservedIp(mapped);
    }
    const hexParts = mapped.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0]!, 16);
      const lo = parseInt(hexParts[1]!, 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
        return isPrivateOrReservedIp(ipv4);
      }
    }
    return true;
  }

  if (net.isIPv4(normalized)) {
    const ipInt = ipv4ToInt(normalized);
    if (ipInt < 0) return true;
    const blockedCidrs: Array<[string, number]> = [
      ['0.0.0.0', 8],          // Current network
      ['10.0.0.0', 8],         // Private RFC1918
      ['100.64.0.0', 10],      // CGNAT
      ['127.0.0.0', 8],        // Loopback
      ['169.254.0.0', 16],     // Link-local & cloud metadata (169.254.169.254)
      ['172.16.0.0', 12],      // Private RFC1918
      ['192.0.0.0', 24],       // IETF protocol
      ['192.0.2.0', 24],       // TEST-NET-1
      ['192.168.0.0', 16],     // Private RFC1918
      ['198.18.0.0', 15],      // Benchmarking
      ['198.51.100.0', 24],    // TEST-NET-2
      ['203.0.113.0', 24],     // TEST-NET-3
      ['224.0.0.0', 4],        // Multicast
      ['240.0.0.0', 4],        // Reserved / Broadcast
    ];
    return blockedCidrs.some(([base, prefix]) => isInCidr4(ipInt, base, prefix));
  }

  if (net.isIPv6(normalized)) {
    if (normalized === '::' || normalized === '::1') return true;
    // fc00::/7 (Unique Local), fe80::/10 (Link-local), ff00::/8 (Multicast)
    if (
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('ff')
    ) {
      return true;
    }
    return false;
  }

  // Unknown / malformed IP -> fail closed
  return true;
}

export function validateOutboundUrl(rawUrl: string, allowLoopbackForTest = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(`Blocked protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError('Credentials in URL are not allowed');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowLoopbackForTest) {
    if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new SsrfBlockedError(`Blocked internal hostname: ${hostname}`);
    }
    if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
      throw new SsrfBlockedError(`Blocked private/reserved IP: ${hostname}`);
    }
  }
  return parsed;
}

// Custom undici Agent with DNS lookup validation to prevent DNS rebinding SSRF
export function createSafeDispatcher(options?: { allowLoopbackForTest?: boolean }): Agent {
  const allowLoopback = options?.allowLoopbackForTest ?? false;
  return new Agent({
    connect: {
      timeout: 10_000,
      lookup(hostname, lookupOpts, callback) {
        dns.lookup(hostname, { ...lookupOpts, all: true }, (err, addresses) => {
          if (err) {
            callback(err, []);
            return;
          }
          const list = Array.isArray(addresses) ? addresses : [addresses];
          if (!allowLoopback) {
            for (const entry of list) {
              if (isPrivateOrReservedIp(entry.address)) {
                callback(
                  new SsrfBlockedError(`SSRF blocked resolved IP ${entry.address} for ${hostname}`),
                  []
                );
                return;
              }
            }
          }
          if (lookupOpts.all) {
            callback(null, list);
          } else {
            const first = list[0];
            if (!first) {
              callback(new Error(`No DNS records for ${hostname}`), '', 4);
              return;
            }
            callback(null, first.address, first.family);
          }
        });
      },
    },
  });
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  allowLoopbackForTest?: boolean;
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<{ status: number; headers: Record<string, string>; bodyText: string }> {
  const allowLoopback = options.allowLoopbackForTest ?? false;
  const parsed = validateOutboundUrl(rawUrl, allowLoopback);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024; // 2MB default cap

  const dispatcher = createSafeDispatcher({ allowLoopbackForTest: allowLoopback });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: UndiciRequestInit = {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      redirect: 'manual', // Prevent open-redirect SSRF bypasses
      signal: controller.signal,
      dispatcher,
    };
    const res = await undiciFetch(parsed.toString(), init);

    // Follow at most 1 safe redirect if needed? Fail closed on private redirects:
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const nextUrl = new URL(res.headers.get('location')!, parsed).toString();
      validateOutboundUrl(nextUrl, allowLoopback);
    }

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`Response exceeded max size of ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }

    const bodyText = Buffer.concat(chunks).toString('utf8');
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });
    return { status: res.status, headers: responseHeaders, bodyText };
  } finally {
    clearTimeout(timer);
    await dispatcher.close();
  }
}
