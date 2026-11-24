import type { Pool } from 'pg';

const MIGRATION_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'local',
  external_auth_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS provider_keys (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  label TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_workspace ON provider_keys(workspace_id);

-- Global account-level BYOK key & model configuration on workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS chat_provider_key_id UUID REFERENCES provider_keys(id) ON DELETE SET NULL;
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS chat_model TEXT NOT NULL DEFAULT 'tencent/hy4-flash';
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS embedding_provider_key_id UUID REFERENCES provider_keys(id) ON DELETE SET NULL;
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'alibaba/qwen3-embedding-0.6b';
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_language TEXT NOT NULL DEFAULT 'en',
  system_prompt TEXT NOT NULL,
  welcome_message TEXT NOT NULL DEFAULT 'Hi! How can I help you today?',
  allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  url_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  widget_jwt_secret_encrypted TEXT NOT NULL,
  chat_provider_key_id UUID REFERENCES provider_keys(id) ON DELETE SET NULL,
  chat_model TEXT NOT NULL DEFAULT 'tencent/hy4-flash',
  embedding_provider_key_id UUID REFERENCES provider_keys(id) ON DELETE SET NULL,
  embedding_model TEXT NOT NULL DEFAULT 'alibaba/qwen3-embedding-0.6b',
  embedding_dimensions INTEGER,
  max_messages_per_conversation INTEGER NOT NULL DEFAULT 50,
  show_branding BOOLEAN NOT NULL DEFAULT TRUE,
  primary_color TEXT NOT NULL DEFAULT '#2563EB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);

-- Backfill workspace-level global BYOK key/model settings from legacy per-agent columns (idempotent)
DO $$
BEGIN
  UPDATE workspaces w
  SET
    chat_provider_key_id = COALESCE(
      w.chat_provider_key_id,
      (SELECT a.chat_provider_key_id FROM agents a WHERE a.workspace_id = w.id AND a.chat_provider_key_id IS NOT NULL ORDER BY a.created_at ASC LIMIT 1)
    ),
    chat_model = COALESCE(
      NULLIF(w.chat_model, 'tencent/hy4-flash'),
      (SELECT a.chat_model FROM agents a WHERE a.workspace_id = w.id AND a.chat_provider_key_id IS NOT NULL ORDER BY a.created_at ASC LIMIT 1),
      w.chat_model
    ),
    embedding_provider_key_id = COALESCE(
      w.embedding_provider_key_id,
      (SELECT a.embedding_provider_key_id FROM agents a WHERE a.workspace_id = w.id AND a.embedding_provider_key_id IS NOT NULL ORDER BY a.created_at ASC LIMIT 1)
    ),
    embedding_model = COALESCE(
      NULLIF(w.embedding_model, 'alibaba/qwen3-embedding-0.6b'),
      (SELECT a.embedding_model FROM agents a WHERE a.workspace_id = w.id AND a.embedding_provider_key_id IS NOT NULL ORDER BY a.created_at ASC LIMIT 1),
      w.embedding_model
    ),
    allowed_domains = CASE
      WHEN jsonb_array_length(w.allowed_domains) > 0 THEN w.allowed_domains
      ELSE COALESCE(
        (
          SELECT jsonb_agg(DISTINCT d)
          FROM agents a, LATERAL jsonb_array_elements_text(a.allowed_domains) AS d
          WHERE a.workspace_id = w.id
        ),
        '[]'::jsonb
      )
    END;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT,
  storage_key TEXT,
  raw_content TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_agent ON knowledge_sources(agent_id);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL,
  search_vector TSVECTOR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_agent_dims ON knowledge_chunks(agent_id, embedding_dimensions);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts ON knowledge_chunks USING GIN (search_vector);

-- Partial HNSW expression indexes for native multi-dimension vector search (zero truncation hacks)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_emb_768 ON knowledge_chunks
  USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE embedding_dimensions = 768;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_emb_1024 ON knowledge_chunks
  USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
  WHERE embedding_dimensions = 1024;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_emb_1536 ON knowledge_chunks
  USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WHERE embedding_dimensions = 1536;

CREATE TABLE IF NOT EXISTS tools (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  url TEXT NOT NULL,
  headers_encrypted TEXT,
  parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tools_agent ON tools(agent_id);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  headers_encrypted TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_agent ON mcp_servers(agent_id);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_label TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  image_url TEXT,
  badge TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_agent ON products(agent_id);

CREATE TABLE IF NOT EXISTS availability_rules (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_availability_rules_agent ON availability_rules(agent_id);

CREATE TABLE IF NOT EXISTS availability_blocks (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_availability_blocks_agent ON availability_blocks(agent_id);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'sales',
  status TEXT NOT NULL DEFAULT 'resolved_ai',
  language TEXT NOT NULL DEFAULT 'en',
  page_url TEXT NOT NULL DEFAULT '/',
  visitor_id TEXT,
  visitor_email TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  visitor_name TEXT NOT NULL,
  visitor_email TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bookings_valid_range CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_bookings_agent ON bookings(agent_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (
        agent_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (status = 'confirmed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS execution_traces (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  mode TEXT NOT NULL,
  model TEXT NOT NULL,
  rag_chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_execution_traces_conversation ON execution_traces(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  visitor_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  summary TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_agent ON tickets(agent_id);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  interest TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_agent ON leads(agent_id);

CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_agent ON outbound_webhooks(agent_id);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  tokens_estimated INTEGER NOT NULL DEFAULT 0,
  tool_calls_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_agent_created ON usage_events(agent_id, created_at);
`;

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(MIGRATION_SQL);
}
