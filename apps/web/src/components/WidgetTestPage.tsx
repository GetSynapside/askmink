import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  MessageCircle,
  Moon,
  RefreshCw,
  Sliders,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type WidgetPosition = 'bottom-right' | 'bottom-left';
type WidgetTheme = 'light' | 'dark';
type WidgetRadius = 'rounded' | 'classic' | 'sharp';

const COPY: Record<
  SupportedLanguage,
  {
    badge: string;
    title: string;
    subtitle: string;
    backToPlayground: string;
    openWidget: string;
    closeWidget: string;
    reloadWidget: string;
    setContext: string;
    contextApplied: string;
    hostTheme: string;
    light: string;
    dark: string;
    widgetOptions: string;
    position: string;
    bottomRight: string;
    bottomLeft: string;
    widgetTheme: string;
    corners: string;
    rounded: string;
    classic: string;
    sharp: string;
    agentId: string;
    scriptLoaded: string;
    scriptError: string;
    missingTitle: string;
    missingDesc: string;
    agentPlaceholder: string;
    loadAgent: string;
    hint: string;
  }
> = {
  en: {
    badge: 'Live Widget Sandbox',
    title: 'Widget Test Page',
    subtitle:
      'This standalone page embeds the real Shadow DOM widget (/widget.js) so you can test the end-user experience outside the dashboard.',
    backToPlayground: 'Back to Playground',
    openWidget: 'Open Widget',
    closeWidget: 'Close Widget',
    reloadWidget: 'Reload',
    setContext: 'Send Sample Context',
    contextApplied: 'Context sent to widget',
    hostTheme: 'Host page',
    light: 'Light',
    dark: 'Dark',
    widgetOptions: 'Embed attributes',
    position: 'Position',
    bottomRight: 'Bottom right',
    bottomLeft: 'Bottom left',
    widgetTheme: 'Widget theme',
    corners: 'Corners',
    rounded: 'Rounded',
    classic: 'Classic',
    sharp: 'Sharp',
    agentId: 'Agent ID',
    scriptLoaded: 'widget.js loaded',
    scriptError: 'Failed to load /widget.js — make sure the API server and widget build are running.',
    missingTitle: 'No agent selected',
    missingDesc: 'Pass ?agent=YOUR_AGENT_ID in the URL or enter an Agent ID below to test the widget.',
    agentPlaceholder: 'Paste Agent ID...',
    loadAgent: 'Load Widget',
    hint: 'Click the floating launcher button in the corner or use "Open Widget" above.',
  },
  pt: {
    badge: 'Sandbox do Widget',
    title: 'Página de Teste do Widget',
    subtitle:
      'Esta página independente carrega o widget real em Shadow DOM (/widget.js) para você testar a experiência final fora do painel.',
    backToPlayground: 'Voltar ao Playground',
    openWidget: 'Abrir Widget',
    closeWidget: 'Fechar Widget',
    reloadWidget: 'Recarregar',
    setContext: 'Enviar Contexto',
    contextApplied: 'Contexto enviado ao widget',
    hostTheme: 'Página host',
    light: 'Claro',
    dark: 'Escuro',
    widgetOptions: 'Atributos de embed',
    position: 'Posição',
    bottomRight: 'Inferior direita',
    bottomLeft: 'Inferior esquerda',
    widgetTheme: 'Tema do widget',
    corners: 'Bordas',
    rounded: 'Arredondado',
    classic: 'Clássico',
    sharp: 'Reto',
    agentId: 'ID do Agente',
    scriptLoaded: 'widget.js carregado',
    scriptError: 'Falha ao carregar /widget.js — verifique se a API e o build do widget estão ativos.',
    missingTitle: 'Nenhum agente selecionado',
    missingDesc: 'Informe ?agent=SEU_AGENT_ID na URL ou cole o ID do agente abaixo para testar o widget.',
    agentPlaceholder: 'Cole o ID do agente...',
    loadAgent: 'Carregar Widget',
    hint: 'Clique no botão flutuante no canto da tela ou use "Abrir Widget" acima.',
  },
  es: {
    badge: 'Sandbox del Widget',
    title: 'Página de Prueba del Widget',
    subtitle:
      'Esta página independiente incrusta el widget real en Shadow DOM (/widget.js) para probar la experiencia final fuera del panel.',
    backToPlayground: 'Volver al Playground',
    openWidget: 'Abrir Widget',
    closeWidget: 'Cerrar Widget',
    reloadWidget: 'Recargar',
    setContext: 'Enviar Contexto',
    contextApplied: 'Contexto enviado al widget',
    hostTheme: 'Página host',
    light: 'Claro',
    dark: 'Oscuro',
    widgetOptions: 'Atributos de embed',
    position: 'Posición',
    bottomRight: 'Inferior derecha',
    bottomLeft: 'Inferior izquierda',
    widgetTheme: 'Tema del widget',
    corners: 'Bordes',
    rounded: 'Redondeado',
    classic: 'Clásico',
    sharp: 'Recto',
    agentId: 'ID del Agente',
    scriptLoaded: 'widget.js cargado',
    scriptError: 'Error al cargar /widget.js — verifica que la API y el build del widget estén activos.',
    missingTitle: 'Ningún agente seleccionado',
    missingDesc: 'Pasa ?agent=TU_AGENT_ID en la URL o ingresa un ID de agente abajo para probar el widget.',
    agentPlaceholder: 'Pega el ID del agente...',
    loadAgent: 'Cargar Widget',
    hint: 'Haz clic en el botón flotante en la esquina o usa "Abrir Widget" arriba.',
  },
};

