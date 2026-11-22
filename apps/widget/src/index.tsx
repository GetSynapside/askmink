import { render } from 'preact';
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
  primaryColor: string;
  showBranding: boolean;
}

const I18N: Record<Lang, Record<string, string>> = {
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
    powered: 'Powered by Askmink',
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
    powered: 'Powered by Askmink',
  },
};

function detectLanguage(fallback: Lang): Lang {
  const raw = (document.documentElement.lang || navigator.language || fallback).toLowerCase();
  if (raw.startsWith('pt')) return 'pt';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('en')) return 'en';
  return fallback;
}

interface SharedRuntime {
  apiBase: string;
  agentId: string;
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
  t: Record<string, string>;
}) {
  const slots = (card.slots || []) as Array<{ startsAt: string; endsAt: string; label: string }>;
  const [selected, setSelected] = useState(slots[0] || null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState<{ bookingId: string; icsDownloadUrl: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (confirmed) {
    return (
      <div class="am-card">
        <div class="am-card-title">{t.book} ✓</div>
        <div class="am-card-desc">{selected?.label}</div>
        <a
          class="am-btn"
          href={`${apiBase}${confirmed.icsDownloadUrl}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.downloadIcs}
        </a>
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Booking failed');
      setConfirmed({ bookingId: data.booking.id, icsDownloadUrl: data.icsDownloadUrl });
    } catch (err) {
      setError((err as Error).message);
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
  const [lang, setLang] = useState<Lang>('en');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    runtime.setOpenExternal = setOpen;
    fetch(`${runtime.apiBase}/api/widget/${runtime.agentId}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: WidgetConfig | null) => {
        if (!cfg) return;
        setConfig(cfg);
        setLang(detectLanguage(cfg.defaultLanguage || 'en'));
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            text: cfg.welcomeMessage || 'Hi! How can I help you?',
          },
        ]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const t = I18N[lang] || I18N.en;

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
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
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now() + 2), role: 'assistant', text: (err as Error).message },
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
        <div class="am-panel" role="dialog" aria-label={config?.name || 'Askmink Chat'}>
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
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          <div class="am-messages" ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} class={`am-msg ${m.role === 'user' ? 'am-msg-user' : 'am-msg-bot'}`}>
                <div>{m.text}</div>

                {m.citations && m.citations.length > 0 && (
                  <div class="am-citations">
                    {m.citations.map((c, idx) =>
                      c.url ? (
                        <a
                          key={idx}
                          class="am-cite"
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {c.title}
                        </a>
                      ) : (
                        <span key={idx} class="am-cite">
                          {c.title}
                        </span>
                      )
                    )}
                  </div>
                )}

                {m.cards?.map((card, idx) => {
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
                    return (
                      <div key={idx} class="am-card">
                        <div class="am-card-title">{card.name}</div>
                        <div class="am-card-desc">{card.description}</div>
                        <div class="am-price">{card.priceLabel}</div>
                        <a
                          class="am-btn"
                          href={card.checkoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t.checkout}
                        </a>
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
        aria-label={open ? 'Close Askmink' : runtime.launcherLabel || 'Open Askmink'}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '×' : runtime.launcherLabel ? `✦ ${runtime.launcherLabel}` : '✦'}
      </button>
    </div>
  );
}

function bootWidget() {
  const scriptEl =
    (document.currentScript as HTMLScriptElement | null) ||
    document.querySelector<HTMLScriptElement>('script[data-agent]');
  if (!scriptEl) return;

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

  const host = document.createElement('div');
  host.id = 'askmink-widget-host';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  const mount = document.createElement('div');
  shadow.appendChild(mount);
  render(<AskminkWidgetApp runtime={runtime} />, mount);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootWidget);
} else {
  bootWidget();
}
