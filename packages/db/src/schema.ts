import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  customType,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { HttpToolParam, MessagePart, UrlRule } from '@askmink/shared';

// Native unconstrained pgvector column: supports ANY embedding dimension (e.g. 768, 1024, 1536, 3072)
// without truncation or schema migrations. Partial expression HNSW indexes handle fast ANN search.
export const dynamicVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    if (!value) return [];
    return value
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .filter(Boolean)
      .map(Number);
  },
});

export const tsvectorCol = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

const uuidv7Pk = () =>
  uuid('id')
    .default(sql`uuidv7()`)
    .primaryKey();

export const users = pgTable('users', {
  id: uuidv7Pk(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'), // null for Auth0 cloud users
  authProvider: text('auth_provider').notNull().default('local'),
  externalAuthId: text('external_auth_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaces = pgTable('workspaces', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuidv7Pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('workspace_members_ws_user_idx').on(t.workspaceId, t.userId)]
);

export const sessions = pgTable('sessions', {
  id: uuidv7Pk(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const providerKeys = pgTable('provider_keys', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  purpose: text('purpose').notNull(), // 'chat' | 'embedding'
  label: text('label').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  keyLast4: text('key_last4').notNull(),
  baseUrl: text('base_url'),
  defaultModel: text('default_model'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agents = pgTable('agents', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  defaultLanguage: text('default_language').notNull().default('en'),
  systemPrompt: text('system_prompt').notNull(),
  welcomeMessage: text('welcome_message').notNull().default('Hi! How can I help you today?'),
  allowedDomains: jsonb('allowed_domains').$type<string[]>().notNull().default([]),
  urlRules: jsonb('url_rules').$type<UrlRule[]>().notNull().default([]),
  widgetJwtSecretEncrypted: text('widget_jwt_secret_encrypted').notNull(),
  chatProviderKeyId: uuid('chat_provider_key_id').references(() => providerKeys.id, {
    onDelete: 'set null',
  }),
  chatModel: text('chat_model').notNull().default('tencent/hy4-flash'),
  embeddingProviderKeyId: uuid('embedding_provider_key_id').references(() => providerKeys.id, {
    onDelete: 'set null',
  }),
  embeddingModel: text('embedding_model').notNull().default('alibaba/qwen3-embedding-0.6b'),
  embeddingDimensions: integer('embedding_dimensions'),
  maxMessagesPerConversation: integer('max_messages_per_conversation').notNull().default(50),
  showBranding: boolean('show_branding').notNull().default(true),
  primaryColor: text('primary_color').notNull().default('#2563EB'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeSources = pgTable('knowledge_sources', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'file' | 'url' | 'sitemap' | 'llms_txt' | 'text'
  title: text('title').notNull(),
  sourceUrl: text('source_url'),
  storageKey: text('storage_key'),
  rawContent: text('raw_content'),
  status: text('status').notNull().default('pending'), // 'pending' | 'processing' | 'ready' | 'error'
  errorMessage: text('error_message'),
  chunkCount: integer('chunk_count').notNull().default(0),
  embeddingModel: text('embedding_model'),
  embeddingDimensions: integer('embedding_dimensions'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  embedding: dynamicVector('embedding'),
  embeddingModel: text('embedding_model').notNull(),
  embeddingDimensions: integer('embedding_dimensions').notNull(),
  searchVector: tsvectorCol('search_vector'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tools = pgTable('tools', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  method: text('method').notNull().default('GET'),
  url: text('url').notNull(),
  headersEncrypted: text('headers_encrypted'),
  parameters: jsonb('parameters').$type<HttpToolParam[]>().notNull().default([]),
  requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mcpServers = pgTable('mcp_servers', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  headersEncrypted: text('headers_encrypted'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const products = pgTable('products', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  priceLabel: text('price_label').notNull(),
  checkoutUrl: text('checkout_url').notNull(),
  imageUrl: text('image_url'),
  badge: text('badge').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const availabilityRules = pgTable('availability_rules', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0 (Sun) - 6 (Sat)
  startTime: text('start_time').notNull(), // HH:mm
  endTime: text('end_time').notNull(), // HH:mm
  slotDurationMinutes: integer('slot_duration_minutes').notNull().default(30),
  timezone: text('timezone').notNull().default('UTC'),
  enabled: boolean('enabled').notNull().default(true),
});

export const availabilityBlocks = pgTable('availability_blocks', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull().default(''),
});

export const conversations = pgTable('conversations', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('sales'), // 'sales' | 'support'
  status: text('status').notNull().default('resolved_ai'), // 'resolved_ai' | 'ticket_open' | 'lead_booked'
  language: text('language').notNull().default('en'),
  pageUrl: text('page_url').notNull().default('/'),
  visitorId: text('visitor_id'),
  visitorEmail: text('visitor_email'),
  messageCount: integer('message_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const bookings = pgTable('bookings', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, {
    onDelete: 'set null',
  }),
  visitorName: text('visitor_name').notNull(),
  visitorEmail: text('visitor_email').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('confirmed'), // 'confirmed' | 'cancelled'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system' | 'tool'
  content: text('content').notNull().default(''),
  parts: jsonb('parts').$type<MessagePart[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const executionTraces = pgTable('execution_traces', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  mode: text('mode').notNull(),
  model: text('model').notNull(),
  ragChunks: jsonb('rag_chunks').$type<Array<Record<string, unknown>>>().notNull().default([]),
  toolCalls: jsonb('tool_calls').$type<Array<Record<string, unknown>>>().notNull().default([]),
  latencyMs: integer('latency_ms').notNull().default(0),
  estimatedTokens: integer('estimated_tokens').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tickets = pgTable('tickets', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, {
    onDelete: 'set null',
  }),
  visitorEmail: text('visitor_email').notNull(),
  subject: text('subject').notNull(),
  summary: text('summary').notNull(),
  priority: text('priority').notNull().default('medium'),
  status: text('status').notNull().default('open'), // 'open' | 'resolved'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const leads = pgTable('leads', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull().default(''),
  email: text('email').notNull(),
  interest: text('interest').notNull().default(''),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const outboundWebhooks = pgTable('outbound_webhooks', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secretEncrypted: text('secret_encrypted').notNull(),
  events: jsonb('events').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usageEvents = pgTable('usage_events', {
  id: uuidv7Pk(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, {
    onDelete: 'set null',
  }),
  eventType: text('event_type').notNull(), // 'conversation_turn' | 'tool_call' | 'embedding'
  tokensEstimated: integer('tokens_estimated').notNull().default(0),
  toolCallsCount: integer('tool_calls_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
