import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { createAskminkApp, type AskminkAppContext } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { CryptoService, signHmacSha256 } from '../../src/crypto/encryption.js';
import { isPrivateOrReservedIp } from '../../src/security/ssrf.js';
import { signWidgetSessionJwt } from '../../src/tools/index.js';
import { buildChatModel, generateEmbeddings } from '../../src/ai/providers.js';
import { generateText } from 'ai';

interface TestClient {
  cookies: Map<string, string>;
  csrfToken: string;
  fetchJson: (
    urlPath: string,
    opts?: { method?: string; body?: unknown; headers?: Record<string, string>; formData?: FormData }
  ) => Promise<{ status: number; data: any; headers: Headers }>;
}

function createTestClient(baseUrl: string): TestClient {
  const cookies = new Map<string, string>();
  let csrfToken = '';

  function captureCookies(res: Response) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      if (!pair) continue;
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (value === '') cookies.delete(name);
      else cookies.set(name, value);
    }
  }

  function cookieHeader(): string {
    return Array.from(cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async function ensureCsrf() {
    if (csrfToken) return;
    const res = await fetch(`${baseUrl}/api/auth/csrf`);
    captureCookies(res);
    const body = (await res.json()) as { csrfToken: string };
    csrfToken = body.csrfToken;
  }

  return {
    cookies,
    get csrfToken() {
      return csrfToken;
    },
    async fetchJson(urlPath, opts = {}) {
      const method = opts.method ?? 'GET';
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (method !== 'GET' && !headers['x-skip-csrf']) {
        await ensureCsrf();
        headers['X-CSRF-Token'] = csrfToken;
      }
      delete headers['x-skip-csrf'];
      const ck = cookieHeader();
      if (ck) headers['Cookie'] = ck;

      let body: BodyInit | undefined;
      if (opts.formData) {
        body = opts.formData;
      } else if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }

      const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body });
      captureCookies(res);
      const text = await res.text();
      let data: any = text;
      try {
        data = JSON.parse(text);
      } catch {
        // non-JSON
      }
      return { status: res.status, data, headers: res.headers };
    },
  };
}

