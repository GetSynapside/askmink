import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { AskminkDb } from '@askmink/db';
import {
  agents,
  availabilityBlocks,
  availabilityRules,
  bookings,
  conversations,
  executionTraces,
  knowledgeChunks,
  knowledgeSources,
  leads,
  mcpServers,
  messages,
  outboundWebhooks,
  products,
  providerKeys,
  tickets,
  tools,
  usageEvents,
  users,
  workspaces,
} from '@askmink/db';
import {
  AvailabilityBlockSchema,
  AvailabilityRuleSchema,
  ChangePasswordSchema,
  CreateAgentSchema,
  CreateBookingSchema,
  CreateKnowledgeTextSchema,
  CreateKnowledgeUrlSchema,
  CreateLeadSchema,
  CreateMcpServerSchema,
  CreateProductSchema,
  CreateProviderKeySchema,
  CreateTicketSchema,
  CreateToolSchema,
  CreateWebhookSchema,
  DEFAULT_SYSTEM_PROMPTS_BY_LANG,
  DEFAULT_WELCOME_BY_LANG,
  LoginSchema,
  SignupSchema,
  TestToolSchema,
  UpdateAccountAiSettingsSchema,
  UpdateAccountProfileSchema,
  UpdateAccountSettingsSchema,
  UpdateAgentSchema,
  UpdateKnowledgeSourceSchema,
  UpdateProductSchema,
  UpdateTicketSchema,
  UpdateToolSchema,
  WidgetChatRequestSchema,
} from '@askmink/shared';
import type { AppConfig } from '../config.js';
import type { AuthService, AuthUser } from '../auth/index.js';
import {
  CryptoService,
  generateRandomToken,
  hashPassword,
  verifyPassword,
} from '../crypto/encryption.js';
import type { StorageAdapter } from '../storage/index.js';
import { validateKnowledgeUpload } from '../storage/index.js';
import type { JobRunner } from '../jobs/index.js';
import type { AgentOrchestrator } from '../ai/orchestrator.js';
import { checkWorkspaceEmbeddingModelMismatch } from '../rag/index.js';
import { executeHttpTool, listRemoteMcpTools } from '../tools/index.js';
import {
  BookingConflictError,
  createAtomicBooking,
  generateBookingIcs,
  getAvailableSlots,
} from '../schedule/index.js';
import { createRateLimiter } from '../security/middleware.js';
import { SsrfBlockedError } from '../security/ssrf.js';

