import { Fragment, render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { WIDGET_CSS } from './styles';

type Lang = 'en' | 'pt' | 'es';

interface Citation {
  sourceId: string;
  title: string;
  url?: string;
}

interface UICard {
  type: string;
  [key: string]: any;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  cards?: UICard[];
}

interface WidgetConfig {
  id: string;
  name: string;
  defaultLanguage: Lang;
  welcomeMessage: string;
  starterPrompts?: string[];
  primaryColor: string;
  showBranding: boolean;
}

interface I18NStrings {
  online: string;
  placeholder: string;
  send: string;
  book: string;
  checkout: string;
  downloadIcs: string;
  confirmAction: string;
  cancel: string;
  namePh: string;
  emailPh: string;
  powered: string;
  welcome: string;
  close: string;
  openLauncher: string;
  closeLauncher: string;
  chatDialogLabel: string;
  thinking: string;
  errorOrigin: string;
  errorRateLimit: string;
  errorGeneric: string;
}

const I18N: Record<Lang, I18NStrings> = {
  en: {
    online: 'Online',
    placeholder: 'Ask a question...',
    send: 'Send',
    book: 'Confirm booking',
    checkout: 'Proceed to checkout',
    downloadIcs: 'Download .ics',
    confirmAction: 'Confirm action',
    cancel: 'Cancel',
    namePh: 'Your name',
    emailPh: 'Your email',
    powered: 'Powered by Askmink',
    welcome: 'Hi! How can I help you today?',
    close: 'Close',
    openLauncher: 'Open Askmink',
    closeLauncher: 'Close Askmink',
    chatDialogLabel: 'Askmink Chat',
    thinking: 'Thinking...',
    errorOrigin: 'This domain is not authorized to use this assistant.',
    errorRateLimit: 'Too many messages right now. Please wait a moment and try again.',
    errorGeneric: 'Sorry, I could not respond right now. Please try again.',
  },
  pt: {
    online: 'Online',
    placeholder: 'Digite sua dúvida...',
    send: 'Enviar',
    book: 'Confirmar agendamento',
    checkout: 'Ir para checkout',
    downloadIcs: 'Baixar .ics',
    confirmAction: 'Confirmar ação',
    cancel: 'Cancelar',
    namePh: 'Seu nome',
    emailPh: 'Seu e-mail',
    powered: 'Desenvolvido com Askmink',
    welcome: 'Olá! Como posso ajudar você hoje?',
    close: 'Fechar',
    openLauncher: 'Abrir Askmink',
    closeLauncher: 'Fechar Askmink',
    chatDialogLabel: 'Chat Askmink',
    thinking: 'Respondendo...',
    errorOrigin: 'Este domínio não está autorizado a usar este assistente.',
    errorRateLimit: 'Muitas mensagens em seguida. Aguarde um instante e tente novamente.',
    errorGeneric: 'Desculpe, não foi possível responder agora. Tente novamente.',
  },
  es: {
    online: 'En línea',
    placeholder: 'Escribe tu pregunta...',
    send: 'Enviar',
    book: 'Confirmar reserva',
    checkout: 'Ir al checkout',
    downloadIcs: 'Descargar .ics',
    confirmAction: 'Confirmar acción',
    cancel: 'Cancelar',
    namePh: 'Tu nombre',
    emailPh: 'Tu correo',
    powered: 'Impulsado por Askmink',
    welcome: '¡Hola! ¿Cómo puedo ayudarte hoy?',
    close: 'Cerrar',
    openLauncher: 'Abrir Askmink',
    closeLauncher: 'Cerrar Askmink',
    chatDialogLabel: 'Chat de Askmink',
    thinking: 'Pensando...',
    errorOrigin: 'Este dominio no está autorizado para usar este asistente.',
    errorRateLimit: 'Demasiados mensajes seguidos. Espera un momento e inténtalo de nuevo.',
    errorGeneric: 'Lo siento, no pude responder en este momento. Inténtalo de nuevo.',
  },
};

function normalizeLang(raw?: string | null): Lang | null {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'pt' || v.startsWith('pt-') || v.startsWith('pt_')) return 'pt';
  if (v === 'es' || v.startsWith('es-') || v.startsWith('es_')) return 'es';
  if (v === 'en' || v.startsWith('en-') || v.startsWith('en_')) return 'en';
  return null;
}

