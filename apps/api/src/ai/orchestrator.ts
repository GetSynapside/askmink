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
  AIProvider,
  Citation,
  GenerativeUICard,
  MessagePart,
  SupportedLanguage,
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
import { BookingConflictError, createAtomicBooking, generateBookingIcs, getAvailableSlots } from '../schedule/index.js';

const LANGUAGE_DISPLAY_NAMES: Record<SupportedLanguage, string> = {
  pt: 'Portuguese (pt-BR)',
  es: 'Spanish (es)',
  en: 'English (en)',
};

const PT_STRONG_TOKENS = new Set([
  'voce', 'voces', 'nao', 'sao', 'estao', 'ola', 'oi', 'obrigado', 'obrigada',
  'quero', 'qual', 'quais', 'posso', 'preciso', 'gostaria', 'tenho', 'temos',
  'ajuda', 'ajudar', 'suporte', 'preco', 'precos', 'plano', 'planos',
  'produto', 'produtos', 'chamado', 'tambem', 'entao', 'quanto', 'isso', 'isto',
  'meu', 'minha', 'seu', 'sua', 'seus', 'suas', 'bom', 'boa', 'tudo', 'falar',
  'atendimento', 'pagamento', 'assinatura', 'custa', 'onde', 'pelo', 'pela',
  'dos', 'das', 'uma', 'uns', 'umas', 'pra', 'agora', 'cafeteira', 'moedor',
  'xicaras', 'graos', 'faco', 'fazer', 'oferecem', 'vendem', 'conhecer', 'mostra',
]);

const ES_STRONG_TOKENS = new Set([
  'hola', 'gracias', 'quiero', 'necesito', 'puedo', 'puedes', 'podria',
  'cual', 'cuales', 'cuanto', 'cuesta', 'tengo', 'tenemos', 'tienes', 'tiene', 'tienen',
  'ayuda', 'ayudar', 'soporte', 'precio', 'precios', 'producto', 'productos',
  'planes', 'tambien', 'entonces', 'pero', 'buenos', 'buenas', 'dias',
  'tardes', 'noches', 'usted', 'ustedes', 'nosotros', 'nuestro', 'nuestra',
  'suscripcion', 'atencion', 'hablar', 'cita', 'reservar', 'reunion',
  'informacion', 'muy', 'mas', 'sin', 'donde', 'ese', 'esa', 'quien',
  'cuando', 'ahora', 'tarjeta', 'tarjetas',
  'el', 'los', 'las', 'ofrecen', 'venden', 'muestra', 'conocer',
]);

const PT_ES_SHARED_TOKENS = new Set([
  'comprar', 'como', 'sobre', 'agendar', 'horario', 'horarios',
  'disponivel', 'disponiveis', 'disponible', 'disponibles',
  'funciona', 'reembolso', 'cancelar', 'aqui', 'favor',
]);

const EN_STRONG_TOKENS = new Set([
  'hello', 'hi', 'hey', 'thanks', 'thank', 'please', 'what', 'which',
  'where', 'when', 'why', 'how', 'who', 'would', 'could', 'should', 'can',
  'will', 'want', 'need', 'help', 'support', 'price', 'pricing', 'prices',
  'product', 'products', 'buy', 'purchase', 'checkout', 'schedule', 'meeting',
  'book', 'booking', 'ticket', 'broken', 'issue', 'error', 'tell', 'about',
  'included', 'the', 'this', 'that', 'these', 'those', 'with', 'from', 'for',
  'your', 'you', 'are', 'is', 'have', 'has', 'do', 'does', 'not',
  'available', 'order', 'status', 'refund', 'subscription', 'account',
  'explain', 'policy', 'confirm',
]);

export function detectMessageLanguage(text: string): SupportedLanguage | null {
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, ' ').trim();
  if (withoutUrls.length < 2) return null;

  let pt = 0;
  let es = 0;
  let en = 0;

  if (/[ãõç]/i.test(withoutUrls)) pt += 3;
  if (/[âêô]/i.test(withoutUrls)) pt += 2;
  if (/[ñ¿¡]/i.test(withoutUrls)) es += 3;

  const normalized = withoutUrls
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const tokens = normalized.match(/[a-z0-9]+/g) ?? [];

  for (const tok of tokens) {
    if (PT_STRONG_TOKENS.has(tok)) pt += 2;
    if (ES_STRONG_TOKENS.has(tok)) es += 2;
    if (PT_ES_SHARED_TOKENS.has(tok)) {
      pt += 1;
      es += 1;
    }
    if (EN_STRONG_TOKENS.has(tok)) en += 2;
  }

  const scores: Array<{ lang: SupportedLanguage; score: number }> = [
    { lang: 'en', score: en },
    { lang: 'pt', score: pt },
    { lang: 'es', score: es },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];
  if (!top || !second) return null;
  if (top.score >= 2 && top.score > second.score) {
    return top.lang;
  }
  return null;
}

