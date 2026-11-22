import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  MessageCircle,
  Monitor,
  Moon,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '../lib/api';

interface WidgetStudioViewProps {
  agent: any;
  lang: SupportedLanguage;
  t: Record<string, string>;
  onAgentUpdated: () => Promise<void> | void;
}

type WidgetPosition = 'bottom-right' | 'bottom-left';
type WidgetTheme = 'light' | 'dark';
type LauncherStyle = 'icon' | 'pill';
type CornerStyle = 'rounded' | 'classic' | 'sharp';

interface LocalWidgetPrefs {
  position: WidgetPosition;
  theme: WidgetTheme;
  launcherStyle: LauncherStyle;
  launcherLabel: string;
  cornerStyle: CornerStyle;
  starterPromptsText: string;
}

interface PreviewMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Array<{ title: string; url?: string }>;
  cards?: Array<Record<string, any>>;
}

const COLOR_PRESETS = [
  '#2563EB', // Blue
  '#18181B', // Graphite
  '#4F46E5', // Indigo
  '#059669', // Emerald
  '#E11D48', // Rose
  '#D97706', // Amber
  '#0891B2', // Cyan
];

const DEFAULT_STARTERS: Record<SupportedLanguage, string> = {
  en: 'What plans do you offer?\nCan I book a quick demo?',
  pt: 'Quais planos vocês oferecem?\nPosso agendar uma demonstração?',
  es: '¿Qué planes ofrecen?\n¿Puedo agendar una demostración?',
};

const DEFAULT_LAUNCHER_LABEL: Record<SupportedLanguage, string> = {
  en: 'Chat with us',
  pt: 'Fale conosco',
  es: 'Chatea con nosotros',
};

