import { z } from 'zod';

export const SUPPORTED_LANGUAGES = ['en', 'pt', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const AI_PROVIDERS = [
  'vercel-ai-gateway',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'openai-compatible',
  'mock',
] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export const PROVIDER_PURPOSES = ['chat', 'embedding'] as const;
export type ProviderPurpose = (typeof PROVIDER_PURPOSES)[number];

export const WEBHOOK_EVENTS = [
  'ticket.created',
  'booking.created',
  'lead.captured',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const DEFAULT_MODELS = {
  chat: 'tencent/hy4-flash',
  embedding: 'alibaba/qwen3-embedding-0.6b',
  gatewayBaseUrl: 'https://ai-gateway.vercel.sh/v1',
} as const;

export const INDEXED_EMBEDDING_DIMENSIONS = [768, 1024, 1536] as const;

// Strong password policy: min 8 chars (12+ recommended), max 128, all characters allowed
export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password must be at most 128 characters long');

export const SignupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255).toLowerCase(),
  password: PasswordSchema,
  workspaceName: z.string().trim().min(2).max(100).optional(),
});

export const LoginSchema = z.object({
  email: z.string().trim().email().max(255).toLowerCase(),
  password: z.string().min(1).max(128),
});

export const DEFAULT_ALLOWED_DOMAINS = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
] as const;

export const DEFAULT_SYSTEM_PROMPTS_BY_LANG: Record<SupportedLanguage, string> = {
  en: 'You are Askmink, a helpful AI sales and support agent. Answer accurately using the knowledge base, cite sources when applicable, and use tools when helpful.',
  pt: 'Você é o assistente de IA da Askmink para vendas e suporte. Responda com precisão usando a base de conhecimento, cite fontes quando aplicável e utilize as ferramentas disponíveis quando útil.',
  es: 'Eres el asistente de IA de Askmink para ventas y soporte. Responde con precisión usando la base de conocimiento, cita fuentes cuando corresponda y utiliza las herramientas disponibles cuando sea útil.',
};

export const DEFAULT_WELCOME_BY_LANG: Record<SupportedLanguage, string> = {
  en: 'Hi! How can I help you today?',
  pt: 'Olá! Como posso ajudar você hoje?',
  es: '¡Hola! ¿Cómo puedo ayudarte hoy?',
};

export const CreateAgentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().max(500).optional().default(''),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default('en'),
  systemPrompt: z.string().max(8000).default(DEFAULT_SYSTEM_PROMPTS_BY_LANG.en),
  welcomeMessage: z.string().max(500).default(DEFAULT_WELCOME_BY_LANG.en),
  starterPrompts: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  allowedDomains: z.array(z.string().trim().min(1).max(255)).default([...DEFAULT_ALLOWED_DOMAINS]),
  maxMessagesPerConversation: z.number().int().min(5).max(500).default(50),
  showBranding: z.boolean().default(true),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2563EB'),
});

export const UpdateAgentSchema = CreateAgentSchema.partial();

export const UpdateAccountAiSettingsSchema = z.object({
  chatProviderKeyId: z.string().uuid().nullable().optional(),
  chatModel: z.string().trim().min(1).max(200).optional(),
  embeddingProviderKeyId: z.string().uuid().nullable().optional(),
  embeddingModel: z.string().trim().min(1).max(200).optional(),
  confirmReindex: z.boolean().optional(),
});

export const UpdateAccountSettingsSchema = z.object({
  allowedDomains: z.array(z.string().trim().min(1).max(255)).max(100),
});

export const UpdateAccountProfileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  workspaceName: z.string().trim().min(2).max(100).optional(),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: PasswordSchema,
});

export const CreateProviderKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  purpose: z.enum(PROVIDER_PURPOSES),
  label: z.string().trim().min(2).max(100),
  apiKey: z.string().trim().min(1).max(1000),
  baseUrl: z.string().url().max(500).optional().or(z.literal('')),
  defaultModel: z.string().trim().max(200).optional(),
  activate: z.boolean().optional(),
});

type GlobalWithURL = typeof globalThis & {
  URL?: new (input: string) => { protocol: string; hostname?: string };
};

function isValidHttpUrl(value: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(value) || !/^https?:\/\//i.test(value)) {
    return false;
  }
  const URLCtor = (globalThis as GlobalWithURL).URL;
  if (typeof URLCtor === 'function') {
    try {
      const parsed = new URLCtor(value);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
    } catch {
      return false;
    }
  }
  return /^https?:\/\/[^/\s]+/i.test(value);
}

export const OptionalHttpSourceUrlSchema = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine(isValidHttpUrl, 'Must be a valid http:// or https:// URL'),
  ])
  .optional();

