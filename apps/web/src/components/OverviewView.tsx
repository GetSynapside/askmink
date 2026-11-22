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
import { apiRequest } from '../lib/api';

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
  const [aiStatus, setAiStatus] = useState({ gateway: false, keys: 0 });
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
      apiRequest<{ items: any[] }>('/api/provider-keys').catch(() => ({ items: [] })),
    ]).then(([convs, leadsRes, health, keysRes]) => {
      if (cancelled) return;
      setRecentConversations((convs.items || []).slice(0, 4));
      setRecentLeads((leadsRes.items || []).slice(0, 4));
      setAiStatus({
        gateway: Boolean(health?.defaults?.gatewayConfigured),
        keys: (keysRes.items || []).length,
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
      onClick: () => onNavigate('behavior'),
    },
    {
      id: 'ai',
      label: t.checkItemAi,
      cta: t.checkItemAiCta,
      done: aiStatus.gateway || aiStatus.keys > 0,
      onClick: () => onNavigate('settings'),
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
                <h1 className="text-xl font-semibold text-[#111827] tracking-tight truncate">
                  {agent.name}
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] border border-[#D1FAE5] text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" aria-hidden="true" />
                  {t.online}
                </span>
              </div>
              <p className="text-xs text-[#6B7280] mt-1">{t.overviewSubtitle}</p>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {checklistHidden && checklistDoneCount < checklistItems.length && (
                <button
                  type="button"
                  onClick={() => toggleChecklistHidden(false)}
                  className="px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] text-xs font-medium text-[#374151] transition"
                >
                  {t.checklistShow} ({checklistDoneCount}/{checklistItems.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate('widget')}
                className="px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] text-xs font-medium text-[#111827] inline-flex items-center gap-1.5 transition"
              >
                <Paintbrush className="w-3.5 h-3.5 text-[#4B5563]" aria-hidden="true" />
                <span>{t.customizeWidget}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('playground')}
                className="px-3 py-2 rounded-lg bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium inline-flex items-center gap-1.5 transition"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.openPlayground}</span>
              </button>
            </div>
          </div>

          {/* Interactive Launch Checklist */}
          {!checklistHidden && (
            <section className="bg-white border border-[#EAECEF] rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-[#111827]">{t.checklistTitle}</h2>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#374151] tabular-nums">
                      {checklistDoneCount}/{checklistItems.length} {t.checklistCompleted}
                    </span>
                  </div>
                  <p className="text-xs text-[#6B7280] mt-0.5">
                    {checklistDoneCount === checklistItems.length
                      ? t.checklistAllDone
                      : t.checklistSubtitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleChecklistHidden(true)}
                  className="text-xs text-[#6B7280] hover:text-[#111827] self-start sm:self-center"
                >
                  {t.checklistDismiss}
                </button>
              </div>

              <progress
                className="askmink-progress"
                value={checklistDoneCount}
                max={checklistItems.length}
                aria-label={t.checklistTitle}
              />

              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {checklistItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={item.onClick}
                      className={`w-full px-3 py-2.5 rounded-lg border text-left flex items-center justify-between gap-2.5 transition ${
                        item.done
                          ? 'bg-[#FAFAFB] border-[#F3F4F6] hover:border-[#E5E7EB]'
                          : 'bg-white border-[#EAECEF] hover:border-[#18181B]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            item.done
                              ? 'bg-[#10B981] text-white'
                              : 'border-2 border-[#D1D5DB] bg-white'
                          }`}
                          aria-hidden="true"
                        >
                          {item.done && <Check className="w-3 h-3" />}
                        </span>
                        <span
                          className={`text-xs truncate ${
                            item.done
                              ? 'text-[#6B7280] line-through'
                              : 'text-[#111827] font-medium'
                          }`}
                        >
                          {item.label}
                        </span>
                      </span>
                      <span className="text-[11px] font-medium text-[#2563EB] shrink-0">
                        {item.cta}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
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
                iconClass: 'bg-[#EFF6FF] text-[#2563EB]',
              },
              {
                id: 'tickets',
                label: t.openTickets,
                value: kpis.openTickets,
                sub: t.linkedToInbox,
                icon: LifeBuoy,
                iconClass: 'bg-[#FEF2F2] text-[#DC2626]',
              },
              {
                id: 'schedule',
                label: t.bookings,
                value: kpis.bookings,
                sub: t.confirmedMeetings,
                icon: Calendar,
                iconClass: 'bg-[#ECFDF5] text-[#059669]',
              },
              {
                id: 'leads',
                label: t.leads,
                value: kpis.leads,
                sub: t.capturedInChat,
                icon: Users,
                iconClass: 'bg-[#F5F3FF] text-[#7C3AED]',
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => onNavigate(card.id)}
                  className="group bg-white border border-[#EAECEF] hover:border-[#D1D5DB] rounded-xl p-4 text-left transition flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#6B7280]">{card.label}</span>
                    <span
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${card.iconClass}`}
                      aria-hidden="true"
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-[#111827] tabular-nums">
                    {Number(card.value).toLocaleString(locale)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[#6B7280]">
                    <span className="truncate">{card.sub}</span>
                    <ArrowUpRight
                      className="w-3.5 h-3.5 text-[#9CA3AF] opacity-0 group-hover:opacity-100 transition shrink-0"
                      aria-hidden="true"
                    />
                  </div>
                </button>
              );
            })}
          </section>

          {/* Agent Setup & Quick Access Modules */}
          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
              {t.setupReadiness}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onNavigate('knowledge')}
                className="bg-white border border-[#EAECEF] hover:border-[#D1D5DB] rounded-xl p-3.5 text-left transition flex items-start gap-3"
              >
                <span
                  className="w-8 h-8 rounded-lg bg-[#F3F4F6] text-[#374151] flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <BookOpen className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-[#111827] truncate">
                      {t.setupDocsTitle}
                    </span>
                    {knowledge.ready > 0 && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" aria-hidden="true" />
                    )}
                  </div>
                  <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                    {knowledge.chunks > 0
                      ? `${knowledge.chunks.toLocaleString(locale)} ${t.setupDocsReady}`
                      : t.setupDocsEmpty}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('widget')}
                className="bg-white border border-[#EAECEF] hover:border-[#D1D5DB] rounded-xl p-3.5 text-left transition flex items-start gap-3"
              >
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-black/10"
                  style={{ backgroundColor: agent.primaryColor || '#2563EB' }}
                  aria-hidden="true"
                >
                  <Paintbrush className="w-4 h-4 text-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#111827] truncate">
                    {t.setupWidgetTitle}
                  </div>
                  <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                    {t.setupWidgetDesc} · {(agent.defaultLanguage || 'en').toUpperCase()}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('tools')}
                className="bg-white border border-[#EAECEF] hover:border-[#D1D5DB] rounded-xl p-3.5 text-left transition flex items-start gap-3"
              >
                <span
                  className="w-8 h-8 rounded-lg bg-[#F3F4F6] text-[#374151] flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <Wrench className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#111827] truncate">
                    {t.setupToolsTitle}
                  </div>
                  <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                    {t.setupToolsDesc}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={onOpenEmbed}
                className="bg-white border border-[#EAECEF] hover:border-[#D1D5DB] rounded-xl p-3.5 text-left transition flex items-start gap-3"
              >
                <span
                  className="w-8 h-8 rounded-lg bg-[#F3F4F6] text-[#374151] flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <Code2 className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#111827] truncate">
                    {t.setupEmbedTitle}
                  </div>
                  <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                    {allowedDomains.length} {t.setupDomainsCount}
                  </div>
                </div>
              </button>
            </div>
          </section>

          {/* Runtime & Metering Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Agent Runtime Card */}
            <section className="bg-white border border-[#EAECEF] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#6B7280]" aria-hidden="true" />
                  <span>{t.runtimeTitle}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  aria-label={t.configureSettings}
                  className="text-xs text-[#6B7280] hover:text-[#111827]"
                >
                  <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              <dl className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#6B7280] shrink-0">{t.chatModelLabel}</dt>
                  <dd className="font-mono text-[11px] text-[#111827] bg-[#F8F9FB] border border-[#EAECEF] px-2 py-0.5 rounded-md truncate">
                    {agent.chatModel}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#6B7280] shrink-0">{t.embeddingModelLabel}</dt>
                  <dd
                    className="font-mono text-[11px] text-[#111827] bg-[#F8F9FB] border border-[#EAECEF] px-2 py-0.5 rounded-md truncate"
                    title={agent.embeddingModel}
                  >
                    {String(agent.embeddingModel || '').split('/').pop()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#6B7280] shrink-0">{t.vectorDimsLabel}</dt>
                  <dd className="font-medium text-[#111827] tabular-nums">
                    {agent.embeddingDimensions ? `${agent.embeddingDimensions}d` : t.vectorAuto}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[#6B7280] shrink-0">{t.widgetLangLabel}</dt>
                  <dd className="inline-flex items-center gap-1 font-medium text-[#111827] uppercase">
                    <Globe className="w-3 h-3 text-[#6B7280]" aria-hidden="true" />
                    <span>{agent.defaultLanguage || 'en'}</span>
                  </dd>
                </div>
              </dl>
            </section>

            {/* Honest Usage & Metering Card */}
            <section className="bg-white border border-[#EAECEF] rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-[#111827]">{t.usageCapacity}</h2>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-[#111827] tabular-nums">
                    {Number(usage.tokens).toLocaleString(locale)}
                  </span>
                  <span className="text-xs text-[#6B7280]">{t.estimatedTokens}</span>
                </div>
              </div>

              {hasUsage ? (
                <div className="space-y-3">
                  <div className="h-2 w-full rounded-full bg-[#F3F4F6] overflow-hidden flex">
                    <div className="h-full bg-[#2563EB]" style={{ width: `${chatSharePct}%` }} />
                    <div className="h-full bg-[#F59E0B] flex-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-[#F8F9FB] border border-[#EAECEF]">
                      <div className="text-[11px] text-[#6B7280]">{t.turnsMetered}</div>
                      <div className="font-semibold text-[#111827] tabular-nums mt-0.5">
                        {Number(usage.turns).toLocaleString(locale)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#F8F9FB] border border-[#EAECEF]">
                      <div className="text-[11px] text-[#6B7280]">{t.toolCallsLabel}</div>
                      <div className="font-semibold text-[#111827] tabular-nums mt-0.5">
                        {Number(usage.toolCalls).toLocaleString(locale)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="h-2 w-full rounded-full bg-[#F3F4F6]" />
                  <p className="text-xs text-[#6B7280] leading-relaxed">{t.noUsageYet}</p>
                </div>
              )}
            </section>
          </div>

          {/* Recent Tickets & Escalations */}
          <section className="bg-white border border-[#EAECEF] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F3F4F6] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#111827]">{t.recentActivity}</h2>
              <button
                type="button"
                onClick={() => onNavigate('tickets')}
                className="text-xs font-medium text-[#2563EB] hover:underline"
              >
                {t.viewAll}
              </button>
            </div>
            {recentTickets.length === 0 ? (
              <div className="px-5 py-7 text-center space-y-2">
                <p className="text-xs font-medium text-[#374151]">{t.noTicketsYet}</p>
                <p className="text-xs text-[#6B7280] max-w-md mx-auto">{t.noTicketsHint}</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#F3F4F6]">
                {recentTickets.map((tk: any) => (
                  <li
                    key={tk.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFB] transition"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#111827] truncate">
                        {tk.subject}
                      </div>
                      <div className="text-[11px] text-[#6B7280] truncate">{tk.visitorEmail}</div>
                    </div>
                    <span
                      className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium shrink-0 ${
                        tk.status === 'open'
                          ? 'bg-[#FEF2F2] text-[#B91C1C]'
                          : 'bg-[#ECFDF5] text-[#047857]'
                      }`}
                    >
                      {tk.status === 'open' ? t.ticketOpen : t.ticketResolved}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Right Context Panel: Agent Highlight + Live Updates (Conversations, Clients, Bookings) */}
      <aside className="hidden xl:flex w-[316px] border-l border-[#EAECEF] bg-white flex-col overflow-y-auto sidebar-scroll p-4 space-y-5 shrink-0">
        {/* Pastel Mesh Agent Card */}
        <div className="border border-[#EAECEF] rounded-2xl overflow-hidden shrink-0">
          <div className="h-20 mesh-banner" />
          <div className="px-4 pb-4 -mt-7">
            <div
              className="w-14 h-14 rounded-full text-white border-4 border-white flex items-center justify-center text-lg font-bold shadow-xs"
              style={{ backgroundColor: agent.primaryColor || '#18181B' }}
            >
              {String(agent.name || 'A').slice(0, 1).toUpperCase()}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <h2 className="text-sm font-semibold text-[#111827] truncate">{agent.name}</h2>
              <BadgeCheck className="w-4 h-4 text-[#2563EB] shrink-0" aria-hidden="true" />
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-[#6B7280]">
              <span className="truncate">{agent.chatModel}</span>
              <span className="px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] text-[10px] font-medium shrink-0">
                {t.online}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => onNavigate('widget')}
                className="px-2 py-1.5 rounded-lg border border-[#EAECEF] hover:bg-[#F9FAFB] text-[11px] font-medium text-[#374151] flex items-center justify-center gap-1 transition"
              >
                <Paintbrush className="w-3 h-3" aria-hidden="true" />
                <span>{t.quickWidgetBtn}</span>
              </button>
              <button
                type="button"
                onClick={onOpenEmbed}
                className="px-2 py-1.5 rounded-lg border border-[#EAECEF] hover:bg-[#F9FAFB] text-[11px] font-medium text-[#374151] flex items-center justify-center gap-1 transition"
              >
                <Code2 className="w-3 h-3" aria-hidden="true" />
                <span>{t.quickEmbedBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('tools')}
                className="px-2 py-1.5 rounded-lg border border-[#EAECEF] hover:bg-[#F9FAFB] text-[11px] font-medium text-[#374151] flex items-center justify-center gap-1 transition"
              >
                <Wrench className="w-3 h-3" aria-hidden="true" />
                <span>{t.quickToolsBtn}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Recent Conversations */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-[#111827]">{t.recentConversations}</h3>
            <button
              type="button"
              onClick={() => onNavigate('inbox')}
              className="text-[11px] font-medium text-[#2563EB] hover:underline"
            >
              {t.viewAll}
            </button>
          </div>
          {recentConversations.length === 0 ? (
            <p className="text-xs text-[#9CA3AF]">{t.noConversationsYet}</p>
          ) : (
            <ul className="space-y-1.5">
              {recentConversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate('inbox')}
                    className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#F8F9FB] text-left transition"
                  >
                    <span
                      className="w-8 h-8 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[#111827] truncate">
                        {c.visitorEmail || c.pageUrl || '/'}
                      </div>
                      <div className="text-[11px] text-[#6B7280] flex items-center gap-1.5">
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
            <h3 className="text-xs font-semibold text-[#111827]">{t.recentClients}</h3>
            <button
              type="button"
              onClick={() => onNavigate('leads')}
              className="text-[11px] font-medium text-[#2563EB] hover:underline"
            >
              {t.viewAll}
            </button>
          </div>
          {recentLeads.length === 0 ? (
            <p className="text-xs text-[#9CA3AF]">{t.noClientsYet}</p>
          ) : (
            <ul className="space-y-1.5">
              {recentLeads.map((ld) => (
                <li key={ld.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate('leads')}
                    className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#F8F9FB] text-left transition"
                  >
                    <span
                      className="w-8 h-8 rounded-lg bg-[#F5F3FF] text-[#7C3AED] text-xs font-semibold flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      {String(ld.name || ld.email || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-[#111827] truncate">
                        {ld.name || ld.email}
                      </div>
                      <div className="text-[11px] text-[#6B7280] truncate">
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
            <h3 className="text-xs font-semibold text-[#111827]">{t.upcoming}</h3>
            <button
              type="button"
              onClick={() => onNavigate('schedule')}
              className="text-[11px] font-medium text-[#2563EB] hover:underline"
            >
              {t.viewAll}
            </button>
          </div>
          {upcomingBookings.length === 0 ? (
            <p className="text-xs text-[#9CA3AF]">{t.noBookingsYet}</p>
          ) : (
            <ul className="space-y-1.5">
              {upcomingBookings.map((b: any) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#F8F9FB] transition"
                >
                  <span
                    className="w-8 h-8 rounded-lg bg-[#ECFDF5] text-[#059669] flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-[#111827] truncate">
                      {b.visitorName}
                    </div>
                    <div className="text-[11px] text-[#6B7280]">
                      {new Date(b.startsAt).toLocaleString(locale)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bottom Pastel Mesh Highlight Card */}
        <div className="mt-auto p-4 rounded-2xl border border-[#EAECEF] mesh-recap shrink-0">
          <div className="w-7 h-7 rounded-lg bg-white border border-[#EAECEF] flex items-center justify-center mb-2.5">
            <Sparkles className="w-4 h-4 text-[#18181B]" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-[#111827]">{t.recapTitle}</h3>
          <p className="text-xs text-[#6B7280] mt-1">{t.recapDesc}</p>
          <button
            type="button"
            onClick={() => onNavigate('playground')}
            className="mt-3 w-full py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium hover:bg-[#27272A] inline-flex items-center justify-center gap-1.5 transition"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.openPlayground}</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
