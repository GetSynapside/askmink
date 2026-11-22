import PgBoss from 'pg-boss';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { AskminkDb } from '@askmink/db';
import { agents, knowledgeSources, outboundWebhooks, providerKeys } from '@askmink/db';
import type { AIProvider, WebhookEvent } from '@askmink/shared';
import type { AppConfig } from '../config.js';
import { CryptoService, signHmacSha256 } from '../crypto/encryption.js';
import type { StorageAdapter } from '../storage/index.js';
import { crawlKnowledgeUrl, extractFileText, indexDocumentChunks } from '../rag/index.js';
import { safeFetch } from '../security/ssrf.js';
import { sendBookingEmailIfConfigured } from '../schedule/index.js';
import type { ResolvedProviderCredentials } from '../ai/providers.js';

export const QUEUE_KNOWLEDGE_INGEST = 'knowledge.ingest';
export const QUEUE_WEBHOOK_DELIVER = 'webhook.deliver';
export const QUEUE_BOOKING_EMAIL = 'email.booking';

export interface KnowledgeIngestJob {
  sourceId: string;
  workspaceId: string;
  agentId: string;
  crawlType?: 'url' | 'sitemap' | 'llms_txt';
  maxPages?: number;
  allowLoopbackForTest?: boolean;
}

export interface WebhookDeliverJob {
  webhookId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  allowLoopbackForTest?: boolean;
}

export interface BookingEmailJob {
  to: string;
  subject: string;
  text: string;
  icsContent: string;
}

export class JobRunner {
  private boss: PgBoss;
  private started = false;

  constructor(
    private readonly db: AskminkDb,
    private readonly pool: Pool,
    private readonly crypto: CryptoService,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig
  ) {
    this.boss = new PgBoss({
      connectionString: config.databaseUrl,
      schema: 'pgboss',
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    await this.boss.createQueue(QUEUE_KNOWLEDGE_INGEST);
    await this.boss.createQueue(QUEUE_WEBHOOK_DELIVER);
    await this.boss.createQueue(QUEUE_BOOKING_EMAIL);

    await this.boss.work<KnowledgeIngestJob>(QUEUE_KNOWLEDGE_INGEST, async (jobs) => {
      for (const job of jobs) {
        await this.handleKnowledgeIngest(job.data);
      }
    });

    await this.boss.work<WebhookDeliverJob>(QUEUE_WEBHOOK_DELIVER, async (jobs) => {
      for (const job of jobs) {
        await this.handleWebhookDeliver(job.data);
      }
    });

    await this.boss.work<BookingEmailJob>(QUEUE_BOOKING_EMAIL, async (jobs) => {
      for (const job of jobs) {
        await sendBookingEmailIfConfigured(this.config, job.data);
      }
    });

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, timeout: 5000 });
    this.started = false;
  }

  async enqueueKnowledgeIngest(data: KnowledgeIngestJob): Promise<string | null> {
    return this.boss.send(QUEUE_KNOWLEDGE_INGEST, data, { retryLimit: 2, retryDelay: 5 });
  }

  async enqueueWebhookEvent(params: {
    workspaceId: string;
    agentId: string;
    event: WebhookEvent;
    payload: Record<string, unknown>;
    allowLoopbackForTest?: boolean;
  }): Promise<void> {
    const hooks = await this.db.query.outboundWebhooks.findMany({
      where: and(
        eq(outboundWebhooks.workspaceId, params.workspaceId),
        eq(outboundWebhooks.agentId, params.agentId),
        eq(outboundWebhooks.active, true)
      ),
    });

    for (const hook of hooks) {
      if (hook.events.includes(params.event)) {
        await this.boss.send(
          QUEUE_WEBHOOK_DELIVER,
          {
            webhookId: hook.id,
            event: params.event,
            payload: params.payload,
            allowLoopbackForTest: params.allowLoopbackForTest,
          } satisfies WebhookDeliverJob,
          { retryLimit: 3, retryDelay: 5 }
        );
      }
    }
  }

  async enqueueBookingEmail(data: BookingEmailJob): Promise<void> {
    if (!this.config.smtp) return;
    await this.boss.send(QUEUE_BOOKING_EMAIL, data, { retryLimit: 2, retryDelay: 10 });
  }