function resolveLanguage(dataLang?: Lang | null, cfgLang?: string | null): Lang {
  return (
    dataLang ||
    normalizeLang(cfgLang) ||
    normalizeLang(typeof document !== 'undefined' ? document.documentElement.lang : '') ||
    normalizeLang(typeof navigator !== 'undefined' ? navigator.language : '') ||
    'en'
  );
}

function isSafeHttpUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

class WidgetFriendlyError extends Error {}

function mapStatusError(status: number, t: I18NStrings): string {
  if (status === 403) return t.errorOrigin;
  if (status === 429) return t.errorRateLimit;
  return t.errorGeneric;
}

async function parseJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function dedupeCards(cards?: UICard[]): UICard[] {
  if (!cards || cards.length === 0) return [];
  const seenProductIds = new Set<string>();
  return cards.filter((card) => {
    if (card.type !== 'product_card') return true;
    const pid = typeof card.productId === 'string' ? card.productId.trim() : '';
    if (!pid) return true;
    if (seenProductIds.has(pid)) return false;
    seenProductIds.add(pid);
    return true;
  });
}

function parseInline(text: string, depth = 0): ComponentChildren[] {
  if (!text || depth > 6) return [text];
  const out: ComponentChildren[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // 1. Inline code: `...`
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push(<code key={`c-${i}`}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }

    // 2. Links: [label](url) with balanced parentheses in url
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket > i + 1 && text[closeBracket + 1] === '(') {
        let pDepth = 1;
        let j = closeBracket + 2;
        while (j < text.length && pDepth > 0) {
          const uc = text[j];
          if (uc === '\n') break;
          if (uc === '(') pDepth++;
          else if (uc === ')') pDepth--;
          j++;
        }
        if (pDepth === 0) {
          const label = text.slice(i + 1, closeBracket);
          const rawUrl = text.slice(closeBracket + 2, j - 1);
          flush();
          if (isSafeHttpUrl(rawUrl)) {
            out.push(
              <a
                key={`a-${i}`}
                href={rawUrl.trim()}
                target="_blank"
                rel="noopener noreferrer"
              >
                {parseInline(label, depth + 1)}
              </a>
            );
          } else {
            out.push(
              <Fragment key={`bl-${i}`}>{parseInline(label, depth + 1)}</Fragment>
            );
          }
          i = j;
          continue;
        }
      }
    }

    // 3. Bold + Italic: ***...***
    if (ch === '*' && text[i + 1] === '*' && text[i + 2] === '*') {
      const nextCh = text[i + 3];
      if (nextCh && !/\s/.test(nextCh)) {
        let end = text.indexOf('***', i + 3);
        while (end !== -1 && /\s/.test(text[end - 1] || '')) {
          end = text.indexOf('***', end + 1);
        }
        if (end > i + 3) {
          flush();
          out.push(
            <strong key={`bi-${i}`}>
              <em>{parseInline(text.slice(i + 3, end), depth + 1)}</em>
            </strong>
          );
          i = end + 3;
          continue;
        }
      }
    }

    // 4. Bold: **...**
    if (ch === '*' && text[i + 1] === '*') {
      const nextCh = text[i + 2];
      if (nextCh && !/\s/.test(nextCh)) {
        let end = text.indexOf('**', i + 2);
        while (end !== -1 && /\s/.test(text[end - 1] || '')) {
          end = text.indexOf('**', end + 1);
        }
        if (end > i + 2) {
          if (
            text[end + 2] === '*' &&
            (end + 3 >= text.length || /\s|[.,!?;:)\]]/.test(text[end + 3] || ''))
          ) {
            end++;
          }
          flush();
          out.push(
            <strong key={`b-${i}`}>{parseInline(text.slice(i + 2, end), depth + 1)}</strong>
          );
          i = end + 2;
          continue;
        }
      }
    }

    // 5. Italic: *...*
    if (ch === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
      const nextCh = text[i + 1];
      if (nextCh && !/\s/.test(nextCh)) {
        let end = i + 2;
        let found = -1;
        while (end < text.length) {
          if (
            text[end] === '*' &&
            text[end - 1] !== '*' &&
            text[end + 1] !== '*' &&
            !/\s/.test(text[end - 1] || '')
          ) {
            found = end;
            break;
          }
          end++;
        }
        if (found > i + 1) {
          flush();
          out.push(<em key={`e-${i}`}>{parseInline(text.slice(i + 1, found), depth + 1)}</em>);
          i = found + 1;
          continue;
        }
      }
    }

    buf += ch ?? '';
    i++;
  }

  flush();
  return out;
}

function SafeMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ComponentChildren[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ComponentChildren[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        const content = (lines[i] ?? '').replace(/^\s*[-*]\s+/, '');
        items.push(<li key={items.length}>{parseInline(content)}</li>);
        i++;
      }
      blocks.push(<ul key={blocks.length}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ComponentChildren[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        const content = (lines[i] ?? '').replace(/^\s*\d+\.\s+/, '');
        items.push(<li key={items.length}>{parseInline(content)}</li>);
        i++;
      }
      blocks.push(<ol key={blocks.length}>{items}</ol>);
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (!cur.trim() || /^\s*[-*]\s+/.test(cur) || /^\s*\d+\.\s+/.test(cur)) break;
      paraLines.push(cur);
      i++;
    }
    blocks.push(
      <p key={blocks.length}>
        {paraLines.map((pl, idx) => (
          <Fragment key={`pl-${idx}`}>
            {idx > 0 && <br />}
            {parseInline(pl)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div class="am-md">{blocks}</div>;
}

interface SharedRuntime {
  apiBase: string;
  agentId: string;
  lang: Lang | null;
  starters: string[];
  position: 'bottom-right' | 'bottom-left';
  theme: 'light' | 'dark';
  radius: 'rounded' | 'classic' | 'sharp';
  launcherLabel: string;
  sessionJwt?: string;
  context: Record<string, unknown>;
  setOpenExternal?: (open: boolean) => void;
}

function BookingSlotsCard({
  card,
  apiBase,
  agentId,
  conversationId,
  t,
}: {
  card: UICard;
  apiBase: string;
  agentId: string;
  conversationId?: string;
  t: I18NStrings;
}) {
  const slots = (card.slots || []) as Array<{ startsAt: string; endsAt: string; label: string }>;
  const [selected, setSelected] = useState(slots[0] || null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState<{ bookingId: string; icsDownloadUrl: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (confirmed) {
    const rawIcs = typeof confirmed.icsDownloadUrl === 'string' ? confirmed.icsDownloadUrl.trim() : '';
    let icsHref = '';
    if (/^https?:\/\//i.test(rawIcs)) {
      icsHref = rawIcs;
    } else if (rawIcs.startsWith('/') && !rawIcs.startsWith('//')) {
      const base = apiBase || (typeof window !== 'undefined' ? window.location.origin : '');
      icsHref = base ? `${base.replace(/\/$/, '')}${rawIcs}` : '';
    }
    return (
      <div class="am-card">
        <div class="am-card-title">{t.book} ✓</div>
        <div class="am-card-desc">{selected?.label}</div>
        {isSafeHttpUrl(icsHref) && (
          <a
            class="am-btn"
            href={icsHref.trim()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.downloadIcs}
          </a>
        )}
      </div>
    );
  }

  async function submitBooking(e: Event) {
    e.preventDefault();
    if (!selected || !name.trim() || !email.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/widget/${agentId}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          visitorName: name.trim(),
          visitorEmail: email.trim(),
          startsAt: selected.startsAt,
          endsAt: selected.endsAt,
          timezone: card.timezone || 'UTC',
        }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        throw new WidgetFriendlyError(mapStatusError(res.status, t));
      }
      if (!data?.booking?.id || !data?.icsDownloadUrl) {
        throw new WidgetFriendlyError(t.errorGeneric);
      }
      setConfirmed({ bookingId: data.booking.id, icsDownloadUrl: data.icsDownloadUrl });
    } catch (err) {
      setError(err instanceof WidgetFriendlyError ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="am-card" onSubmit={submitBooking}>
      <div class="am-card-title">{card.title}</div>
      <div class="am-slots">
        {slots.map((s) => (
          <button
            key={s.startsAt}
            type="button"
            class={`am-slot ${selected?.startsAt === s.startsAt ? 'am-slot-active' : ''}`}
            onClick={() => setSelected(s)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <input
        class="am-input"
        placeholder={t.namePh}
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        required
      />
      <input
        class="am-input"
        type="email"
        placeholder={t.emailPh}
        value={email}
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        required
      />
      {error && <div class="am-card-desc" style={{ color: '#B91C1C' }}>{error}</div>}
      <button class="am-btn" type="submit" disabled={busy || !selected}>
        {t.book}
      </button>
    </form>
  );
}

function AskminkWidgetApp({ runtime }: { runtime: SharedRuntime }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [lang, setLang] = useState<Lang>(() => resolveLanguage(runtime.lang));
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    runtime.setOpenExternal = setOpen;
    const initialLang = resolveLanguage(runtime.lang);

    (async () => {
      try {
        const res = await fetch(`${runtime.apiBase}/api/widget/${runtime.agentId}/config`);
        if (cancelled) return;
        const cfg = (await parseJsonSafe(res)) as WidgetConfig | null;
        if (cancelled) return;
        if (!res.ok || !cfg) {
          const errText = mapStatusError(res.status, I18N[initialLang]);
          setMessages((prev) =>
            prev.length === 0 ? [{ id: 'config-error', role: 'assistant', text: errText }] : prev
          );
          return;
        }
        const resolved = resolveLanguage(runtime.lang, cfg.defaultLanguage);
        setConfig(cfg);
        setLang(resolved);
        const welcomeText = cfg.welcomeMessage?.trim() || I18N[resolved].welcome;
        setMessages((prev) =>
          prev.length === 0
            ? [{ id: 'welcome', role: 'assistant', text: welcomeText }]
            : prev.map((m) => (m.id === 'welcome' ? { ...m, text: welcomeText } : m))
        );
      } catch {
        if (cancelled) return;
        setMessages((prev) =>
          prev.length === 0
            ? [{ id: 'config-error', role: 'assistant', text: I18N[initialLang].errorGeneric }]
            : prev
        );
      }
    })();

    return () => {
      cancelled = true;
      runtime.setOpenExternal = undefined;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, loading]);

  const t = I18N[lang] || I18N.en;

  const starters = Array.from(
    new Set(
      runtime.starters.length > 0
        ? runtime.starters
        : Array.isArray(config?.starterPrompts)
          ? config.starterPrompts.map((s) => String(s).trim()).filter(Boolean)
          : []
    )
  ).slice(0, 6);
  const hasUserMessage = messages.some((m) => m.role === 'user');
  const showStarters =
    !hasUserMessage &&
    !loading &&
    starters.length > 0 &&
    messages.some((m) => m.id === 'welcome');

  async function sendMessage(text: string, confirmedToolCallId?: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    if (!confirmedToolCallId) {
      setMessages((prev) => [...prev, { id: String(Date.now()), role: 'user', text: trimmed }]);
      setInput('');
    }
    try {
      const res = await fetch(`${runtime.apiBase}/api/widget/${runtime.agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: trimmed,
          pageUrl: window.location.pathname + window.location.search,
          language: lang,
          sessionJwt: runtime.sessionJwt,
          context: runtime.context,
          confirmedToolCallId,
        }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        throw new WidgetFriendlyError(mapStatusError(res.status, t));
      }
      if (!data) {
        throw new WidgetFriendlyError(t.errorGeneric);
      }
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: data.messageId || String(Date.now() + 1),
          role: 'assistant',
          text: data.text || '',
          citations: data.citations || [],
          cards: data.cards || [],
        },
      ]);
    } catch (err) {
      const friendlyText = err instanceof WidgetFriendlyError ? err.message : t.errorGeneric;
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now() + 2), role: 'assistant', text: friendlyText },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      class="am-root"
      data-position={runtime.position}
      data-theme={runtime.theme}
      data-radius={runtime.radius}
      style={{ '--am-primary': config?.primaryColor || '#2563EB' } as any}
    >
      {open && (
        <div class="am-panel" role="dialog" aria-label={config?.name || t.chatDialogLabel}>
          <div class="am-header">
            <div class="am-brand">
              <div class="am-avatar">{(config?.name || 'A').slice(0, 1).toUpperCase()}</div>
              <div>
                <h2 class="am-title">{config?.name || 'Askmink'}</h2>
                <div class="am-status">
                  <span class="am-dot" />
                  <span>{t.online}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="am-close"
              aria-label={t.close}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          <div class="am-messages" ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} class={`am-msg ${m.role === 'user' ? 'am-msg-user' : 'am-msg-bot'}`}>
                {m.role === 'assistant' ? (
                  <SafeMarkdown text={m.text} />
                ) : (
                  <div class="am-user-text">{m.text}</div>
                )}

                {m.citations && m.citations.length > 0 && (
                  <div class="am-citations">
                    {m.citations.map((c, idx) =>
                      isSafeHttpUrl(c.url) ? (
                        <a
                          key={c.sourceId || idx}
                          class="am-cite"
                          href={c.url.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {c.title}
                        </a>
                      ) : (
                        <span key={c.sourceId || idx} class="am-cite">
                          {c.title}
                        </span>
                      )
                    )}
                  </div>
                )}

                {dedupeCards(m.cards).map((card, idx) => {
                  if (card.type === 'booking_slots') {
                    return (
                      <BookingSlotsCard
                        key={idx}
                        card={card}
                        apiBase={runtime.apiBase}
                        agentId={runtime.agentId}
                        conversationId={conversationId}
                        t={t}
                      />
                    );
                  }
                  if (card.type === 'product_card') {
                    const pid = typeof card.productId === 'string' ? card.productId.trim() : '';
                    return (
                      <div key={pid ? `product-${pid}` : idx} class="am-card">
                        <div class="am-card-title">{card.name}</div>
                        <div class="am-card-desc">{card.description}</div>
                        <div class="am-price">{card.priceLabel}</div>
                        {isSafeHttpUrl(card.checkoutUrl) && (
                          <a
                            class="am-btn"
                            href={card.checkoutUrl.trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t.checkout}
                          </a>
                        )}
                      </div>
                    );
                  }
                  if (card.type === 'ticket_card') {
                    return (
                      <div key={idx} class="am-card">
                        <div class="am-card-title">{card.subject}</div>
                        <div class="am-card-desc">{card.summary}</div>
                        <span class="am-badge am-badge-ok">{card.status}</span>
                      </div>
                    );
                  }
                  if (card.type === 'diagnostic_card') {
                    const cls =
                      card.status === 'success'
                        ? 'am-badge-ok'
                        : card.status === 'warning'
                          ? 'am-badge-warn'
                          : 'am-badge-err';
                    return (
                      <div key={idx} class="am-card">
                        <div class="am-card-title">{card.toolName}</div>
                        <div class="am-card-desc">{card.summary}</div>
                        <span class={`am-badge ${cls}`}>{card.status}</span>
                      </div>
                    );
                  }
                  if (card.type === 'confirmation_request') {
                    return (
                      <div key={idx} class="am-card">
                        <div class="am-card-title">{card.toolName}</div>
                        <div class="am-card-desc">{card.description}</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            class="am-btn"
                            onClick={() => sendMessage(`Confirm ${card.toolName}`, card.toolCallId)}
                          >
                            {t.confirmAction}
                          </button>
                          <button type="button" class="am-btn am-btn-sec">
                            {t.cancel}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ))}

            {showStarters && (
              <div class="am-starters">
                {starters.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    class="am-starter"
                    onClick={() => sendMessage(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {loading && (
              <div class="am-msg am-msg-bot am-thinking" aria-live="polite">
                <span class="am-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{t.thinking}</span>
              </div>
            )}
          </div>

          <form
            class="am-form"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <input
              class="am-composer"
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              disabled={loading}
            />
            <button class="am-btn" type="submit" disabled={loading}>
              {t.send}
            </button>
          </form>

          {config?.showBranding !== false && <div class="am-footer">{t.powered}</div>}
        </div>
      )}

      <button
        type="button"
        class={`am-launcher ${!runtime.launcherLabel || open ? 'am-launcher-icon' : ''}`}
        aria-label={open ? t.closeLauncher : runtime.launcherLabel || t.openLauncher}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '×' : runtime.launcherLabel ? `✦ ${runtime.launcherLabel}` : '✦'}
      </button>
    </div>
  );
}

function parseStarters(raw: string | null): string[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const items = parsed.map((x) => String(x).trim()).filter(Boolean);
        return Array.from(new Set(items)).slice(0, 6);
      }
    } catch {
      // Fallback to delimiter parsing below
    }
  }
  const sep = trimmed.includes(';;') ? ';;' : '|';
  const items = trimmed
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(items)).slice(0, 6);
}

function bootWidget() {
  let scriptEl = document.currentScript as HTMLScriptElement | null;
  if (!scriptEl) {
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-agent]');
    scriptEl = scripts[scripts.length - 1] || null;
  }
  if (!scriptEl || !document.body) return;

  const agentId = scriptEl.getAttribute('data-agent');
  if (!agentId) return;

  const scriptSrc = scriptEl.getAttribute('src') || '';
  let apiBase = scriptEl.getAttribute('data-api') || '';
  if (!apiBase && scriptSrc) {
    try {
      apiBase = new URL(scriptSrc, window.location.href).origin;
    } catch {
      apiBase = window.location.origin;
    }
  }
  if (!apiBase) apiBase = window.location.origin;

  const rawPos = scriptEl.getAttribute('data-position');
  const rawTheme = scriptEl.getAttribute('data-theme');
  const rawRadius = scriptEl.getAttribute('data-radius');
  const rawLabel = (scriptEl.getAttribute('data-launcher-label') || '').trim().slice(0, 40);

  const runtime: SharedRuntime = {
    apiBase: apiBase.replace(/\/$/, ''),
    agentId,
    lang: normalizeLang(scriptEl.getAttribute('data-lang')),
    starters: parseStarters(scriptEl.getAttribute('data-starters')),
    position: rawPos === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    theme: rawTheme === 'dark' ? 'dark' : 'light',
    radius: rawRadius === 'classic' || rawRadius === 'sharp' ? rawRadius : 'rounded',
    launcherLabel: rawLabel,
    context: {},
  };

  // Expose public window.Askmink API
  (window as any).Askmink = {
    identify(signedJwt: string) {
      runtime.sessionJwt = signedJwt;
    },
    setContext(ctx: Record<string, unknown>) {
      runtime.context = { ...runtime.context, ...ctx };
    },
    open() {
      runtime.setOpenExternal?.(true);
    },
    close() {
      runtime.setOpenExternal?.(false);
    },
  };

  document.querySelectorAll('#askmink-widget-host').forEach((existing) => {
    const prevMount = existing.shadowRoot?.querySelector('[data-am-mount="1"]');
    if (prevMount) render(null, prevMount);
    existing.remove();
  });

  const host = document.createElement('div');
  host.id = 'askmink-widget-host';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  const mount = document.createElement('div');
  mount.setAttribute('data-am-mount', '1');
  shadow.appendChild(mount);
  render(<AskminkWidgetApp runtime={runtime} />, mount);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootWidget);
} else {
  bootWidget();
}
