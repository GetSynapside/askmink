import crypto from 'node:crypto';
import { generateText, tool as aiTool } from 'ai';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { AskminkDb } from '@askmink/db';
import {
  agents,
  conversations,
  executionTraces,
  leads,
  mcpServers,
  messages,
  products,
  providerKeys,
  tickets,
  tools as toolsTable,
  usageEvents,
  workspaces,
} from '@askmink/db';
import type {
  AgentMode,
  AIProvider,
  Citation,
  GenerativeUICard,
  MessagePart,
  SupportedLanguage,
  UrlRule,
} from '@askmink/shared';
import type { AppConfig } from '../config.js';
import type { CryptoService } from '../crypto/encryption.js';
import type { JobRunner } from '../jobs/index.js';
import { buildChatModel, type ResolvedProviderCredentials } from './providers.js';
import { hybridSearchKnowledge } from '../rag/index.js';
import {
  executeHttpTool,
  listRemoteMcpTools,
  callRemoteMcpTool,
  verifyWidgetSessionJwt,
  type VerifiedSessionClaims,
} from '../tools/index.js';
import { createAtomicBooking, generateBookingIcs, getAvailableSlots } from '../schedule/index.js';

export function matchUrlRule(pageUrl: string, rules: UrlRule[]): UrlRule | null {
  let pathname = pageUrl;
  try {
    if (pageUrl.startsWith('http://') || pageUrl.startsWith('https://')) {
      pathname = new URL(pageUrl).pathname;
    }
  } catch {
    pathname = pageUrl;
  }

  for (const rule of rules) {
    const escaped = rule.pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    if (regex.test(pathname)) {
      return rule;
    }
  }
  return null;
}

export interface ChatTurnInput {
  agentId: string;
  workspaceId: string;
  conversationId?: string;
  message: string;
  pageUrl: string;
  language?: SupportedLanguage;
  sessionJwt?: string;
  context?: Record<string, unknown>;
  confirmedToolCallId?: string;
  allowLoopbackForTest?: boolean;
}

export interface ChatTurnResult {
  conversationId: string;
  messageId: string;
  mode: AgentMode;
  language: SupportedLanguage;
  text: string;
  parts: MessagePart[];
  citations: Citation[];
  cards: GenerativeUICard[];
  trace: {
    id: string;
    model: string;
    mode: AgentMode;
    ragChunks: Array<Record<string, unknown>>;
    toolCalls: Array<Record<string, unknown>>;
    latencyMs: number;
    estimatedTokens: number;
  };
}

export class AgentOrchestrator {
  constructor(
    private readonly db: AskminkDb,
    private readonly pool: Pool,
    private readonly crypto: CryptoService,
    private readonly jobs: JobRunner,
    private readonly config: AppConfig
  ) {}