export interface RouteDeps {
  db: AskminkDb;
  pool: Pool;
  config: AppConfig;
  auth: AuthService;
  crypto: CryptoService;
  storage: StorageAdapter;
  jobs: JobRunner;
  orchestrator: AgentOrchestrator;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function parseHttpOrigin(raw: string | undefined): URL | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.host || parsed.username || parsed.password) return null;
    if (parsed.origin.toLowerCase() !== trimmed.replace(/\/$/, '').toLowerCase()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isOriginAllowed(origin: string | undefined, allowedDomains: string[]): boolean {
  const parsedOrigin = parseHttpOrigin(origin);
  if (!parsedOrigin) return false;
  const normalizedOrigin = parsedOrigin.origin.toLowerCase();
  return allowedDomains.some((allowed) => {
    const normalizedAllowed = allowed.trim().replace(/\/$/, '').toLowerCase();
    return normalizedAllowed === normalizedOrigin;
  });
}

function isSameAppOrDevOrigin(
  origin: string | undefined,
  reqHost: string | undefined,
  config: AppConfig
): boolean {
  const parsedOrigin = parseHttpOrigin(origin);
  if (!parsedOrigin) return false;
  const normalizedOrigin = parsedOrigin.origin.toLowerCase();

  const appCandidates = [
    config.appUrl,
    ...(config.corsOrigin ? config.corsOrigin.split(',').map((s) => s.trim()) : []),
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ].filter(Boolean);

  for (const candidate of appCandidates) {
    const parsedCandidate = parseHttpOrigin(candidate);
    if (parsedCandidate && parsedCandidate.origin.toLowerCase() === normalizedOrigin) {
      return true;
    }
  }

  if (reqHost) {
    const normalizedReqHost = reqHost.trim().toLowerCase();
    if (
      normalizedReqHost &&
      !/[\s/@\\]/.test(normalizedReqHost) &&
      parsedOrigin.host.toLowerCase() === normalizedReqHost
    ) {
      return true;
    }
  }

  return false;
}

export function registerRoutes(app: Hono, deps: RouteDeps): void {
  const { db, pool, config, auth, crypto, storage, jobs, orchestrator } = deps;

  // Healthcheck
  app.get('/health', async (c) => {
    await pool.query('SELECT 1');
    return c.json({
      status: 'ok',
      mode: config.appMode,
      defaults: {
        chatModel: config.defaultChatModel,
        embeddingModel: config.defaultEmbeddingModel,
        gatewayConfigured: Boolean(config.aiGatewayApiKey),
      },
    });
  });

  // =========================================================================
  // Auth Routes
  // =========================================================================
  const authRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

  app.get('/api/auth/csrf', (c) => {
    const csrfToken = auth.issueCsrfCookie(c);
    return c.json({ csrfToken });
  });

  app.post('/api/auth/signup', authRateLimit, async (c) => {
    const parsed = SignupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    try {
      const { user, sessionToken } = await auth.signupLocal(parsed.data);
      auth.setSessionCookie(c, sessionToken);
      return c.json({ user }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 409);
    }
  });

  app.post('/api/auth/login', authRateLimit, async (c) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid credentials' }, 400);
    }
    try {
      const { user, sessionToken } = await auth.loginLocal(parsed.data);
      auth.setSessionCookie(c, sessionToken);
      return c.json({ user });
    } catch {
      return c.json({ error: 'Invalid email or password' }, 401);
    }
  });

  app.post('/api/auth/logout', async (c) => {
    const user = await auth.resolveRequestUser(c);
    if (user) {
      await auth.logoutAllUserSessions(user.userId);
    }
    auth.clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', async (c) => {
    const user = await auth.resolveRequestUser(c);
    if (!user) return c.json({ user: null }, 401);
    return c.json({ user, mode: config.appMode });
  });

  app.get('/api/auth/session', async (c) => {
    const user = await auth.resolveRequestUser(c);
    return c.json({
      authenticated: Boolean(user),
      user: user ?? null,
      mode: config.appMode,
    });
  });

  // =========================================================================
  // Authenticated Admin API (explicitly excludes /api/widget/* public routes)
  // =========================================================================
  const admin = new Hono<{ Variables: { authUser: AuthUser } }>();
  const adminRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 240 });
  const requireAdminAuth = auth.requireAuth();
  admin.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/widget/')) return next();
    return adminRateLimit(c, next);
  });
  admin.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/widget/')) return next();
    return requireAdminAuth(c, next);
  });

  // --- Global Account AI Settings & Provider Keys (BYOK) ---
  async function validateWorkspaceKeyRef(
    keyId: string | null | undefined,
    workspaceId: string,
    expectedPurpose: 'chat' | 'embedding'
  ): Promise<boolean> {
    if (!keyId) return true;
    const row = await db.query.providerKeys.findFirst({
      where: and(
        eq(providerKeys.id, keyId),
        eq(providerKeys.workspaceId, workspaceId),
        eq(providerKeys.purpose, expectedPurpose)
      ),
    });
    if (!row) return false;
    if (expectedPurpose === 'embedding' && row.provider === 'anthropic') {
      return false;
    }
    return true;
  }

  function sanitizeProviderKey(r: typeof providerKeys.$inferSelect) {
    return {
      id: r.id,
      provider: r.provider,
      purpose: r.purpose,
      label: r.label,
      keyLast4: r.keyLast4,
      baseUrl: r.baseUrl,
      defaultModel: r.defaultModel,
      createdAt: r.createdAt,
    };
  }

  admin.get('/account/profile', async (c) => {
    const { userId, workspaceId, role } = c.get('authUser');
    const [userRow, workspaceRow, agentCountRes] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, userId) }),
      db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(agents)
        .where(eq(agents.workspaceId, workspaceId)),
    ]);
    if (!userRow || !workspaceRow) {
      return c.json({ error: 'Account not found' }, 404);
    }

    return c.json({
      profile: {
        userId: userRow.id,
        name: userRow.name,
        email: userRow.email,
        authProvider: userRow.authProvider,
        createdAt: userRow.createdAt,
        workspaceId: workspaceRow.id,
        workspaceName: workspaceRow.name,
        role,
        agentsCount: agentCountRes[0]?.count ?? 0,
      },
    });
  });

  admin.patch('/account/profile', async (c) => {
    const { userId, workspaceId, role } = c.get('authUser');
    const parsed = UpdateAccountProfileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const [updatedUser] = await db
      .update(users)
      .set({ name: parsed.data.name })
      .where(eq(users.id, userId))
      .returning();

    let updatedWorkspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });

    if (parsed.data.workspaceName && (role === 'owner' || role === 'admin')) {
      const [ws] = await db
        .update(workspaces)
        .set({ name: parsed.data.workspaceName })
        .where(eq(workspaces.id, workspaceId))
        .returning();
      if (ws) updatedWorkspace = ws;
    }

    if (!updatedUser || !updatedWorkspace) {
      return c.json({ error: 'Account not found' }, 404);
    }

    return c.json({
      profile: {
        userId: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        authProvider: updatedUser.authProvider,
        createdAt: updatedUser.createdAt,
        workspaceId: updatedWorkspace.id,
        workspaceName: updatedWorkspace.name,
        role,
      },
    });
  });

  admin.post('/account/change-password', async (c) => {
    const { userId } = c.get('authUser');
    const parsed = ChangePasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const userRow = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!userRow || !userRow.passwordHash || userRow.authProvider !== 'local') {
      return c.json({ error: 'Password change is only available for local accounts' }, 400);
    }

    const valid = await verifyPassword(parsed.data.currentPassword, userRow.passwordHash);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const nextHash = await hashPassword(parsed.data.newPassword);
    await db.update(users).set({ passwordHash: nextHash }).where(eq(users.id, userId));
    return c.json({ ok: true });
  });

  admin.get('/account/ai-settings', async (c) => {
    const { workspaceId } = c.get('authUser');
    const [workspace, rows] = await Promise.all([
      db.query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
      }),
      db.query.providerKeys.findMany({
        where: eq(providerKeys.workspaceId, workspaceId),
        orderBy: [desc(providerKeys.createdAt)],
      }),
    ]);

    return c.json({
      settings: {
        chatProviderKeyId: workspace?.chatProviderKeyId ?? null,
        chatModel: workspace?.chatModel ?? config.defaultChatModel,
        embeddingProviderKeyId: workspace?.embeddingProviderKeyId ?? null,
        embeddingModel: workspace?.embeddingModel ?? config.defaultEmbeddingModel,
        gatewayConfigured: Boolean(config.aiGatewayApiKey),
        defaultChatModel: config.defaultChatModel,
        defaultEmbeddingModel: config.defaultEmbeddingModel,
      },
      // NEVER return encryptedApiKey or plaintext apiKey
      keys: rows.map(sanitizeProviderKey),
    });
  });

  admin.patch('/account/ai-settings', async (c) => {
    const { workspaceId } = c.get('authUser');
    const parsed = UpdateAccountAiSettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const [chatKeyOk, embKeyOk, existingWorkspace] = await Promise.all([
      validateWorkspaceKeyRef(parsed.data.chatProviderKeyId, workspaceId, 'chat'),
      validateWorkspaceKeyRef(parsed.data.embeddingProviderKeyId, workspaceId, 'embedding'),
      db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
    ]);
    if (!chatKeyOk || !embKeyOk) {
      return c.json({ error: 'Provider key not found in account or incompatible purpose' }, 400);
    }
    if (!existingWorkspace) {
      return c.json({ error: 'Account workspace not found' }, 404);
    }

    // Block embedding model change without explicit reindex confirmation if chunks already exist in account
    if (parsed.data.embeddingModel && parsed.data.embeddingModel !== existingWorkspace.embeddingModel) {
      const mismatch = await checkWorkspaceEmbeddingModelMismatch(
        db,
        workspaceId,
        parsed.data.embeddingModel
      );
      if (mismatch.hasIndexedChunks && !parsed.data.confirmReindex) {
        return c.json(
          {
            error: 'EMBEDDING_REINDEX_REQUIRED',
            message: `This account has ${mismatch.chunkCount} chunks indexed with "${mismatch.currentModel}". Confirm reindex to switch to "${parsed.data.embeddingModel}".`,
            currentModel: mismatch.currentModel,
            chunkCount: mismatch.chunkCount,
          },
          409
        );
      }
    }

    const { confirmReindex, ...patch } = parsed.data;
    const workspacePatch: Partial<typeof workspaces.$inferInsert> = {};
    if (patch.chatProviderKeyId !== undefined) workspacePatch.chatProviderKeyId = patch.chatProviderKeyId;
    if (patch.chatModel !== undefined) workspacePatch.chatModel = patch.chatModel;
    if (patch.embeddingProviderKeyId !== undefined) {
      workspacePatch.embeddingProviderKeyId = patch.embeddingProviderKeyId;
    }
    if (patch.embeddingModel !== undefined) workspacePatch.embeddingModel = patch.embeddingModel;

    let updated = existingWorkspace;
    if (Object.keys(workspacePatch).length > 0) {
      const [row] = await db
        .update(workspaces)
        .set(workspacePatch)
        .where(eq(workspaces.id, workspaceId))
        .returning();
      if (row) updated = row;

      // Sync global chat/embedding model labels onto workspace agents so agent metadata stays aligned
      const agentSyncPatch: Record<string, unknown> = {};
      if (patch.chatModel !== undefined) agentSyncPatch.chatModel = patch.chatModel;
      if (patch.embeddingModel !== undefined) agentSyncPatch.embeddingModel = patch.embeddingModel;
      if (Object.keys(agentSyncPatch).length > 0) {
        await db
          .update(agents)
          .set({ ...agentSyncPatch, updatedAt: new Date() })
          .where(eq(agents.workspaceId, workspaceId));
      }
    }

    // If embedding model changed with confirmReindex, enqueue re-indexing of all sources in workspace
    if (
      confirmReindex &&
      parsed.data.embeddingModel &&
      parsed.data.embeddingModel !== existingWorkspace.embeddingModel
    ) {
      const sources = await db.query.knowledgeSources.findMany({
        where: eq(knowledgeSources.workspaceId, workspaceId),
      });
      for (const s of sources) {
        await jobs.enqueueKnowledgeIngest({ sourceId: s.id, workspaceId, agentId: s.agentId });
      }
    }

    return c.json({
      settings: {
        chatProviderKeyId: updated.chatProviderKeyId ?? null,
        chatModel: updated.chatModel,
        embeddingProviderKeyId: updated.embeddingProviderKeyId ?? null,
        embeddingModel: updated.embeddingModel,
        gatewayConfigured: Boolean(config.aiGatewayApiKey),
        defaultChatModel: config.defaultChatModel,
        defaultEmbeddingModel: config.defaultEmbeddingModel,
      },
    });
  });

  // --- Global Account Settings (Allowed Domains for all agents) ---
  admin.get('/account/settings', async (c) => {
    const { workspaceId } = c.get('authUser');
    const [workspace, workspaceAgents] = await Promise.all([
      db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
      db.query.agents.findMany({
        where: eq(agents.workspaceId, workspaceId),
        columns: { allowedDomains: true },
      }),
    ]);

    const workspaceDomains = Array.isArray(workspace?.allowedDomains)
      ? workspace.allowedDomains
      : [];
    const effectiveDomains =
      workspaceDomains.length > 0
        ? workspaceDomains
        : Array.from(
            new Set(
              workspaceAgents.flatMap((a) =>
                Array.isArray(a.allowedDomains) ? a.allowedDomains : []
              )
            )
          );

    return c.json({
      settings: {
        allowedDomains: effectiveDomains,
      },
    });
  });

  admin.patch('/account/settings', async (c) => {
    const { workspaceId } = c.get('authUser');
    const parsed = UpdateAccountSettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const normalizedDomains = Array.from(
      new Set(parsed.data.allowedDomains.map((d) => d.trim()).filter(Boolean))
    );

    const [updatedWorkspace] = await db
      .update(workspaces)
      .set({ allowedDomains: normalizedDomains })
      .where(eq(workspaces.id, workspaceId))
      .returning();

    if (!updatedWorkspace) {
      return c.json({ error: 'Account workspace not found' }, 404);
    }

    await db
      .update(agents)
      .set({ allowedDomains: normalizedDomains, updatedAt: new Date() })
      .where(eq(agents.workspaceId, workspaceId));

    return c.json({
      settings: {
        allowedDomains: updatedWorkspace.allowedDomains ?? [],
      },
    });
  });

  admin.get('/provider-keys', async (c) => {
    const { workspaceId } = c.get('authUser');
    const rows = await db.query.providerKeys.findMany({
      where: eq(providerKeys.workspaceId, workspaceId),
      orderBy: [desc(providerKeys.createdAt)],
    });
    // NEVER return encryptedApiKey or plaintext apiKey
    return c.json({
      items: rows.map(sanitizeProviderKey),
    });
  });

  admin.post('/provider-keys', async (c) => {
    const { workspaceId } = c.get('authUser');
    const parsed = CreateProviderKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    if (parsed.data.provider === 'mock' && !config.allowMockProvider) {
      return c.json({ error: 'Mock provider is not allowed in this environment' }, 400);
    }
    if (parsed.data.provider === 'anthropic' && parsed.data.purpose === 'embedding') {
      return c.json(
        { error: 'Anthropic does not support embeddings. Please choose another provider for embeddings.' },
        400
      );
    }
    const encryptedApiKey = crypto.encrypt(parsed.data.apiKey);
    const keyLast4 = parsed.data.apiKey.slice(-4);
    const [created] = await db
      .insert(providerKeys)
      .values({
        workspaceId,
        provider: parsed.data.provider,
        purpose: parsed.data.purpose,
        label: parsed.data.label,
        encryptedApiKey,
        keyLast4,
        baseUrl: parsed.data.baseUrl || null,
        defaultModel: parsed.data.defaultModel || null,
      })
      .returning();

    if (parsed.data.activate === true && created) {
      if (parsed.data.purpose === 'chat') {
        const patch: Partial<typeof workspaces.$inferInsert> = {
          chatProviderKeyId: created.id,
        };
        if (parsed.data.defaultModel) {
          patch.chatModel = parsed.data.defaultModel;
        }
        await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId));
        if (parsed.data.defaultModel) {
          await db
            .update(agents)
            .set({ chatModel: parsed.data.defaultModel, updatedAt: new Date() })
            .where(eq(agents.workspaceId, workspaceId));
        }
      } else {
        await db
          .update(workspaces)
          .set({ embeddingProviderKeyId: created.id })
          .where(eq(workspaces.id, workspaceId));
      }
    }

    return c.json({ item: sanitizeProviderKey(created!) }, 201);
  });

  admin.delete('/provider-keys/:id', async (c) => {
    const { workspaceId } = c.get('authUser');
    await db
      .delete(providerKeys)
      .where(and(eq(providerKeys.id, c.req.param('id')), eq(providerKeys.workspaceId, workspaceId)));
    return c.json({ ok: true });
  });

  // --- Agents ---
  admin.get('/agents', async (c) => {
    const { workspaceId } = c.get('authUser');
    const [workspace, rows] = await Promise.all([
      db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
      db.query.agents.findMany({
        where: eq(agents.workspaceId, workspaceId),
        orderBy: [desc(agents.createdAt)],
      }),
    ]);
    const wsDomains = Array.isArray(workspace?.allowedDomains) ? workspace.allowedDomains : [];
    return c.json({
      items: rows.map(({ widgetJwtSecretEncrypted: _s, ...safe }) => ({
        ...safe,
        chatModel: workspace?.chatModel ?? safe.chatModel,
        embeddingModel: workspace?.embeddingModel ?? safe.embeddingModel,
        allowedDomains: wsDomains.length > 0 ? wsDomains : safe.allowedDomains,
      })),
    });
  });

  admin.post('/agents', async (c) => {
    const { workspaceId } = c.get('authUser');
    const rawBody = await c.req.json().catch(() => null);
    const parsed = CreateAgentSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    const wsDomains = Array.isArray(workspace?.allowedDomains) ? workspace.allowedDomains : [];
    const rawObj =
      rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : {};
    const hasExplicitDomains = Array.isArray(rawObj.allowedDomains);
    const resolvedDomains =
      wsDomains.length > 0 && !hasExplicitDomains ? wsDomains : parsed.data.allowedDomains;

    const hasCustomSystemPrompt =
      typeof rawObj.systemPrompt === 'string' && rawObj.systemPrompt.trim().length > 0;
    const hasCustomWelcomeMessage =
      typeof rawObj.welcomeMessage === 'string' && rawObj.welcomeMessage.trim().length > 0;

    const resolvedSystemPrompt = hasCustomSystemPrompt
      ? parsed.data.systemPrompt
      : DEFAULT_SYSTEM_PROMPTS_BY_LANG[parsed.data.defaultLanguage];
    const resolvedWelcomeMessage = hasCustomWelcomeMessage
      ? parsed.data.welcomeMessage
      : DEFAULT_WELCOME_BY_LANG[parsed.data.defaultLanguage];

    const widgetJwtSecret = generateRandomToken(32);
    const [created] = await db
      .insert(agents)
      .values({
        workspaceId,
        ...parsed.data,
        systemPrompt: resolvedSystemPrompt,
        welcomeMessage: resolvedWelcomeMessage,
        allowedDomains: resolvedDomains,
        chatProviderKeyId: null,
        embeddingProviderKeyId: null,
        chatModel: workspace?.chatModel ?? config.defaultChatModel,
        embeddingModel: workspace?.embeddingModel ?? config.defaultEmbeddingModel,
        widgetJwtSecretEncrypted: crypto.encrypt(widgetJwtSecret),
      })
      .returning();
    const { widgetJwtSecretEncrypted: _s, ...safe } = created!;
    return c.json({ item: safe, widgetJwtSecretOnce: widgetJwtSecret }, 201);
  });

  admin.get('/agents/:agentId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const [workspace, row] = await Promise.all([
      db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
      db.query.agents.findFirst({
        where: and(eq(agents.id, c.req.param('agentId')), eq(agents.workspaceId, workspaceId)),
      }),
    ]);
    if (!row) return c.json({ error: 'Agent not found' }, 404);
    const wsDomains = Array.isArray(workspace?.allowedDomains) ? workspace.allowedDomains : [];
    const { widgetJwtSecretEncrypted: _s, ...safe } = row;
    return c.json({
      item: {
        ...safe,
        chatModel: workspace?.chatModel ?? safe.chatModel,
        embeddingModel: workspace?.embeddingModel ?? safe.embeddingModel,
        allowedDomains: wsDomains.length > 0 ? wsDomains : safe.allowedDomains,
      },
    });
  });

  admin.patch('/agents/:agentId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    const parsed = UpdateAgentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }
    const [existing, workspace] = await Promise.all([
      db.query.agents.findFirst({
        where: and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)),
      }),
      db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) }),
    ]);
    if (!existing) return c.json({ error: 'Agent not found' }, 404);

    const [updated] = await db
      .update(agents)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .returning();

    const { widgetJwtSecretEncrypted: _s, ...safe } = updated!;
    return c.json({
      item: {
        ...safe,
        chatModel: workspace?.chatModel ?? safe.chatModel,
        embeddingModel: workspace?.embeddingModel ?? safe.embeddingModel,
      },
    });
  });

  admin.delete('/agents/:agentId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    const [deleted] = await db
      .delete(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .returning({ id: agents.id });
    if (!deleted) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ ok: true, id: deleted.id });
  });

  admin.post('/agents/:agentId/rotate-jwt-secret', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    const newSecret = generateRandomToken(32);
    const [updated] = await db
      .update(agents)
      .set({ widgetJwtSecretEncrypted: crypto.encrypt(newSecret), updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
      .returning();
    if (!updated) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ widgetJwtSecretOnce: newSecret });
  });

  // Helper to verify agent ownership
  async function assertAgentOwner(agentId: string, workspaceId: string) {
    if (!isUuid(agentId)) return undefined;
    return db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)),
    });
  }

  // --- Overview / Metering Dashboard ---
  admin.get('/agents/:agentId/overview', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    const agent = await assertAgentOwner(agentId, workspaceId);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const [convCount, openTicketCount, bookingCount, leadCount, sourceStats, usageStats, recentBookings, recentTickets] =
      await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(and(eq(conversations.agentId, agentId), eq(conversations.workspaceId, workspaceId))),
        db.select({ count: sql<number>`count(*)::int` }).from(tickets).where(and(eq(tickets.agentId, agentId), eq(tickets.status, 'open'))),
        db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.agentId, agentId), eq(bookings.status, 'confirmed'))),
        db.select({ count: sql<number>`count(*)::int` }).from(leads).where(eq(leads.agentId, agentId)),
        db.select({
          total: sql<number>`count(*)::int`,
          ready: sql<number>`count(*) filter (where status = 'ready')::int`,
          chunks: sql<number>`coalesce(sum(chunk_count), 0)::int`,
        }).from(knowledgeSources).where(eq(knowledgeSources.agentId, agentId)),
        db.select({
          turns: sql<number>`count(*)::int`,
          tokens: sql<number>`coalesce(sum(tokens_estimated), 0)::int`,
          toolCalls: sql<number>`coalesce(sum(tool_calls_count), 0)::int`,
        }).from(usageEvents).where(eq(usageEvents.agentId, agentId)),
        db.query.bookings.findMany({
          where: and(eq(bookings.agentId, agentId), eq(bookings.status, 'confirmed')),
          orderBy: [desc(bookings.startsAt)],
          limit: 5,
        }),
        db.query.tickets.findMany({
          where: eq(tickets.agentId, agentId),
          orderBy: [desc(tickets.createdAt)],
          limit: 5,
        }),
      ]);

    return c.json({
      kpis: {
        conversations: convCount[0]?.count ?? 0,
        openTickets: openTicketCount[0]?.count ?? 0,
        bookings: bookingCount[0]?.count ?? 0,
        leads: leadCount[0]?.count ?? 0,
      },
      knowledge: sourceStats[0] ?? { total: 0, ready: 0, chunks: 0 },
      usage: usageStats[0] ?? { turns: 0, tokens: 0, toolCalls: 0 },
      upcomingBookings: recentBookings,
      recentTickets,
    });
  });

  // --- Knowledge Base (Files, URLs/Sitemap/llms.txt, Manual Text/Q&A) ---
  admin.get('/agents/:agentId/knowledge', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const items = await db.query.knowledgeSources.findMany({
      where: and(eq(knowledgeSources.agentId, agentId), eq(knowledgeSources.workspaceId, workspaceId)),
      orderBy: [desc(knowledgeSources.createdAt)],
    });
    return c.json({ items });
  });

  admin.post('/agents/:agentId/knowledge/text', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateKnowledgeTextSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

    const [source] = await db
      .insert(knowledgeSources)
      .values({
        workspaceId,
        agentId,
        type: 'text',
        title: parsed.data.title,
        sourceUrl: parsed.data.sourceUrl || null,
        rawContent: parsed.data.content,
        status: 'pending',
      })
      .returning();

    await jobs.enqueueKnowledgeIngest({ sourceId: source!.id, workspaceId, agentId });
    return c.json({ item: source }, 201);
  });

  admin.post('/agents/:agentId/knowledge/url', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateKnowledgeUrlSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

    const [source] = await db
      .insert(knowledgeSources)
      .values({
        workspaceId,
        agentId,
        type: parsed.data.crawlType,
        title: parsed.data.title || parsed.data.url,
        sourceUrl: parsed.data.url,
        status: 'pending',
      })
      .returning();

    await jobs.enqueueKnowledgeIngest({
      sourceId: source!.id,
      workspaceId,
      agentId,
      crawlType: parsed.data.crawlType,
      maxPages: parsed.data.maxPages,
    });
    return c.json({ item: source }, 201);
  });

  admin.post('/agents/:agentId/knowledge/upload', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return c.json({ error: 'Missing file field in multipart upload' }, 400);
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const validated = validateKnowledgeUpload(file.name, buffer);
      const storageKey = await storage.save(validated.buffer, validated.extension);
      const [source] = await db
        .insert(knowledgeSources)
        .values({
          workspaceId,
          agentId,
          type: 'file',
          title: validated.originalName,
          storageKey,
          status: 'pending',
        })
        .returning();

      await jobs.enqueueKnowledgeIngest({ sourceId: source!.id, workspaceId, agentId });
      return c.json({ item: source }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  admin.patch('/agents/:agentId/knowledge/:sourceId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    const sourceId = c.req.param('sourceId');
    if (!(await assertAgentOwner(agentId, workspaceId))) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    if (!isUuid(sourceId)) {
      return c.json({ error: 'Source not found' }, 404);
    }

    const parsed = UpdateKnowledgeSourceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const { title, content, sourceUrl } = parsed.data;
    if (title === undefined && content === undefined && sourceUrl === undefined) {
      return c.json({ error: 'At least one field (title, content, or sourceUrl) must be provided' }, 400);
    }

    const existing = await db.query.knowledgeSources.findFirst({
      where: and(
        eq(knowledgeSources.id, sourceId),
        eq(knowledgeSources.agentId, agentId),
        eq(knowledgeSources.workspaceId, workspaceId)
      ),
    });
    if (!existing) {
      return c.json({ error: 'Source not found' }, 404);
    }

    if (content !== undefined && existing.type !== 'text') {
      return c.json({ error: 'Content can only be edited for text knowledge sources' }, 400);
    }

    if (
      sourceUrl === '' &&
      (existing.type === 'url' || existing.type === 'sitemap' || existing.type === 'llms_txt')
    ) {
      return c.json({ error: 'sourceUrl cannot be empty for URL knowledge sources' }, 400);
    }

    const nextTitle = title ?? existing.title;
    const nextRawContent = content !== undefined ? content : existing.rawContent;
    const nextSourceUrl =
      sourceUrl === undefined ? existing.sourceUrl : sourceUrl === '' ? null : sourceUrl;

    const needsReingest =
      nextTitle !== existing.title ||
      nextRawContent !== existing.rawContent ||
      nextSourceUrl !== existing.sourceUrl;

    const updateSet: Partial<typeof knowledgeSources.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (title !== undefined) updateSet.title = title;
    if (content !== undefined) updateSet.rawContent = content;
    if (sourceUrl !== undefined) updateSet.sourceUrl = nextSourceUrl;
    if (needsReingest) {
      updateSet.status = 'pending';
      updateSet.errorMessage = null;
    }

    const [updated] = await db
      .update(knowledgeSources)
      .set(updateSet)
      .where(
        and(
          eq(knowledgeSources.id, existing.id),
          eq(knowledgeSources.agentId, agentId),
          eq(knowledgeSources.workspaceId, workspaceId)
        )
      )
      .returning();

    if (needsReingest && updated) {
      await jobs.enqueueKnowledgeIngest({
        sourceId: updated.id,
        workspaceId,
        agentId,
        ...(updated.type === 'url' || updated.type === 'sitemap' || updated.type === 'llms_txt'
          ? {
              crawlType: updated.type,
              allowLoopbackForTest:
                config.nodeEnv === 'test' && c.req.header('x-test-allow-loopback') === '1',
            }
          : {}),
      });
    }

    return c.json({ item: updated, source: updated });
  });

  admin.delete('/agents/:agentId/knowledge/:sourceId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const source = await db.query.knowledgeSources.findFirst({
      where: and(
        eq(knowledgeSources.id, c.req.param('sourceId')),
        eq(knowledgeSources.agentId, c.req.param('agentId')),
        eq(knowledgeSources.workspaceId, workspaceId)
      ),
    });
    if (!source) return c.json({ error: 'Source not found' }, 404);
    if (source.storageKey) {
      await storage.delete(source.storageKey).catch(() => undefined);
    }
    await db.delete(knowledgeSources).where(eq(knowledgeSources.id, source.id));
    return c.json({ ok: true });
  });

  // --- HTTP Tool Builder & Test Tool ---
  admin.get('/agents/:agentId/tools', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const rows = await db.query.tools.findMany({
      where: and(eq(tools.agentId, agentId), eq(tools.workspaceId, workspaceId)),
      orderBy: [desc(tools.createdAt)],
    });
    return c.json({
      items: rows.map(({ headersEncrypted, ...safe }) => ({
        ...safe,
        hasHeaders: Boolean(headersEncrypted),
      })),
    });
  });

  admin.post('/agents/:agentId/tools', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateToolSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

    const { headers, ...rest } = parsed.data;
    const headersEncrypted = Object.keys(headers).length > 0 ? crypto.encryptJson(headers) : null;
    const [created] = await db
      .insert(tools)
      .values({ workspaceId, agentId, ...rest, headersEncrypted })
      .returning();
    const { headersEncrypted: _h, ...safe } = created!;
    return c.json({ item: { ...safe, hasHeaders: Boolean(_h) } }, 201);
  });

  admin.patch('/agents/:agentId/tools/:toolId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const parsed = UpdateToolSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    const { headers, ...rest } = parsed.data;
    const patch: Record<string, unknown> = { ...rest };
    if (headers) {
      patch.headersEncrypted = Object.keys(headers).length > 0 ? crypto.encryptJson(headers) : null;
    }
    const [updated] = await db
      .update(tools)
      .set(patch)
      .where(
        and(
          eq(tools.id, c.req.param('toolId')),
          eq(tools.agentId, c.req.param('agentId')),
          eq(tools.workspaceId, workspaceId)
        )
      )
      .returning();
    if (!updated) return c.json({ error: 'Tool not found' }, 404);
    const { headersEncrypted: _h, ...safe } = updated;
    return c.json({ item: { ...safe, hasHeaders: Boolean(_h) } });
  });

  admin.delete('/agents/:agentId/tools/:toolId', async (c) => {
    const { workspaceId } = c.get('authUser');
    await db
      .delete(tools)
      .where(
        and(
          eq(tools.id, c.req.param('toolId')),
          eq(tools.agentId, c.req.param('agentId')),
          eq(tools.workspaceId, workspaceId)
        )
      );
    return c.json({ ok: true });
  });

  admin.post('/agents/:agentId/tools/:toolId/test', async (c) => {
    const { workspaceId } = c.get('authUser');
    const parsed = TestToolSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'Validation failed' }, 400);

    const toolRow = await db.query.tools.findFirst({
      where: and(
        eq(tools.id, c.req.param('toolId')),
        eq(tools.agentId, c.req.param('agentId')),
        eq(tools.workspaceId, workspaceId)
      ),
    });
    if (!toolRow) return c.json({ error: 'Tool not found' }, 404);

    try {
      const headers = toolRow.headersEncrypted
        ? crypto.decryptJson<Record<string, string>>(toolRow.headersEncrypted)
        : {};
      const result = await executeHttpTool({
        method: toolRow.method,
        url: toolRow.url,
        headers,
        parameters: toolRow.parameters ?? [],
        llmArgs: parsed.data.args,
        sessionClaims: parsed.data.mockSession ?? null,
        allowLoopbackForTest: config.nodeEnv === 'test' && c.req.header('x-test-allow-loopback') === '1',
      });
      return c.json({ result });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return c.json({ error: err.message, code: 'SSRF_BLOCKED' }, 403);
      }
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // --- MCP Servers ---
  admin.get('/agents/:agentId/mcp-servers', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const rows = await db.query.mcpServers.findMany({
      where: and(eq(mcpServers.agentId, agentId), eq(mcpServers.workspaceId, workspaceId)),
    });
    return c.json({
      items: rows.map(({ headersEncrypted, ...safe }) => ({
        ...safe,
        hasHeaders: Boolean(headersEncrypted),
      })),
    });
  });

  admin.post('/agents/:agentId/mcp-servers', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateMcpServerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    const { headers, ...rest } = parsed.data;
    const [created] = await db
      .insert(mcpServers)
      .values({
        workspaceId,
        agentId,
        ...rest,
        headersEncrypted: Object.keys(headers).length > 0 ? crypto.encryptJson(headers) : null,
      })
      .returning();
    const { headersEncrypted: _h, ...safe } = created!;
    return c.json({ item: { ...safe, hasHeaders: Boolean(_h) } }, 201);
  });

  admin.post('/agents/:agentId/mcp-servers/:serverId/discover', async (c) => {
    const { workspaceId } = c.get('authUser');
    const server = await db.query.mcpServers.findFirst({
      where: and(
        eq(mcpServers.id, c.req.param('serverId')),
        eq(mcpServers.agentId, c.req.param('agentId')),
        eq(mcpServers.workspaceId, workspaceId)
      ),
    });
    if (!server) return c.json({ error: 'MCP server not found' }, 404);
    try {
      const headers = server.headersEncrypted
        ? crypto.decryptJson<Record<string, string>>(server.headersEncrypted)
        : {};
      const remoteTools = await listRemoteMcpTools(server.url, headers);
      return c.json({ tools: remoteTools });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  admin.delete('/agents/:agentId/mcp-servers/:serverId', async (c) => {
    const { workspaceId } = c.get('authUser');
    await db
      .delete(mcpServers)
      .where(
        and(
          eq(mcpServers.id, c.req.param('serverId')),
          eq(mcpServers.agentId, c.req.param('agentId')),
          eq(mcpServers.workspaceId, workspaceId)
        )
      );
    return c.json({ ok: true });
  });

  // --- Products / Checkout Cards ---
  admin.get('/agents/:agentId/products', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const items = await db.query.products.findMany({
      where: and(eq(products.agentId, agentId), eq(products.workspaceId, workspaceId)),
      orderBy: [desc(products.createdAt)],
    });
    return c.json({ items });
  });

  admin.post('/agents/:agentId/products', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateProductSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    const [created] = await db
      .insert(products)
      .values({ workspaceId, agentId, ...parsed.data, imageUrl: parsed.data.imageUrl || null })
      .returning();
    return c.json({ item: created }, 201);
  });

  admin.patch('/agents/:agentId/products/:productId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const parsed = UpdateProductSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed' }, 400);
    const [updated] = await db
      .update(products)
      .set(parsed.data)
      .where(
        and(
          eq(products.id, c.req.param('productId')),
          eq(products.agentId, c.req.param('agentId')),
          eq(products.workspaceId, workspaceId)
        )
      )
      .returning();
    if (!updated) return c.json({ error: 'Product not found' }, 404);
    return c.json({ item: updated });
  });

  admin.delete('/agents/:agentId/products/:productId', async (c) => {
    const { workspaceId } = c.get('authUser');
    await db
      .delete(products)
      .where(
        and(
          eq(products.id, c.req.param('productId')),
          eq(products.agentId, c.req.param('agentId')),
          eq(products.workspaceId, workspaceId)
        )
      );
    return c.json({ ok: true });
  });

  // --- Native Schedule (Availability Rules, Blocks, Bookings) ---
  admin.get('/agents/:agentId/schedule', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const [rules, blocks, bookingRows] = await Promise.all([
      db.query.availabilityRules.findMany({ where: eq(availabilityRules.agentId, agentId) }),
      db.query.availabilityBlocks.findMany({ where: eq(availabilityBlocks.agentId, agentId) }),
      db.query.bookings.findMany({
        where: eq(bookings.agentId, agentId),
        orderBy: [desc(bookings.startsAt)],
      }),
    ]);
    return c.json({ rules, blocks, bookings: bookingRows });
  });

  admin.post('/agents/:agentId/availability-rules', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = AvailabilityRuleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    const [created] = await db
      .insert(availabilityRules)
      .values({ workspaceId, agentId, ...parsed.data })
      .returning();
    return c.json({ item: created }, 201);
  });

  admin.delete('/agents/:agentId/availability-rules/:ruleId', async (c) => {
    const { workspaceId } = c.get('authUser');
    await db
      .delete(availabilityRules)
      .where(
        and(
          eq(availabilityRules.id, c.req.param('ruleId')),
          eq(availabilityRules.workspaceId, workspaceId)
        )
      );
    return c.json({ ok: true });
  });

  admin.post('/agents/:agentId/availability-blocks', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = AvailabilityBlockSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed' }, 400);
    const [created] = await db
      .insert(availabilityBlocks)
      .values({
        workspaceId,
        agentId,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        reason: parsed.data.reason,
      })
      .returning();
    return c.json({ item: created }, 201);
  });

  admin.delete('/agents/:agentId/bookings/:bookingId', async (c) => {
    const { workspaceId } = c.get('authUser');
    await db
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(bookings.id, c.req.param('bookingId')),
          eq(bookings.agentId, c.req.param('agentId')),
          eq(bookings.workspaceId, workspaceId)
        )
      );
    return c.json({ ok: true });
  });

  // --- Playground & Inbox ---
  admin.post('/agents/:agentId/playground/chat', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = WidgetChatRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

    try {
      const result = await orchestrator.runChatTurn({
        agentId,
        workspaceId,
        ...parsed.data,
        allowLoopbackForTest: config.nodeEnv === 'test' && c.req.header('x-test-allow-loopback') === '1',
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  admin.get('/agents/:agentId/conversations', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const statusFilter = c.req.query('status');
    const conditions = [
      eq(conversations.agentId, agentId),
      eq(conversations.workspaceId, workspaceId),
    ];
    if (statusFilter && ['resolved_ai', 'ticket_open', 'lead_booked'].includes(statusFilter)) {
      conditions.push(eq(conversations.status, statusFilter));
    }
    const items = await db.query.conversations.findMany({
      where: and(...conditions),
      orderBy: [desc(conversations.updatedAt)],
      limit: 100,
    });
    return c.json({ items });
  });

  admin.get('/conversations/:conversationId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const conv = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.id, c.req.param('conversationId')),
        eq(conversations.workspaceId, workspaceId)
      ),
    });
    if (!conv) return c.json({ error: 'Conversation not found' }, 404);
    const [msgRows, traceRows] = await Promise.all([
      db.query.messages.findMany({
        where: eq(messages.conversationId, conv.id),
        orderBy: [messages.createdAt],
      }),
      db.query.executionTraces.findMany({
        where: eq(executionTraces.conversationId, conv.id),
        orderBy: [executionTraces.createdAt],
      }),
    ]);
    return c.json({ conversation: conv, messages: msgRows, traces: traceRows });
  });

  // --- Tickets & Leads ---
  admin.get('/agents/:agentId/tickets', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const items = await db.query.tickets.findMany({
      where: and(eq(tickets.agentId, agentId), eq(tickets.workspaceId, workspaceId)),
      orderBy: [desc(tickets.createdAt)],
    });
    return c.json({ items });
  });

  admin.patch('/agents/:agentId/tickets/:ticketId', async (c) => {
    const { workspaceId } = c.get('authUser');
    const parsed = UpdateTicketSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed' }, 400);
    const [updated] = await db
      .update(tickets)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(tickets.id, c.req.param('ticketId')),
          eq(tickets.agentId, c.req.param('agentId')),
          eq(tickets.workspaceId, workspaceId)
        )
      )
      .returning();
    if (!updated) return c.json({ error: 'Ticket not found' }, 404);
    return c.json({ item: updated });
  });

  admin.get('/agents/:agentId/leads', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const items = await db.query.leads.findMany({
      where: and(eq(leads.agentId, agentId), eq(leads.workspaceId, workspaceId)),
      orderBy: [desc(leads.createdAt)],
    });
    return c.json({ items });
  });

  // --- Outbound Webhooks ---
  admin.get('/agents/:agentId/webhooks', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const rows = await db.query.outboundWebhooks.findMany({
      where: and(eq(outboundWebhooks.agentId, agentId), eq(outboundWebhooks.workspaceId, workspaceId)),
    });
    return c.json({
      items: rows.map(({ secretEncrypted: _s, ...safe }) => safe),
    });
  });

  admin.post('/agents/:agentId/webhooks', async (c) => {
    const { workspaceId } = c.get('authUser');
    const agentId = c.req.param('agentId');
    if (!(await assertAgentOwner(agentId, workspaceId))) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateWebhookSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    const [created] = await db
      .insert(outboundWebhooks)
      .values({
        workspaceId,
        agentId,
        url: parsed.data.url,
        secretEncrypted: crypto.encrypt(parsed.data.secret),
        events: parsed.data.events,
        active: parsed.data.active,
      })
      .returning();
    const { secretEncrypted: _s, ...safe } = created!;
    return c.json({ item: safe }, 201);
  });

  admin.delete('/agents/:agentId/webhooks/:webhookId', async (c) => {
    const { workspaceId } = c.get('authUser');
    await db
      .delete(outboundWebhooks)
      .where(
        and(
          eq(outboundWebhooks.id, c.req.param('webhookId')),
          eq(outboundWebhooks.agentId, c.req.param('agentId')),
          eq(outboundWebhooks.workspaceId, workspaceId)
        )
      );
    return c.json({ ok: true });
  });

  app.route('/api', admin);

  // =========================================================================
  // Public Widget API (Dynamic CORS Allowlist per Agent + Rate Limiting)
  // =========================================================================
  const widgetRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });

  app.use('/api/widget/:agentId/*', widgetRateLimit, async (c, next) => {
    const agentId = c.req.param('agentId');
    if (!agentId || !isUuid(agentId)) return c.json({ error: 'Agent not found' }, 404);
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, agent.workspaceId),
      columns: { allowedDomains: true },
    });

    const origin = c.req.header('origin');
    const reqHost = c.req.header('host');
    const wsDomains = Array.isArray(workspace?.allowedDomains) ? workspace.allowedDomains : [];
    const allowed = wsDomains.length > 0 ? wsDomains : (agent.allowedDomains ?? []);
    // If Origin header is sent (browser cross-origin request), strictly enforce allowlist + same-app origin
    if (origin) {
      if (!isOriginAllowed(origin, allowed) && !isSameAppOrDevOrigin(origin, reqHost, config)) {
        return c.json({ error: 'Origin not allowed for this agent' }, 403);
      }
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    return next();
  });

  app.get('/api/widget/:agentId/config', async (c) => {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, c.req.param('agentId')),
    });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json({
      id: agent.id,
      name: agent.name,
      defaultLanguage: agent.defaultLanguage,
      welcomeMessage: agent.welcomeMessage,
      starterPrompts: agent.starterPrompts ?? [],
      primaryColor: agent.primaryColor,
      showBranding: agent.showBranding,
    });
  });

  app.post('/api/widget/:agentId/chat', async (c) => {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, c.req.param('agentId')),
    });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const parsed = WidgetChatRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid chat payload' }, 400);

    const accept = c.req.header('accept') ?? '';
    const allowLoopback = config.nodeEnv === 'test' && c.req.header('x-test-allow-loopback') === '1';

    if (accept.includes('text/event-stream')) {
      return streamSSE(c, async (stream) => {
        try {
          const result = await orchestrator.runChatTurn({
            agentId: agent.id,
            workspaceId: agent.workspaceId,
            ...parsed.data,
            allowLoopbackForTest: allowLoopback,
          });
          await stream.writeSSE({ event: 'meta', data: JSON.stringify({ conversationId: result.conversationId, language: result.language }) });
          await stream.writeSSE({ event: 'text', data: JSON.stringify({ text: result.text }) });
          if (result.citations.length > 0) {
            await stream.writeSSE({ event: 'citations', data: JSON.stringify({ citations: result.citations }) });
          }
          for (const card of result.cards) {
            await stream.writeSSE({ event: 'card', data: JSON.stringify({ card }) });
          }
          await stream.writeSSE({ event: 'done', data: JSON.stringify({ messageId: result.messageId }) });
        } catch (err) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: (err as Error).message }) });
        }
      });
    }

    try {
      const result = await orchestrator.runChatTurn({
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        ...parsed.data,
        allowLoopbackForTest: allowLoopback,
      });
      return c.json({
        conversationId: result.conversationId,
        messageId: result.messageId,
        language: result.language,
        text: result.text,
        citations: result.citations,
        cards: result.cards,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/api/widget/:agentId/slots', async (c) => {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, c.req.param('agentId')) });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const slots = await getAvailableSlots({ db, agentId: agent.id, daysAhead: 7 });
    return c.json({ slots });
  });

  app.post('/api/widget/:agentId/bookings', async (c) => {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, c.req.param('agentId')) });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateBookingSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

    try {
      const booking = await createAtomicBooking(db, {
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        conversationId: parsed.data.conversationId,
        visitorName: parsed.data.visitorName,
        visitorEmail: parsed.data.visitorEmail,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        timezone: parsed.data.timezone,
        notes: parsed.data.notes,
      });

      const ics = generateBookingIcs({
        id: booking.id,
        agentName: agent.name,
        visitorName: booking.visitorName,
        visitorEmail: booking.visitorEmail,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        notes: booking.notes,
      });

      await Promise.all([
        jobs.enqueueWebhookEvent({
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          event: 'booking.created',
          payload: {
            bookingId: booking.id,
            visitorName: booking.visitorName,
            visitorEmail: booking.visitorEmail,
            startsAt: booking.startsAt.toISOString(),
            endsAt: booking.endsAt.toISOString(),
          },
          allowLoopbackForTest: config.nodeEnv === 'test' && c.req.header('x-test-allow-loopback') === '1',
        }),
        jobs.enqueueBookingEmail({
          to: booking.visitorEmail,
          subject: `Booking confirmed with ${agent.name}`,
          text: `Your meeting is confirmed for ${booking.startsAt.toISOString()}.`,
          icsContent: ics,
        }),
      ]);

      return c.json(
        {
          booking,
          icsDownloadUrl: `/api/widget/${agent.id}/bookings/${booking.id}/ics`,
        },
        201
      );
    } catch (err) {
      if (err instanceof BookingConflictError) {
        return c.json({ error: err.message, code: 'BOOKING_CONFLICT' }, 409);
      }
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/api/widget/:agentId/bookings/:bookingId/ics', async (c) => {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, c.req.param('agentId')) });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const booking = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, c.req.param('bookingId')), eq(bookings.agentId, agent.id)),
    });
    if (!booking) return c.json({ error: 'Booking not found' }, 404);

    const ics = generateBookingIcs({
      id: booking.id,
      agentName: agent.name,
      visitorName: booking.visitorName,
      visitorEmail: booking.visitorEmail,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      notes: booking.notes,
    });
    c.header('Content-Type', 'text/calendar; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="askmink-booking-${booking.id.slice(0, 8)}.ics"`);
    return c.body(ics);
  });

  app.post('/api/widget/:agentId/tickets', async (c) => {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, c.req.param('agentId')) });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateTicketSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed' }, 400);

    const [ticket] = await db
      .insert(tickets)
      .values({
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        conversationId: parsed.data.conversationId ?? null,
        visitorEmail: parsed.data.visitorEmail,
        subject: parsed.data.subject,
        summary: parsed.data.summary,
        priority: parsed.data.priority,
        status: 'open',
      })
      .returning();

    await jobs.enqueueWebhookEvent({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      event: 'ticket.created',
      payload: {
        ticketId: ticket!.id,
        visitorEmail: ticket!.visitorEmail,
        subject: ticket!.subject,
        summary: ticket!.summary,
      },
      allowLoopbackForTest: config.nodeEnv === 'test' && c.req.header('x-test-allow-loopback') === '1',
    });

    return c.json({ ticket }, 201);
  });

  app.post('/api/widget/:agentId/leads', async (c) => {
    const agent = await db.query.agents.findFirst({ where: eq(agents.id, c.req.param('agentId')) });
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const parsed = CreateLeadSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Validation failed' }, 400);

    const [lead] = await db
      .insert(leads)
      .values({
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        conversationId: parsed.data.conversationId ?? null,
        name: parsed.data.name,
        email: parsed.data.email,
        interest: parsed.data.interest,
        metadata: parsed.data.metadata,
      })
      .returning();

    await jobs.enqueueWebhookEvent({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      event: 'lead.captured',
      payload: { leadId: lead!.id, name: lead!.name, email: lead!.email, interest: lead!.interest },
      allowLoopbackForTest: config.nodeEnv === 'test' && c.req.header('x-test-allow-loopback') === '1',
    });

    return c.json({ lead }, 201);
  });
}