export const CreateKnowledgeTextSchema = z.object({
  title: z.string().trim().min(2).max(200),
  content: z.string().trim().min(10).max(200_000),
  sourceUrl: OptionalHttpSourceUrlSchema,
});

export const UpdateKnowledgeSourceSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  content: z.string().trim().min(10).max(200_000).optional(),
  sourceUrl: OptionalHttpSourceUrlSchema,
});

export const CreateKnowledgeUrlSchema = z.object({
  url: z.string().url().max(1000),
  title: z.string().trim().max(200).optional(),
  crawlType: z.enum(['url', 'sitemap', 'llms_txt']).default('url'),
  maxPages: z.number().int().min(1).max(50).default(10),
});

export const HttpToolParamSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().max(300),
  required: z.boolean().default(true),
  location: z.enum(['query', 'body', 'path', 'header']).default('body'),
  sessionClaim: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/)
    .optional(),
});
export type HttpToolParam = z.infer<typeof HttpToolParamSchema>;

export const CreateToolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/),
  description: z.string().trim().min(5).max(1000),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('GET'),
  url: z.string().url().max(1000),
  headers: z.record(z.string(), z.string()).default({}),
  parameters: z.array(HttpToolParamSchema).default([]),
  requiresConfirmation: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const UpdateToolSchema = CreateToolSchema.partial();

export const TestToolSchema = z.object({
  args: z.record(z.string(), z.unknown()).default({}),
  mockSession: z.record(z.string(), z.unknown()).optional(),
});

export const CreateMcpServerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  url: z.string().url().max(1000),
  headers: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
});

export const CreateProductSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().min(5).max(1000),
  priceLabel: z.string().trim().min(1).max(60),
  checkoutUrl: z.string().url().max(1000),
  imageUrl: z.string().url().max(1000).optional().or(z.literal('')),
  badge: z.string().trim().max(40).optional().default(''),
  active: z.boolean().default(true),
});

export const UpdateProductSchema = CreateProductSchema.partial();

export const AvailabilityRuleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  slotDurationMinutes: z.number().int().min(15).max(180).default(30),
  timezone: z.string().min(2).max(100).default('UTC'),
  enabled: z.boolean().default(true),
});

export const AvailabilityBlockSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().max(255).optional().default(''),
});

export const CreateBookingSchema = z.object({
  conversationId: z.string().uuid().optional(),
  visitorName: z.string().trim().min(2).max(120),
  visitorEmail: z.string().trim().email().max(255).toLowerCase(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().min(2).max(100).default('UTC'),
  notes: z.string().max(2000).optional().default(''),
});

export const CreateTicketSchema = z.object({
  conversationId: z.string().uuid().optional(),
  visitorEmail: z.string().trim().email().max(255).toLowerCase(),
  subject: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(5).max(4000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const UpdateTicketSchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

export const CreateLeadSchema = z.object({
  conversationId: z.string().uuid().optional(),
  name: z.string().trim().max(120).optional().default(''),
  email: z.string().trim().email().max(255).toLowerCase(),
  interest: z.string().max(500).optional().default(''),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const CreateWebhookSchema = z.object({
  url: z.string().url().max(1000),
  secret: z.string().min(16).max(256),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  active: z.boolean().default(true),
});

export const WidgetChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  pageUrl: z.string().max(2000).optional().default('/'),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  sessionJwt: z.string().max(4096).optional(),
  context: z.record(z.string(), z.unknown()).optional().default({}),
  confirmedToolCallId: z.string().optional(),
});

export interface Citation {
  index?: number;
  sourceId: string;
  title: string;
  url?: string;
  snippet: string;
  score: number;
}

export type GenerativeUICard =
  | {
      type: 'booking_slots';
      title: string;
      timezone: string;
      slots: Array<{ startsAt: string; endsAt: string; label: string }>;
    }
  | {
      type: 'booking_confirmed';
      bookingId: string;
      visitorName: string;
      startsAt: string;
      endsAt: string;
      icsDownloadUrl: string;
    }
  | {
      type: 'product_card';
      productId: string;
      name: string;
      description: string;
      priceLabel: string;
      checkoutUrl: string;
      badge?: string;
    }
  | {
      type: 'ticket_card';
      ticketId: string;
      subject: string;
      status: 'open' | 'resolved';
      summary: string;
    }
  | {
      type: 'diagnostic_card';
      toolName: string;
      status: 'success' | 'warning' | 'error';
      summary: string;
      details?: Record<string, unknown>;
    }
  | {
      type: 'confirmation_request';
      toolCallId: string;
      toolName: string;
      description: string;
      args: Record<string, unknown>;
    };

export interface MessagePart {
  type: 'text' | 'citation' | 'ui_card' | 'tool_call';
  text?: string;
  citations?: Citation[];
  card?: GenerativeUICard;
  toolName?: string;
  toolResult?: unknown;
}
