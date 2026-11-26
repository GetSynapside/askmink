import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Code2,
  ExternalLink,
  FileText,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Ticket,
  Wrench,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SafeMarkdown, isSafeHttpUrl } from '@/components/SafeMarkdown';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

interface PlaygroundViewProps {
  agent: any;
  lang?: SupportedLanguage;
  t?: Record<string, string>;
}

const COPY: Record<
  SupportedLanguage,
  {
    title: string;
    subtitle: string;
    reset: string;
    openWidgetTest: string;
    emptyTitle: string;
    emptyDesc: string;
    inputPlaceholder: string;
    send: string;
    thinking: string;
    traceTitle: string;
    traceEmptyTitle: string;
    traceEmptyDesc: string;
    metricLatency: string;
    metricModel: string;
    metricTokens: string;
    ragChunks: string;
    noRagChunks: string;
    toolCalls: string;
    noToolCalls: string;
    confirmExecute: string;
    starters: string[];
  }
> = {
  en: {
    title: 'Playground',
    subtitle: 'Test responses, RAG retrieval, and tools in real time.',
    reset: 'Reset chat',
    openWidgetTest: 'Test Widget',
    emptyTitle: 'Start a test conversation',
    emptyDesc:
      'Send a message or pick a starter prompt to inspect hybrid RAG chunks, HTTP/MCP tools, and Generative UI cards.',
    inputPlaceholder: 'Ask about docs, pricing, schedule a meeting, or trigger a tool...',
    send: 'Send',
    thinking: 'Thinking...',
    traceTitle: 'Trace Inspector (X-Ray)',
    traceEmptyTitle: 'No execution trace yet',
    traceEmptyDesc:
      'Send a message in the playground to inspect latency, retrieved RAG chunks, and tool calls.',
    metricLatency: 'LATENCY',
    metricModel: 'MODEL',
    metricTokens: 'EST. TOKENS',
    ragChunks: 'RAG Chunks',
    noRagChunks: 'No knowledge chunks retrieved for this turn.',
    toolCalls: 'Tool Calls',
    noToolCalls: 'No tools were invoked in this turn.',
    confirmExecute: 'Confirm & Execute',
    starters: [
      'What plans and pricing do you offer?',
      'Can I schedule a quick demo?',
      'How do I integrate this with my website?',
      'I need help with a support issue.',
    ],
  },
  pt: {
    title: 'Playground',
    subtitle: 'Teste respostas, busca RAG e ferramentas em tempo real.',
    reset: 'Limpar chat',
    openWidgetTest: 'Testar Widget',
    emptyTitle: 'Inicie uma conversa de teste',
    emptyDesc:
      'Envie uma mensagem ou escolha uma sugestão para inspecionar trechos RAG, ferramentas HTTP/MCP e cards generativos.',
    inputPlaceholder: 'Pergunte sobre docs, preços, agende uma reunião ou acione uma ferramenta...',
    send: 'Enviar',
    thinking: 'Pensando...',
    traceTitle: 'Inspetor de Trace (X-Ray)',
    traceEmptyTitle: 'Nenhum trace de execução ainda',
    traceEmptyDesc:
      'Envie uma mensagem no playground para inspecionar latência, trechos RAG recuperados e chamadas de ferramentas.',
    metricLatency: 'LATÊNCIA',
    metricModel: 'MODELO',
    metricTokens: 'TOKENS EST.',
    ragChunks: 'Trechos RAG',
    noRagChunks: 'Nenhum trecho da base de conhecimento recuperado neste turno.',
    toolCalls: 'Chamadas de Ferramentas',
    noToolCalls: 'Nenhuma ferramenta foi acionada neste turno.',
    confirmExecute: 'Confirmar e Executar',
    starters: [
      'Quais planos e preços vocês oferecem?',
      'Posso agendar uma demonstração rápida?',
      'Como faço para integrar no meu site?',
      'Preciso de ajuda com um problema de suporte.',
    ],
  },
  es: {
    title: 'Playground',
    subtitle: 'Prueba respuestas, recuperación RAG y herramientas en tiempo real.',
    reset: 'Reiniciar chat',
    openWidgetTest: 'Probar Widget',
    emptyTitle: 'Inicia una conversación de prueba',
    emptyDesc:
      'Envía un mensaje o elige una sugerencia para inspeccionar fragmentos RAG, herramientas HTTP/MCP y tarjetas generativas.',
    inputPlaceholder: 'Pregunta sobre docs, precios, agenda una reunión o ejecuta una herramienta...',
    send: 'Enviar',
    thinking: 'Pensando...',
    traceTitle: 'Inspector de Traza (X-Ray)',
    traceEmptyTitle: 'Aún no hay traza de ejecución',
    traceEmptyDesc:
      'Envía un mensaje en el playground para inspeccionar latencia, fragmentos RAG recuperados y llamadas a herramientas.',
    metricLatency: 'LATENCIA',
    metricModel: 'MODELO',
    metricTokens: 'TOKENS EST.',
    ragChunks: 'Fragmentos RAG',
    noRagChunks: 'No se recuperaron fragmentos de conocimiento en este turno.',
    toolCalls: 'Llamadas de Herramientas',
    noToolCalls: 'No se invocaron herramientas en este turno.',
    confirmExecute: 'Confirmar y Ejecutar',
    starters: [
      '¿Qué planes y precios ofrecen?',
      '¿Puedo agendar una demostración rápida?',
      '¿Cómo lo integro en mi sitio web?',
      'Necesito ayuda con un problema de soporte.',
    ],
  },
};

