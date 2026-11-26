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
import { apiRequest } from '@/lib/api';
import { SafeMarkdown, isSafeHttpUrl } from '@/components/SafeMarkdown';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

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
  '#2563EB',
  '#18181B',
  '#4F46E5',
  '#059669',
  '#E11D48',
  '#D97706',
  '#0891B2',
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

function parseStarterPrompts(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim().slice(0, 200);
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= 6) break;
    }
  }
  return out;
}

function resolveStarterPromptsText(agent: any, fallbackLang: SupportedLanguage): string {
  if (Array.isArray(agent?.starterPrompts) && agent.starterPrompts.length > 0) {
    const cleaned = agent.starterPrompts
      .map((s: unknown) => String(s ?? '').trim().slice(0, 200))
      .filter(Boolean);
    if (cleaned.length > 0) return cleaned.join('\n');
  }
  return readLocalPrefs(agent.id, fallbackLang).starterPromptsText;
}

function dedupeCards(cards?: Array<Record<string, any>>): Array<Record<string, any>> {
  if (!Array.isArray(cards)) return [];
  const seenProducts = new Set<string>();
  const out: Array<Record<string, any>> = [];
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
  const [name, setName] = useState<string>(agent.name || 'Askmink');
  const [welcomeMessage, setWelcomeMessage] = useState<string>(
    agent.welcomeMessage || 'Hi! How can I help you today?'
  );
  const [defaultLanguage, setDefaultLanguage] = useState<SupportedLanguage>(
    agent.defaultLanguage || 'en'
  );
  const [primaryColor, setPrimaryColor] = useState<string>(agent.primaryColor || '#2563EB');
  const [showBranding, setShowBranding] = useState<boolean>(agent.showBranding !== false);

  const [prefs, setPrefs] = useState<LocalWidgetPrefs>(() => ({
    ...readLocalPrefs(agent.id, lang),
    starterPromptsText: resolveStarterPromptsText(agent, lang),
  }));

  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [widgetOpen, setWidgetOpen] = useState(true);
  const [hostTheme, setHostTheme] = useState<'light' | 'dark'>('light');
  const [previewMode, setPreviewMode] = useState<'live' | 'cards'>('live');

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

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

  useEffect(() => {
    setName(agent.name || 'Askmink');
    setWelcomeMessage(agent.welcomeMessage || 'Hi! How can I help you today?');
    setDefaultLanguage(agent.defaultLanguage || 'en');
    setPrimaryColor(agent.primaryColor || '#2563EB');
    setShowBranding(agent.showBranding !== false);
    setPrefs({
      ...readLocalPrefs(agent.id, lang),
      starterPromptsText: resolveStarterPromptsText(agent, lang),
    });
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

  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) => (m.id === 'welcome' ? { ...m, text: welcomeMessage || '...' } : m))
    );
  }, [welcomeMessage]);

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

  const starterPrompts = parseStarterPrompts(prefs.starterPromptsText);
  const savedStarterPrompts = Array.isArray(agent.starterPrompts)
    ? parseStarterPrompts(
        agent.starterPrompts.map((s: unknown) => String(s ?? '').trim()).join('\n')
      )
    : [];

  const isDirty =
    name !== (agent.name || '') ||
    welcomeMessage !== (agent.welcomeMessage || '') ||
    defaultLanguage !== (agent.defaultLanguage || 'en') ||
    primaryColor.toLowerCase() !== (agent.primaryColor || '#2563EB').toLowerCase() ||
    showBranding !== (agent.showBranding !== false) ||
    JSON.stringify(starterPrompts) !== JSON.stringify(savedStarterPrompts);

  const validHex = /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#2563EB';

  const radiusTokens =
    prefs.cornerStyle === 'sharp'
      ? { panel: '6px', launcher: '6px', bubble: '6px', btn: '5px' }
      : prefs.cornerStyle === 'classic'
        ? { panel: '12px', launcher: '12px', bubble: '10px', btn: '8px' }
        : { panel: '18px', launcher: '9999px', bubble: '14px', btn: '10px' };

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
    const nextName = name.trim() || agent.name;
    const nextWelcome = welcomeMessage.trim() || 'Hi! How can I help you today?';
    try {
      await apiRequest(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        body: {
          name: nextName,
          welcomeMessage: nextWelcome,
          defaultLanguage,
          primaryColor: validHex,
          showBranding,
          starterPrompts,
        },
      });
      setName(nextName);
      setWelcomeMessage(nextWelcome);
      try {
        localStorage.setItem(`askmink_check_widget_${agent.id}`, '1');
      } catch {
        // Ignore storage write errors
      }
      setNotice({ type: 'ok', text: t.savedSuccess || 'Saved.' });
      await Promise.resolve(onAgentUpdated()).catch(() => undefined);
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
          pageUrl: '/',
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
      text: t.demoUserMsg || 'Tell me about the Pro plan and available demo times.',
    },
    {
      id: 'demo-bot',
      role: 'assistant',
      text: t.demoBotMsg || 'Here are the Pro plan details and the next available demo slots:',
      citations: [
        { title: t.demoCite1 || 'Pricing Guide' },
        { title: t.demoCite2 || 'FAQ' },
      ],
      cards: [
        {
          type: 'product_card',
          productId: 'demo-pro-plan',
          name: t.demoProductName || 'Pro Plan',
          description:
            t.demoProductDesc || 'Unlimited hybrid RAG, MCP tools, and white-label widget.',
          priceLabel: t.demoProductPrice || '$49/mo',
        },
        {
          type: 'booking_slots',
          title: t.demoBookingTitle || 'Available times',
          slots: [
            { label: t.demoSlot1 || 'Tue 10:00' },
            { label: t.demoSlot2 || 'Tue 14:30' },
            { label: t.demoSlot3 || 'Wed 11:00' },
            { label: t.demoSlot4 || 'Thu 16:00' },
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
      <aside className="w-full lg:w-[370px] xl:w-[400px] bg-card border-b lg:border-b-0 lg:border-r border-border flex flex-col shrink-0 max-h-[48vh] lg:max-h-none">
        <div className="px-5 py-4 border-b border-border shrink-0">
          <h1 className="text-base font-semibold text-foreground tracking-tight">
            {t.widgetStudioTitle}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t.widgetStudioSubtitle}</p>
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll p-5 space-y-6">
          {notice && (
            <Alert variant={notice.type === 'ok' ? 'success' : 'destructive'}>
              <AlertDescription className="font-medium">{notice.text}</AlertDescription>
            </Alert>
          )}

          {/* Section 1: Identity & Copy */}
          <div className="space-y-3.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t.sectionIdentity}
            </h2>

            <div className="space-y-1.5">
              <Label htmlFor="widget-name-input">{t.widgetNameLabel}</Label>
              <Input
                id="widget-name-input"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="widget-welcome-input">{t.welcomeMessageLabel}</Label>
              <Textarea
                id="widget-welcome-input"
                rows={2}
                maxLength={500}
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                className="resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="widget-lang-select">{t.widgetDefaultLangLabel}</Label>
              <Select
                value={defaultLanguage}
                onValueChange={(v) => setDefaultLanguage(v as SupportedLanguage)}
              >
                <SelectTrigger id="widget-lang-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English (EN)</SelectItem>
                  <SelectItem value="pt">Português (PT)</SelectItem>
                  <SelectItem value="es">Español (ES)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="widget-color-hex">{t.primaryColorLabel}</Label>
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
                      className={`size-7 rounded-full border transition flex items-center justify-center cursor-pointer ${
                        selected
                          ? 'ring-2 ring-offset-2 ring-foreground border-transparent'
                          : 'border-black/15 hover:scale-105'
                      }`}
                      style={{ backgroundColor: hex }}
                    >
                      {selected && <Check className="size-3.5 text-white" aria-hidden="true" />}
                    </button>
                  );
                })}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="color"
                    aria-label={t.primaryColorLabel}
                    value={validHex}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="size-7 p-0.5 rounded-lg border border-input bg-background cursor-pointer"
                  />
                </label>
                <Input
                  id="widget-color-hex"
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  maxLength={7}
                  className="w-20 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <Label htmlFor="widget-branding-switch" className="cursor-pointer">
                {t.showBrandingLabel}
              </Label>
              <Switch
                id="widget-branding-switch"
                checked={showBranding}
                onCheckedChange={setShowBranding}
              />
            </div>
          </div>

          <Separator />

          {/* Section 2: Appearance & Layout */}
          <div className="space-y-3.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t.sectionAppearance}
            </h2>

            {/* Theme */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">{t.themeLabel}</div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t.themeLabel}>
                {(['light', 'dark'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={prefs.theme === mode ? 'default' : 'outline'}
                    aria-pressed={prefs.theme === mode}
                    onClick={() => setPrefs((p) => ({ ...p, theme: mode }))}
                  >
                    {mode === 'light' ? (
                      <Sun className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Moon className="size-3.5" aria-hidden="true" />
                    )}
                    <span>{mode === 'light' ? t.themeLight : t.themeDark}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Position */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">{t.positionLabel}</div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t.positionLabel}>
                {(
                  [
                    { id: 'bottom-left', label: t.positionLeft },
                    { id: 'bottom-right', label: t.positionRight },
                  ] as const
                ).map((pos) => (
                  <Button
                    key={pos.id}
                    type="button"
                    variant={prefs.position === pos.id ? 'default' : 'outline'}
                    aria-pressed={prefs.position === pos.id}
                    onClick={() => setPrefs((p) => ({ ...p, position: pos.id }))}
                  >
                    {pos.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Launcher style */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">{t.launcherStyleLabel}</div>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label={t.launcherStyleLabel}
              >
                {(
                  [
                    { id: 'icon', label: t.launcherIcon },
                    { id: 'pill', label: t.launcherPill },
                  ] as const
                ).map((st) => (
                  <Button
                    key={st.id}
                    type="button"
                    variant={prefs.launcherStyle === st.id ? 'default' : 'outline'}
                    aria-pressed={prefs.launcherStyle === st.id}
                    onClick={() => setPrefs((p) => ({ ...p, launcherStyle: st.id }))}
                  >
                    {st.label}
                  </Button>
                ))}
              </div>

              {prefs.launcherStyle === 'pill' && (
                <div className="mt-2 space-y-1">
                  <Label
                    htmlFor="launcher-label-input"
                    className="text-[11px] text-muted-foreground font-normal"
                  >
                    {t.launcherLabelField}
                  </Label>
                  <Input
                    id="launcher-label-input"
                    type="text"
                    maxLength={40}
                    value={prefs.launcherLabel}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, launcherLabel: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>

            {/* Corner radius */}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">{t.cornerRadiusLabel}</div>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label={t.cornerRadiusLabel}>
                {(
                  [
                    { id: 'rounded', label: t.radiusRounded },
                    { id: 'classic', label: t.radiusClassic },
                    { id: 'sharp', label: t.radiusSharp },
                  ] as const
                ).map((r) => (
                  <Button
                    key={r.id}
                    type="button"
                    size="xs"
                    variant={prefs.cornerStyle === r.id ? 'default' : 'outline'}
                    aria-pressed={prefs.cornerStyle === r.id}
                    onClick={() => setPrefs((p) => ({ ...p, cornerStyle: r.id }))}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          {/* Section 3: Quick Starter Prompts */}
          <div className="space-y-2">
            <Label
              htmlFor="starter-prompts-textarea"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {t.sectionStarterPrompts}
            </Label>
            <p className="text-[11px] text-muted-foreground">{t.starterPromptsHint}</p>
            <Textarea
              id="starter-prompts-textarea"
              rows={2}
              value={prefs.starterPromptsText}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, starterPromptsText: e.target.value }))
              }
              className="resize-none"
            />
          </div>
        </div>

        {/* Sticky Save Bar */}
        <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {isDirty ? t.unsavedChanges : t.allChangesSaved || 'All changes saved'}
          </span>
          <Button type="button" onClick={handleSave} disabled={saving}>
            <Save className="size-3.5" aria-hidden="true" />
            <span>{saving ? t.saving : t.saveChanges}</span>
          </Button>
        </div>
      </aside>

      {/* Right Stage: Live Host-Site Canvas & Interactive Widget */}
      <div className="flex-1 flex flex-col min-w-0 bg-muted/50 overflow-hidden">
        {/* Stage Toolbar */}
        <div className="px-4 py-2.5 bg-card border-b border-border flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs value={viewport} onValueChange={(v) => setViewport(v as 'desktop' | 'mobile')}>
              <TabsList>
                <TabsTrigger value="desktop">
                  <Monitor className="size-3.5" aria-hidden="true" />
                  <span>{t.previewDesktop}</span>
                </TabsTrigger>
                <TabsTrigger value="mobile">
                  <Smartphone className="size-3.5" aria-hidden="true" />
                  <span>{t.previewMobile}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Tabs
              value={widgetOpen ? 'open' : 'closed'}
              onValueChange={(v) => setWidgetOpen(v === 'open')}
            >
              <TabsList>
                <TabsTrigger value="open">{t.previewOpen}</TabsTrigger>
                <TabsTrigger value="closed">{t.previewClosed}</TabsTrigger>
              </TabsList>
            </Tabs>

            <Tabs
              value={previewMode}
              onValueChange={(v) => {
                setPreviewMode(v as 'live' | 'cards');
                setWidgetOpen(true);
              }}
            >
              <TabsList>
                <TabsTrigger value="live">{t.previewModeLive}</TabsTrigger>
                <TabsTrigger value="cards">{t.previewModeCards}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setHostTheme((h) => (h === 'light' ? 'dark' : 'light'))}
            >
              {hostTheme === 'light' ? (
                <Moon className="size-3.5" aria-hidden="true" />
              ) : (
                <Sun className="size-3.5" aria-hidden="true" />
              )}
              <span>{hostTheme === 'light' ? t.previewHostDark : t.previewHostLight}</span>
            </Button>

            <Button type="button" variant="outline" size="xs" onClick={resetChat}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              <span>{t.resetPreviewChat}</span>
            </Button>
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
                : 'bg-white border-border'
            }`}
          >
            {/* Mock Browser Chrome */}
            <div
              className={`h-9 px-3.5 border-b flex items-center gap-3 shrink-0 ${
                hostTheme === 'dark'
                  ? 'bg-[#1E293B] border-[#334155]'
                  : 'bg-[#F9FAFB] border-border'
              }`}
            >
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="size-2.5 rounded-full bg-[#E5E7EB] dark:bg-[#475569]" />
                <span className="size-2.5 rounded-full bg-[#E5E7EB] dark:bg-[#475569]" />
                <span className="size-2.5 rounded-full bg-[#E5E7EB] dark:bg-[#475569]" />
              </div>
              <div
                className={`flex-1 max-w-xs mx-auto text-center text-[11px] px-3 py-0.5 rounded-md truncate ${
                  hostTheme === 'dark'
                    ? 'bg-[#0F172A] text-[#94A3B8]'
                    : 'bg-white border border-border text-muted-foreground'
                }`}
              >
                https://your-website.com/
              </div>
            </div>

            {/* Simulated Host Page Content */}
            <div className="flex-1 relative overflow-hidden p-6 sm:p-8">
              <div className="max-w-lg space-y-4 select-none pointer-events-none opacity-80">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-6 rounded-md ${
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
                          className="size-8 rounded-lg text-white font-bold text-xs flex items-center justify-center shrink-0"
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
                              className="size-1.5 rounded-full bg-[#16A34A]"
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
                        className={`size-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                          isDarkWidget
                            ? 'text-[#9CA3AF] hover:bg-[#27272A] hover:text-white'
                            : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'
                        }`}
                      >
                        <X className="size-4" aria-hidden="true" />
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
                          className={`max-w-[88%] px-3 py-2 text-[13px] leading-relaxed break-words ${
                            m.role === 'user'
                              ? 'ml-auto rounded-br-sm'
                              : isDarkWidget
                                ? 'bg-[#18181B] border border-[#27272A] text-[#F3F4F6] rounded-bl-sm'
                                : 'bg-white border border-[#EAECEF] text-[#111827] rounded-bl-sm'
                          }`}
                        >
                          {m.role === 'assistant' ? (
                            <SafeMarkdown content={m.text} />
                          ) : (
                            <div className="whitespace-pre-wrap">{m.text}</div>
                          )}

                          {m.citations && m.citations.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {m.citations.map((c, idx) =>
                                isSafeHttpUrl(c.url) ? (
                                  <a
                                    key={idx}
                                    href={c.url.trim()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`text-[10px] px-2 py-0.5 rounded-full border underline-offset-2 hover:underline ${
                                      isDarkWidget
                                        ? 'bg-[#1E293B] border-[#334155] text-[#93C5FD]'
                                        : 'bg-[#EFF6FF] border-[#DBEAFE] text-[#1D4ED8]'
                                    }`}
                                  >
                                    {c.title}
                                  </a>
                                ) : (
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
                                )
                              )}
                            </div>
                          )}

                          {dedupeCards(m.cards).map((card, idx) => {
                            if (card.type === 'product_card') {
                              return (
                                <div
                                  key={card.productId || idx}
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
                                  {isSafeHttpUrl(card.checkoutUrl) ? (
                                    <a
                                      href={card.checkoutUrl.trim()}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        backgroundColor: validHex,
                                        borderRadius: radiusTokens.btn,
                                      }}
                                      className="inline-block px-3 py-1 text-[11px] font-medium text-white hover:brightness-110 transition"
                                    >
                                      {t.demoCheckoutBtn || 'Proceed to checkout'}
                                    </a>
                                  ) : (
                                    <span
                                      style={{
                                        backgroundColor: validHex,
                                        borderRadius: radiusTokens.btn,
                                      }}
                                      className="inline-block px-3 py-1 text-[11px] font-medium text-white"
                                    >
                                      {t.demoCheckoutBtn || 'Proceed to checkout'}
                                    </span>
                                  )}
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
                                          className={`px-2 py-1 text-[11px] rounded-md border text-left transition cursor-pointer ${
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

                      {previewMode === 'live' &&
                        messages.length === 1 &&
                        starterPrompts.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {starterPrompts.map((prompt, idx) => (
                              <button
                                key={`${prompt}-${idx}`}
                                type="button"
                                onClick={() => sendLiveMessage(prompt)}
                                className={`text-[11px] px-2.5 py-1.5 rounded-full border transition text-left cursor-pointer ${
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
                        className="px-3 py-2 text-white text-xs font-medium inline-flex items-center justify-center disabled:opacity-50 transition cursor-pointer"
                      >
                        <Send className="size-3.5" aria-hidden="true" />
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
                        {t.widgetPoweredBy || 'Powered by Askmink'}
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
                      : 'size-13'
                  }`}
                >
                  {widgetOpen ? (
                    <X className="size-5" aria-hidden="true" />
                  ) : (
                    <>
                      {prefs.launcherStyle === 'pill' ? (
                        <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <Sparkles className="size-5" aria-hidden="true" />
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
        <div className="px-4 py-3 bg-card border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Code2 className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <code className="text-[11px] font-mono text-foreground bg-muted border border-border px-2.5 py-1.5 rounded-lg truncate flex-1">
              {embedSnippet}
            </code>
          </div>
          <Button type="button" onClick={handleCopyEmbed} className="shrink-0">
            {copiedEmbed ? (
              <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            <span>{copiedEmbed ? t.copied : t.copySnippet}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