  async resolveEmbeddingCredentials(agentId: string): Promise<ResolvedProviderCredentials> {
    const agent = await this.db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    if (!agent) throw new Error('Agent not found');

    if (agent.embeddingProviderKeyId) {
      const keyRow = await this.db.query.providerKeys.findFirst({
        where: eq(providerKeys.id, agent.embeddingProviderKeyId),
      });
      if (keyRow) {
        return {
          provider: keyRow.provider as AIProvider,
          apiKey: this.crypto.decrypt(keyRow.encryptedApiKey),
          baseUrl: keyRow.baseUrl,
          model: agent.embeddingModel || keyRow.defaultModel || this.config.defaultEmbeddingModel,
        };
      }
    }

    if (this.config.aiGatewayApiKey) {
      return {
        provider: 'vercel-ai-gateway',
        apiKey: this.config.aiGatewayApiKey,
        baseUrl: this.config.aiGatewayBaseUrl,
        model: agent.embeddingModel || this.config.defaultEmbeddingModel,
      };
    }

    if (this.config.allowMockProvider) {
      return {
        provider: 'mock',
        apiKey: 'mock',
        model: agent.embeddingModel || this.config.defaultEmbeddingModel,
      };
    }

    throw new Error('No embedding provider key configured for this agent');
  }

  async handleKnowledgeIngest(job: KnowledgeIngestJob): Promise<void> {
    const source = await this.db.query.knowledgeSources.findFirst({
      where: eq(knowledgeSources.id, job.sourceId),
    });
    if (!source) return;

    await this.db
      .update(knowledgeSources)
      .set({ status: 'processing', errorMessage: null, updatedAt: new Date() })
      .where(eq(knowledgeSources.id, source.id));

    try {
      const embeddingCreds = await this.resolveEmbeddingCredentials(job.agentId);
      let documents: Array<{ title: string; url?: string; content: string }> = [];

      if (source.type === 'text') {
        documents = [
          {
            title: source.title,
            url: source.sourceUrl ?? undefined,
            content: source.rawContent ?? '',
          },
        ];
      } else if (source.type === 'file' && source.storageKey) {
        const buffer = await this.storage.read(source.storageKey);
        const ext = source.storageKey.slice(source.storageKey.lastIndexOf('.')).toLowerCase();
        const text = await extractFileText(buffer, ext);
        documents = [{ title: source.title, content: text }];
      } else if (
        (source.type === 'url' || source.type === 'sitemap' || source.type === 'llms_txt') &&
        source.sourceUrl
      ) {
        documents = await crawlKnowledgeUrl(
          source.sourceUrl,
          job.crawlType ?? (source.type as 'url' | 'sitemap' | 'llms_txt'),
          job.maxPages ?? 10,
          job.allowLoopbackForTest ?? false
        );
      }

      await indexDocumentChunks({
        db: this.db,
        pool: this.pool,
        workspaceId: job.workspaceId,
        agentId: job.agentId,
        sourceId: source.id,
        documents,
        embeddingCreds,
        config: this.config,
      });
    } catch (err) {
      await this.db
        .update(knowledgeSources)
        .set({
          status: 'error',
          errorMessage: (err as Error).message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, source.id));
    }
  }

  async handleWebhookDeliver(job: WebhookDeliverJob): Promise<void> {
    const hook = await this.db.query.outboundWebhooks.findFirst({
      where: eq(outboundWebhooks.id, job.webhookId),
    });
    if (!hook || !hook.active) return;

    const secret = this.crypto.decrypt(hook.secretEncrypted);
    const body = JSON.stringify({
      event: job.event,
      timestamp: new Date().toISOString(),
      data: job.payload,
    });
    const signature = signHmacSha256(secret, body);

    const res = await safeFetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Askmink-Event': job.event,
        'X-Askmink-Signature': `sha256=${signature}`,
      },
      body,
      timeoutMs: 10_000,
      maxBytes: 64 * 1024,
      allowLoopbackForTest: job.allowLoopbackForTest ?? false,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Webhook delivery failed with HTTP ${res.status}`);
    }
  }
}