function readLocalPrefs(agentId: string, lang: SupportedLanguage): LocalWidgetPrefs {
  try {
    const raw = localStorage.getItem(`askmink_widget_prefs_${agentId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        position: parsed.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
        launcherStyle: parsed.launcherStyle === 'pill' ? 'pill' : 'icon',
        launcherLabel:
          typeof parsed.launcherLabel === 'string' && parsed.launcherLabel.trim()
            ? parsed.launcherLabel
            : DEFAULT_LAUNCHER_LABEL[lang],
        cornerStyle:
          parsed.cornerStyle === 'classic' || parsed.cornerStyle === 'sharp'
            ? parsed.cornerStyle
            : 'rounded',
        starterPromptsText:
          typeof parsed.starterPromptsText === 'string'
            ? parsed.starterPromptsText
            : DEFAULT_STARTERS[lang],
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return {
    position: 'bottom-right',
    theme: 'light',
    launcherStyle: 'icon',
    launcherLabel: DEFAULT_LAUNCHER_LABEL[lang],
    cornerStyle: 'rounded',
    starterPromptsText: DEFAULT_STARTERS[lang],
  };
}

export function WidgetStudioView({ agent, lang, t, onAgentUpdated }: WidgetStudioViewProps) {
  // Persisted DB fields (via PATCH /api/agents/:agentId)
  const [name, setName] = useState<string>(agent.name || 'Askmink');
  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    agent.welcomeMessage || 'Hi! How can I help you today?'
  );
  const [defaultLanguage, setDefaultLanguage] = useState<SupportedLanguage>(
    agent.defaultLanguage || 'en'
  );
  const [primaryColor, setPrimaryColor] = useState<string>(agent.primaryColor || '#2563EB');
  const [showBranding, setShowBranding] = useState<boolean>(agent.showBranding !== false);

  // Embed appearance options (saved locally & encoded into script data-* attributes)
  const [prefs, setPrefs] = useState<LocalWidgetPrefs>(() => readLocalPrefs(agent.id, lang));

  // Preview controls
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [widgetOpen, setWidgetOpen] = useState(true);
  const [hostTheme, setHostTheme] = useState<'light' | 'dark'>('light');
  const [previewMode, setPreviewMode] = useState<'live' | 'cards'>('live');

  // Save & copy UI feedback
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Live preview chat state
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<PreviewMsg[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: agent.welcomeMessage || 'Hi! How can I help you today?',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedDemoSlot, setSelectedDemoSlot] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync form when switching active agent
  useEffect(() => {
    setName(agent.name || 'Askmink');
    setWelcomeMessage(agent.welcomeMessage || 'Hi! How can I help you today?');
    setDefaultLanguage(agent.defaultLanguage || 'en');
    setPrimaryColor(agent.primaryColor || '#2563EB');
    setShowBranding(agent.showBranding !== false);
    setPrefs(readLocalPrefs(agent.id, lang));
    setConversationId(undefined);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        text: agent.welcomeMessage || 'Hi! How can I help you today?',
      },
    ]);
    setNotice(null);
  }, [agent.id]);

  // Keep welcome bubble synchronized in real time while editing
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) => (m.id === 'welcome' ? { ...m, text: welcomeMessage || '...' } : m))
    );
  }, [welcomeMessage]);

  // Persist local embed appearance prefs per agent
  useEffect(() => {
    try {
      localStorage.setItem(`askmink_widget_prefs_${agent.id}`, JSON.stringify(prefs));
    } catch {
      // Ignore storage write errors
    }
  }, [agent.id, prefs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, widgetOpen, previewMode]);

  const isDirty =
    name !== (agent.name || '') ||
    welcomeMessage !== (agent.welcomeMessage || '') ||
    defaultLanguage !== (agent.defaultLanguage || 'en') ||
    primaryColor.toLowerCase() !== (agent.primaryColor || '#2563EB').toLowerCase() ||
    showBranding !== (agent.showBranding !== false);

  const validHex = /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#2563EB';

  const radiusTokens =
    prefs.cornerStyle === 'sharp'
      ? { panel: '6px', launcher: '6px', bubble: '6px', btn: '5px' }
      : prefs.cornerStyle === 'classic'
        ? { panel: '12px', launcher: '12px', bubble: '10px', btn: '8px' }
        : { panel: '18px', launcher: '9999px', bubble: '14px', btn: '10px' };

  const starterPrompts = prefs.starterPromptsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  const embedAttrs = [
    `src="${window.location.origin}/widget.js"`,
    `data-agent="${agent.id}"`,
    prefs.position !== 'bottom-right' ? `data-position="${prefs.position}"` : '',
    prefs.theme !== 'light' ? `data-theme="${prefs.theme}"` : '',
    prefs.cornerStyle !== 'rounded' ? `data-radius="${prefs.cornerStyle}"` : '',
    prefs.launcherStyle === 'pill' && prefs.launcherLabel.trim()
      ? `data-launcher-label="${prefs.launcherLabel.trim().replace(/"/g, '&quot;')}"`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const embedSnippet = `<script ${embedAttrs}></script>`;

  async function handleSave() {
    setSaving(true);
    setNotice(null);
    try {
      await apiRequest(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        body: {
          name: name.trim() || agent.name,
          welcomeMessage: welcomeMessage.trim() || 'Hi! How can I help you today?',
          defaultLanguage,
          primaryColor: validHex,
          showBranding,
        },
      });
      await onAgentUpdated();
      try {
        localStorage.setItem(`askmink_check_widget_${agent.id}`, '1');
      } catch {
        // Ignore storage write errors
      }
      setNotice({ type: 'ok', text: t.savedSuccess || 'Saved.' });
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message || t.saveError || 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyEmbed() {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  }

  async function sendLiveMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setPreviewMode('live');
    setWidgetOpen(true);
    setSending(true);
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'user', text: trimmed }]);
    setChatInput('');
    try {
      const res = await apiRequest(`/api/agents/${agent.id}/playground/chat`, {
        method: 'POST',
        body: {
          conversationId,
          message: trimmed,
          pageUrl: '/pricing',
          language: defaultLanguage,
        },
      });
      if (res.conversationId) setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          role: 'assistant',
          text: res.text || '',
          citations: res.citations || [],
          cards: res.cards || [],
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 2),
          role: 'assistant',
          text: (err as Error).message,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function resetChat() {
    setConversationId(undefined);
    setMessages([{ id: 'welcome', role: 'assistant', text: welcomeMessage || '...' }]);
  }

  const demoMessages: PreviewMsg[] = [
    { id: 'demo-welcome', role: 'assistant', text: welcomeMessage || '...' },
    {
      id: 'demo-user',
      role: 'user',
      text:
        defaultLanguage === 'pt'
          ? 'Quero conhecer o plano Pro e agendar uma demo.'
          : defaultLanguage === 'es'
            ? 'Quiero ver el plan Pro y agendar una demo.'
            : 'Tell me about the Pro plan and available demo times.',
    },
    {
      id: 'demo-bot',
      role: 'assistant',
      text:
        defaultLanguage === 'pt'
          ? 'Aqui estão os detalhes do plano Pro e os próximos horários livres para demonstração:'
          : defaultLanguage === 'es'
            ? 'Aquí tienes los detalles del plan Pro y los próximos horarios disponibles:'
            : 'Here are the Pro plan details and the next available demo slots:',
      citations: [{ title: 'Pricing Guide' }, { title: 'FAQ' }],
      cards: [
        {
          type: 'product_card',
          name: 'Pro Plan',
          description:
            defaultLanguage === 'pt'
              ? 'RAG híbrido ilimitado, MCP e widget white-label.'
              : defaultLanguage === 'es'
                ? 'RAG híbrido ilimitado, MCP y widget white-label.'
                : 'Unlimited hybrid RAG, MCP tools, and white-label widget.',
          priceLabel: '$49/mo',
        },
        {
          type: 'booking_slots',
          title:
            defaultLanguage === 'pt'
              ? 'Horários disponíveis'
              : defaultLanguage === 'es'
                ? 'Horarios disponibles'
                : 'Available times',
          slots: [
            { label: 'Tue 10:00' },
            { label: 'Tue 14:30' },
            { label: 'Wed 11:00' },
            { label: 'Thu 16:00' },
          ],
        },
      ],
    },
  ];

  const renderedMessages = previewMode === 'cards' ? demoMessages : messages;
  const isDarkWidget = prefs.theme === 'dark';

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
      {/* Left Inspector: Customization Controls */}
      <aside className="w-full lg:w-[370px] xl:w-[400px] bg-white border-b lg:border-b-0 lg:border-r border-[#EAECEF] flex flex-col shrink-0 max-h-[48vh] lg:max-h-none">
        <div className="px-5 py-4 border-b border-[#EAECEF] shrink-0">
          <h1 className="text-sm font-semibold text-[#111827]">{t.widgetStudioTitle}</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">{t.widgetStudioSubtitle}</p>
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll p-5 space-y-6">
          {notice && (
            <div
              role="status"
              className={`px-3 py-2 rounded-lg text-xs font-medium ${
                notice.type === 'ok'
                  ? 'bg-[#ECFDF5] text-[#047857] border border-[#D1FAE5]'
                  : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]'
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* Section 1: Identity & Copy */}
          <div className="space-y-3.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
              {t.sectionIdentity}
            </h2>

            <div>
              <label
                htmlFor="widget-name-input"
                className="block text-xs font-medium text-[#374151] mb-1"
              >
                {t.widgetNameLabel}
              </label>
              <input
                id="widget-name-input"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[#111827]"
              />
            </div>

            <div>
              <label
                htmlFor="widget-welcome-input"
                className="block text-xs font-medium text-[#374151] mb-1"
              >
                {t.welcomeMessageLabel}
              </label>
              <textarea
                id="widget-welcome-input"
                rows={2}
                maxLength={500}
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[#111827] resize-none"
              />
            </div>

            <div>
              <label
                htmlFor="widget-lang-select"
                className="block text-xs font-medium text-[#374151] mb-1"
              >
                {t.widgetDefaultLangLabel}
              </label>
              <select
                id="widget-lang-select"
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value as SupportedLanguage)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[#111827]"
              >
                <option value="en">English (EN)</option>
                <option value="pt">Português (PT)</option>
                <option value="es">Español (ES)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="widget-color-hex"
                className="block text-xs font-medium text-[#374151] mb-1.5"
              >
                {t.primaryColorLabel}
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {COLOR_PRESETS.map((hex) => {
                  const selected = validHex.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setPrimaryColor(hex)}
                      aria-label={hex}
                      aria-pressed={selected}
                      className={`w-7 h-7 rounded-full border transition flex items-center justify-center ${
                        selected
                          ? 'ring-2 ring-offset-2 ring-[#111827] border-transparent'
                          : 'border-black/15 hover:scale-105'
                      }`}
                      style={{ backgroundColor: hex }}
                    >
                      {selected && <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
                    </button>
                  );
                })}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="color"
                    aria-label={t.primaryColorLabel}
                    value={validHex}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-7 h-7 p-0.5 rounded-lg border border-[#E5E7EB] bg-white cursor-pointer"
                  />
                </label>
                <input
                  id="widget-color-hex"
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  maxLength={7}
                  className="w-20 text-xs font-mono px-2 py-1.5 rounded-lg border border-[#E5E7EB] text-[#111827]"
                />
              </div>
            </div>

            <label
              htmlFor="widget-branding-switch"
              className="flex items-center justify-between gap-3 pt-1 cursor-pointer"
            >
              <span className="text-xs font-medium text-[#374151]">{t.showBrandingLabel}</span>
              <input
                id="widget-branding-switch"
                type="checkbox"
                checked={showBranding}
                onChange={(e) => setShowBranding(e.target.checked)}
                {...({ switch: '' } as any)}
                className="w-4 h-4 rounded"
              />
            </label>
          </div>

          {/* Section 2: Appearance & Layout */}
          <div className="space-y-3.5 pt-4 border-t border-[#F3F4F6]">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
              {t.sectionAppearance}
            </h2>

            {/* Theme */}
            <div>
              <span className="block text-xs font-medium text-[#374151] mb-1.5">
                {t.themeLabel}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(['light', 'dark'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={prefs.theme === mode}
                    onClick={() => setPrefs((p) => ({ ...p, theme: mode }))}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 transition ${
                      prefs.theme === mode
                        ? 'bg-[#18181B] text-white border-[#18181B]'
                        : 'bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {mode === 'light' ? (
                      <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{mode === 'light' ? t.themeLight : t.themeDark}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Position */}
            <div>
              <span className="block text-xs font-medium text-[#374151] mb-1.5">
                {t.positionLabel}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'bottom-left', label: t.positionLeft },
                    { id: 'bottom-right', label: t.positionRight },
                  ] as const
                ).map((pos) => (
                  <button
                    key={pos.id}
                    type="button"
                    aria-pressed={prefs.position === pos.id}
                    onClick={() => setPrefs((p) => ({ ...p, position: pos.id }))}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition ${
                      prefs.position === pos.id
                        ? 'bg-[#18181B] text-white border-[#18181B]'
                        : 'bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Launcher style */}
            <div>
              <span className="block text-xs font-medium text-[#374151] mb-1.5">
                {t.launcherStyleLabel}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'icon', label: t.launcherIcon },
                    { id: 'pill', label: t.launcherPill },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    aria-pressed={prefs.launcherStyle === st.id}
                    onClick={() => setPrefs((p) => ({ ...p, launcherStyle: st.id }))}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition ${
                      prefs.launcherStyle === st.id
                        ? 'bg-[#18181B] text-white border-[#18181B]'
                        : 'bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {prefs.launcherStyle === 'pill' && (
                <div className="mt-2">
                  <label
                    htmlFor="launcher-label-input"
                    className="block text-[11px] text-[#6B7280] mb-1"
                  >
                    {t.launcherLabelField}
                  </label>
                  <input
                    id="launcher-label-input"
                    type="text"
                    maxLength={40}
                    value={prefs.launcherLabel}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, launcherLabel: e.target.value }))
                    }
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#111827]"
                  />
                </div>
              )}
            </div>

            {/* Corner radius */}
            <div>
              <span className="block text-xs font-medium text-[#374151] mb-1.5">
                {t.cornerRadiusLabel}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'rounded', label: t.radiusRounded },
                    { id: 'classic', label: t.radiusClassic },
                    { id: 'sharp', label: t.radiusSharp },
                  ] as const
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={prefs.cornerStyle === r.id}
                    onClick={() => setPrefs((p) => ({ ...p, cornerStyle: r.id }))}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition ${
                      prefs.cornerStyle === r.id
                        ? 'bg-[#18181B] text-white border-[#18181B]'
                        : 'bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 3: Quick Starter Prompts */}
          <div className="space-y-2 pt-4 border-t border-[#F3F4F6]">
            <label
              htmlFor="starter-prompts-textarea"
              className="block text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]"
            >
              {t.sectionStarterPrompts}
            </label>
            <p className="text-[11px] text-[#6B7280]">{t.starterPromptsHint}</p>
            <textarea
              id="starter-prompts-textarea"
              rows={2}
              value={prefs.starterPromptsText}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, starterPromptsText: e.target.value }))
              }
              className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[#111827] resize-none"
            />
          </div>
        </div>

        {/* Sticky Save Bar */}
        <div className="p-4 border-t border-[#EAECEF] bg-[#FAFAFB] flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-[#6B7280]">
            {isDirty ? t.unsavedChanges : t.online}
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#18181B] hover:bg-[#27272A] disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 transition"
          >
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{saving ? t.saving : t.saveChanges}</span>
          </button>
        </div>
      </aside>

      {/* Right Stage: Live Host-Site Canvas & Interactive Widget */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F3F4F6]/70 overflow-hidden">
        {/* Stage Toolbar */}
        <div className="px-4 py-2.5 bg-white border-b border-[#EAECEF] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Viewport switch */}
            <div className="inline-flex p-0.5 rounded-lg bg-[#F3F4F6] border border-[#EAECEF]">
              <button
                type="button"
                aria-pressed={viewport === 'desktop'}
                onClick={() => setViewport('desktop')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition ${
                  viewport === 'desktop'
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.previewDesktop}</span>
              </button>
              <button
                type="button"
                aria-pressed={viewport === 'mobile'}
                onClick={() => setViewport('mobile')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition ${
                  viewport === 'mobile'
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.previewMobile}</span>
              </button>
            </div>

            {/* Open / Closed toggle */}
            <div className="inline-flex p-0.5 rounded-lg bg-[#F3F4F6] border border-[#EAECEF]">
              <button
                type="button"
                aria-pressed={widgetOpen}
                onClick={() => setWidgetOpen(true)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  widgetOpen
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {t.previewOpen}
              </button>
              <button
                type="button"
                aria-pressed={!widgetOpen}
                onClick={() => setWidgetOpen(false)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  !widgetOpen
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {t.previewClosed}
              </button>
            </div>

            {/* Live Chat vs UI Cards Showcase */}
            <div className="inline-flex p-0.5 rounded-lg bg-[#F3F4F6] border border-[#EAECEF]">
              <button
                type="button"
                aria-pressed={previewMode === 'live'}
                onClick={() => {
                  setPreviewMode('live');
                  setWidgetOpen(true);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  previewMode === 'live'
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {t.previewModeLive}
              </button>
              <button
                type="button"
                aria-pressed={previewMode === 'cards'}
                onClick={() => {
                  setPreviewMode('cards');
                  setWidgetOpen(true);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  previewMode === 'cards'
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {t.previewModeCards}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHostTheme((h) => (h === 'light' ? 'dark' : 'light'))}
              className="px-2.5 py-1.5 rounded-lg border border-[#EAECEF] bg-white hover:bg-[#F9FAFB] text-xs font-medium text-[#374151] inline-flex items-center gap-1.5 transition"
            >
              {hostTheme === 'light' ? (
                <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{hostTheme === 'light' ? t.previewHostDark : t.previewHostLight}</span>
            </button>

            <button
              type="button"
              onClick={resetChat}
              className="px-2.5 py-1.5 rounded-lg border border-[#EAECEF] bg-white hover:bg-[#F9FAFB] text-xs font-medium text-[#374151] inline-flex items-center gap-1.5 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.resetPreviewChat}</span>
            </button>
          </div>
        </div>

        {/* Simulated Customer Website Viewport */}
        <div className="flex-1 overflow-auto p-4 lg:p-6 flex items-center justify-center">
          <div
            className={`relative rounded-2xl border overflow-hidden shadow-sm transition-all duration-200 flex flex-col ${
              viewport === 'mobile'
                ? 'w-[390px] h-[680px] max-w-full'
                : 'w-full max-w-4xl h-[640px]'
            } ${
              hostTheme === 'dark'
                ? 'bg-[#0F172A] border-[#1E293B]'
                : 'bg-white border-[#E5E7EB]'
            }`}
          >
            {/* Mock Browser Chrome */}
            <div
              className={`h-9 px-3.5 border-b flex items-center gap-3 shrink-0 ${
                hostTheme === 'dark'
                  ? 'bg-[#1E293B] border-[#334155]'
                  : 'bg-[#F9FAFB] border-[#EAECEF]'
              }`}
            >
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E5E7EB] dark:bg-[#475569]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#E5E7EB] dark:bg-[#475569]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#E5E7EB] dark:bg-[#475569]" />
              </div>
              <div
                className={`flex-1 max-w-xs mx-auto text-center text-[11px] px-3 py-0.5 rounded-md truncate ${
                  hostTheme === 'dark'
                    ? 'bg-[#0F172A] text-[#94A3B8]'
                    : 'bg-white border border-[#EAECEF] text-[#6B7280]'
                }`}
              >
                https://your-website.com/pricing
              </div>
            </div>

            {/* Simulated Host Page Content */}
            <div className="flex-1 relative overflow-hidden p-6 sm:p-8">
              <div className="max-w-lg space-y-4 select-none pointer-events-none opacity-80">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-6 h-6 rounded-md ${
                      hostTheme === 'dark' ? 'bg-[#334155]' : 'bg-[#E5E7EB]'
                    }`}
                  />
                  <span
                    className={`text-xs font-semibold ${
                      hostTheme === 'dark' ? 'text-[#CBD5E1]' : 'text-[#374151]'
                    }`}
                  >
                    {t.hostSiteBrand}
                  </span>
                </div>

                <h2
                  className={`text-xl font-semibold tracking-tight leading-snug ${
                    hostTheme === 'dark' ? 'text-white' : 'text-[#111827]'
                  }`}
                >
                  {t.hostSiteHero}
                </h2>
                <p
                  className={`text-xs leading-relaxed ${
                    hostTheme === 'dark' ? 'text-[#94A3B8]' : 'text-[#6B7280]'
                  }`}
                >
                  {t.hostSiteSub}
                </p>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[1, 2].map((n) => (
                    <div
                      key={n}
                      className={`rounded-xl p-4 border space-y-2 ${
                        hostTheme === 'dark'
                          ? 'bg-[#1E293B]/60 border-[#334155]'
                          : 'bg-[#F8F9FB] border-[#EAECEF]'
                      }`}
                    >
                      <div
                        className={`h-2.5 w-16 rounded ${
                          hostTheme === 'dark' ? 'bg-[#334155]' : 'bg-[#E5E7EB]'
                        }`}
                      />
                      <div
                        className={`h-5 w-20 rounded ${
                          hostTheme === 'dark' ? 'bg-[#475569]' : 'bg-[#D1D5DB]'
                        }`}
                      />
                      <div
                        className={`h-2 w-full rounded ${
                          hostTheme === 'dark' ? 'bg-[#334155]/70' : 'bg-[#E5E7EB]/80'
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Floating Live Widget Preview */}
              <div
                className={`absolute bottom-4 z-20 flex flex-col gap-2.5 ${
                  prefs.position === 'bottom-left'
                    ? 'left-4 items-start'
                    : 'right-4 items-end'
                }`}
              >
                {widgetOpen && (
                  <div
                    role="region"
                    aria-label={`${name} widget preview`}
                    style={{ borderRadius: radiusTokens.panel }}
                    className={`flex flex-col overflow-hidden border shadow-2xl ${
                      viewport === 'mobile'
                        ? 'w-[348px] h-[515px]'
                        : 'w-[368px] h-[490px]'
                    } ${
                      isDarkWidget
                        ? 'bg-[#111827] border-[#1F2937] text-[#F9FAFB]'
                        : 'bg-white border-[#E5E7EB] text-[#111827]'
                    }`}
                  >
                    {/* Widget Header */}
                    <div
                      className={`px-4 py-3 border-b flex items-center justify-between gap-2 shrink-0 ${
                        isDarkWidget
                          ? 'bg-[#18181B] border-[#27272A]'
                          : 'bg-white border-[#EAECEF]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-8 h-8 rounded-lg text-white font-bold text-xs flex items-center justify-center shrink-0"
                          style={{ backgroundColor: validHex }}
                        >
                          {(name || 'A').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold leading-tight truncate">
                            {name || 'Askmink'}
                          </div>
                          <div className="text-[11px] text-[#16A34A] flex items-center gap-1 mt-0.5">
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"
                              aria-hidden="true"
                            />
                            <span>{t.online}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWidgetOpen(false)}
                        aria-label={t.close}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition ${
                          isDarkWidget
                            ? 'text-[#9CA3AF] hover:bg-[#27272A] hover:text-white'
                            : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'
                        }`}
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>

                    {/* Widget Messages */}
                    <div
                      className={`flex-1 overflow-y-auto sidebar-scroll p-3.5 space-y-2.5 ${
                        isDarkWidget ? 'bg-[#0B0F19]' : 'bg-[#F8F9FB]'
                      }`}
                    >
                      {renderedMessages.map((m) => (
                        <div
                          key={m.id}
                          style={{
                            borderRadius: radiusTokens.bubble,
                            ...(m.role === 'user'
                              ? { backgroundColor: validHex, color: '#FFFFFF' }
                              : {}),
                          }}
                          className={`max-w-[88%] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                            m.role === 'user'
                              ? 'ml-auto rounded-br-sm'
                              : isDarkWidget
                                ? 'bg-[#18181B] border border-[#27272A] text-[#F3F4F6] rounded-bl-sm'
                                : 'bg-white border border-[#EAECEF] text-[#111827] rounded-bl-sm'
                          }`}
                        >
                          <div>{m.text}</div>

                          {m.citations && m.citations.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {m.citations.map((c, idx) => (
                                <span
                                  key={idx}
                                  className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                    isDarkWidget
                                      ? 'bg-[#1E293B] border-[#334155] text-[#93C5FD]'
                                      : 'bg-[#EFF6FF] border-[#DBEAFE] text-[#1D4ED8]'
                                  }`}
                                >
                                  {c.title}
                                </span>
                              ))}
                            </div>
                          )}

                          {m.cards?.map((card, idx) => {
                            if (card.type === 'product_card') {
                              return (
                                <div
                                  key={idx}
                                  className={`mt-2 p-3 rounded-xl border space-y-1.5 ${
                                    isDarkWidget
                                      ? 'bg-[#111827] border-[#27272A]'
                                      : 'bg-[#FAFAFB] border-[#EAECEF]'
                                  }`}
                                >
                                  <div className="font-semibold text-xs">{card.name}</div>
                                  <div
                                    className={`text-[11px] ${
                                      isDarkWidget ? 'text-[#9CA3AF]' : 'text-[#6B7280]'
                                    }`}
                                  >
                                    {card.description}
                                  </div>
                                  <div className="text-sm font-bold tabular-nums">
                                    {card.priceLabel}
                                  </div>
                                  <span
                                    style={{
                                      backgroundColor: validHex,
                                      borderRadius: radiusTokens.btn,
                                    }}
                                    className="inline-block px-3 py-1 text-[11px] font-medium text-white"
                                  >
                                    Checkout
                                  </span>
                                </div>
                              );
                            }

                            if (card.type === 'booking_slots') {
                              return (
                                <div
                                  key={idx}
                                  className={`mt-2 p-3 rounded-xl border space-y-2 ${
                                    isDarkWidget
                                      ? 'bg-[#111827] border-[#27272A]'
                                      : 'bg-[#FAFAFB] border-[#EAECEF]'
                                  }`}
                                >
                                  <div className="font-semibold text-xs">{card.title}</div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    {(card.slots || []).map((slot: any, sIdx: number) => {
                                      const active = selectedDemoSlot === sIdx;
                                      return (
                                        <button
                                          key={sIdx}
                                          type="button"
                                          onClick={() => setSelectedDemoSlot(sIdx)}
                                          style={
                                            active
                                              ? {
                                                  borderColor: validHex,
                                                  color: validHex,
                                                }
                                              : undefined
                                          }
                                          className={`px-2 py-1 text-[11px] rounded-md border text-left transition ${
                                            active
                                              ? 'font-semibold bg-white/80'
                                              : isDarkWidget
                                                ? 'border-[#27272A] bg-[#18181B] text-[#D1D5DB]'
                                                : 'border-[#E5E7EB] bg-white text-[#374151]'
                                          }`}
                                        >
                                          {slot.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      ))}

                      {/* Starter Quick Prompts (when in live mode with only welcome msg) */}
                      {previewMode === 'live' &&
                        messages.length === 1 &&
                        starterPrompts.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {starterPrompts.map((prompt) => (
                              <button
                                key={prompt}
                                type="button"
                                onClick={() => sendLiveMessage(prompt)}
                                className={`text-[11px] px-2.5 py-1.5 rounded-full border transition text-left ${
                                  isDarkWidget
                                    ? 'bg-[#18181B] border-[#27272A] text-[#E5E7EB] hover:border-[#52525B]'
                                    : 'bg-white border-[#E5E7EB] text-[#374151] hover:border-[#9CA3AF]'
                                }`}
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                        )}

                      {sending && (
                        <div
                          className={`inline-block px-3 py-2 rounded-xl text-xs ${
                            isDarkWidget
                              ? 'bg-[#18181B] text-[#9CA3AF]'
                              : 'bg-white border border-[#EAECEF] text-[#6B7280]'
                          }`}
                        >
                          {t.widgetThinking}
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Widget Composer */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        sendLiveMessage(chatInput);
                      }}
                      className={`p-2.5 border-t flex items-center gap-2 shrink-0 ${
                        isDarkWidget
                          ? 'bg-[#18181B] border-[#27272A]'
                          : 'bg-white border-[#EAECEF]'
                      }`}
                    >
                      <input
                        type="text"
                        aria-label={t.widgetInputPlaceholder}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder={t.widgetInputPlaceholder}
                        disabled={sending}
                        className={`flex-1 text-xs px-3 py-2 rounded-lg border outline-none ${
                          isDarkWidget
                            ? 'bg-[#111827] border-[#27272A] text-white placeholder:text-[#6B7280]'
                            : 'bg-white border-[#E5E7EB] text-[#111827] placeholder:text-[#9CA3AF]'
                        }`}
                      />
                      <button
                        type="submit"
                        disabled={sending || !chatInput.trim()}
                        aria-label={t.widgetSend}
                        style={{ backgroundColor: validHex, borderRadius: radiusTokens.btn }}
                        className="px-3 py-2 text-white text-xs font-medium inline-flex items-center justify-center disabled:opacity-50 transition"
                      >
                        <Send className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </form>

                    {showBranding && (
                      <div
                        className={`py-1.5 text-center text-[10px] ${
                          isDarkWidget
                            ? 'bg-[#18181B] text-[#71717A]'
                            : 'bg-white text-[#9CA3AF]'
                        }`}
                      >
                        Powered by Askmink
                      </div>
                    )}
                  </div>
                )}

                {/* Floating Launcher Button */}
                <button
                  type="button"
                  onClick={() => setWidgetOpen((o) => !o)}
                  aria-label={widgetOpen ? t.close : name}
                  style={{
                    backgroundColor: validHex,
                    borderRadius:
                      prefs.launcherStyle === 'pill' ? '9999px' : radiusTokens.launcher,
                  }}
                  className={`text-white shadow-lg hover:brightness-110 transition flex items-center justify-center gap-2 cursor-pointer ${
                    prefs.launcherStyle === 'pill' && !widgetOpen
                      ? 'h-12 px-4 text-xs font-semibold'
                      : 'w-13 h-13'
                  }`}
                >
                  {widgetOpen ? (
                    <X className="w-5 h-5" aria-hidden="true" />
                  ) : (
                    <>
                      {prefs.launcherStyle === 'pill' ? (
                        <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <Sparkles className="w-5 h-5" aria-hidden="true" />
                      )}
                      {prefs.launcherStyle === 'pill' && (
                        <span>{prefs.launcherLabel || DEFAULT_LAUNCHER_LABEL[lang]}</span>
                      )}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Embed Code Strip */}
        <div className="px-4 py-3 bg-white border-t border-[#EAECEF] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Code2 className="w-4 h-4 text-[#6B7280] shrink-0" aria-hidden="true" />
            <code className="text-[11px] font-mono text-[#374151] bg-[#F8F9FB] border border-[#EAECEF] px-2.5 py-1.5 rounded-lg truncate flex-1">
              {embedSnippet}
            </code>
          </div>
          <button
            type="button"
            onClick={handleCopyEmbed}
            className="px-3 py-1.5 rounded-lg bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 shrink-0 transition"
          >
            {copiedEmbed ? (
              <Check className="w-3.5 h-3.5 text-[#4ADE80]" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{copiedEmbed ? t.copied : t.copySnippet}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