  private async resolveChatCredentials(agent: typeof agents.$inferSelect): Promise<ResolvedProviderCredentials> {
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(workspaces.id, agent.workspaceId),
    });

    if (workspace?.chatProviderKeyId) {
      const keyRow = await this.db.query.providerKeys.findFirst({
        where: and(
          eq(providerKeys.id, workspace.chatProviderKeyId),
          eq(providerKeys.workspaceId, agent.workspaceId),
          eq(providerKeys.purpose, 'chat')
        ),
      });
      if (keyRow) {
        return {
          provider: keyRow.provider as AIProvider,
          apiKey: this.crypto.decrypt(keyRow.encryptedApiKey),
          baseUrl: keyRow.baseUrl,
          model:
            workspace.chatModel ||
            keyRow.defaultModel ||
            agent.chatModel ||
            this.config.defaultChatModel,
        };
      }
    }

    const activeModel = workspace?.chatModel || agent.chatModel || this.config.defaultChatModel;

    if (this.config.aiGatewayApiKey) {
      return {
        provider: 'vercel-ai-gateway',
        apiKey: this.config.aiGatewayApiKey,
        baseUrl: this.config.aiGatewayBaseUrl,
        model: activeModel,
      };
    }

    if (this.config.allowMockProvider) {
      return {
        provider: 'mock',
        apiKey: 'mock',
        model: activeModel,
      };
    }

    throw new Error('No global chat AI provider key configured. Add a Chat BYOK key in Account Settings.');
  }

  private async resolveEmbeddingCredentialsOptional(
    agent: typeof agents.$inferSelect
  ): Promise<ResolvedProviderCredentials | null> {
    try {
      return await this.jobs.resolveEmbeddingCredentials(agent.id);
    } catch {
      return null;
    }
  }

  async runChatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
    const startMs = Date.now();
    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, input.agentId), eq(agents.workspaceId, input.workspaceId)),
    });
    if (!agent) {
      throw new Error('Agent not found');
    }

    const matchedRule = matchUrlRule(input.pageUrl || '/', agent.urlRules ?? []);
    const mode: AgentMode = matchedRule?.mode ?? 'sales';
    const language: SupportedLanguage =
      input.language ?? (agent.defaultLanguage as SupportedLanguage) ?? 'en';

    // Verify optional widget visitor JWT (strict HS256 + exp)
    let sessionClaims: VerifiedSessionClaims | null = null;
    if (input.sessionJwt) {
      const secret = this.crypto.decrypt(agent.widgetJwtSecretEncrypted);
      sessionClaims = await verifyWidgetSessionJwt(input.sessionJwt, secret);
    }

    // Load or create conversation
    let conversationId = input.conversationId;
    if (conversationId) {
      const existingConv = await this.db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, conversationId),
          eq(conversations.agentId, agent.id),
          eq(conversations.workspaceId, agent.workspaceId)
        ),
      });
      if (!existingConv) {
        conversationId = undefined;
      } else if (existingConv.messageCount >= agent.maxMessagesPerConversation) {
        throw new Error('Maximum messages per conversation limit reached');
      }
    }

    if (!conversationId) {
      const [conv] = await this.db
        .insert(conversations)
        .values({
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          mode,
          language,
          pageUrl: input.pageUrl || '/',
          visitorEmail:
            typeof sessionClaims?.email === 'string' ? sessionClaims.email : null,
          visitorId:
            typeof sessionClaims?.user_id === 'string'
              ? sessionClaims.user_id
              : typeof sessionClaims?.sub === 'string'
                ? sessionClaims.sub
                : null,
        })
        .returning();
      conversationId = conv!.id;
    }

    // Store user message
    await this.db.insert(messages).values({
      workspaceId: agent.workspaceId,
      conversationId,
      role: 'user',
      content: input.message,
      parts: [{ type: 'text', text: input.message }],
    });

    // Hybrid RAG Search
    const embeddingCreds = await this.resolveEmbeddingCredentialsOptional(agent);
    const rag = await hybridSearchKnowledge({
      pool: this.pool,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      query: input.message,
      embeddingCreds,
      config: this.config,
      topK: 5,
    });

    const cards: GenerativeUICard[] = [];
    const toolTraceLog: Array<Record<string, unknown>> = [];

    // Load agent products, custom HTTP tools, and MCP servers
    const [agentProducts, agentTools, agentMcpServers] = await Promise.all([
      this.db.query.products.findMany({
        where: and(eq(products.agentId, agent.id), eq(products.active, true)),
      }),
      this.db.query.tools.findMany({
        where: and(eq(toolsTable.agentId, agent.id), eq(toolsTable.enabled, true)),
      }),
      this.db.query.mcpServers.findMany({
        where: and(eq(mcpServers.agentId, agent.id), eq(mcpServers.enabled, true)),
      }),
    ]);

    const chatCreds = await this.resolveChatCredentials(agent);
    let assistantText = '';
    let estimatedTokens = Math.ceil(input.message.length / 4);

    if (chatCreds.provider === 'mock') {
      // Deterministic orchestrator path for offline E2E verification (real RAG, real tools, real cards!)
      const lower = input.message.toLowerCase();

      if (lower.includes('schedule') || lower.includes('agend') || lower.includes('meeting') || lower.includes('horário')) {
        const slots = await getAvailableSlots({ db: this.db, agentId: agent.id, daysAhead: 7 });
        cards.push({
          type: 'booking_slots',
          title: language === 'pt' ? 'Horários disponíveis' : 'Available time slots',
          timezone: slots[0]?.timezone ?? 'UTC',
          slots: slots.slice(0, 6).map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label })),
        });
        toolTraceLog.push({ tool: 'show_booking_slots', slotsFound: slots.length });
        assistantText =
          language === 'pt'
            ? 'Aqui estão os próximos horários disponíveis para agendar uma conversa.'
            : 'Here are the next available time slots to schedule a meeting.';
      } else if ((lower.includes('buy') || lower.includes('price') || lower.includes('plan') || lower.includes('checkout') || lower.includes('comprar') || lower.includes('preço')) && agentProducts.length > 0) {
        const prod = agentProducts[0]!;
        cards.push({
          type: 'product_card',
          productId: prod.id,
          name: prod.name,
          description: prod.description,
          priceLabel: prod.priceLabel,
          checkoutUrl: prod.checkoutUrl,
          badge: prod.badge || undefined,
        });
        toolTraceLog.push({ tool: 'recommend_product', productId: prod.id });
        assistantText =
          language === 'pt'
            ? `Recomendo o plano **${prod.name}** (${prod.priceLabel}). Você pode finalizar direto pelo card abaixo.`
            : `I recommend **${prod.name}** (${prod.priceLabel}). You can proceed directly via the checkout card below.`;
      } else if (lower.includes('ticket') || lower.includes('chamado') || lower.includes('bug') || lower.includes('broken')) {
        const visitorEmail =
          (typeof sessionClaims?.email === 'string' && sessionClaims.email) ||
          (typeof input.context?.email === 'string' && input.context.email) ||
          'visitor@example.com';
        const [ticket] = await this.db
          .insert(tickets)
          .values({
            workspaceId: agent.workspaceId,
            agentId: agent.id,
            conversationId,
            visitorEmail,
            subject: input.message.slice(0, 100),
            summary: `Auto-generated support ticket in ${mode} mode: ${input.message}`,
            priority: 'medium',
            status: 'open',
          })
          .returning();
        await this.db
          .update(conversations)
          .set({ status: 'ticket_open', updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));
        await this.jobs.enqueueWebhookEvent({
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          event: 'ticket.created',
          payload: {
            ticketId: ticket!.id,
            conversationId,
            visitorEmail,
            subject: ticket!.subject,
            summary: ticket!.summary,
          },
          allowLoopbackForTest: input.allowLoopbackForTest,
        });
        cards.push({
          type: 'ticket_card',
          ticketId: ticket!.id,
          subject: ticket!.subject,
          status: 'open',
          summary: ticket!.summary,
        });
        toolTraceLog.push({ tool: 'create_support_ticket', ticketId: ticket!.id });
        assistantText =
          language === 'pt'
            ? `Abri o chamado #${ticket!.id.slice(0, 8)} para nossa equipe de suporte.`
            : `I have opened support ticket #${ticket!.id.slice(0, 8)} for our team.`;
      } else {
        // Check if message mentions a configured custom HTTP tool name
        const matchedTool = agentTools.find((t) => lower.includes(t.name.toLowerCase()));
        if (matchedTool) {
          if (matchedTool.requiresConfirmation && !input.confirmedToolCallId) {
            const callId = crypto.randomUUID();
            cards.push({
              type: 'confirmation_request',
              toolCallId: callId,
              toolName: matchedTool.name,
              description: matchedTool.description,
              args: input.context ?? {},
            });
            toolTraceLog.push({ tool: matchedTool.name, status: 'awaiting_confirmation' });
            assistantText = `Please confirm before I execute **${matchedTool.name}**.`;
          } else {
            const decryptedHeaders = matchedTool.headersEncrypted
              ? this.crypto.decryptJson<Record<string, string>>(matchedTool.headersEncrypted)
              : {};
            const execRes = await executeHttpTool({
              method: matchedTool.method,
              url: matchedTool.url,
              headers: decryptedHeaders,
              parameters: matchedTool.parameters ?? [],
              llmArgs: input.context ?? {},
              sessionClaims,
              allowLoopbackForTest: input.allowLoopbackForTest,
            });
            cards.push({
              type: 'diagnostic_card',
              toolName: matchedTool.name,
              status: execRes.ok ? 'success' : 'error',
              summary: `HTTP ${execRes.status} (${execRes.durationMs}ms)`,
              details: typeof execRes.data === 'object' && execRes.data !== null ? (execRes.data as Record<string, unknown>) : { body: execRes.rawBody },
            });
            toolTraceLog.push({
              tool: matchedTool.name,
              status: execRes.status,
              durationMs: execRes.durationMs,
            });
            assistantText = `Executed **${matchedTool.name}** (HTTP ${execRes.status}).`;
          }
        } else if (rag.chunks.length > 0) {
          const best = rag.chunks[0]!;
          assistantText = `Based on "${best.title}": ${best.content.slice(0, 420)}`;
        } else {
          assistantText =
            mode === 'support'
              ? `[Support Mode] I received your question: "${input.message}".`
              : `[Sales Mode] Thanks for reaching out! How can I help with "${input.message}"?`;
        }
      }
      estimatedTokens += Math.ceil(assistantText.length / 4) + rag.chunks.length * 120;
    } else {
      // Real Vercel AI SDK multi-step orchestration with tools + RAG + Generative UI
      const recentMessages = await this.db.query.messages.findMany({
        where: eq(messages.conversationId, conversationId),
        orderBy: [desc(messages.createdAt)],
        limit: 12,
      });
      recentMessages.reverse();

      const ragContextBlock =
        rag.chunks.length > 0
          ? `\n\n## Retrieved Knowledge Base Context (cite sources in your answer):\n${rag.chunks
              .map((c, idx) => `[${idx + 1}] ${c.title}${c.url ? ` (${c.url})` : ''}:\n${c.content}`)
              .join('\n\n')}`
          : '';

      const modeInstruction =
        mode === 'sales'
          ? 'Current Mode: SALES. Focus on answering commercial questions, handling objections, recommending products with checkout cards, capturing leads, and scheduling demos.'
          : 'Current Mode: SUPPORT. Focus on accurate technical answers citing documentation, running diagnostic tools, and opening support tickets when needed.';

      const systemPrompt = [
        agent.systemPrompt,
        modeInstruction,
        matchedRule?.promptOverride ? `URL Rule Override: ${matchedRule.promptOverride}` : '',
        `Respond in language: ${language}.`,
        input.context && Object.keys(input.context).length > 0
          ? `Page context: ${JSON.stringify(input.context)}`
          : '',
        ragContextBlock,
      ]
        .filter(Boolean)
        .join('\n\n');

      const sdkTools: Record<string, any> = {
        show_booking_slots: aiTool({
          description: 'Show available meeting time slots from the native schedule to the visitor.',
          parameters: z.object({ daysAhead: z.number().int().min(1).max(14).default(7) }),
          execute: async ({ daysAhead }) => {
            const slots = await getAvailableSlots({ db: this.db, agentId: agent.id, daysAhead });
            cards.push({
              type: 'booking_slots',
              title: language === 'pt' ? 'Horários disponíveis' : 'Available time slots',
              timezone: slots[0]?.timezone ?? 'UTC',
              slots: slots.slice(0, 8).map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label })),
            });
            toolTraceLog.push({ tool: 'show_booking_slots', slotsFound: slots.length });
            return { slots: slots.slice(0, 8) };
          },
        }),
        book_meeting: aiTool({
          description: 'Atomically book a confirmed meeting slot for the visitor.',
          parameters: z.object({
            visitorName: z.string().min(2),
            visitorEmail: z.string().email(),
            startsAt: z.string().datetime(),
            endsAt: z.string().datetime(),
            notes: z.string().optional(),
          }),
          execute: async (args) => {
            const booking = await createAtomicBooking(this.db, {
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              conversationId,
              visitorName: args.visitorName,
              visitorEmail: args.visitorEmail,
              startsAt: new Date(args.startsAt),
              endsAt: new Date(args.endsAt),
              timezone: 'UTC',
              notes: args.notes,
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
              this.db
                .update(conversations)
                .set({ status: 'lead_booked', visitorEmail: booking.visitorEmail, updatedAt: new Date() })
                .where(eq(conversations.id, conversationId!)),
              this.jobs.enqueueWebhookEvent({
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
                allowLoopbackForTest: input.allowLoopbackForTest,
              }),
              this.jobs.enqueueBookingEmail({
                to: booking.visitorEmail,
                subject: `Booking confirmed with ${agent.name}`,
                text: `Your meeting is confirmed for ${booking.startsAt.toISOString()}.`,
                icsContent: ics,
              }),
            ]);
            cards.push({
              type: 'booking_confirmed',
              bookingId: booking.id,
              visitorName: booking.visitorName,
              startsAt: booking.startsAt.toISOString(),
              endsAt: booking.endsAt.toISOString(),
              icsDownloadUrl: `/api/widget/${agent.id}/bookings/${booking.id}/ics`,
            });
            toolTraceLog.push({ tool: 'book_meeting', bookingId: booking.id });
            return { ok: true, bookingId: booking.id };
          },
        }),
        recommend_product: aiTool({
          description: 'Show a product or pricing plan checkout card to the visitor.',
          parameters: z.object({ query: z.string().optional() }),
          execute: async ({ query }) => {
            const q = (query ?? '').toLowerCase();
            const matched =
              agentProducts.find(
                (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
              ) ?? agentProducts[0];
            if (!matched) return { found: false };
            cards.push({
              type: 'product_card',
              productId: matched.id,
              name: matched.name,
              description: matched.description,
              priceLabel: matched.priceLabel,
              checkoutUrl: matched.checkoutUrl,
              badge: matched.badge || undefined,
            });
            toolTraceLog.push({ tool: 'recommend_product', productId: matched.id });
            return { found: true, product: { id: matched.id, name: matched.name, priceLabel: matched.priceLabel } };
          },
        }),
        capture_lead: aiTool({
          description: 'Save visitor contact info (name/email) as a sales lead.',
          parameters: z.object({
            name: z.string().optional(),
            email: z.string().email(),
            interest: z.string().optional(),
          }),
          execute: async (args) => {
            const [lead] = await this.db
              .insert(leads)
              .values({
                workspaceId: agent.workspaceId,
                agentId: agent.id,
                conversationId,
                name: args.name ?? '',
                email: args.email,
                interest: args.interest ?? '',
              })
              .returning();
            await this.db
              .update(conversations)
              .set({ status: 'lead_booked', visitorEmail: args.email, updatedAt: new Date() })
              .where(eq(conversations.id, conversationId!));
            await this.jobs.enqueueWebhookEvent({
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              event: 'lead.captured',
              payload: { leadId: lead!.id, name: args.name, email: args.email, interest: args.interest },
              allowLoopbackForTest: input.allowLoopbackForTest,
            });
            toolTraceLog.push({ tool: 'capture_lead', leadId: lead!.id });
            return { ok: true, leadId: lead!.id };
          },
        }),
        create_support_ticket: aiTool({
          description: 'Open an internal support ticket linked to this conversation.',
          parameters: z.object({
            visitorEmail: z.string().email(),
            subject: z.string().min(3),
            summary: z.string().min(5),
            priority: z.enum(['low', 'medium', 'high']).default('medium'),
          }),
          execute: async (args) => {
            const [ticket] = await this.db
              .insert(tickets)
              .values({
                workspaceId: agent.workspaceId,
                agentId: agent.id,
                conversationId,
                visitorEmail: args.visitorEmail,
                subject: args.subject,
                summary: args.summary,
                priority: args.priority,
                status: 'open',
              })
              .returning();
            await this.db
              .update(conversations)
              .set({ status: 'ticket_open', visitorEmail: args.visitorEmail, updatedAt: new Date() })
              .where(eq(conversations.id, conversationId!));
            await this.jobs.enqueueWebhookEvent({
              workspaceId: agent.workspaceId,
              agentId: agent.id,
              event: 'ticket.created',
              payload: {
                ticketId: ticket!.id,
                conversationId,
                visitorEmail: args.visitorEmail,
                subject: args.subject,
                summary: args.summary,
              },
              allowLoopbackForTest: input.allowLoopbackForTest,
            });
            cards.push({
              type: 'ticket_card',
              ticketId: ticket!.id,
              subject: ticket!.subject,
              status: 'open',
              summary: ticket!.summary,
            });
            toolTraceLog.push({ tool: 'create_support_ticket', ticketId: ticket!.id });
            return { ok: true, ticketId: ticket!.id };
          },
        }),
      };

      // Register custom HTTP tools (excluding session-bound params from LLM schema so LLM can't spoof them)
      for (const customTool of agentTools) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const p of customTool.parameters ?? []) {
          if (p.sessionClaim) continue; // Immutable JWT claim — hidden from LLM args!
          let field: z.ZodTypeAny =
            p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean() : z.string();
          field = field.describe(p.description);
          shape[p.name] = p.required ? field : field.optional();
        }
        sdkTools[customTool.name] = aiTool({
          description: customTool.description,
          parameters: z.object(shape),
          execute: async (llmArgs: Record<string, unknown>) => {
            if (customTool.requiresConfirmation && !input.confirmedToolCallId) {
              const toolCallId = crypto.randomUUID();
              cards.push({
                type: 'confirmation_request',
                toolCallId,
                toolName: customTool.name,
                description: customTool.description,
                args: llmArgs,
              });
              toolTraceLog.push({ tool: customTool.name, status: 'awaiting_confirmation' });
              return { status: 'awaiting_user_confirmation', toolCallId };
            }
            const headers = customTool.headersEncrypted
              ? this.crypto.decryptJson<Record<string, string>>(customTool.headersEncrypted)
              : {};
            const res = await executeHttpTool({
              method: customTool.method,
              url: customTool.url,
              headers,
              parameters: customTool.parameters ?? [],
              llmArgs,
              sessionClaims,
              allowLoopbackForTest: input.allowLoopbackForTest,
            });
            cards.push({
              type: 'diagnostic_card',
              toolName: customTool.name,
              status: res.ok ? 'success' : 'error',
              summary: `HTTP ${res.status} (${res.durationMs}ms)`,
              details: typeof res.data === 'object' && res.data !== null ? (res.data as Record<string, unknown>) : { body: res.rawBody },
            });
            toolTraceLog.push({ tool: customTool.name, status: res.status, durationMs: res.durationMs });
            return { status: res.status, ok: res.ok, data: res.data };
          },
        });
      }

      // Register remote MCP server tools
      for (const server of agentMcpServers) {
        try {
          const headers = server.headersEncrypted
            ? this.crypto.decryptJson<Record<string, string>>(server.headersEncrypted)
            : {};
          const remoteTools = await listRemoteMcpTools(server.url, headers, input.allowLoopbackForTest);
          for (const rt of remoteTools) {
            const safeToolKey = `mcp_${server.name.replace(/[^a-zA-Z0-9]/g, '_')}_${rt.name}`;
            sdkTools[safeToolKey] = aiTool({
              description: rt.description || `Remote MCP tool ${rt.name} on ${server.name}`,
              parameters: z.record(z.string(), z.unknown()),
              execute: async (args: Record<string, unknown>) => {
                const res = await callRemoteMcpTool(
                  server.url,
                  headers,
                  rt.name,
                  args,
                  input.allowLoopbackForTest
                );
                cards.push({
                  type: 'diagnostic_card',
                  toolName: `${server.name}:${rt.name}`,
                  status: 'success',
                  summary: 'MCP tool executed',
                  details: typeof res === 'object' && res !== null ? (res as Record<string, unknown>) : { result: res },
                });
                toolTraceLog.push({ tool: safeToolKey, mcpServer: server.name });
                return res;
              },
            });
          }
        } catch (err) {
          toolTraceLog.push({ mcpServer: server.name, error: (err as Error).message });
        }
      }

      const model = buildChatModel(chatCreds, this.config);
      const genResult = await generateText({
        model,
        system: systemPrompt,
        messages: recentMessages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        tools: sdkTools,
        maxSteps: 5,
      });

      assistantText = genResult.text || 'Done.';
      estimatedTokens =
        (genResult.usage?.totalTokens ?? 0) ||
        Math.ceil((systemPrompt.length + assistantText.length) / 4);
    }

    const parts: MessagePart[] = [{ type: 'text', text: assistantText }];
    if (rag.citations.length > 0) {
      parts.push({ type: 'citation', citations: rag.citations });
    }
    for (const card of cards) {
      parts.push({ type: 'ui_card', card });
    }

    const [assistantMsg] = await this.db
      .insert(messages)
      .values({
        workspaceId: agent.workspaceId,
        conversationId,
        role: 'assistant',
        content: assistantText,
        parts,
      })
      .returning();

    const latencyMs = Date.now() - startMs;
    const [traceRow] = await this.db
      .insert(executionTraces)
      .values({
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        conversationId,
        messageId: assistantMsg!.id,
        mode,
        model: chatCreds.model,
        ragChunks: rag.chunks.map((c) => ({
          id: c.id,
          title: c.title,
          url: c.url,
          rrfScore: c.rrfScore,
          vectorRank: c.vectorRank,
          lexicalRank: c.lexicalRank,
          snippet: c.content.slice(0, 180),
        })),
        toolCalls: toolTraceLog,
        latencyMs,
        estimatedTokens,
      })
      .returning();

    await Promise.all([
      this.db
        .update(conversations)
        .set({
          messageCount: sql`${conversations.messageCount} + 2`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversationId)),
      this.db.insert(usageEvents).values({
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        conversationId,
        eventType: 'conversation_turn',
        tokensEstimated: estimatedTokens,
        toolCallsCount: toolTraceLog.length,
      }),
    ]);

    return {
      conversationId,
      messageId: assistantMsg!.id,
      mode,
      language,
      text: assistantText,
      parts,
      citations: rag.citations,
      cards,
      trace: {
        id: traceRow!.id,
        model: chatCreds.model,
        mode,
        ragChunks: traceRow!.ragChunks,
        toolCalls: traceRow!.toolCalls,
        latencyMs,
        estimatedTokens,
      },
    };
  }
}