function dedupeCards(cards?: any[]): any[] {
  if (!Array.isArray(cards)) return [];
  const seenProducts = new Set<string>();
  const out: any[] = [];
  for (const card of cards) {
    if (!card || typeof card !== 'object') continue;
    if (card.type === 'product_card') {
      const pid = typeof card.productId === 'string' ? card.productId.trim() : '';
      if (pid) {
        if (seenProducts.has(pid)) continue;
        seenProducts.add(pid);
      }
    }
    out.push(card);
  }
  return out;
}

function dedupeCitations(citations?: any[]): any[] {
  if (!Array.isArray(citations)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of citations) {
    if (!c || typeof c !== 'object') continue;
    const key =
      typeof c.sourceId === 'string' && c.sourceId.trim()
        ? c.sourceId.trim()
        : `${c.title || ''}|${c.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function PlaygroundCardItem({
  card,
  ui,
  t,
  loading,
  onConfirm,
}: {
  card: any;
  ui: { confirmExecute: string };
  t?: Record<string, string>;
  loading: boolean;
  onConfirm: (card: any) => void;
}) {
  const [showJson, setShowJson] = useState(false);

  return (
    <Card className="mt-2.5 p-3.5 bg-muted/40 text-xs space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {card.type}
        </Badge>
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
        >
          <Code2 className="size-3" aria-hidden="true" />
          <span>{showJson ? t?.hideJson || 'Hide JSON' : t?.viewJson || 'View JSON'}</span>
        </button>
      </div>

      {card.type === 'product_card' && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-sm text-foreground leading-snug">{card.name}</div>
            {card.badge && (
              <Badge variant="info" className="text-[10px] shrink-0">
                {card.badge}
              </Badge>
            )}
          </div>
          {card.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {card.priceLabel && (
              <span className="text-sm font-bold tabular-nums text-foreground">
                {card.priceLabel}
              </span>
            )}
            {isSafeHttpUrl(card.checkoutUrl) && (
              <Button size="xs" asChild>
                <a href={card.checkoutUrl.trim()} target="_blank" rel="noopener noreferrer">
                  <span>{t?.playgroundCheckoutBtn || 'Proceed to checkout'}</span>
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      {card.type === 'booking_slots' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
              <Clock className="size-3.5 text-blue-600 shrink-0" aria-hidden="true" />
              <span>{card.title}</span>
            </div>
            {card.timezone && (
              <span className="text-[10px] font-mono text-muted-foreground">{card.timezone}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Array.isArray(card.slots) ? card.slots : []).map((slot: any, sIdx: number) => (
              <Badge key={sIdx} variant="outline" className="font-normal">
                {slot.label}
              </Badge>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {Array.isArray(card.slots) ? card.slots.length : 0}{' '}
            {t?.playgroundSlotsCount || 'available slots'}
          </div>
        </div>
      )}

      {card.type === 'booking_confirmed' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-xs text-emerald-700">
            <CalendarCheck className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{card.visitorName}</span>
            {card.bookingId && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                #{String(card.bookingId).slice(0, 8)}
              </Badge>
            )}
          </div>
          {(card.startsAt || card.endsAt) && (
            <div className="text-[11px] font-mono text-muted-foreground">
              {card.startsAt} → {card.endsAt}
            </div>
          )}
          {isSafeHttpUrl(card.icsDownloadUrl) && (
            <Button variant="outline" size="xs" asChild>
              <a href={card.icsDownloadUrl.trim()} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3" aria-hidden="true" />
                <span>ICS</span>
              </a>
            </Button>
          )}
        </div>
      )}

      {card.type === 'ticket_card' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-xs text-foreground flex items-center gap-1.5 min-w-0">
              <Ticket className="size-3.5 text-amber-600 shrink-0" aria-hidden="true" />
              <span className="truncate">{card.subject}</span>
            </div>
            <Badge
              variant={card.status === 'resolved' ? 'success' : 'warning'}
              className="text-[10px] shrink-0"
            >
              {card.status}
            </Badge>
          </div>
          {card.ticketId && (
            <div className="text-[10px] font-mono text-muted-foreground">#{card.ticketId}</div>
          )}
          {card.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">{card.summary}</p>
          )}
        </div>
      )}

      {card.type === 'diagnostic_card' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-blue-600 shrink-0" aria-hidden="true" />
              <span className="font-mono">{card.toolName}</span>
            </div>
            <Badge
              variant={
                card.status === 'success'
                  ? 'success'
                  : card.status === 'error'
                    ? 'destructive'
                    : 'warning'
              }
              className="text-[10px] shrink-0"
            >
              {card.status}
            </Badge>
          </div>
          {card.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">{card.summary}</p>
          )}
        </div>
      )}

      {card.type === 'confirmation_request' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
            <ShieldAlert className="size-3.5 text-amber-600 shrink-0" aria-hidden="true" />
            <span className="font-mono">{card.toolName}</span>
          </div>
          {card.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p>
          )}
          <Button
            type="button"
            size="xs"
            disabled={loading}
            onClick={() => onConfirm(card)}
          >
            {ui.confirmExecute}
          </Button>
        </div>
      )}

      {showJson && (
        <pre className="p-2.5 rounded-lg bg-background border border-border text-[11px] font-mono text-muted-foreground max-w-full overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {JSON.stringify(card, null, 2)}
        </pre>
      )}
    </Card>
  );
}

export function PlaygroundView({ agent, lang = 'en', t }: PlaygroundViewProps) {
  const ui = COPY[lang] || COPY.en;
  const language: SupportedLanguage = (agent.defaultLanguage as SupportedLanguage) || lang || 'en';
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<any[]>([]);
  const [lastTrace, setLastTrace] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([]);
    setConversationId(undefined);
    setLastTrace(null);
    setInput('');
  }, [agent.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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
        body: { conversationId, message: trimmed, pageUrl: '/', language, confirmedToolCallId },
      });
      setConversationId(res.conversationId);
      setLastTrace(res.trace);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.text,
          citations: res.citations,
          cards: res.cards,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setMessages([]);
    setConversationId(undefined);
    setLastTrace(null);
  }

  const starterPrompts = (COPY[language] || ui).starters;
  const ragChunks = lastTrace?.ragChunks ?? [];
  const toolCalls = lastTrace?.toolCalls ?? [];

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
      {/* Left: Interactive Chat + Generative UI */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">
        {/* Studio Toolbar */}
        <div className="px-5 lg:px-6 py-4 bg-card border-b border-border shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-xl font-semibold text-foreground tracking-tight">
                  {ui.title}
                </h1>
                <Badge
                  variant="secondary"
                  title={agent.name}
                  className="inline-block max-w-[240px] truncate align-middle font-normal"
                >
                  {agent.name}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{ui.subtitle}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button type="button" variant="outline" onClick={handleReset}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                <span>{t?.resetPreviewChat || ui.reset}</span>
              </Button>

              <Button variant="outline" asChild>
                <a
                  href={`/widget-test?agent=${encodeURIComponent(agent.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span>{ui.openWidgetTest}</span>
                </a>
              </Button>
            </div>
          </div>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && (
              <Card className="border-dashed rounded-2xl p-8 text-center space-y-4 my-6">
                <div className="size-10 rounded-xl bg-secondary text-secondary-foreground mx-auto flex items-center justify-center">
                  <Sparkles className="size-5 text-blue-600" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-foreground">{ui.emptyTitle}</h2>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                    {ui.emptyDesc}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {starterPrompts.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => send(prompt)}
                      className="rounded-full h-auto py-1.5 px-3 text-xs font-normal text-muted-foreground hover:text-foreground whitespace-normal text-left"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </Card>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2.5',
                  m.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {m.role !== 'user' && (
                  <span
                    className="size-7 rounded-lg text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs"
                    style={{ backgroundColor: agent.primaryColor || '#2563EB' }}
                    aria-hidden="true"
                  >
                    <Bot className="size-3.5" />
                  </span>
                )}

                <div
                  className={cn(
                    'max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-card border border-border text-foreground shadow-2xs rounded-tl-sm'
                  )}
                >
                  {m.role === 'user' ? (
                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  ) : (
                    <SafeMarkdown content={m.text} />
                  )}

                  {dedupeCitations(m.citations).length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {dedupeCitations(m.citations).map((c: any, idx: number) => {
                        const label = `[${c.index ?? idx + 1}] ${c.title}`;
                        return isSafeHttpUrl(c.url) ? (
                          <a
                            key={c.sourceId || idx}
                            href={c.url.trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              badgeVariants({ variant: 'info' }),
                              'hover:opacity-90 transition'
                            )}
                          >
                            <FileText className="size-3" aria-hidden="true" />
                            <span>{label}</span>
                          </a>
                        ) : (
                          <Badge key={c.sourceId || idx} variant="info">
                            <FileText className="size-3" aria-hidden="true" />
                            <span>{label}</span>
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  {dedupeCards(m.cards).map((card: any, idx: number) => (
                    <PlaygroundCardItem
                      key={`${card.type}-${card.productId || card.ticketId || card.bookingId || idx}`}
                      card={card}
                      ui={ui}
                      t={t}
                      loading={loading}
                      onConfirm={(c) => send(`Confirm ${c.toolName}`, c.toolCallId)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-start gap-2.5">
                <span
                  className="size-7 rounded-lg text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs"
                  style={{ backgroundColor: agent.primaryColor || '#2563EB' }}
                  aria-hidden="true"
                >
                  <Bot className="size-3.5" />
                </span>
                <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-card border border-border text-xs text-muted-foreground inline-flex items-center gap-2 shadow-2xs">
                  <span
                    className="size-2 rounded-full bg-blue-600 animate-pulse"
                    aria-hidden="true"
                  />
                  <span>{t?.widgetThinking || ui.thinking}</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Chat Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="px-5 py-3.5 bg-card border-t border-border shrink-0"
        >
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <Input
              aria-label={ui.inputPlaceholder}
              className="flex-1 h-9 text-sm"
              placeholder={ui.inputPlaceholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <Button type="submit" size="lg" disabled={loading || !input.trim()}>
              <Send className="size-3.5" aria-hidden="true" />
              <span>{t?.widgetSend || ui.send}</span>
            </Button>
          </div>
        </form>
      </div>

      {/* Right: Trace Inspector (X-Ray) */}
      <aside className="w-full lg:w-[360px] xl:w-[380px] min-w-0 overflow-hidden border-t lg:border-t-0 lg:border-l border-border bg-card flex flex-col shrink-0 max-h-[40vh] lg:max-h-none">
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Activity className="size-4 text-blue-600 shrink-0" aria-hidden="true" />
            <span>{ui.traceTitle}</span>
          </div>
          {lastTrace && (
            <Badge variant="success" className="tabular-nums">
              {lastTrace.latencyMs} ms
            </Badge>
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto sidebar-scroll p-4 space-y-4">
          {!lastTrace ? (
            <Card className="border-dashed p-6 text-center space-y-2.5 bg-muted/20">
              <div className="size-9 rounded-xl bg-secondary text-secondary-foreground mx-auto flex items-center justify-center">
                <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <div className="text-xs font-semibold text-foreground">{ui.traceEmptyTitle}</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {ui.traceEmptyDesc}
              </p>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-muted/60 border border-border">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {ui.metricLatency}
                  </div>
                  <div className="font-semibold tabular-nums text-foreground mt-0.5">
                    {lastTrace.latencyMs} ms
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/60 border border-border">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {ui.metricTokens}
                  </div>
                  <div className="font-semibold tabular-nums text-foreground mt-0.5">
                    {lastTrace.estimatedTokens}
                  </div>
                </div>
                <div className="col-span-2 p-2.5 rounded-lg bg-muted/60 border border-border">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {ui.metricModel}
                  </div>
                  <div
                    className="font-mono text-[11px] text-foreground truncate mt-0.5"
                    title={lastTrace.model}
                  >
                    {lastTrace.model}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span>{ui.ragChunks}</span>
                  </h2>
                  <Badge variant="secondary" className="tabular-nums">
                    {ragChunks.length}
                  </Badge>
                </div>

                {ragChunks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{ui.noRagChunks}</p>
                ) : (
                  <div className="space-y-2">
                    {ragChunks.map((c: any, idx: number) => (
                      <Card key={idx} className="p-3 bg-muted/40 text-xs space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground truncate">{c.title}</span>
                          <Badge variant="info" className="font-mono text-[10px] shrink-0">
                            RRF {c.rrfScore}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                          {c.snippet}
                        </p>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span>{ui.toolCalls}</span>
                  </h2>
                  <Badge variant="secondary" className="tabular-nums">
                    {toolCalls.length}
                  </Badge>
                </div>

                {toolCalls.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{ui.noToolCalls}</p>
                ) : (
                  <pre className="p-3 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[11px] max-w-full overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                    {JSON.stringify(toolCalls, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