function resolveLang(): SupportedLanguage {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('lang');
  if (fromQuery === 'en' || fromQuery === 'pt' || fromQuery === 'es') return fromQuery;
  try {
    const saved = localStorage.getItem('askmink_ui_lang');
    if (saved === 'en' || saved === 'pt' || saved === 'es') return saved;
  } catch {
    // Ignore storage errors
  }
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('pt')) return 'pt';
  if (nav.startsWith('es')) return 'es';
  return 'en';
}

function readSavedWidgetPrefs(agentId: string) {
  try {
    const raw = localStorage.getItem(`askmink_widget_prefs_${agentId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore storage errors
  }
  return null;
}

export function WidgetTestPage() {
  const lang = useMemo(resolveLang, []);
  const ui = COPY[lang] || COPY.en;

  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const queryLang = useMemo<SupportedLanguage | null>(() => {
    const raw = initialParams.get('lang');
    return raw === 'en' || raw === 'pt' || raw === 'es' ? raw : null;
  }, [initialParams]);
  const initialAgentId = initialParams.get('agent') || '';
  const savedPrefs = useMemo(
    () => (initialAgentId ? readSavedWidgetPrefs(initialAgentId) : null),
    [initialAgentId]
  );

  const [agentId, setAgentId] = useState(initialAgentId);
  const [agentInput, setAgentInput] = useState(initialAgentId);
  const [hostDark, setHostDark] = useState(false);
  const [position, setPosition] = useState<WidgetPosition>(
    initialParams.get('position') === 'bottom-left' || savedPrefs?.position === 'bottom-left'
      ? 'bottom-left'
      : 'bottom-right'
  );
  const [widgetTheme, setWidgetTheme] = useState<WidgetTheme>(
    initialParams.get('theme') === 'dark' || savedPrefs?.theme === 'dark' ? 'dark' : 'light'
  );
  const [radius, setRadius] = useState<WidgetRadius>(() => {
    const r = initialParams.get('radius') || savedPrefs?.cornerStyle;
    return r === 'classic' || r === 'sharp' ? r : 'rounded';
  });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [scriptStatus, setScriptStatus] = useState<'idle' | 'loaded' | 'error'>('idle');
  const [contextNotice, setContextNotice] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${ui.title} | Askmink`;
  }, [lang, ui.title]);

  useEffect(() => {
    if (!agentId) {
      setScriptStatus('idle');
      return;
    }

    let cancelled = false;

    // Clean up any previous widget instance
    document.querySelectorAll('#askmink-widget-host').forEach((el) => el.remove());
    document.querySelectorAll('script[data-askmink-test-script="true"]').forEach((el) => el.remove());

    const script = document.createElement('script');
    script.src = `${window.location.origin}/widget.js?v=${reloadNonce}`;
    script.async = true;
    script.setAttribute('data-askmink-test-script', 'true');
    script.setAttribute('data-agent', agentId);
    script.setAttribute('data-api', window.location.origin);
    script.setAttribute('data-position', position);
    script.setAttribute('data-theme', widgetTheme);
    script.setAttribute('data-radius', radius);
    if (queryLang) {
      script.setAttribute('data-lang', queryLang);
    }
    if (savedPrefs?.launcherStyle === 'pill' && savedPrefs?.launcherLabel) {
      script.setAttribute('data-launcher-label', savedPrefs.launcherLabel);
    }

    script.onload = () => {
      if (!cancelled) setScriptStatus('loaded');
    };
    script.onerror = () => {
      if (!cancelled) setScriptStatus('error');
    };

    document.body.appendChild(script);

    return () => {
      cancelled = true;
      script.remove();
      document.querySelectorAll('#askmink-widget-host').forEach((el) => el.remove());
    };
  }, [agentId, position, widgetTheme, radius, reloadNonce, savedPrefs, queryLang]);

  function handleLoadAgent(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = agentInput.trim();
    if (!trimmed) return;
    setAgentId(trimmed);
    const params = new URLSearchParams(window.location.search);
    params.set('agent', trimmed);
    window.history.replaceState({}, '', `/widget-test?${params.toString()}`);
  }

  function handleSendContext() {
    (window as any).Askmink?.setContext({
      plan: 'pro',
      page: '/pricing',
      source: 'widget-test-page',
    });
    setContextNotice(true);
    setTimeout(() => setContextNotice(false), 2000);
  }

  const playgroundHref = agentId
    ? `/playground?agent=${encodeURIComponent(agentId)}`
    : '/playground';

  return (
    <div
      className={
        hostDark
          ? 'min-h-screen bg-zinc-950 text-zinc-100 transition-colors'
          : 'min-h-screen bg-slate-50 text-slate-900 transition-colors'
      }
    >
      <header
        className={
          hostDark
            ? 'border-b border-zinc-800 bg-zinc-900/80 backdrop-blur'
            : 'border-b border-slate-200 bg-white/80 backdrop-blur'
        }
      >
        <div className="max-w-4xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <Sparkles className="size-4" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{ui.title}</span>
                <Badge variant="secondary" className="text-[11px] font-normal">
                  {ui.badge}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHostDark((d) => !d)}
              className={hostDark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800' : ''}
            >
              {hostDark ? (
                <Sun className="size-3.5" aria-hidden="true" />
              ) : (
                <Moon className="size-3.5" aria-hidden="true" />
              )}
              <span>
                {ui.hostTheme}: {hostDark ? ui.dark : ui.light}
              </span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              asChild
              className={hostDark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800' : ''}
            >
              <a href={playgroundHref}>
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                <span>{ui.backToPlayground}</span>
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {!agentId ? (
          <Card
            className={
              hostDark
                ? 'p-8 bg-zinc-900 border-zinc-800 text-zinc-100 space-y-4'
                : 'p-8 bg-white border-slate-200 space-y-4'
            }
          >
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">{ui.missingTitle}</h1>
              <p className="text-sm text-muted-foreground">{ui.missingDesc}</p>
            </div>
            <form onSubmit={handleLoadAgent} className="flex flex-wrap gap-2 max-w-md">
              <Input
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                placeholder={ui.agentPlaceholder}
                className="flex-1 font-mono text-xs"
              />
              <Button type="submit">{ui.loadAgent}</Button>
            </form>
          </Card>
        ) : (
          <>
            <Card
              className={
                hostDark
                  ? 'p-6 bg-zinc-900 border-zinc-800 text-zinc-100 space-y-5'
                  : 'p-6 bg-white border-slate-200 space-y-5'
              }
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{ui.agentId}:</span>
                  <code
                    className={
                      hostDark
                        ? 'text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-200'
                        : 'text-xs font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-800'
                    }
                  >
                    {agentId}
                  </code>
                  {scriptStatus === 'loaded' && (
                    <Badge variant="secondary" className="text-[11px] text-emerald-700 bg-emerald-50 border-emerald-200">
                      {ui.scriptLoaded}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{ui.subtitle}</p>
              </div>

              {scriptStatus === 'error' && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {ui.scriptError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => (window as any).Askmink?.open()}>
                  <MessageCircle className="size-4" aria-hidden="true" />
                  <span>{ui.openWidget}</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => (window as any).Askmink?.close()}
                  className={hostDark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800' : ''}
                >
                  <X className="size-4" aria-hidden="true" />
                  <span>{ui.closeWidget}</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendContext}
                  className={hostDark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800' : ''}
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span>{contextNotice ? ui.contextApplied : ui.setContext}</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReloadNonce((n) => n + 1)}
                  className={hostDark ? 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800' : ''}
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  <span>{ui.reloadWidget}</span>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">{ui.hint}</p>
            </Card>

            <Card
              className={
                hostDark
                  ? 'p-6 bg-zinc-900 border-zinc-800 text-zinc-100 space-y-4'
                  : 'p-6 bg-white border-slate-200 space-y-4'
              }
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sliders className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>{ui.widgetOptions}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{ui.position}</Label>
                  <Select value={position} onValueChange={(v) => setPosition(v as WidgetPosition)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bottom-right">{ui.bottomRight}</SelectItem>
                      <SelectItem value="bottom-left">{ui.bottomLeft}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{ui.widgetTheme}</Label>
                  <Select value={widgetTheme} onValueChange={(v) => setWidgetTheme(v as WidgetTheme)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">{ui.light}</SelectItem>
                      <SelectItem value="dark">{ui.dark}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{ui.corners}</Label>
                  <Select value={radius} onValueChange={(v) => setRadius(v as WidgetRadius)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rounded">{ui.rounded}</SelectItem>
                      <SelectItem value="classic">{ui.classic}</SelectItem>
                      <SelectItem value="sharp">{ui.sharp}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
