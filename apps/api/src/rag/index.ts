import { extractText } from 'unpdf';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { AskminkDb } from '@askmink/db';
import { agents, knowledgeChunks, knowledgeSources } from '@askmink/db';
import { INDEXED_EMBEDDING_DIMENSIONS, type Citation } from '@askmink/shared';
import { safeFetch } from '../security/ssrf.js';
import { generateEmbeddings, type ResolvedProviderCredentials } from '../ai/providers.js';
import type { AppConfig } from '../config.js';

export function chunkText(text: string, maxChars = 1000, overlap = 150): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).trim().length <= maxChars) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) {
        chunks.push(current.trim());
        const tail = current.slice(-overlap);
        current = `${tail}\n\n${para}`.trim();
      } else {
        // Long single paragraph -> slice with overlap
        let offset = 0;
        while (offset < para.length) {
          chunks.push(para.slice(offset, offset + maxChars).trim());
          offset += maxChars - overlap;
        }
        current = '';
      }
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks.filter((c) => c.length > 0);
}

export async function extractFileText(buffer: Buffer, extension: string): Promise<string> {
  if (extension === '.pdf') {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    return typeof result.text === 'string' ? result.text : (result.text as string[]).join('\n\n');
  }
  return buffer.toString('utf8');
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|section|article)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function crawlKnowledgeUrl(
  url: string,
  crawlType: 'url' | 'sitemap' | 'llms_txt',
  maxPages = 10,
  allowLoopbackForTest = false
): Promise<Array<{ url: string; title: string; content: string }>> {
  const { status, bodyText, headers } = await safeFetch(url, {
    timeoutMs: 12_000,
    maxBytes: 2 * 1024 * 1024,
    allowLoopbackForTest,
  });
  if (status < 200 || status >= 300) {
    throw new Error(`Failed to fetch ${url}: HTTP ${status}`);
  }

  if (crawlType === 'sitemap') {
    const locMatches = Array.from(bodyText.matchAll(/<loc>(.*?)<\/loc>/gi))
      .map((m) => m[1]?.trim())
      .filter((u): u is string => Boolean(u))
      .slice(0, maxPages);

    const results: Array<{ url: string; title: string; content: string }> = [];
    for (const pageUrl of locMatches) {
      try {
        const page = await safeFetch(pageUrl, {
          timeoutMs: 10_000,
          maxBytes: 1024 * 1024,
          allowLoopbackForTest,
        });
        if (page.status >= 200 && page.status < 300) {
          const titleMatch = page.bodyText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const content = stripHtmlToText(page.bodyText);
          if (content.length >= 20) {
            results.push({
              url: pageUrl,
              title: titleMatch?.[1]?.trim() || pageUrl,
              content,
            });
          }
        }
      } catch {
        // Skip individual failed/blocked pages in sitemap
      }
    }
    return results;
  }

  const contentType = headers['content-type'] ?? '';
  if (crawlType === 'llms_txt' || contentType.includes('text/plain') || contentType.includes('text/markdown')) {
    return [{ url, title: url, content: bodyText.trim() }];
  }

  const titleMatch = bodyText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return [
    {
      url,
      title: titleMatch?.[1]?.trim() || url,
      content: stripHtmlToText(bodyText),
    },
  ];
}