export function normalizeCatalogText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const PRODUCT_STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'para', 'pra',
  'por', 'com', 'sem', 'um', 'uma', 'uns', 'umas', 'ao', 'aos', 'ou', 'as', 'os', 'sao', 'estao',
  'el', 'la', 'lo', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'con', 'sin', 'en', 'son', 'estan',
  'se', 'me', 'te', 'les', 'eu', 'tu', 'su', 'mi', 'le', 'si', 'ya', 'ja',
  'the', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'is', 'are', 'am', 'be', 'was', 'were',
  'by', 'if', 'it', 'my', 'no', 'so', 'up', 'us',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'have', 'has', 'had',
  'you', 'your', 'we', 'our', 'they', 'their', 'this', 'that', 'these', 'those', 'some', 'any',
  'want', 'need', 'buy', 'purchase', 'checkout', 'get', 'show', 'see', 'tell', 'list', 'find', 'offer', 'sell',
  'about', 'what', 'which', 'how', 'much', 'many', 'where', 'when', 'recommend', 'please', 'hi', 'hello', 'thanks',
  'quero', 'preciso', 'gostaria', 'comprar', 'ver', 'mostrar', 'mostra', 'mostre', 'conhecer', 'saber', 'existem', 'diga',
  'oferece', 'oferecem', 'oferecer', 'vende', 'vendem', 'vender',
  'quais', 'qual', 'como', 'onde', 'quando',
  'quanto', 'custa', 'custam', 'tem', 'temos', 'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas',
  'isso', 'isto', 'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'sobre',
  'voce', 'voces', 'pode', 'poderia', 'posso', 'indicar', 'sugerir', 'recomendar', 'ola', 'oi', 'obrigado', 'obrigada', 'favor',
  'quiero', 'necesito', 'cual', 'cuales', 'cuanto', 'cuantos', 'cuesta', 'cuestan', 'tiene', 'tienen',
  'tengo', 'hay', 'que', 'usted', 'ustedes', 'puedo', 'puedes', 'puede', 'hola', 'gracias', 'pero',
  'ofrece', 'ofrecen', 'ofrecer', 'venden', 'muestra', 'muestrame', 'conocer', 'existen', 'ensena', 'ensename', 'ensenar', 'dime',
]);

const BROAD_CATALOG_TERMS = new Set([
  'produto', 'produtos', 'producto', 'productos', 'product', 'products',
  'plano', 'planos', 'plan', 'plans', 'planes',
  'catalogo', 'catalog', 'catalogue', 'item', 'items', 'itens',
  'opcao', 'opcoes', 'opcion', 'opciones', 'option', 'options',
  'preco', 'precos', 'price', 'prices', 'pricing', 'precio', 'precios',
  'todos', 'todas', 'all', 'tudo', 'todo',
  'disponivel', 'disponiveis', 'available', 'disponible', 'disponibles',
  'servico', 'servicos', 'service', 'services', 'servicio', 'servicios',
]);

function tokenizeCatalogWords(text: string): string[] {
  const matches = normalizeCatalogText(text).match(/[a-z0-9]+/g) ?? [];
  return Array.from(new Set(matches.filter((t) => t.length >= 2)));
}

function wordMatchesToken(word: string, tok: string): boolean {
  if (word === tok) return true;
  if (Math.min(word.length, tok.length) >= 4) {
    return word.startsWith(tok) || tok.startsWith(word);
  }
  return false;
}

export interface CatalogProductItem {
  id: string;
  name: string;
  description: string;
  priceLabel: string;
  checkoutUrl: string;
  badge: string;
}

export interface RecommendProductsParams {
  products: CatalogProductItem[];
  query?: string;
  productId?: string;
  productIds?: string[];
  recommendedProductIds: Set<string>;
  cards: GenerativeUICard[];
  toolTraceLog: Array<Record<string, unknown>>;
  maxResults?: number;
}