async function waitFor<T>(fn: () => Promise<T>, predicate: (val: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last!: T;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
}

describe('Askmink MVP E2E Suite (Real PostgreSQL 18 + pgvector + pg-boss + Hono)', () => {
  let ctx: AskminkAppContext;
  let apiServer: ReturnType<typeof serve>;
  let baseUrl = '';

  // Local HTTP receiver for webhook & HTTP tool E2E verification (listens strictly on 127.0.0.1)
  let receiverServer: http.Server;
  let receiverBaseUrl = '';
  const receivedWebhooks: Array<{ headers: http.IncomingHttpHeaders; rawBody: string; parsed: any }> = [];
  const receivedToolCalls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }> = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_MOCK_AI = 'true';

    // Start local receiver on 127.0.0.1
    receiverServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        if (req.url?.startsWith('/webhook')) {
          receivedWebhooks.push({
            headers: req.headers,
            rawBody,
            parsed: JSON.parse(rawBody || '{}'),
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
          return;
        }
        if (req.url?.startsWith('/tool-target')) {
          receivedToolCalls.push({ url: req.url, headers: req.headers, body: rawBody });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, echoedUrl: req.url, echoedHeader: req.headers['x-session-user'] }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => receiverServer.listen(0, '127.0.0.1', resolve));
    const rAddr = receiverServer.address() as { port: number };
    receiverBaseUrl = `http://127.0.0.1:${rAddr.port}`;

    // Start real Askmink API on 127.0.0.1 (isolated from external AI calls for deterministic E2E)
    const config = {
      ...loadConfig(),
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      aiGatewayApiKey: undefined, // Deterministic mock for core E2E; live gateway tested separately below
      allowMockProvider: true,
    };
    ctx = await createAskminkApp(config);
    apiServer = serve({ fetch: ctx.app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => apiServer.once('listening', resolve));
    const addr = apiServer.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    apiServer?.close();
    receiverServer?.close();
    await ctx?.close();
  });

  it('Critical Security Invariants: AES-256-GCM tamper detection & Anti-SSRF IPv4/IPv6 blocking', () => {
    const key = crypto.randomBytes(32).toString('hex');
    const c = new CryptoService(key);
    const cipher = c.encrypt('sk-super-secret-value');
    expect(c.decrypt(cipher)).toBe('sk-super-secret-value');
    // Tampering with ciphertext must throw
    const tampered = cipher.slice(0, -2) + (cipher.endsWith('AA') ? 'BB' : 'AA');
    expect(() => c.decrypt(tampered)).toThrow();

    // Anti-SSRF IP checks
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.12.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
  });

  it('E2E Full Lifecycle: Auth, CSRF, Tenant Isolation, BYOK, Multi-Dim RAG (1024d -> 768d), Dual-Mode, Atomic Booking, HMAC Webhook, Immutable JWT Tool & Widget <30KB', async () => {
    const unique = Date.now();
    const alice = createTestClient(baseUrl);
    const bob = createTestClient(baseUrl);

    // 1. CSRF enforcement on mutating endpoint
    const noCsrf = await alice.fetchJson('/api/auth/signup', {
      method: 'POST',
      headers: { 'x-skip-csrf': '1' },
      body: { name: 'Alice', email: `alice+${unique}@example.com`, password: 'StrongPassword!2026' },
    });
    expect(noCsrf.status).toBe(403);

    // 2. Signup Alice & Bob (separate workspaces)
    const signupAlice = await alice.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: {
        name: 'Alice Founder',
        email: `alice+${unique}@example.com`,
        password: 'StrongPassword!2026',
        workspaceName: 'Alice Corp',
      },
    });
    expect(signupAlice.status).toBe(201);

    const signupBob = await bob.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: {
        name: 'Bob Other',
        email: `bob+${unique}@example.com`,
        password: 'AnotherStrongPassword!2026',
      },
    });
    expect(signupBob.status).toBe(201);

    // 3. Encrypted BYOK key never leaked back in plaintext
    const secretKey = 'vck_live_super_secret_9876';
    const keyRes = await alice.fetchJson('/api/provider-keys', {
      method: 'POST',
      body: {
        provider: 'vercel-ai-gateway',
        purpose: 'chat',
        label: 'Test Gateway',
        apiKey: secretKey,
      },
    });
    expect(keyRes.status).toBe(201);
    expect(keyRes.data.item.keyLast4).toBe('9876');
    expect(JSON.stringify(keyRes.data)).not.toContain(secretKey);

    // 4. Create Agent with allowlist + default free models (tencent/hy4-flash + alibaba/qwen3-embedding-0.6b)
    const agentRes = await alice.fetchJson('/api/agents', {
      method: 'POST',
      body: {
        name: 'Askmink Demo Agent',
        allowedDomains: ['https://allowed.askmink.test'],
        chatModel: 'tencent/hy4-flash',
        embeddingModel: 'alibaba/qwen3-embedding-0.6b',
      },
    });
    expect(agentRes.status).toBe(201);
    const agentId: string = agentRes.data.item.id;
    const widgetJwtSecret: string = agentRes.data.widgetJwtSecretOnce;
    expect(widgetJwtSecret.length).toBeGreaterThan(20);

    // Tenant isolation: Bob cannot read Alice's agent or bind Alice's provider key
    const bobRead = await bob.fetchJson(`/api/agents/${agentId}`);
    expect(bobRead.status).toBe(404);

    const bobCrossKey = await bob.fetchJson('/api/agents', {
      method: 'POST',
      body: {
        name: 'Bob Unauthorized Key Agent',
        chatProviderKeyId: keyRes.data.item.id,
      },
    });
    expect(bobCrossKey.status).toBe(400);

    // 5. Upload Security (forged PDF magic bytes rejected, real Markdown accepted)
    const fakePdfForm = new FormData();
    fakePdfForm.append('file', new Blob(['NOT_A_PDF_HEADER'], { type: 'application/pdf' }), 'malicious.pdf');
    const fakePdfRes = await alice.fetchJson(`/api/agents/${agentId}/knowledge/upload`, {
      method: 'POST',
      formData: fakePdfForm,
    });
    expect(fakePdfRes.status).toBe(400);

    const mdForm = new FormData();
    mdForm.append(
      'file',
      new Blob(
        ['# Enterprise SKU Guide\n\nProduct code SKU-MINK-9001 includes 99.99% uptime SLA and priority support.'],
        { type: 'text/markdown' }
      ),
      'sku-guide.md'
    );
    const mdRes = await alice.fetchJson(`/api/agents/${agentId}/knowledge/upload`, {
      method: 'POST',
      formData: mdForm,
    });
    expect(mdRes.status).toBe(201);

    // Wait for pg-boss worker to finish indexing natively in 1024d (qwen3-embedding-0.6b native dim)
    const sources1024 = await waitFor(
      () => alice.fetchJson(`/api/agents/${agentId}/knowledge`),
      (r) => r.data.items?.[0]?.status === 'ready'
    );
    expect(sources1024.data.items[0].status).toBe('ready');
    expect(sources1024.data.items[0].embeddingDimensions).toBe(1024);
    expect(sources1024.data.items[0].chunkCount).toBeGreaterThan(0);

    // Hybrid RAG search returns exact SKU citation in Playground X-Ray trace
    const ragChat = await alice.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'What is included in SKU-MINK-9001?', pageUrl: '/docs/sku' },
    });
    expect(ragChat.status).toBe(200);
    expect(ragChat.data.mode).toBe('support');
    expect(ragChat.data.citations.length).toBeGreaterThan(0);
    expect(ragChat.data.text).toContain('SKU-MINK-9001');
    expect(ragChat.data.trace.ragChunks.length).toBeGreaterThan(0);

    // 6. Embedding model change blocked without confirmReindex, then cleanly re-indexed natively to 768d!
    const blockedSwitch = await alice.fetchJson(`/api/agents/${agentId}`, {
      method: 'PATCH',
      body: { embeddingModel: 'text-embedding-004' },
    });
    expect(blockedSwitch.status).toBe(409);
    expect(blockedSwitch.data.error).toBe('EMBEDDING_REINDEX_REQUIRED');

    const confirmedSwitch = await alice.fetchJson(`/api/agents/${agentId}`, {
      method: 'PATCH',
      body: { embeddingModel: 'text-embedding-004', confirmReindex: true },
    });
    expect(confirmedSwitch.status).toBe(200);

    const sources768 = await waitFor(
      () => alice.fetchJson(`/api/agents/${agentId}/knowledge`),
      (r) => r.data.items?.[0]?.embeddingDimensions === 768 && r.data.items?.[0]?.status === 'ready'
    );
    expect(sources768.data.items[0].embeddingDimensions).toBe(768);

    // 7. Product Checkout Card (Sales mode) + Outbound HMAC Webhook (Support Ticket)
    await alice.fetchJson(`/api/agents/${agentId}/products`, {
      method: 'POST',
      body: {
        name: 'Askmink Pro',
        description: 'Pay-as-you-go cloud agent',
        priceLabel: '$49/mo',
        checkoutUrl: 'https://checkout.example.com/pro',
      },
    });
    const webhookSecret = 'whsec_test_secret_1234567890';
    await alice.fetchJson(`/api/agents/${agentId}/webhooks`, {
      method: 'POST',
      body: {
        url: `${receiverBaseUrl}/webhook`,
        secret: webhookSecret,
        events: ['ticket.created', 'booking.created', 'lead.captured'],
      },
    });

    const salesChat = await alice.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'I want to buy the Pro plan checkout', pageUrl: '/pricing' },
    });
    expect(salesChat.status).toBe(200);
    expect(salesChat.data.mode).toBe('sales');
    expect(salesChat.data.cards.some((c: any) => c.type === 'product_card')).toBe(true);

    const ticketChat = await alice.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      headers: { 'x-test-allow-loopback': '1' },
      body: { message: 'Please open a support ticket for broken webhook', pageUrl: '/docs/webhooks' },
    });
    expect(ticketChat.status).toBe(200);
    expect(ticketChat.data.cards.some((c: any) => c.type === 'ticket_card')).toBe(true);

    // Wait for pg-boss to deliver HMAC-signed webhook to local receiver
    await waitFor(
      async () => receivedWebhooks.length,
      (len) => len > 0
    );
    const delivered = receivedWebhooks[0]!;
    expect(delivered.headers['x-askmink-event']).toBe('ticket.created');
    const expectedSig = `sha256=${signHmacSha256(webhookSecret, delivered.rawBody)}`;
    expect(delivered.headers['x-askmink-signature']).toBe(expectedSig);

    // 8. Native Schedule: Atomic Double-Booking Prevention + .ics download
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setUTCHours(14, 0, 0, 0);
    const slotEnd = new Date(tomorrow.getTime() + 30 * 60 * 1000);

    const [b1, b2] = await Promise.all([
      fetch(`${baseUrl}/api/widget/${agentId}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://allowed.askmink.test' },
        body: JSON.stringify({
          visitorName: 'Visitor One',
          visitorEmail: 'one@example.com',
          startsAt: tomorrow.toISOString(),
          endsAt: slotEnd.toISOString(),
          timezone: 'UTC',
        }),
      }),
      fetch(`${baseUrl}/api/widget/${agentId}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://allowed.askmink.test' },
        body: JSON.stringify({
          visitorName: 'Visitor Two',
          visitorEmail: 'two@example.com',
          startsAt: tomorrow.toISOString(),
          endsAt: slotEnd.toISOString(),
          timezone: 'UTC',
        }),
      }),
    ]);
    const statuses = [b1.status, b2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winningRes = b1.status === 201 ? b1 : b2;
    const winningData = (await winningRes.json()) as any;
    const icsRes = await fetch(`${baseUrl}${winningData.icsDownloadUrl}`, {
      headers: { Origin: 'https://allowed.askmink.test' },
    });
    expect(icsRes.status).toBe(200);
    const icsBody = await icsRes.text();
    expect(icsBody).toContain('BEGIN:VCALENDAR');
    expect(icsBody).toContain('BEGIN:VEVENT');

    // 9. HTTP Tool Builder: Anti-SSRF + Immutable {{session.user_id}} JWT + Human-in-the-Loop
    const ssrfTool = await alice.fetchJson(`/api/agents/${agentId}/tools`, {
      method: 'POST',
      body: {
        name: 'ssrf_probe',
        description: 'Should be blocked by SSRF guard',
        method: 'GET',
        url: 'http://169.254.169.254/latest/meta-data/',
        headers: {},
        parameters: [],
      },
    });
    const ssrfTest = await alice.fetchJson(`/api/agents/${agentId}/tools/${ssrfTool.data.item.id}/test`, {
      method: 'POST',
      body: { args: {} },
    });
    expect(ssrfTest.status).toBe(403);
    expect(ssrfTest.data.code).toBe('SSRF_BLOCKED');

    const orderTool = await alice.fetchJson(`/api/agents/${agentId}/tools`, {
      method: 'POST',
      body: {
        name: 'check_order_status',
        description: 'Check authenticated user order status',
        method: 'GET',
        url: `${receiverBaseUrl}/tool-target/{{session.user_id}}`,
        headers: { 'X-Session-User': '{{session.user_id}}' },
        parameters: [
          {
            name: 'user_id',
            type: 'string',
            description: 'Immutable user id',
            required: true,
            location: 'query',
            sessionClaim: 'user_id',
          },
        ],
        requiresConfirmation: true,
      },
    });
    expect(orderTool.status).toBe(201);

    const signedJwt = await signWidgetSessionJwt({ user_id: 'real-alice-123', email: 'alice@example.com' }, widgetJwtSecret);

    // First call triggers HITL confirmation_request card (does NOT execute HTTP call yet)
    const hitlPrompt = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://allowed.askmink.test',
        'x-test-allow-loopback': '1',
      },
      body: JSON.stringify({
        message: 'Please run check_order_status now',
        pageUrl: '/app/orders',
        sessionJwt: signedJwt,
        context: { user_id: 'attacker-spoofed-999' }, // Attempted prompt/context spoofing!
      }),
    });
    const hitlData = (await hitlPrompt.json()) as any;
    const confirmCard = hitlData.cards.find((c: any) => c.type === 'confirmation_request');
    expect(confirmCard).toBeDefined();
    expect(receivedToolCalls.length).toBe(0);

    // Confirmed call executes HTTP tool strictly using verified JWT claim (never spoofed value)
    const confirmedRun = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://allowed.askmink.test',
        'x-test-allow-loopback': '1',
      },
      body: JSON.stringify({
        conversationId: hitlData.conversationId,
        message: 'Confirm check_order_status',
        pageUrl: '/app/orders',
        sessionJwt: signedJwt,
        context: { user_id: 'attacker-spoofed-999' },
        confirmedToolCallId: confirmCard.toolCallId,
      }),
    });
    const confirmedData = (await confirmedRun.json()) as any;
    expect(confirmedData.cards.some((c: any) => c.type === 'diagnostic_card')).toBe(true);
    expect(receivedToolCalls.length).toBe(1);
    expect(receivedToolCalls[0]!.url).toContain('/tool-target/real-alice-123');
    expect(receivedToolCalls[0]!.url).toContain('user_id=real-alice-123');
    expect(receivedToolCalls[0]!.url).not.toContain('attacker-spoofed-999');
    expect(receivedToolCalls[0]!.headers['x-session-user']).toBe('real-alice-123');

    // 10. Strict Dynamic CORS on Widget API (including OPTIONS preflight)
    const evilOrigin = await fetch(`${baseUrl}/api/widget/${agentId}/config`, {
      headers: { Origin: 'https://evil.attacker.example' },
    });
    expect(evilOrigin.status).toBe(403);

    const evilPreflight = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.attacker.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(evilPreflight.status).toBe(403);

    const goodOrigin = await fetch(`${baseUrl}/api/widget/${agentId}/config`, {
      headers: { Origin: 'https://allowed.askmink.test' },
    });
    expect(goodOrigin.status).toBe(200);
    expect(goodOrigin.headers.get('access-control-allow-origin')).toBe('https://allowed.askmink.test');

    const goodPreflight = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://allowed.askmink.test',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(goodPreflight.status).toBe(204);
    expect(goodPreflight.headers.get('access-control-allow-origin')).toBe('https://allowed.askmink.test');
    expect(goodPreflight.headers.get('access-control-allow-methods')).toContain('POST');

    const widgetJsRes = await fetch(`${baseUrl}/widget.js`);
    expect(widgetJsRes.status).toBe(200);
    expect(widgetJsRes.headers.get('access-control-allow-origin')).toBe('*');

    // 11. Built widget.js gzipped size check (< 30 KB)
    const widgetPath = path.resolve(process.cwd(), '../widget/dist/widget.js');
    if (fs.existsSync(widgetPath)) {
      const gzipped = zlib.gzipSync(fs.readFileSync(widgetPath));
      expect(gzipped.byteLength).toBeLessThan(30 * 1024);
    }

    // 12. Logout invalidates all sessions
    const logoutRes = await alice.fetchJson('/api/auth/logout', { method: 'POST' });
    expect(logoutRes.status).toBe(200);
    const meAfterLogout = await alice.fetchJson('/api/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('Live Vercel AI Gateway Smoke Test (runs when AI_GATEWAY_API_KEY is configured in .env)', async () => {
    const liveConfig = loadConfig();
    if (!liveConfig.aiGatewayApiKey) {
      return;
    }

    // Verify native embedding dimension with alibaba/qwen3-embedding-0.6b
    const emb = await generateEmbeddings(
      ['Askmink embedded AI agent for sales and support'],
      {
        provider: 'vercel-ai-gateway',
        apiKey: liveConfig.aiGatewayApiKey,
        baseUrl: liveConfig.aiGatewayBaseUrl,
        model: liveConfig.defaultEmbeddingModel,
      },
      liveConfig
    );
    expect(emb.embeddings.length).toBe(1);
    expect(emb.dimensions).toBeGreaterThanOrEqual(256);

    // Verify chat model connectivity via Vercel AI Gateway
    const chatModel = buildChatModel(
      {
        provider: 'vercel-ai-gateway',
        apiKey: liveConfig.aiGatewayApiKey,
        baseUrl: liveConfig.aiGatewayBaseUrl,
        model: liveConfig.defaultChatModel,
      },
      liveConfig
    );
    try {
      const reply = await generateText({
        model: chatModel,
        prompt: 'Reply with exactly one word: OK',
        maxTokens: 16,
      });
      expect(reply.text.trim().length).toBeGreaterThan(0);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('Free tier users do not have access')) {
        console.warn(`[live-gateway] Embedding (${liveConfig.defaultEmbeddingModel}, ${emb.dimensions}d) succeeded; chat model "${liveConfig.defaultChatModel}" returned Vercel free-tier entitlement error.`);
        return;
      }
      throw err;
    }
  });
});