export async function indexDocumentChunks(params: {
  db: AskminkDb;
  pool: Pool;
  workspaceId: string;
  agentId: string;
  sourceId: string;
  documents: Array<{ title: string; url?: string; content: string }>;
  embeddingCreds: ResolvedProviderCredentials;
  config: AppConfig;
}): Promise<{ chunkCount: number; dimensions: number; model: string }> {
  const { db, pool, workspaceId, agentId, sourceId, documents, embeddingCreds, config } = params;

  const allChunks: Array<{ content: string; title: string; url?: string }> = [];
  for (const doc of documents) {
    const parts = chunkText(doc.content);
    for (const part of parts) {
      allChunks.push({ content: part, title: doc.title, url: doc.url });
    }
  }

  if (allChunks.length === 0) {
    await db
      .update(knowledgeSources)
      .set({ status: 'error', errorMessage: 'No extractable text found', updatedAt: new Date() })
      .where(eq(knowledgeSources.id, sourceId));
    return { chunkCount: 0, dimensions: 0, model: embeddingCreds.model };
  }

  // Generate native-dimension embeddings in batches of 32
  const vectors: number[][] = [];
  let dimensions = 0;
  for (let i = 0; i < allChunks.length; i += 32) {
    const batch = allChunks.slice(i, i + 32).map((c) => c.content);
    const res = await generateEmbeddings(batch, embeddingCreds, config);
    dimensions = res.dimensions;
    vectors.push(...res.embeddings);
  }

  // Replace existing chunks for this source atomically
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM knowledge_chunks WHERE source_id = $1', [sourceId]);

    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i]!;
      const vec = vectors[i]!;
      const vectorLiteral = `[${vec.join(',')}]`;
      await client.query(
        `INSERT INTO knowledge_chunks
          (workspace_id, agent_id, source_id, chunk_index, content, metadata, embedding, embedding_model, embedding_dimensions, search_vector)
         VALUES
          ($1, $2, $3, $4, $5, $6::jsonb, $7::vector, $8, $9, to_tsvector('simple', $5))`,
        [
          workspaceId,
          agentId,
          sourceId,
          i,
          chunk.content,
          JSON.stringify({ title: chunk.title, url: chunk.url }),
          vectorLiteral,
          embeddingCreds.model,
          dimensions,
        ]
      );
    }

    await client.query(
      `UPDATE knowledge_sources
       SET status = 'ready', error_message = NULL, chunk_count = $2,
           embedding_model = $3, embedding_dimensions = $4, updated_at = NOW()
       WHERE id = $1`,
      [sourceId, allChunks.length, embeddingCreds.model, dimensions]
    );

    await client.query(
      `UPDATE agents
       SET embedding_dimensions = $2, updated_at = NOW()
       WHERE id = $1`,
      [agentId, dimensions]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { chunkCount: allChunks.length, dimensions, model: embeddingCreds.model };
}

export interface HybridSearchResult {
  chunks: Array<{
    id: string;
    sourceId: string;
    content: string;
    title: string;
    url?: string;
    rrfScore: number;
    vectorRank?: number;
    lexicalRank?: number;
  }>;
  citations: Citation[];
}