export interface RecommendProductsResult {
  found: boolean;
  products: Array<{ id: string; name: string; priceLabel: string; badge?: string }>;
  emittedCardsCount: number;
  availableProducts: Array<{ id: string; name: string; priceLabel: string }>;
}

export function recommendProductsFromCatalog(
  params: RecommendProductsParams
): RecommendProductsResult {
  const {
    products: catalog,
    query,
    productId,
    productIds,
    recommendedProductIds,
    cards,
    toolTraceLog,
    maxResults = 5,
  } = params;

  const availableProducts = catalog.slice(0, 10).map((p) => ({
    id: p.id,
    name: p.name,
    priceLabel: p.priceLabel,
  }));

  if (catalog.length === 0) {
    toolTraceLog.push({
      tool: 'recommend_product',
      query,
      productId,
      productIds,
      matchedIds: [],
      emittedCount: 0,
    });
    return {
      found: false,
      products: [],
      emittedCardsCount: 0,
      availableProducts,
    };
  }

  const explicitIds: string[] = [];
  if (productId && productId.trim()) {
    explicitIds.push(productId.trim());
  }
  if (Array.isArray(productIds)) {
    for (const id of productIds) {
      const trimmed = id.trim();
      if (trimmed && !explicitIds.includes(trimmed)) {
        explicitIds.push(trimmed);
      }
    }
  }

  let matched: CatalogProductItem[] = [];
  if (explicitIds.length > 0) {
    matched = explicitIds
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is CatalogProductItem => Boolean(p))
      .slice(0, maxResults);
  }

  if (matched.length === 0 && (explicitIds.length === 0 || (query && query.trim().length > 0))) {
    const rawTokens = tokenizeCatalogWords(query ?? '').filter((t) => !PRODUCT_STOP_WORDS.has(t));
    const specificTokens = rawTokens.filter((t) => !BROAD_CATALOG_TERMS.has(t));

    if (rawTokens.length === 0 || specificTokens.length === 0) {
      if (explicitIds.length === 0) {
        matched = catalog.slice(0, maxResults);
      }
    } else {
      const scored: Array<{
        product: CatalogProductItem;
        matchedTokenCount: number;
        score: number;
      }> = [];

      for (const p of catalog) {
        const nameWords = tokenizeCatalogWords(p.name);
        const badgeWords = tokenizeCatalogWords(p.badge);
        const descWords = tokenizeCatalogWords(p.description);
        let matchedTokenCount = 0;
        let score = 0;

        for (const tok of specificTokens) {
          const inName = nameWords.some((w) => wordMatchesToken(w, tok));
          const inBadge = badgeWords.some((w) => wordMatchesToken(w, tok));
          const inDesc = descWords.some((w) => wordMatchesToken(w, tok));
          if (inName || inBadge || inDesc) {
            matchedTokenCount += 1;
            if (inName) score += 3;
            if (inBadge) score += 2;
            if (inDesc) score += 1;
          }
        }

        if (matchedTokenCount > 0) {
          scored.push({ product: p, matchedTokenCount, score });
        }
      }

      scored.sort((a, b) => b.matchedTokenCount - a.matchedTokenCount || b.score - a.score);
      matched = scored.slice(0, maxResults).map((s) => s.product);
    }
  }

  if (matched.length === 0) {
    toolTraceLog.push({
      tool: 'recommend_product',
      query,
      productId,
      productIds,
      matchedIds: [],
      emittedCount: 0,
    });
    return {
      found: false,
      products: [],
      emittedCardsCount: 0,
      availableProducts,
    };
  }

  let emittedCardsCount = 0;
  for (const prod of matched) {
    if (!recommendedProductIds.has(prod.id)) {
      recommendedProductIds.add(prod.id);
      cards.push({
        type: 'product_card',
        productId: prod.id,
        name: prod.name,
        description: prod.description,
        priceLabel: prod.priceLabel,
        checkoutUrl: prod.checkoutUrl,
        badge: prod.badge || undefined,
      });
      emittedCardsCount += 1;
    }
  }

  toolTraceLog.push({
    tool: 'recommend_product',
    query,
    productId,
    productIds,
    matchedIds: matched.map((p) => p.id),
    emittedCount: emittedCardsCount,
  });

  return {
    found: true,
    products: matched.map((p) => ({
      id: p.id,
      name: p.name,
      priceLabel: p.priceLabel,
      badge: p.badge || undefined,
    })),
    emittedCardsCount,
    availableProducts,
  };
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
  language: SupportedLanguage;
  text: string;
  parts: MessagePart[];
  citations: Citation[];
  cards: GenerativeUICard[];
  trace: {
    id: string;
    model: string;
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

    const detectedLanguage = detectMessageLanguage(input.message);
    const language: SupportedLanguage =
      detectedLanguage ?? input.language ?? (agent.defaultLanguage as SupportedLanguage) ?? 'en';

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

    const citationIndexBySource = new Map<string, number>();
    for (const cit of rag.citations) {
      if (typeof cit.index === 'number') {
        citationIndexBySource.set(cit.sourceId, cit.index);
      }
    }

    const cards: GenerativeUICard[] = [];
    const recommendedProductIds = new Set<string>();
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
      const normalizedLower = normalizeCatalogText(input.message);
      const isProductIntent =
        /\b(buy|price|pricing|plan|plans|plano|planos|planes|checkout|comprar|preco|precos|produto|produtos|producto|productos|product|products|precio|precios|catalogo|catalog|catalogue|recomenda\w*|recommend\w*|custa|cuesta)\b/.test(
          normalizedLower
        );

      if (
        lower.includes('schedule') ||
        lower.includes('agend') ||
        lower.includes('meeting') ||
        lower.includes('horário') ||
        lower.includes('horario') ||
        lower.includes('cita') ||
        lower.includes('reuni')
      ) {
        const slots = await getAvailableSlots({ db: this.db, agentId: agent.id, daysAhead: 7 });
        cards.push({
          type: 'booking_slots',
          title:
            language === 'pt'
              ? 'Horários disponíveis'
              : language === 'es'
                ? 'Horarios disponibles'
                : 'Available time slots',
          timezone: slots[0]?.timezone ?? 'UTC',
          slots: slots.slice(0, 6).map(({ startsAt, endsAt, label }) => ({ startsAt, endsAt, label })),
        });
        toolTraceLog.push({ tool: 'show_booking_slots', slotsFound: slots.length });
        assistantText =
          language === 'pt'
            ? 'Aqui estão os próximos horários disponíveis para agendar uma conversa.'
            : language === 'es'
              ? 'Aquí tienes los próximos horarios disponibles para agendar una reunión.'
              : 'Here are the next available time slots to schedule a meeting.';
      } else if (isProductIntent && agentProducts.length > 0) {
        const rec = recommendProductsFromCatalog({
          products: agentProducts,
          query: input.message,
          recommendedProductIds,
          cards,
          toolTraceLog,
        });
        if (!rec.found || rec.products.length === 0) {
          assistantText =
            language === 'pt'
              ? 'Não encontrei um produto exato com esse nome no catálogo ativo. Posso mostrar os itens disponíveis se desejar.'
              : language === 'es'
                ? 'No encontré un producto exacto con ese nombre en el catálogo activo. Puedo mostrarte los artículos disponibles si lo deseas.'
                : 'I could not find an exact matching product in the active catalog. Let me know if you would like to see our available options.';
        } else if (rec.products.length === 1) {
          const prod = rec.products[0]!;
          assistantText =
            language === 'pt'
              ? `Recomendo **${prod.name}** (${prod.priceLabel}). Você pode finalizar direto pelo card abaixo.`
              : language === 'es'
                ? `Te recomiendo **${prod.name}** (${prod.priceLabel}). Puedes continuar directamente con la tarjeta de abajo.`
                : `I recommend **${prod.name}** (${prod.priceLabel}). You can proceed directly via the checkout card below.`;
        } else {
          const names = rec.products.map((p) => `**${p.name}** (${p.priceLabel})`).join(', ');
          assistantText =
            language === 'pt'
              ? `Encontrei estas opções para você: ${names}. Você pode finalizar pelos cards abaixo.`
              : language === 'es'
                ? `Encontré estas opciones para ti: ${names}. Puedes continuar con las tarjetas de abajo.`
                : `I found these options for you: ${names}. You can proceed via the checkout cards below.`;
        }
      } else if (
        lower.includes('ticket') ||
        lower.includes('chamado') ||
        lower.includes('bug') ||
        lower.includes('broken')
      ) {
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
            summary: `Auto-generated support ticket: ${input.message}`,
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
            : language === 'es'
              ? `Abrí el ticket #${ticket!.id.slice(0, 8)} para nuestro equipo de soporte.`
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
            assistantText =
              language === 'pt'
                ? `Por favor, confirme antes de eu executar **${matchedTool.name}**.`
                : language === 'es'
                  ? `Por favor, confirma antes de que ejecute **${matchedTool.name}**.`
                  : `Please confirm before I execute **${matchedTool.name}**.`;
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
            assistantText =
              language === 'pt'
                ? `Executei **${matchedTool.name}** (HTTP ${execRes.status}).`
                : language === 'es'
                  ? `Ejecuté **${matchedTool.name}** (HTTP ${execRes.status}).`
                  : `Executed **${matchedTool.name}** (HTTP ${execRes.status}).`;
          }
        } else if (rag.chunks.length > 0) {
          const best = rag.chunks[0]!;
          const citIdx = citationIndexBySource.get(best.sourceId) ?? 1;
          assistantText =
            language === 'pt'
              ? `Com base em "${best.title}" [${citIdx}]: ${best.content.slice(0, 420)}`
              : language === 'es'
                ? `Según "${best.title}" [${citIdx}]: ${best.content.slice(0, 420)}`
                : `Based on "${best.title}" [${citIdx}]: ${best.content.slice(0, 420)}`;
        } else {
          assistantText =
            language === 'pt'
              ? `Olá! Recebi sua mensagem: "${input.message}". Como posso ajudar?`
              : language === 'es'
                ? `¡Hola! Recibí tu mensaje: "${input.message}". ¿Cómo puedo ayudarte?`
                : `Hi! I received your message: "${input.message}". How can I help?`;
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
          ? `\n\n## Retrieved Knowledge Base Context (cite sources using [N] matching the source number below):\n${rag.chunks
              .map((c, idx) => {
                const citationIndex = citationIndexBySource.get(c.sourceId) ?? idx + 1;
                return `[${citationIndex}] ${c.title}${c.url ? ` (${c.url})` : ''}:\n${c.content}`;
              })
              .join('\n\n')}`
          : '';

      const catalogSummaryBlock =
        agentProducts.length > 0
          ? `## Active Product Catalog (${agentProducts.length} active ${agentProducts.length === 1 ? 'item' : 'items'} — call recommend_product with productId, productIds, or query to render checkout cards):\n${agentProducts
              .slice(0, 25)
              .map(
                (p) =>
                  `- id="${p.id}" | name="${p.name}" | price="${p.priceLabel}"${p.badge ? ` | badge="${p.badge}"` : ''} | description="${p.description.slice(0, 140)}"`
              )
              .join('\n')}`
          : '';

      const systemPrompt = [
        agent.systemPrompt,
        `CRITICAL LANGUAGE INSTRUCTION: Always respond in ${LANGUAGE_DISPLAY_NAMES[language]}. Match the user's language in this turn (${LANGUAGE_DISPLAY_NAMES[language]}) even if knowledge base chunks or product catalog entries are written in another language.`,
        catalogSummaryBlock,
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
              title:
                language === 'pt'
                  ? 'Horários disponíveis'
                  : language === 'es'
                    ? 'Horarios disponibles'
                    : 'Available time slots',
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
            let booking;
            try {
              booking = await createAtomicBooking(this.db, {
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
            } catch (err) {
              if (err instanceof BookingConflictError) {
                toolTraceLog.push({ tool: 'book_meeting', conflict: true, error: err.message });
                return { ok: false, code: 'BOOKING_CONFLICT', error: err.message };
              }
              throw err;
            }
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
          description:
            'Show one or more active product or pricing plan checkout cards to the visitor. Prefer productId/productIds from the Active Product Catalog when known, or pass a search query.',
          parameters: z.object({
            query: z.string().optional(),
            productId: z.string().optional(),
            productIds: z.array(z.string()).max(10).optional(),
          }),
          execute: async ({ query, productId, productIds }) =>
            recommendProductsFromCatalog({
              products: agentProducts,
              query,
              productId,
              productIds,
              recommendedProductIds,
              cards,
              toolTraceLog,
            }),
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
        model: chatCreds.model,
        ragChunks: rag.chunks.map((c) => ({
          id: c.id,
          sourceId: c.sourceId,
          citationIndex: citationIndexBySource.get(c.sourceId),
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
      language,
      text: assistantText,
      parts,
      citations: rag.citations,
      cards,
      trace: {
        id: traceRow!.id,
        model: chatCreds.model,
        ragChunks: traceRow!.ragChunks,
        toolCalls: traceRow!.toolCalls,
        latencyMs,
        estimatedTokens,
      },
    };
  }
}
