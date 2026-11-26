import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
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
      pgbossSchema: 'pgboss_test',
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

  it('E2E Full Lifecycle: Auth, CSRF, Tenant Isolation, BYOK, Multi-Dim RAG (1024d -> 768d), Atomic Booking, HMAC Webhook, Immutable JWT Tool & Widget <30KB', async () => {
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

    // Tenant isolation: Bob cannot read Alice's agent or bind Alice's provider key globally
    const bobRead = await bob.fetchJson(`/api/agents/${agentId}`);
    expect(bobRead.status).toBe(404);

    const bobCrossKey = await bob.fetchJson('/api/account/ai-settings', {
      method: 'PATCH',
      body: {
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
    expect(ragChat.data.citations.length).toBeGreaterThan(0);
    expect(ragChat.data.text).toContain('SKU-MINK-9001');
    expect(ragChat.data.trace.ragChunks.length).toBeGreaterThan(0);

    // 6. Global embedding model change blocked without confirmReindex, then cleanly re-indexed natively to 768d!
    const blockedSwitch = await alice.fetchJson('/api/account/ai-settings', {
      method: 'PATCH',
      body: { embeddingModel: 'text-embedding-004' },
    });
    expect(blockedSwitch.status).toBe(409);
    expect(blockedSwitch.data.error).toBe('EMBEDDING_REINDEX_REQUIRED');

    const confirmedSwitch = await alice.fetchJson('/api/account/ai-settings', {
      method: 'PATCH',
      body: { embeddingModel: 'text-embedding-004', confirmReindex: true },
    });
    expect(confirmedSwitch.status).toBe(200);
    expect(confirmedSwitch.data.settings.embeddingModel).toBe('text-embedding-004');

    const sources768 = await waitFor(
      () => alice.fetchJson(`/api/agents/${agentId}/knowledge`),
      (r) => r.data.items?.[0]?.embeddingDimensions === 768 && r.data.items?.[0]?.status === 'ready'
    );
    expect(sources768.data.items[0].embeddingDimensions).toBe(768);

    // 7. Product Checkout Card + Outbound HMAC Webhook (Support Ticket)
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

  it('Global Account BYOK: Separate Chat & Embedding providers shared across multiple agents + validation', async () => {
    const unique = Date.now();
    const carol = createTestClient(baseUrl);
    const dave = createTestClient(baseUrl);

    await carol.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: {
        name: 'Carol Multi-Agent',
        email: `carol+${unique}@example.com`,
        password: 'StrongPassword!2026',
        workspaceName: 'Carol Global AI',
      },
    });
    await dave.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: {
        name: 'Dave Isolated',
        email: `dave+${unique}@example.com`,
        password: 'StrongPassword!2026',
      },
    });

    // Anthropic cannot be registered for embeddings
    const badAnthropicEmb = await carol.fetchJson('/api/provider-keys', {
      method: 'POST',
      body: {
        provider: 'anthropic',
        purpose: 'embedding',
        label: 'Invalid Anthropic Emb',
        apiKey: 'sk-ant-bad-1234',
      },
    });
    expect(badAnthropicEmb.status).toBe(400);

    // 1. Register Chat key from Anthropic & Embedding key from OpenAI (different providers!)
    const chatSecret = 'sk-ant-carol-chat-1111';
    const embSecret = 'sk-openai-carol-emb-2222';
    const chatKeyRes = await carol.fetchJson('/api/provider-keys', {
      method: 'POST',
      body: {
        provider: 'anthropic',
        purpose: 'chat',
        label: 'Carol Anthropic Chat',
        apiKey: chatSecret,
        activate: true,
      },
    });
    expect(chatKeyRes.status).toBe(201);

    const embKeyRes = await carol.fetchJson('/api/provider-keys', {
      method: 'POST',
      body: {
        provider: 'openai',
        purpose: 'embedding',
        label: 'Carol OpenAI Embedding',
        apiKey: embSecret,
        activate: true,
      },
    });
    expect(embKeyRes.status).toBe(201);

    const patchRes = await carol.fetchJson('/api/account/ai-settings', {
      method: 'PATCH',
      body: {
        chatProviderKeyId: chatKeyRes.data.item.id,
        chatModel: 'claude-sonnet-4-20250514',
        embeddingProviderKeyId: embKeyRes.data.item.id,
        embeddingModel: 'text-embedding-3-small',
      },
    });
    expect(patchRes.status).toBe(200);

    const settingsRes = await carol.fetchJson('/api/account/ai-settings');
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.data.settings.chatProviderKeyId).toBe(chatKeyRes.data.item.id);
    expect(settingsRes.data.settings.embeddingProviderKeyId).toBe(embKeyRes.data.item.id);
    expect(settingsRes.data.settings.chatModel).toBe('claude-sonnet-4-20250514');
    expect(settingsRes.data.settings.embeddingModel).toBe('text-embedding-3-small');
    expect(JSON.stringify(settingsRes.data)).not.toContain(chatSecret);
    expect(JSON.stringify(settingsRes.data)).not.toContain(embSecret);

    // Cannot assign a chat key into embeddingProviderKeyId (purpose mismatch)
    const purposeMismatch = await carol.fetchJson('/api/account/ai-settings', {
      method: 'PATCH',
      body: { embeddingProviderKeyId: chatKeyRes.data.item.id },
    });
    expect(purposeMismatch.status).toBe(400);

    // Cross-tenant isolation: Dave cannot bind Carol's keys
    const daveCross = await dave.fetchJson('/api/account/ai-settings', {
      method: 'PATCH',
      body: { embeddingProviderKeyId: embKeyRes.data.item.id },
    });
    expect(daveCross.status).toBe(400);

    // 2. Create two agents without per-agent keys: both inherit global account settings
    const [a1, a2] = await Promise.all([
      carol.fetchJson('/api/agents', { method: 'POST', body: { name: 'Sales Agent' } }),
      carol.fetchJson('/api/agents', { method: 'POST', body: { name: 'Support Agent' } }),
    ]);
    expect(a1.status).toBe(201);
    expect(a2.status).toBe(201);
    expect(a1.data.item.chatModel).toBe('claude-sonnet-4-20250514');
    expect(a1.data.item.embeddingModel).toBe('text-embedding-3-small');
    expect(a2.data.item.chatModel).toBe('claude-sonnet-4-20250514');
    expect(a2.data.item.embeddingModel).toBe('text-embedding-3-small');

    // 3. Activate mock keys globally and verify both agents share them for RAG + chat
    const mockChatKey = await carol.fetchJson('/api/provider-keys', {
      method: 'POST',
      body: {
        provider: 'mock',
        purpose: 'chat',
        label: 'Mock Chat',
        apiKey: 'mock-chat',
        activate: true,
      },
    });
    const mockEmbKey = await carol.fetchJson('/api/provider-keys', {
      method: 'POST',
      body: {
        provider: 'mock',
        purpose: 'embedding',
        label: 'Mock Emb',
        apiKey: 'mock-emb',
        activate: true,
      },
    });
    expect(mockChatKey.status).toBe(201);
    expect(mockEmbKey.status).toBe(201);

    const mockSettings = await carol.fetchJson('/api/account/ai-settings', {
      method: 'PATCH',
      body: {
        chatModel: 'mock-chat-v1',
        embeddingModel: 'qwen3-embedding-0.6b',
      },
    });
    expect(mockSettings.status).toBe(200);

    const kbRes = await carol.fetchJson(`/api/agents/${a2.data.item.id}/knowledge/text`, {
      method: 'POST',
      body: {
        title: 'Global Account Policy',
        content: 'Global BYOK keys apply across all agents including Support Agent SLA-24H.',
      },
    });
    expect(kbRes.status).toBe(201);

    const kbReady = await waitFor(
      () => carol.fetchJson(`/api/agents/${a2.data.item.id}/knowledge`),
      (r) => r.data.items?.[0]?.status === 'ready'
    );
    expect(kbReady.data.items[0].status).toBe('ready');

    const [chat1, chat2] = await Promise.all([
      carol.fetchJson(`/api/agents/${a1.data.item.id}/playground/chat`, {
        method: 'POST',
        body: { message: 'Hello from sales', pageUrl: '/pricing' },
      }),
      carol.fetchJson(`/api/agents/${a2.data.item.id}/playground/chat`, {
        method: 'POST',
        body: { message: 'Tell me about SLA-24H', pageUrl: '/docs/sla' },
      }),
    ]);
    expect(chat1.status).toBe(200);
    expect(chat1.data.trace.model).toBe('mock-chat-v1');
    expect(chat2.status).toBe(200);
    expect(chat2.data.trace.model).toBe('mock-chat-v1');
    expect(chat2.data.text).toContain('SLA-24H');

    // 4. Account Profile & Change Password
    const profRes = await carol.fetchJson('/api/account/profile');
    expect(profRes.status).toBe(200);
    expect(profRes.data.profile.name).toBe('Carol Multi-Agent');
    expect(profRes.data.profile.workspaceName).toBe('Carol Global AI');
    expect(profRes.data.profile.agentsCount).toBe(2);
    expect(JSON.stringify(profRes.data)).not.toContain('passwordHash');

    const profPatch = await carol.fetchJson('/api/account/profile', {
      method: 'PATCH',
      body: { name: 'Carol Updated', workspaceName: 'Carol Studio' },
    });
    expect(profPatch.status).toBe(200);
    expect(profPatch.data.profile.name).toBe('Carol Updated');
    expect(profPatch.data.profile.workspaceName).toBe('Carol Studio');

    const wrongPw = await carol.fetchJson('/api/account/change-password', {
      method: 'POST',
      body: { currentPassword: 'WrongPassword!123', newPassword: 'NewStrongPassword!2026' },
    });
    expect(wrongPw.status).toBe(401);

    const okPw = await carol.fetchJson('/api/account/change-password', {
      method: 'POST',
      body: { currentPassword: 'StrongPassword!2026', newPassword: 'NewStrongPassword!2026' },
    });
    expect(okPw.status).toBe(200);

    const loginNewPw = await createTestClient(baseUrl).fetchJson('/api/auth/login', {
      method: 'POST',
      body: { email: `carol+${unique}@example.com`, password: 'NewStrongPassword!2026' },
    });
    expect(loginNewPw.status).toBe(200);
  });

  it('(a) KB Edit (PATCH), Re-Ingest, RAG Search, CSRF & Multi-Tenant Isolation', async () => {
    const tag = uniqueSuffix();
    const owner = createTestClient(baseUrl);
    const intruder = createTestClient(baseUrl);

    const ownerSignup = await owner.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: { name: 'KB Owner', email: `kb-owner+${tag}@example.com`, password: 'StrongPassword!2026' },
    });
    expect(ownerSignup.status).toBe(201);

    const intruderSignup = await intruder.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: { name: 'KB Intruder', email: `kb-intruder+${tag}@example.com`, password: 'StrongPassword!2026' },
    });
    expect(intruderSignup.status).toBe(201);

    const agentRes = await owner.fetchJson('/api/agents', {
      method: 'POST',
      body: { name: 'KB Edit Agent' },
    });
    expect(agentRes.status).toBe(201);
    const agentId: string = agentRes.data.item.id;

    const createKb = await owner.fetchJson(`/api/agents/${agentId}/knowledge/text`, {
      method: 'POST',
      body: {
        title: 'Initial Policy',
        content: 'The legacy compliance token is OLD-TOKEN-ALPHA-111 for internal audits.',
        sourceUrl: 'https://docs.example.com/initial-policy',
      },
    });
    expect(createKb.status).toBe(201);
    const sourceId: string = createKb.data.item.id;

    const initialReady = await waitFor(
      () => owner.fetchJson(`/api/agents/${agentId}/knowledge`),
      (r) => r.data.items?.find((i: any) => i.id === sourceId)?.status === 'ready'
    );
    expect(initialReady.data.items?.find((i: any) => i.id === sourceId)?.status).toBe('ready');

    // CSRF enforcement on PATCH
    const noCsrfPatch = await owner.fetchJson(`/api/agents/${agentId}/knowledge/${sourceId}`, {
      method: 'PATCH',
      headers: { 'x-skip-csrf': '1' },
      body: { title: 'Blocked' },
    });
    expect(noCsrfPatch.status).toBe(403);

    // Multi-tenant isolation
    const intruderPatch = await intruder.fetchJson(`/api/agents/${agentId}/knowledge/${sourceId}`, {
      method: 'PATCH',
      body: { title: 'Hijack', content: 'Unauthorized edit content here' },
    });
    expect(intruderPatch.status).toBe(404);

    // Owner updates title, content, and sourceUrl -> triggers re-ingestion
    const updatedPatch = await owner.fetchJson(`/api/agents/${agentId}/knowledge/${sourceId}`, {
      method: 'PATCH',
      body: {
        title: 'Updated Compliance Policy',
        content: 'All partners must follow token UPDATED-POLICY-OMEGA-999 during quarterly audits.',
        sourceUrl: 'https://docs.example.com/updated-policy',
      },
    });
    expect(updatedPatch.status).toBe(200);
    expect(updatedPatch.data.item.id).toBe(sourceId);

    const reindexed = await waitFor(
      () => owner.fetchJson(`/api/agents/${agentId}/knowledge`),
      (r) => {
        const item = r.data.items?.find((i: any) => i.id === sourceId);
        return item?.status === 'ready' && typeof item?.rawContent === 'string' && item.rawContent.includes('UPDATED-POLICY-OMEGA-999');
      }
    );
    const updatedItem = reindexed.data.items?.find((i: any) => i.id === sourceId);
    expect(updatedItem?.status).toBe('ready');
    expect(updatedItem?.title).toBe('Updated Compliance Policy');
    expect(updatedItem?.sourceUrl).toBe('https://docs.example.com/updated-policy');
    expect(updatedItem?.rawContent).toContain('UPDATED-POLICY-OMEGA-999');

    // RAG chat reflects updated content, title, and url
    const ragRes = await owner.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'Tell me about UPDATED-POLICY-OMEGA-999', pageUrl: '/docs/policy' },
    });
    expect(ragRes.status).toBe(200);
    expect(ragRes.data.citations.length).toBeGreaterThan(0);
    expect(
      ragRes.data.citations.some(
        (c: any) =>
          c.sourceId === sourceId &&
          c.title === 'Updated Compliance Policy' &&
          c.url === 'https://docs.example.com/updated-policy'
      )
    ).toBe(true);
    expect(ragRes.data.text).toContain('UPDATED-POLICY-OMEGA-999');

    // Stale token / old title must no longer appear after re-ingestion
    const staleRes = await owner.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'Tell me about OLD-TOKEN-ALPHA-111', pageUrl: '/docs/policy' },
    });
    expect(staleRes.status).toBe(200);
    expect(staleRes.data.text).not.toContain('OLD-TOKEN-ALPHA-111');
    expect(JSON.stringify(staleRes.data.citations)).not.toContain('OLD-TOKEN-ALPHA-111');
    expect(JSON.stringify(staleRes.data.trace?.ragChunks ?? [])).not.toContain('OLD-TOKEN-ALPHA-111');
    expect(staleRes.data.citations.some((c: any) => c.title === 'Initial Policy')).toBe(false);
  });

  it('(b) Localized Agent Defaults (pt), starterPrompts Persistence & Widget Config', async () => {
    const tag = uniqueSuffix();
    const ptOwner = createTestClient(baseUrl);

    const signup = await ptOwner.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: { name: 'PT Owner', email: `pt-owner+${tag}@example.com`, password: 'StrongPassword!2026' },
    });
    expect(signup.status).toBe(201);

    // Omit systemPrompt and welcomeMessage completely so backend applies Portuguese templates
    const createRes = await ptOwner.fetchJson('/api/agents', {
      method: 'POST',
      body: {
        name: 'Agente PT',
        defaultLanguage: 'pt',
        starterPrompts: ['Quais são os planos?', 'Falar com suporte'],
      },
    });
    expect(createRes.status).toBe(201);
    const created = createRes.data.item;
    const agentId: string = created.id;

    expect(created.defaultLanguage).toBe('pt');
    expect(typeof created.systemPrompt).toBe('string');
    expect(created.systemPrompt.trim().length).toBeGreaterThan(0);
    expect(created.systemPrompt).not.toContain('You are Askmink, a helpful AI sales and support agent');
    expect(created.systemPrompt).toMatch(/você|vendas|suporte|conhecimento/i);
    expect(typeof created.welcomeMessage).toBe('string');
    expect(created.welcomeMessage.trim().length).toBeGreaterThan(0);
    expect(created.welcomeMessage).not.toBe('Hi! How can I help you today?');
    expect(created.welcomeMessage).toMatch(/olá|ajudar|como posso/i);
    expect(created.starterPrompts).toEqual(['Quais são os planos?', 'Falar com suporte']);

    // Update starterPrompts via PATCH
    const patchRes = await ptOwner.fetchJson(`/api/agents/${agentId}`, {
      method: 'PATCH',
      body: { starterPrompts: ['Ver preços', 'Agendar demo'] },
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.data.item.starterPrompts).toEqual(['Ver preços', 'Agendar demo']);

    // Public widget config returns Portuguese welcomeMessage and updated starterPrompts
    const widgetCfgRes = await fetch(`${baseUrl}/api/widget/${agentId}/config`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    expect(widgetCfgRes.status).toBe(200);
    const widgetCfg = (await widgetCfgRes.json()) as any;
    expect(widgetCfg.defaultLanguage).toBe('pt');
    expect(widgetCfg.welcomeMessage).toBe(created.welcomeMessage);
    expect(widgetCfg.starterPrompts).toEqual(['Ver preços', 'Agendar demo']);
  });

  it('(c) recommend_product Multi-Product Matching, No Blind Fallback & productId Deduplication', async () => {
    const tag = uniqueSuffix();
    const merchant = createTestClient(baseUrl);

    const signup = await merchant.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Coffee Merchant', email: `merchant+${tag}@example.com`, password: 'StrongPassword!2026' },
    });
    expect(signup.status).toBe(201);

    const agentRes = await merchant.fetchJson('/api/agents', {
      method: 'POST',
      body: { name: 'Store Catalog Agent', defaultLanguage: 'pt' },
    });
    expect(agentRes.status).toBe(201);
    const agentId: string = agentRes.data.item.id;

    const p1 = await merchant.fetchJson(`/api/agents/${agentId}/products`, {
      method: 'POST',
      body: {
        name: 'Cafeteira Expresso Pro',
        description: 'Máquina de café espresso profissional com bomba de 15 bar',
        priceLabel: 'R$ 1.290',
        checkoutUrl: 'https://checkout.example.com/cafeteira',
      },
    });
    const p2 = await merchant.fetchJson(`/api/agents/${agentId}/products`, {
      method: 'POST',
      body: {
        name: 'Moedor de Grãos Precision',
        description: 'Moedor elétrico cônico para moagem perfeita de grãos',
        priceLabel: 'R$ 490',
        checkoutUrl: 'https://checkout.example.com/moedor',
      },
    });
    const p3 = await merchant.fetchJson(`/api/agents/${agentId}/products`, {
      method: 'POST',
      body: {
        name: 'Kit Xícaras Térmicas',
        description: 'Conjunto de xícaras em vidro duplo térmico para bebidas',
        priceLabel: 'R$ 189',
        checkoutUrl: 'https://checkout.example.com/xicaras',
      },
    });
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    expect(p3.status).toBe(201);

    const cafeteiraId: string = p1.data.item.id;
    const moedorId: string = p2.data.item.id;
    const xicarasId: string = p3.data.item.id;

    // 1. Multi-product matching query
    const multiRes = await merchant.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'Quero comprar Cafeteira e Moedor', pageUrl: '/pricing' },
    });
    expect(multiRes.status).toBe(200);
    const multiCards = multiRes.data.cards.filter((c: any) => c.type === 'product_card');
    const multiIds = multiCards.map((c: any) => c.productId);
    expect(multiCards.length).toBeGreaterThanOrEqual(2);
    expect(multiIds).toContain(cafeteiraId);
    expect(multiIds).toContain(moedorId);
    expect(multiIds).not.toContain(xicarasId);
    expect(new Set(multiIds).size).toBe(multiIds.length);

    // 2. Duplicate mentions of the same product still emit at most one product_card per productId
    const dupRes = await merchant.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'Quero comprar Cafeteira Cafeteira e ver preço da Cafeteira', pageUrl: '/pricing' },
    });
    expect(dupRes.status).toBe(200);
    const dupCards = dupRes.data.cards.filter((c: any) => c.type === 'product_card');
    const dupIds = dupCards.map((c: any) => c.productId);
    expect(dupIds.filter((id: string) => id === cafeteiraId).length).toBe(1);
    expect(new Set(dupIds).size).toBe(dupIds.length);

    // 3. Unmatched commercial query must NOT blindly fall back to agentProducts[0]
    const unmatchedRes = await merchant.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'Quero comprar Submarino Atomico', pageUrl: '/pricing' },
    });
    expect(unmatchedRes.status).toBe(200);
    const unmatchedCards = unmatchedRes.data.cards.filter((c: any) => c.type === 'product_card');
    expect(unmatchedCards.length).toBe(0);
  });

  it('(d) /api/widget/:agentId/* Same-App Origin Auto-Authorization & Strict 403 External Block', async () => {
    const tag = uniqueSuffix();
    const corsOwner = createTestClient(baseUrl);

    const signup = await corsOwner.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: { name: 'CORS Owner', email: `cors-owner+${tag}@example.com`, password: 'StrongPassword!2026' },
    });
    expect(signup.status).toBe(201);

    const agentRes = await corsOwner.fetchJson('/api/agents', {
      method: 'POST',
      body: {
        name: 'Strict CORS Agent',
        allowedDomains: ['https://allowed.askmink.test'],
      },
    });
    expect(agentRes.status).toBe(201);
    const agentId: string = agentRes.data.item.id;

    const selfOrigin = new URL(baseUrl).origin;
    const allowedOrigins = [
      selfOrigin,
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'https://allowed.askmink.test',
    ];

    for (const origin of allowedOrigins) {
      const cfgRes = await fetch(`${baseUrl}/api/widget/${agentId}/config`, {
        headers: { Origin: origin },
      });
      expect(cfgRes.status).toBe(200);
      expect(cfgRes.headers.get('access-control-allow-origin')).toBe(origin);
      expect(cfgRes.headers.get('access-control-allow-origin')).not.toBe('*');

      const preflightRes = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });
      expect(preflightRes.status).toBe(204);
      expect(preflightRes.headers.get('access-control-allow-origin')).toBe(origin);
      expect(preflightRes.headers.get('access-control-allow-origin')).not.toBe('*');
    }

    const allowedChatRes = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
      },
      body: JSON.stringify({ message: 'Hello from local sandbox', pageUrl: '/widget-test' }),
    });
    expect(allowedChatRes.status).toBe(200);
    expect(allowedChatRes.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');

    // Unlisted external origin must strictly fail with 403 across GET, OPTIONS, and POST
    const blockedOrigin = 'https://evil.attacker.example';
    const blockedCfg = await fetch(`${baseUrl}/api/widget/${agentId}/config`, {
      headers: { Origin: blockedOrigin },
    });
    expect(blockedCfg.status).toBe(403);

    const blockedPreflight = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: blockedOrigin,
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(blockedPreflight.status).toBe(403);

    const blockedChat = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: blockedOrigin,
      },
      body: JSON.stringify({ message: 'Blocked probe', pageUrl: '/' }),
    });
    expect(blockedChat.status).toBe(403);

    // Separate agent omitting allowedDomains inherits default :5173 dev origins
    const defaultAgentRes = await corsOwner.fetchJson('/api/agents', {
      method: 'POST',
      body: { name: 'Default CORS Agent' },
    });
    expect(defaultAgentRes.status).toBe(201);
    const defaultAgentId: string = defaultAgentRes.data.item.id;
    expect(defaultAgentRes.data.item.allowedDomains).toContain('http://127.0.0.1:5173');
    expect(defaultAgentRes.data.item.allowedDomains).toContain('http://localhost:5173');

    const defaultCfgRes = await fetch(`${baseUrl}/api/widget/${defaultAgentId}/config`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    expect(defaultCfgRes.status).toBe(200);
    expect(defaultCfgRes.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
  });

  it('(e) GET /api/auth/session (200) vs GET /api/auth/me (401 when logged out)', async () => {
    const tag = uniqueSuffix();
    const email = `session-user+${tag}@example.com`;
    const client = createTestClient(baseUrl);

    // 1. Logged out state
    const unauthSession = await client.fetchJson('/api/auth/session');
    expect(unauthSession.status).toBe(200);
    expect(unauthSession.data.authenticated).toBe(false);
    expect(unauthSession.data.user).toBeNull();
    expect(typeof unauthSession.data.mode).toBe('string');

    const unauthMe = await client.fetchJson('/api/auth/me');
    expect(unauthMe.status).toBe(401);
    expect(unauthMe.data.user).toBeNull();

    // 2. Authenticated state after signup
    const signup = await client.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Session User', email, password: 'StrongPassword!2026' },
    });
    expect(signup.status).toBe(201);

    const authSession = await client.fetchJson('/api/auth/session');
    expect(authSession.status).toBe(200);
    expect(authSession.data.authenticated).toBe(true);
    expect(authSession.data.user?.email).toBe(email);

    const authMe = await client.fetchJson('/api/auth/me');
    expect(authMe.status).toBe(200);
    expect(authMe.data.user?.email).toBe(email);

    // 3. Logged out again after logout
    const logout = await client.fetchJson('/api/auth/logout', { method: 'POST' });
    expect(logout.status).toBe(200);

    const afterLogoutSession = await client.fetchJson('/api/auth/session');
    expect(afterLogoutSession.status).toBe(200);
    expect(afterLogoutSession.data.authenticated).toBe(false);
    expect(afterLogoutSession.data.user).toBeNull();

    const afterLogoutMe = await client.fetchJson('/api/auth/me');
    expect(afterLogoutMe.status).toBe(401);
    expect(afterLogoutMe.data.user).toBeNull();
  });

  it('(f) Citation Deduplication + 1-Based Index, widget.js Gzip < 30KB & Zero Unsafe HTML Sinks', async () => {
    const tag = uniqueSuffix();
    const citOwner = createTestClient(baseUrl);

    const signup = await citOwner.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Citation Owner', email: `cit-owner+${tag}@example.com`, password: 'StrongPassword!2026' },
    });
    expect(signup.status).toBe(201);

    const agentRes = await citOwner.fetchJson('/api/agents', {
      method: 'POST',
      body: { name: 'Citation Dedup Agent' },
    });
    expect(agentRes.status).toBe(201);
    const agentId: string = agentRes.data.item.id;

    const para1 = `Section A covers MINK-DEDUP-TOKEN-7741 retention rules. ${'Enterprise audit compliance requires strict verification across regional nodes. '.repeat(9)}`.trim();
    const para2 = `Section B covers MINK-DEDUP-TOKEN-7741 escalation rules. ${'Quarterly verification ensures deterministic indexing across customer workspaces. '.repeat(9)}`.trim();
    const longContent = `${para1}\n\n${para2}`;

    const src1Res = await citOwner.fetchJson(`/api/agents/${agentId}/knowledge/text`, {
      method: 'POST',
      body: {
        title: 'Long Multi-Chunk Policy',
        content: longContent,
        sourceUrl: 'https://docs.example.com/multi-chunk-policy',
      },
    });
    const src2Res = await citOwner.fetchJson(`/api/agents/${agentId}/knowledge/text`, {
      method: 'POST',
      body: {
        title: 'Secondary Dedup Policy',
        content: 'Secondary addendum referencing MINK-DEDUP-TOKEN-7741 governance standards for regional teams.',
        sourceUrl: 'https://docs.example.com/secondary-policy',
      },
    });
    expect(src1Res.status).toBe(201);
    expect(src2Res.status).toBe(201);
    const src1Id: string = src1Res.data.item.id;
    const src2Id: string = src2Res.data.item.id;

    const readySources = await waitFor(
      () => citOwner.fetchJson(`/api/agents/${agentId}/knowledge`),
      (r) => {
        const s1 = r.data.items?.find((i: any) => i.id === src1Id);
        const s2 = r.data.items?.find((i: any) => i.id === src2Id);
        return s1?.status === 'ready' && s2?.status === 'ready';
      }
    );
    const s1Ready = readySources.data.items?.find((i: any) => i.id === src1Id);
    const s2Ready = readySources.data.items?.find((i: any) => i.id === src2Id);
    expect(s1Ready?.status).toBe('ready');
    expect(s2Ready?.status).toBe('ready');
    expect(s1Ready?.chunkCount).toBeGreaterThanOrEqual(2);

    const chatRes = await citOwner.fetchJson(`/api/agents/${agentId}/playground/chat`, {
      method: 'POST',
      body: { message: 'Explain MINK-DEDUP-TOKEN-7741 policy', pageUrl: '/docs/policy' },
    });
    expect(chatRes.status).toBe(200);
    expect(chatRes.data.trace.ragChunks.length).toBeGreaterThan(chatRes.data.citations.length);
    expect(chatRes.data.citations.length).toBe(2);
    const citedSourceIds = chatRes.data.citations.map((c: any) => c.sourceId);
    expect(new Set(citedSourceIds).size).toBe(chatRes.data.citations.length);
    expect(chatRes.data.citations.map((c: any) => c.index)).toEqual(
      chatRes.data.citations.map((_: any, i: number) => i + 1)
    );

    // 2. widget.js gzipped bundle size strictly < 30 KB
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const widgetPath = path.resolve(testDir, '../../../widget/dist/widget.js');
    expect(fs.existsSync(widgetPath)).toBe(true);
    const gzipped = zlib.gzipSync(fs.readFileSync(widgetPath));
    expect(gzipped.byteLength).toBeLessThan(30 * 1024);

    // 3. Zero unsafe HTML sinks across apps/web/src and apps/widget/src
    const webSrcDir = path.resolve(testDir, '../../../web/src');
    const widgetSrcDir = path.resolve(testDir, '../../../widget/src');
    const allSrcFiles = [...collectSourceFiles(webSrcDir), ...collectSourceFiles(widgetSrcDir)];
    expect(allSrcFiles.length).toBeGreaterThan(0);

    const unsafePattern = /(dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML)/;
    const violations: string[] = [];
    for (const filePath of allSrcFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (unsafePattern.test(content)) {
        violations.push(path.relative(path.resolve(testDir, '../../..'), filePath));
      }
    }
    expect(violations).toEqual([]);
  });

  it('(g) book_meeting AI Tool Returns BOOKING_CONFLICT Instead of Aborting Chat Turn with 400', async () => {
    const tag = uniqueSuffix();
    const conflictOwner = createTestClient(baseUrl);

    const signup = await conflictOwner.fetchJson('/api/auth/signup', {
      method: 'POST',
      body: {
        name: 'Conflict Owner',
        email: `conflict-owner+${tag}@example.com`,
        password: 'StrongPassword!2026',
      },
    });
    expect(signup.status).toBe(201);

    const agentRes = await conflictOwner.fetchJson('/api/agents', {
      method: 'POST',
      body: {
        name: 'Booking Conflict Agent',
        defaultLanguage: 'en',
        allowedDomains: ['http://127.0.0.1:5173'],
      },
    });
    expect(agentRes.status).toBe(201);
    const agentId: string = agentRes.data.item.id;

    // Pre-book a future 30-minute UTC slot
    const slotStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    slotStart.setUTCHours(15, 0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

    const preBookRes = await fetch(`${baseUrl}/api/widget/${agentId}/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
      },
      body: JSON.stringify({
        visitorName: 'First Booker',
        visitorEmail: 'first@example.com',
        startsAt: slotStart.toISOString(),
        endsAt: slotEnd.toISOString(),
        timezone: 'UTC',
      }),
    });
    expect(preBookRes.status).toBe(201);

    let llmCallCount = 0;
    let toolResultSeen: any = null;

    const mockLlmServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
          llmCallCount++;
          const payload = JSON.parse(rawBody || '{}');
          if (llmCallCount === 1) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'chatcmpl-conflict-step-1',
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'mock-gpt-conflict',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'call_book_conflict_1',
                          type: 'function',
                          function: {
                            name: 'book_meeting',
                            arguments: JSON.stringify({
                              visitorName: 'Second Visitor',
                              visitorEmail: 'second@example.com',
                              startsAt: slotStart.toISOString(),
                              endsAt: slotEnd.toISOString(),
                            }),
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
                usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
              })
            );
            return;
          }

          const toolMsg = Array.isArray(payload.messages)
            ? [...payload.messages].reverse().find((m: any) => m.role === 'tool')
            : null;
          if (toolMsg?.content) {
            try {
              toolResultSeen = JSON.parse(
                typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)
              );
            } catch {
              toolResultSeen = toolMsg.content;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'chatcmpl-conflict-step-2',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'mock-gpt-conflict',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'That time slot is already booked. Please pick another available slot.',
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 },
            })
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => mockLlmServer.listen(0, '127.0.0.1', resolve));
    try {
      const llmAddr = mockLlmServer.address() as { port: number };
      const mockLlmBaseUrl = `http://127.0.0.1:${llmAddr.port}/v1`;

      const keyRes = await conflictOwner.fetchJson('/api/provider-keys', {
        method: 'POST',
        body: {
          provider: 'openai-compatible',
          purpose: 'chat',
          label: 'Mock Conflict LLM',
          apiKey: 'sk-test-conflict-1234',
          baseUrl: mockLlmBaseUrl,
          defaultModel: 'mock-gpt-conflict',
          activate: true,
        },
      });
      expect(keyRes.status).toBe(201);

      const chatRes = await fetch(`${baseUrl}/api/widget/${agentId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5173',
        },
        body: JSON.stringify({
          message: 'Please book the 15:00 slot tomorrow',
          pageUrl: '/',
        }),
      });
      expect(chatRes.status).toBe(200);
      const chatData = (await chatRes.json()) as any;
      expect(llmCallCount).toBe(2);
      expect(toolResultSeen).toMatchObject({
        ok: false,
        code: 'BOOKING_CONFLICT',
      });
      expect(typeof toolResultSeen?.error).toBe('string');
      expect(chatData.text).toContain('already booked');
      expect(chatData.cards.some((c: any) => c.type === 'booking_confirmed')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => mockLlmServer.close(() => resolve()));
    }
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
        maxTokens: 512,
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