export async function hybridSearchKnowledge(params: {
  pool: Pool;
  workspaceId: string;
  agentId: string;
  query: string;
  embeddingCreds: ResolvedProviderCredentials | null;
  config: AppConfig;
  topK?: number;
}): Promise<HybridSearchResult> {
  const { pool, workspaceId, agentId, query, embeddingCreds, config, topK = 5 } = params;
  const k = 60; // Standard RRF constant

  const vectorRanks = new Map<string, { rank: number; row: any }>();
  const lexicalRanks = new Map<string, { rank: number; row: any }>();

  // 1. Semantic search using pgvector (native multi-dimension + partial HNSW index when standard)
  if (embeddingCreds) {
    try {
      const { embeddings, dimensions } = await generateEmbeddings([query], embeddingCreds, config);
      const queryVec = embeddings[0];
      if (queryVec && dimensions > 0) {
        const vectorLiteral = `[${queryVec.join(',')}]`;
        const isIndexedDim = (INDEXED_EMBEDDING_DIMENSIONS as readonly number[]).includes(dimensions);

        // When dimension matches a partial HNSW index (768, 1024, 1536), cast expression triggers index scan
        const distanceExpr = isIndexedDim
          ? `(kc.embedding::vector(${dimensions})) <=> ($3::vector(${dimensions}))`
          : `kc.embedding <=> ($3::vector)`;

        const vecRes = await pool.query(
          `SELECT kc.id, kc.source_id, kc.content, kc.metadata, ks.title AS source_title, ks.source_url
           FROM knowledge_chunks kc
           JOIN knowledge_sources ks ON ks.id = kc.source_id
           WHERE kc.workspace_id = $1
             AND kc.agent_id = $2
             AND kc.embedding_dimensions = $4
             AND kc.embedding_model = $5
           ORDER BY ${distanceExpr} ASC
           LIMIT $6`,
          [workspaceId, agentId, vectorLiteral, dimensions, embeddingCreds.model, topK * 3]
        );
        vecRes.rows.forEach((row, idx) => {
          vectorRanks.set(row.id, { rank: idx + 1, row });
        });
      }
    } catch (err) {
      console.warn('[rag] Semantic search skipped due to embedding error:', (err as Error).message);
    }
  }

  // 2. Lexical exact search using PostgreSQL tsvector (handles SKUs, error codes, exact technical names)
  const lexRes = await pool.query(
    `SELECT kc.id, kc.source_id, kc.content, kc.metadata, ks.title AS source_title, ks.source_url,
            ts_rank_cd(kc.search_vector, websearch_to_tsquery('simple', $3)) AS lex_score
     FROM knowledge_chunks kc
     JOIN knowledge_sources ks ON ks.id = kc.source_id
     WHERE kc.workspace_id = $1
       AND kc.agent_id = $2
       AND kc.search_vector @@ websearch_to_tsquery('simple', $3)
     ORDER BY lex_score DESC
     LIMIT $4`,
    [workspaceId, agentId, query, topK * 3]
  );
  lexRes.rows.forEach((row, idx) => {
    lexicalRanks.set(row.id, { rank: idx + 1, row });
  });

  // 3. Reciprocal Rank Fusion (RRF)
  const allIds = new Set([...vectorRanks.keys(), ...lexicalRanks.keys()]);
  const merged = Array.from(allIds).map((id) => {
    const v = vectorRanks.get(id);
    const l = lexicalRanks.get(id);
    const row = v?.row ?? l?.row;
    const score = (v ? 1 / (k + v.rank) : 0) + (l ? 1 / (k + l.rank) : 0);
    const meta = (row.metadata ?? {}) as { title?: string; url?: string };
    return {
      id,
      sourceId: row.source_id as string,
      content: row.content as string,
      title: meta.title || (row.source_title as string) || 'Knowledge Source',
      url: meta.url || (row.source_url as string) || undefined,
      rrfScore: Number(score.toFixed(6)),
      vectorRank: v?.rank,
      lexicalRank: l?.rank,
    };
  });

  merged.sort((a, b) => b.rrfScore - a.rrfScore);
  const topChunks = merged.slice(0, topK);

  const citations: Citation[] = topChunks.map((c) => ({
    sourceId: c.sourceId,
    title: c.title,
    url: c.url,
    snippet: c.content.slice(0, 220),
    score: c.rrfScore,
  }));

  return { chunks: topChunks, citations };
}

export async function checkEmbeddingModelMismatch(
  db: AskminkDb,
  agentId: string,
  newEmbeddingModel: string
): Promise<{ hasIndexedChunks: boolean; currentModel: string | null; chunkCount: number }> {
  const result = await db
    .select({
      embeddingModel: knowledgeChunks.embeddingModel,
      count: sql<number>`count(*)::int`,
    })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.agentId, agentId))
    .groupBy(knowledgeChunks.embeddingModel);

  const mismatched = result.find((r) => r.embeddingModel !== newEmbeddingModel && r.count > 0);
  if (!mismatched) {
    return { hasIndexedChunks: false, currentModel: null, chunkCount: 0 };
  }
  return {
    hasIndexedChunks: true,
    currentModel: mismatched.embeddingModel,
    chunkCount: mismatched.count,
  };
}
