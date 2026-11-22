import { useState } from 'react';
import { Activity, Send, Sparkles } from 'lucide-react';
import { apiRequest } from '../lib/api';

export function PlaygroundView({ agent }: { agent: any }) {
  const [pageUrl, setPageUrl] = useState('/pricing');
  const [language, setLanguage] = useState<'en' | 'pt' | 'es'>(agent.defaultLanguage || 'en');
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<any[]>([]);
  const [lastTrace, setLastTrace] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function send(text: string, confirmedToolCallId?: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    if (!confirmedToolCallId) {
      setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
      setInput('');
    }
    try {
      const res = await apiRequest(`/api/agents/${agent.id}/playground/chat`, {
        method: 'POST',
        body: { conversationId, message: trimmed, pageUrl, language, confirmedToolCallId },
      });
      setConversationId(res.conversationId);
      setLastTrace(res.trace);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.text, citations: res.citations, cards: res.cards, mode: res.mode },
      ]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${(err as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left: Interactive Chat + Generative UI */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F8F9FB]">
        <div className="px-5 py-3 bg-white border-b border-[#EAECEF] flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-[#111827] flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[#2563EB]" /> Playground
          </span>
          <input
            className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] w-48"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            placeholder="Simulated URL (/pricing, /docs/api)"
          />
          <select
            className="text-xs px-2 py-1.5 rounded-lg border border-[#E5E7EB] bg-white"
            value={language}
            onChange={(e) => setLanguage(e.target.value as any)}
          >
            <option value="en">EN</option>
            <option value="pt">PT</option>
            <option value="es">ES</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setConversationId(undefined);
              setLastTrace(null);
            }}
            className="ml-auto text-xs px-2.5 py-1.5 rounded-lg border border-[#EAECEF] hover:bg-[#F3F4F6]"
          >
            Reset chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-12 text-xs text-[#9CA3AF]">
              Send a message to inspect hybrid RAG chunks, Dual-Mode routing, HTTP/MCP tools, and Generative UI cards.
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                m.role === 'user'
                  ? 'ml-auto bg-[#18181B] text-white'
                  : 'bg-white border border-[#EAECEF] text-[#111827]'
              }`}
            >
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.citations?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.citations.map((c: any, idx: number) => (
                    <span
                      key={idx}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#DBEAFE]"
                    >
                      {c.title} ({c.score})
                    </span>
                  ))}
                </div>
              )}
              {m.cards?.map((card: any, idx: number) => (
                <div key={idx} className="mt-2 p-3 rounded-xl border border-[#EAECEF] bg-[#F8F9FB] text-xs space-y-1">
                  <div className="font-semibold text-[#111827]">{card.type}</div>
                  <pre className="text-[11px] font-mono text-[#4B5563] overflow-x-auto">
                    {JSON.stringify(card, null, 2)}
                  </pre>
                  {card.type === 'confirmation_request' && (
                    <button
                      type="button"
                      onClick={() => send(`Confirm ${card.toolName}`, card.toolCallId)}
                      className="mt-1 px-3 py-1.5 rounded-lg bg-[#18181B] text-white text-xs"
                    >
                      Confirm &amp; Execute
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="p-4 bg-white border-t border-[#EAECEF] flex gap-2"
        >
          <input
            className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]"
            placeholder="Ask about docs, pricing, schedule a meeting, or trigger a tool..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#18181B] text-white text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" /> Send
          </button>
        </form>
      </div>

      {/* Right: Trace Inspector (Raio-X) */}
      <aside className="w-[360px] border-l border-[#EAECEF] bg-white overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#111827]">
          <Activity className="w-4 h-4 text-[#2563EB]" /> Trace Inspector (X-Ray)
        </div>
        {!lastTrace ? (
          <p className="text-xs text-[#9CA3AF]">No execution trace yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[#F8F9FB] border border-[#EAECEF]">
                <div className="text-[10px] text-[#9CA3AF]">MODE</div>
                <div className="font-semibold uppercase text-[#111827]">{lastTrace.mode}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#F8F9FB] border border-[#EAECEF]">
                <div className="text-[10px] text-[#9CA3AF]">LATENCY</div>
                <div className="font-semibold tabular-nums text-[#111827]">{lastTrace.latencyMs} ms</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#F8F9FB] border border-[#EAECEF]">
                <div className="text-[10px] text-[#9CA3AF]">MODEL</div>
                <div className="font-mono text-[11px] truncate">{lastTrace.model}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#F8F9FB] border border-[#EAECEF]">
                <div className="text-[10px] text-[#9CA3AF]">EST. TOKENS</div>
                <div className="font-semibold tabular-nums">{lastTrace.estimatedTokens}</div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#111827] mb-1.5">
                RAG Chunks ({lastTrace.ragChunks?.length ?? 0})
              </h4>
              <div className="space-y-2">
                {(lastTrace.ragChunks ?? []).map((c: any, idx: number) => (
                  <div key={idx} className="p-2.5 rounded-lg border border-[#EAECEF] bg-[#F8F9FB] text-xs">
                    <div className="flex justify-between font-medium text-[#111827]">
                      <span className="truncate">{c.title}</span>
                      <span className="font-mono text-[11px] text-[#2563EB]">RRF {c.rrfScore}</span>
                    </div>
                    <p className="text-[11px] text-[#6B7280] mt-1 line-clamp-3">{c.snippet}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#111827] mb-1.5">
                Tool Calls ({lastTrace.toolCalls?.length ?? 0})
              </h4>
              <pre className="p-2.5 rounded-lg bg-[#111827] text-[#E5E7EB] font-mono text-[11px] overflow-x-auto">
                {JSON.stringify(lastTrace.toolCalls ?? [], null, 2)}
              </pre>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
