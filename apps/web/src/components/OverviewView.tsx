import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Code2,
  Cpu,
  Globe,
  LifeBuoy,
  MessageSquare,
  Paintbrush,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface OverviewViewProps {
  agent: any;
  overview: any;
  lang: SupportedLanguage;
  t: Record<string, string>;
  onNavigate: (tab: string) => void;
  onOpenEmbed: () => void;
}

const LOCALE_MAP: Record<SupportedLanguage, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-ES',
};

export function OverviewView({
  agent,
  overview,
  lang,
  t,
  onNavigate,
  onOpenEmbed,
}: OverviewViewProps) {
  const [recentConversations, setRecentConversations] = useState<any[]>([]);
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const [aiStatus, setAiStatus] = useState({
    gateway: false,
    keys: 0,
    chatModel: agent.chatModel,
    embeddingModel: agent.embeddingModel,
  });
  const [checklistHidden, setChecklistHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`askmink_checklist_hidden_${agent.id}`) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      setChecklistHidden(localStorage.getItem(`askmink_checklist_hidden_${agent.id}`) === '1');
    } catch {
      setChecklistHidden(false);
    }
    let cancelled = false;
    Promise.all([
      apiRequest<{ items: any[] }>(`/api/agents/${agent.id}/conversations`).catch(() => ({
        items: [],
      })),
      apiRequest<{ items: any[] }>(`/api/agents/${agent.id}/leads`).catch(() => ({
        items: [],
      })),
      fetch('/health')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      apiRequest<{ settings: any; keys: any[] }>('/api/account/ai-settings').catch(() => ({
        settings: null,
        keys: [],
      })),
    ]).then(([convs, leadsRes, health, aiRes]) => {
      if (cancelled) return;
      setRecentConversations((convs.items || []).slice(0, 4));
      setRecentLeads((leadsRes.items || []).slice(0, 4));
      setAiStatus({
        gateway: Boolean(health?.defaults?.gatewayConfigured || aiRes?.settings?.gatewayConfigured),
        keys: (aiRes?.keys || []).length,
        chatModel: aiRes?.settings?.chatModel || agent.chatModel,
        embeddingModel: aiRes?.settings?.embeddingModel || agent.embeddingModel,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  const kpis = overview?.kpis ?? { conversations: 0, openTickets: 0, bookings: 0, leads: 0 };
  const knowledge = overview?.knowledge ?? { total: 0, ready: 0, chunks: 0 };
  const usage = overview?.usage ?? { turns: 0, tokens: 0, toolCalls: 0 };
  const allowedDomains: string[] = Array.isArray(agent.allowedDomains) ? agent.allowedDomains : [];
  const recentTickets: any[] = overview?.recentTickets ?? [];
  const upcomingBookings: any[] = overview?.upcomingBookings ?? [];

  const locale = LOCALE_MAP[lang] || 'en-US';
  const hasUsage = usage.tokens > 0 || usage.turns > 0 || usage.toolCalls > 0;
  const chatSharePct =
    usage.turns + usage.toolCalls > 0
      ? Math.round((usage.turns / (usage.turns + usage.toolCalls)) * 100)
      : 0;

  let widgetCustomized = false;
  let embedCopied = false;
  try {
    widgetCustomized = localStorage.getItem(`askmink_check_widget_${agent.id}`) === '1';
    embedCopied = localStorage.getItem(`askmink_check_embed_${agent.id}`) === '1';
  } catch {
    // Ignore storage read errors
  }

  const checklistItems = [
    {
      id: 'agent',
      label: t.checkItemAgent,
      cta: t.checkItemAgentCta,
      done: Boolean(agent.systemPrompt && agent.systemPrompt.trim().length > 0),
      onClick: () => onNavigate('workflow'),
    },
    {
      id: 'ai',
      label: t.checkItemAi,
      cta: t.checkItemAiCta,
      done: aiStatus.gateway || aiStatus.keys > 0,
      onClick: () => onNavigate('account/byok'),
    },
    {
      id: 'knowledge',
      label: t.checkItemKnowledge,
      cta: t.checkItemKnowledgeCta,
      done: knowledge.total > 0,
      onClick: () => onNavigate('knowledge'),
    },
    {
      id: 'widget',
      label: t.checkItemWidget,
      cta: t.checkItemWidgetCta,
      done: widgetCustomized,
      onClick: () => onNavigate('widget'),
    },
    {
      id: 'test',
      label: t.checkItemTest,
      cta: t.checkItemTestCta,
      done: usage.turns > 0 || kpis.conversations > 0,
      onClick: () => onNavigate('playground'),
    },
    {
      id: 'embed',
      label: t.checkItemEmbed,
      cta: t.checkItemEmbedCta,
      done: embedCopied,
      onClick: () => onOpenEmbed(),
    },
  ];
  const checklistDoneCount = checklistItems.filter((i) => i.done).length;
  const checklistProgressPct = Math.round((checklistDoneCount / checklistItems.length) * 100);

  function toggleChecklistHidden(next: boolean) {
    setChecklistHidden(next);
    try {
      if (next) localStorage.setItem(`askmink_checklist_hidden_${agent.id}`, '1');
      else localStorage.removeItem(`askmink_checklist_hidden_${agent.id}`);
    } catch {
      // Ignore storage errors
    }
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Center Dashboard Column */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        <div className="max-w-5xl mx-auto p-5 lg:p-6 space-y-6">
          {/* Clean Agent Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-semibold text-foreground tracking-tight truncate">
                  {agent.name}
                </h1>
                <Badge variant="success" className="gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  {t.online}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t.overviewSubtitle}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {checklistHidden && checklistDoneCount < checklistItems.length && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => toggleChecklistHidden(false)}
                >
                  {t.checklistShow} ({checklistDoneCount}/{checklistItems.length})
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onNavigate('widget')}>
                <Paintbrush className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span>{t.customizeWidget}</span>
              </Button>
              <Button type="button" onClick={() => onNavigate('playground')}>
                <Sparkles className="size-3.5" aria-hidden="true" />
                <span>{t.openPlayground}</span>
              </Button>
            </div>
          </div>

          {/* Interactive Launch Checklist */}
          {!checklistHidden && (
            <Card className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">{t.checklistTitle}</h2>
                    <Badge variant="secondary" className="tabular-nums">
                      {checklistDoneCount}/{checklistItems.length} {t.checklistCompleted}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {checklistDoneCount === checklistItems.length
                      ? t.checklistAllDone
                      : t.checklistSubtitle}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => toggleChecklistHidden(true)}
                  className="text-muted-foreground self-start sm:self-center"
                >
                  {t.checklistDismiss}
                </Button>
              </div>

              <Progress value={checklistProgressPct} aria-label={t.checklistTitle} />

              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {checklistItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={item.onClick}
                      className={cn(
                        'w-full px-3 py-2.5 rounded-lg border text-left flex items-center justify-between gap-2.5 transition cursor-pointer',
                        item.done
                          ? 'bg-muted/40 border-border/70 hover:border-border'
                          : 'bg-card border-border hover:border-primary'
                      )}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={cn(
                            'size-5 rounded-full flex items-center justify-center shrink-0',
                            item.done
                              ? 'bg-emerald-500 text-white'
                              : 'border-2 border-border bg-background'
                          )}
                          aria-hidden="true"
                        >
                          {item.done && <Check className="size-3" />}
                        </span>
                        <span
                          className={cn(
                            'text-xs truncate',
                            item.done
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground font-medium'
                          )}
                        >
                          {item.label}
                        </span>
                      </span>
                      <span className="text-[11px] font-medium text-blue-600 shrink-0">
                        {item.cta}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* 4-Column Operational KPI Grid */}
          <section aria-label="KPIs" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {[
              {
                id: 'inbox',
                label: t.conversations,
                value: kpis.conversations,
                sub: `${usage.turns.toLocaleString(locale)} ${t.turnsMetered}`,
                icon: MessageSquare,
                iconClass: 'bg-blue-50 text-blue-600',
              },
              {
                id: 'tickets',
                label: t.openTickets,
                value: kpis.openTickets,
                sub: t.linkedToInbox,
                icon: LifeBuoy,
                iconClass: 'bg-red-50 text-red-600',
              },
              {
                id: 'schedule',
                label: t.bookings,
                value: kpis.bookings,
                sub: t.confirmedMeetings,
                icon: Calendar,
                iconClass: 'bg-emerald-50 text-emerald-600',
              },
              {
                id: 'leads',
                label: t.leads,
                value: kpis.leads,
                sub: t.capturedInChat,
                icon: Users,
                iconClass: 'bg-violet-50 text-violet-600',
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => onNavigate(card.id)}
                  className="group bg-card border border-border hover:border-foreground/25 rounded-xl p-4 text-left transition flex flex-col justify-between shadow-2xs cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
                    <span
                      className={cn('size-7 rounded-lg flex items-center justify-center', card.iconClass)}
                      aria-hidden="true"
                    >
                      <Icon className="size-3.5" />
                    </span>
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-foreground tabular-nums">
                    {Number(card.value).toLocaleString(locale)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{card.sub}</span>
                    <ArrowUpRight
                      className="size-3.5 opacity-0 group-hover:opacity-100 transition shrink-0"
                      aria-hidden="true"
                    />
                  </div>
                </button>
              );
            })}
          </section>

          {/* Agent Setup & Quick Access Modules */}
          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t.setupReadiness}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onNavigate('knowledge')}
                className="bg-card border border-border hover:border-foreground/25 rounded-xl p-3.5 text-left transition flex items-start gap-3 shadow-2xs cursor-pointer"
              >
                <span
                  className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <BookOpen className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-foreground truncate">
                      {t.setupDocsTitle}
                    </span>
                    {knowledge.ready > 0 && (
                      <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {knowledge.chunks > 0
                      ? `${knowledge.chunks.toLocaleString(locale)} ${t.setupDocsReady}`
                      : t.setupDocsEmpty}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('widget')}
                className="bg-card border border-border hover:border-foreground/25 rounded-xl p-3.5 text-left transition flex items-start gap-3 shadow-2xs cursor-pointer"
              >
                <span
                  className="size-8 rounded-lg flex items-center justify-center shrink-0 border border-black/10"
                  style={{ backgroundColor: agent.primaryColor || '#2563EB' }}
                  aria-hidden="true"
                >
                  <Paintbrush className="size-4 text-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">
                    {t.setupWidgetTitle}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {t.setupWidgetDesc} · {(agent.defaultLanguage || 'en').toUpperCase()}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('tools')}
                className="bg-card border border-border hover:border-foreground/25 rounded-xl p-3.5 text-left transition flex items-start gap-3 shadow-2xs cursor-pointer"
              >
                <span
                  className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <Wrench className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">
                    {t.setupToolsTitle}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {t.setupToolsDesc}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={onOpenEmbed}
                className="bg-card border border-border hover:border-foreground/25 rounded-xl p-3.5 text-left transition flex items-start gap-3 shadow-2xs cursor-pointer"
              >
                <span
                  className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <Code2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">
                    {t.setupEmbedTitle}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {allowedDomains.length} {t.setupDomainsCount}
                  </div>
                </div>
              </button>
            </div>
          </section>

          {/* Runtime & Metering Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>{t.runtimeTitle}</span>
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onNavigate('account/byok')}
                  aria-label={t.configureSettings}
                >
                  <Settings className="size-3.5" aria-hidden="true" />
                </Button>
              </div>

              <dl className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground shrink-0">{t.chatModelLabel}</dt>
                  <dd className="font-mono text-[11px] text-foreground bg-muted border border-border px-2 py-0.5 rounded-md truncate">
                    {aiStatus.chatModel || agent.chatModel}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground shrink-0">{t.embeddingModelLabel}</dt>
                  <dd
                    className="font-mono text-[11px] text-foreground bg-muted border border-border px-2 py-0.5 rounded-md truncate"
                    title={aiStatus.embeddingModel || agent.embeddingModel}
                  >
                    {String(aiStatus.embeddingModel || agent.embeddingModel || '').split('/').pop()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground shrink-0">{t.vectorDimsLabel}</dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {agent.embeddingDimensions ? `${agent.embeddingDimensions}d` : t.vectorAuto}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground shrink-0">{t.widgetLangLabel}</dt>
                  <dd className="inline-flex items-center gap-1 font-medium text-foreground uppercase">
                    <Globe className="size-3 text-muted-foreground" aria-hidden="true" />
                    <span>{agent.defaultLanguage || 'en'}</span>
                  </dd>
                </div>
              </dl>
            </Card>

            <Card className="p-5 flex flex-col justify-between space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t.usageCapacity}</h2>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-foreground tabular-nums">
                    {Number(usage.tokens).toLocaleString(locale)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t.estimatedTokens}</span>
                </div>
              </div>

              {hasUsage ? (
                <div className="space-y-3">
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden flex">
                    <div className="h-full bg-blue-600" style={{ width: `${chatSharePct}%` }} />
                    <div className="h-full bg-amber-500 flex-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-muted/60 border border-border">
                      <div className="text-[11px] text-muted-foreground">{t.turnsMetered}</div>
                      <div className="font-semibold text-foreground tabular-nums mt-0.5">
                        {Number(usage.turns).toLocaleString(locale)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/60 border border-border">
                      <div className="text-[11px] text-muted-foreground">{t.toolCallsLabel}</div>
                      <div className="font-semibold text-foreground tabular-nums mt-0.5">
                        {Number(usage.toolCalls).toLocaleString(locale)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <Progress value={0} />
                  <p className="text-xs text-muted-foreground leading-relaxed">{t.noUsageYet}</p>
                </div>
              )}
            </Card>
          </div>

          {/* Recent Tickets & Escalations */}
          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">{t.recentActivity}</h2>
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => onNavigate('tickets')}
                className="text-blue-600 px-0"
              >
                {t.viewAll}
              </Button>
            </div>
            {recentTickets.length === 0 ? (
              <div className="px-5 py-8 text-center space-y-2">
                <div className="size-9 rounded-xl bg-muted text-muted-foreground mx-auto flex items-center justify-center">
                  <LifeBuoy className="size-4" aria-hidden="true" />
                </div>
                <p className="text-xs font-medium text-foreground">{t.noTicketsYet}</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">{t.noTicketsHint}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recentTickets.map((tk: any) => (
                  <li
                    key={tk.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 transition"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">
                        {tk.subject}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {tk.visitorEmail}
                      </div>
                    </div>
                    <Badge variant={tk.status === 'open' ? 'destructive' : 'success'}>
                      {tk.status === 'open' ? t.ticketOpen : t.ticketResolved}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Right Context Panel */}
      <aside className="hidden xl:flex w-[316px] border-l border-border bg-card flex-col overflow-y-auto sidebar-scroll p-4 space-y-5 shrink-0">
        {/* Pastel Mesh Agent Card */}
        <Card className="rounded-2xl overflow-hidden shrink-0">
          <div className="h-20 mesh-banner" />
          <div className="px-4 pb-4 -mt-7">
            <Avatar className="size-14 border-4 border-card shadow-xs">
              <AvatarFallback
                className="text-white text-lg font-bold"
                style={{ backgroundColor: agent.primaryColor || '#18181B' }}
              >
                {String(agent.name || 'A').slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="mt-2 flex items-center gap-1.5">
              <h2 className="text-sm font-semibold text-foreground truncate">{agent.name}</h2>
              <BadgeCheck className="size-4 text-blue-600 shrink-0" aria-hidden="true" />
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{agent.chatModel}</span>
              <Badge variant="success" className="text-[10px]">
                {t.online}
              </Badge>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onNavigate('widget')}
              >
                <Paintbrush className="size-3" aria-hidden="true" />
                <span>{t.quickWidgetBtn}</span>
              </Button>
              <Button type="button" variant="outline" size="xs" onClick={onOpenEmbed}>
                <Code2 className="size-3" aria-hidden="true" />
                <span>{t.quickEmbedBtn}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onNavigate('tools')}
              >
                <Wrench className="size-3" aria-hidden="true" />
                <span>{t.quickToolsBtn}</span>
              </Button>
            </div>
          </div>
        </Card>

        {/* Recent Conversations */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-foreground">{t.recentConversations}</h3>
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => onNavigate('inbox')}
              className="text-blue-600 h-auto p-0 text-[11px]"
            >
              {t.viewAll}
            </Button>
          </div>
          {recentConversations.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noConversationsYet}</p>
          ) : (
            <ul className="space-y-1.5">
              {recentConversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate('inbox')}
                    className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-muted/60 text-left transition cursor-pointer"
                  >
                    <span
                      className="size-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      <MessageSquare className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">
                        {c.visitorEmail || c.pageUrl || '/'}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <span className="capitalize">{c.mode}</span>
                        <span>·</span>
                        <span>
                          {c.messageCount} {t.messagesShort}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Clients & Leads */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-foreground">{t.recentClients}</h3>
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => onNavigate('leads')}
              className="text-blue-600 h-auto p-0 text-[11px]"
            >
              {t.viewAll}
            </Button>
          </div>
          {recentLeads.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noClientsYet}</p>
          ) : (
            <ul className="space-y-1.5">
              {recentLeads.map((ld) => (
                <li key={ld.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate('leads')}
                    className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-muted/60 text-left transition cursor-pointer"
                  >
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-violet-50 text-violet-600">
                        {String(ld.name || ld.email || '?').slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">
                        {ld.name || ld.email}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {ld.interest || ld.email}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Upcoming Bookings */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-foreground">{t.upcoming}</h3>
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => onNavigate('schedule')}
              className="text-blue-600 h-auto p-0 text-[11px]"
            >
              {t.viewAll}
            </Button>
          </div>
          {upcomingBookings.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noBookingsYet}</p>
          ) : (
            <ul className="space-y-1.5">
              {upcomingBookings.map((b: any) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-muted/60 transition"
                >
                  <span
                    className="size-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <Calendar className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground truncate">
                      {b.visitorName}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(b.startsAt).toLocaleString(locale)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bottom Pastel Mesh Highlight Card */}
        <Card className="mt-auto p-4 rounded-2xl mesh-recap shrink-0">
          <div className="size-7 rounded-lg bg-background border border-border flex items-center justify-center mb-2.5">
            <Sparkles className="size-4 text-foreground" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">{t.recapTitle}</h3>
          <p className="text-xs text-muted-foreground mt-1">{t.recapDesc}</p>
          <Button
            type="button"
            onClick={() => onNavigate('playground')}
            className="mt-3 w-full"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>{t.openPlayground}</span>
          </Button>
        </Card>
      </aside>
    </div>
  );
}
