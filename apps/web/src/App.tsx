import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  Calendar,
  Check,
  ChevronsUpDown,
  Code2,
  Copy,
  Cpu,
  GitBranch,
  Globe,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Paintbrush,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Trash2,
  Users,
  Webhook,
  Wrench,
  X,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from './lib/api';
import { DICT } from './lib/i18n';
import { AuthScreen } from './components/AuthScreen';
import { OverviewView } from './components/OverviewView';
import { BehaviorView } from './components/BehaviorView';
import { PlaygroundView } from './components/PlaygroundView';
import { WidgetStudioView } from './components/WidgetStudioView';
import { AgentOnboardingFlow } from './components/AgentOnboardingFlow';
import {
  InboxView,
  KnowledgeView,
  LeadsView,
  ProductsView,
  ScheduleView,
  SettingsByokView,
  TicketsView,
  ToolsMcpView,
  WebhooksView,
} from './components/ManagementViews';

const LANG_STORAGE_KEY = 'askmink_ui_lang';
const AGENT_STORAGE_KEY = 'askmink_active_agent';

const VALID_TABS = new Set([
  'overview',
  'behavior',
  'widget',
  'playground',
  'inbox',
  'knowledge',
  'tools',
  'products',
  'schedule',
  'tickets',
  'leads',
  'webhooks',
  'settings',
]);

function resolveInitialLanguage(): SupportedLanguage {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'pt' || saved === 'es') {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }
  const navLang = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
  if (navLang.startsWith('pt')) return 'pt';
  if (navLang.startsWith('es')) return 'es';
  return 'en';
}

function resolveTabFromLocation(): string {
  if (typeof window === 'undefined') return 'overview';
  const seg = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  return VALID_TABS.has(seg) ? seg : 'overview';
}

function resolveAgentIdFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const fromQuery = new URLSearchParams(window.location.search).get('agent');
  if (fromQuery) return fromQuery;
  try {
    return localStorage.getItem(AGENT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function App() {
  const [user, setUser] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [activeAgentId, setActiveAgentIdState] = useState<string>(resolveAgentIdFromLocation);
  const [overview, setOverview] = useState<any>(null);
  const [tab, setTabState] = useState<string>(resolveTabFromLocation);
  const [lang, setLangState] = useState<SupportedLanguage>(resolveInitialLanguage);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [agentSwitcherOpen, setAgentSwitcherOpen] = useState(false);
  const [showNewAgentWizard, setShowNewAgentWizard] = useState(false);
  const [agentPendingDelete, setAgentPendingDelete] = useState<any | null>(null);
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [showQuickJump, setShowQuickJump] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');

  const embedDialogRef = useRef<HTMLDialogElement>(null);
  const quickJumpDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  const t = DICT[lang];

  function setLang(next: SupportedLanguage) {
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors
    }
  }

  function updateBrowserUrl(nextTab: string, nextAgentId?: string, replace = false) {
    if (typeof window === 'undefined') return;
    const safeTab = VALID_TABS.has(nextTab) ? nextTab : 'overview';
    const params = new URLSearchParams(window.location.search);
    if (nextAgentId) {
      params.set('agent', nextAgentId);
    } else if (nextAgentId === '') {
      params.delete('agent');
    }
    const qs = params.toString();
    const targetUrl = `/${safeTab}${qs ? `?${qs}` : ''}`;
    if (window.location.pathname + window.location.search !== targetUrl) {
      if (replace) {
        window.history.replaceState({ tab: safeTab }, '', targetUrl);
      } else {
        window.history.pushState({ tab: safeTab }, '', targetUrl);
      }
    }
  }

  function setActiveAgentId(nextId: string) {
    setActiveAgentIdState(nextId);
    try {
      if (nextId) localStorage.setItem(AGENT_STORAGE_KEY, nextId);
      else localStorage.removeItem(AGENT_STORAGE_KEY);
    } catch {
      // Ignore storage write errors
    }
    updateBrowserUrl(tab, nextId, true);
  }

  function handleSelectTab(nextTab: string) {
    const safeTab = VALID_TABS.has(nextTab) ? nextTab : 'overview';
    setTabState(safeTab);
    setMobileMenuOpen(false);
    updateBrowserUrl(safeTab, activeAgentId || undefined, false);
  }

  const navGroups = [
    {
      id: 'core',
      label: t.navGroupCore,
      items: [
        { id: 'overview', label: t.overview, icon: LayoutDashboard },
        { id: 'behavior', label: t.behavior, icon: GitBranch },
        { id: 'widget', label: t.widgetStudio, icon: Paintbrush },
        { id: 'playground', label: t.playground, icon: Sparkles },
        { id: 'inbox', label: t.inbox, icon: Inbox },
      ],
    },
    {
      id: 'knowledge',
      label: t.navGroupKnowledge,
      items: [
        { id: 'knowledge', label: t.knowledge, icon: BookOpen },
        { id: 'tools', label: t.tools, icon: Wrench },
        { id: 'products', label: t.products, icon: ShoppingBag },
        { id: 'schedule', label: t.schedule, icon: Calendar },
      ],
    },
    {
      id: 'operations',
      label: t.navGroupOperations,
      items: [
        { id: 'tickets', label: t.tickets, icon: LifeBuoy },
        { id: 'leads', label: t.navLeads, icon: Users },
        { id: 'webhooks', label: t.webhooks, icon: Webhook },
        { id: 'settings', label: t.settings, icon: Settings },
      ],
    },
  ];

  const allNavItems = navGroups.flatMap((g) => g.items);
  const currentNav = allNavItems.find((n) => n.id === tab);

  async function loadAgents(preferredId?: string) {
    const res = await apiRequest<{ items: any[] }>('/api/agents');
    const items = res.items || [];
    setAgents(items);
    setAgentsLoaded(true);

    const desired = preferredId ?? activeAgentId;
    if (desired && items.some((a) => a.id === desired)) {
      setActiveAgentId(desired);
    } else if (items[0]) {
      setActiveAgentId(items[0].id);
    } else {
      setActiveAgentId('');
    }
  }

  useEffect(() => {
    apiRequest<{ user: any }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
        return loadAgents();
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  // Ensure canonical URL path on mount and sync browser Back/Forward
  useEffect(() => {
    if (window.location.pathname === '/' || !VALID_TABS.has(resolveTabFromLocation())) {
      updateBrowserUrl(tab, activeAgentId || undefined, true);
    }
    function onPopState() {
      const nextTab = resolveTabFromLocation();
      setTabState(nextTab);
      const queryAgent = new URLSearchParams(window.location.search).get('agent');
      if (queryAgent) {
        setActiveAgentIdState(queryAgent);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!activeAgentId) {
      setOverview(null);
      return;
    }
    apiRequest(`/api/agents/${activeAgentId}/overview`)
      .then(setOverview)
      .catch(() => undefined);
  }, [activeAgentId, tab]);

  // Sync document language and page title
  useEffect(() => {
    document.documentElement.lang = lang;
    if (currentNav?.label) {
      document.title = `${currentNav.label} | Askmink`;
    }
  }, [lang, currentNav]);

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowQuickJump((prev) => !prev);
      } else if (e.key === 'Escape') {
        setAgentSwitcherOpen(false);
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Close agent switcher on outside click
  useEffect(() => {
    if (!agentSwitcherOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setAgentSwitcherOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [agentSwitcherOpen]);

  // Sync native <dialog> for Embed modal
  useEffect(() => {
    const dialog = embedDialogRef.current;
    if (!dialog) return;
    if (showEmbed && !dialog.open) {
      dialog.showModal();
    } else if (!showEmbed && dialog.open) {
      dialog.close();
    }
  }, [showEmbed]);

  // Sync native <dialog> for Quick Jump modal
  useEffect(() => {
    const dialog = quickJumpDialogRef.current;
    if (!dialog) return;
    if (showQuickJump && !dialog.open) {
      setQuickQuery('');
      dialog.showModal();
      requestAnimationFrame(() => quickInputRef.current?.focus());
    } else if (!showQuickJump && dialog.open) {
      dialog.close();
    }
  }, [showQuickJump]);

  // Sync native <dialog> for Delete Agent confirmation
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (agentPendingDelete && !dialog.open) {
      dialog.showModal();
    } else if (!agentPendingDelete && dialog.open) {
      dialog.close();
    }
  }, [agentPendingDelete]);

  async function confirmDeleteAgent() {
    if (!agentPendingDelete || deletingAgent) return;
    setDeletingAgent(true);
    try {
      const idToDelete = agentPendingDelete.id;
      await apiRequest(`/api/agents/${idToDelete}`, { method: 'DELETE' });
      try {
        localStorage.removeItem(`askmink_widget_prefs_${idToDelete}`);
        localStorage.removeItem(`askmink_workflow_${idToDelete}`);
      } catch {
        // Ignore storage cleanup errors
      }
      setAgentPendingDelete(null);
      await loadAgents(activeAgentId === idToDelete ? '' : activeAgentId);
    } finally {
      setDeletingAgent(false);
    }
  }

  async function handleLogout() {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    window.location.href = '/';
  }

  async function handleCopySnippet(snippet: string) {
    try {
      await navigator.clipboard.writeText(snippet);
      if (activeAgentId) {
        localStorage.setItem(`askmink_check_embed_${activeAgentId}`, '1');
      }
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xs text-[#6B7280]">
        Loading Askmink...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        lang={lang}
        onChangeLang={setLang}
        t={t}
        onAuthenticated={async (u) => {
          setUser(u);
          await loadAgents();
        }}
      />
    );
  }

  // Mandatory Full-Screen Onboarding when user has 0 agents (right after signup or after deleting all agents)
  if (agentsLoaded && agents.length === 0) {
    return (
      <AgentOnboardingFlow
        mode="first-agent"
        user={user}
        lang={lang}
        onChangeLang={setLang}
        onLogout={handleLogout}
        t={t}
        onCreated={async (created) => {
          await loadAgents(created.id);
          handleSelectTab('overview');
        }}
      />
    );
  }

  const activeAgent = agents.find((a) => a.id === activeAgentId) || agents[0] || null;
  const embedSnippet = activeAgent
    ? `<script src="${window.location.origin}/widget.js" data-agent="${activeAgent.id}"></script>`
    : '';

  const normalizedQuery = quickQuery.trim().toLowerCase();
  const filteredNav = allNavItems.filter(
    (item) => !normalizedQuery || (item.label || '').toLowerCase().includes(normalizedQuery)
  );
  const filteredAgents = agents.filter(
    (a) => !normalizedQuery || String(a.name || '').toLowerCase().includes(normalizedQuery)
  );

  return (
    <div className="h-screen flex bg-[#F8F9FB] overflow-hidden">
      {/* Mobile backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-[1px] z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Unified Primary Sidebar */}
      <aside
        id="primary-sidebar"
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-[#EAECEF] flex flex-col shrink-0 transition-transform duration-200 ease-out lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-14 px-4 border-b border-[#EAECEF] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg bg-[#18181B] text-white flex items-center justify-center shadow-xs shrink-0"
              aria-hidden="true"
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-[#111827] leading-tight truncate">
                Askmink
              </div>
              <div className="text-[10px] text-[#6B7280] leading-tight truncate">
                by Synapside
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label={t.closeMenu}
            className="lg:hidden w-8 h-8 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] flex items-center justify-center"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Agent Switcher */}
        <div className="p-3 border-b border-[#F3F4F6] relative" ref={switcherRef}>
          {activeAgent ? (
            <>
              <button
                type="button"
                onClick={() => setAgentSwitcherOpen((prev) => !prev)}
                aria-expanded={agentSwitcherOpen}
                aria-controls="agent-switcher-menu"
                className="w-full p-2 rounded-xl border border-[#EAECEF] bg-[#FAFAFB] hover:bg-[#F3F4F6]/80 hover:border-[#D1D5DB] transition flex items-center gap-2.5 text-left"
              >
                <span
                  className="w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0"
                  style={{ backgroundColor: activeAgent.primaryColor || '#2563EB' }}
                  aria-hidden="true"
                >
                  <Bot className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-[#111827] truncate">
                    {activeAgent.name}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-[#6B7280] truncate">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {activeAgent.chatModel || 'tencent/hy4-flash'}
                    </span>
                  </span>
                </span>
                <ChevronsUpDown
                  className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0"
                  aria-hidden="true"
                />
              </button>

              {agentSwitcherOpen && (
                <div
                  id="agent-switcher-menu"
                  className="absolute left-3 right-3 top-[calc(100%-4px)] z-50 bg-white border border-[#E5E7EB] rounded-xl shadow-lg p-1.5 space-y-1"
                >
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    {t.agentsSection} ({agents.length})
                  </div>
                  <div className="max-h-52 overflow-y-auto sidebar-scroll space-y-0.5">
                    {agents.map((a) => {
                      const isSelected = activeAgent.id === a.id;
                      return (
                        <div key={a.id} className="flex items-center gap-1 group">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveAgentId(a.id);
                              setAgentSwitcherOpen(false);
                            }}
                            className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition text-left ${
                              isSelected
                                ? 'bg-[#F3F4F6] text-[#111827] font-semibold'
                                : 'text-[#4B5563] hover:bg-[#F9FAFB] hover:text-[#111827]'
                            }`}
                          >
                            <span className="truncate">{a.name}</span>
                            {isSelected && (
                              <Check
                                className="w-3.5 h-3.5 text-[#111827] shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`${t.deleteAgent}: ${a.name}`}
                            onClick={() => {
                              setAgentSwitcherOpen(false);
                              setAgentPendingDelete(a);
                            }}
                            className="w-7 h-7 rounded-lg text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pt-1 mt-1 border-t border-[#F3F4F6]">
                    <button
                      type="button"
                      onClick={() => {
                        setAgentSwitcherOpen(false);
                        setShowNewAgentWizard(true);
                      }}
                      className="w-full px-2 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F3F4F6] flex items-center gap-2 transition"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t.newAgent}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewAgentWizard(true)}
              className="w-full py-2 px-3 rounded-lg bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium flex items-center justify-center gap-2 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.newAgent}</span>
            </button>
          )}
        </div>

        {/* Grouped Navigation (real anchor links for open-in-new-tab + History API) */}
        <nav aria-label="Primary" className="flex-1 overflow-y-auto sidebar-scroll px-3 py-3 space-y-5">
          {navGroups.map((group) => (
            <div key={group.id}>
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = tab === item.id;
                  const href = activeAgentId
                    ? `/${item.id}?agent=${encodeURIComponent(activeAgentId)}`
                    : `/${item.id}`;
                  return (
                    <li key={item.id}>
                      <a
                        href={href}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                            return;
                          }
                          e.preventDefault();
                          handleSelectTab(item.id);
                        }}
                        aria-current={isActive ? 'page' : undefined}
                        className={`nav-item w-full px-2.5 py-2 rounded-lg text-[13px] flex items-center gap-2.5 transition text-left ${
                          isActive
                            ? 'bg-[#F3F4F6] text-[#111827] font-semibold ring-1 ring-inset ring-[#E5E7EB]'
                            : 'text-[#4B5563] font-medium hover:bg-[#F9FAFB] hover:text-[#111827]'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-[#111827]' : 'text-[#6B7280]'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Unified Sidebar Footer */}
        <div className="p-3 border-t border-[#EAECEF] space-y-2.5 shrink-0 bg-[#FAFAFB]/60">
          <button
            type="button"
            onClick={() => handleSelectTab('settings')}
            className="w-full p-2.5 rounded-xl bg-white border border-[#EAECEF] hover:border-[#D1D5DB] transition text-left flex items-center gap-2.5"
          >
            <span
              className="w-7 h-7 rounded-lg bg-[#F3F4F6] text-[#4B5563] flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Cpu className="w-3.5 h-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold text-[#111827] leading-tight">
                BYOK Self-Hosted
              </span>
              <span className="block text-[11px] text-[#6B7280] truncate mt-0.5">
                {activeAgent?.chatModel || 'tencent/hy4-flash'}
              </span>
            </span>
          </button>

          <div className="flex items-center justify-between gap-2">
            <div
              className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#F3F4F6] border border-[#EAECEF]"
              role="group"
              aria-label={t.language}
            >
              <Globe className="w-3.5 h-3.5 text-[#6B7280] ml-1.5 mr-0.5" aria-hidden="true" />
              {(['en', 'pt', 'es'] as SupportedLanguage[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={`px-1.5 py-1 rounded-md text-[10px] font-semibold uppercase transition ${
                    lang === code
                      ? 'bg-white text-[#111827] shadow-2xs'
                      : 'text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#6B7280] hover:text-[#DC2626] hover:bg-[#FEF2F2] inline-flex items-center gap-1.5 transition"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.logout}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column: Topbar + Main Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-[#EAECEF] px-4 lg:px-5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={t.openMenu}
              aria-expanded={mobileMenuOpen}
              aria-controls="primary-sidebar"
              className="lg:hidden w-8 h-8 rounded-lg border border-[#EAECEF] text-[#4B5563] hover:bg-[#F3F4F6] flex items-center justify-center shrink-0"
            >
              <Menu className="w-4 h-4" aria-hidden="true" />
            </button>

            <div className="text-xs text-[#6B7280] truncate">
              <span className="hidden sm:inline">{activeAgent?.name || 'Askmink'} / </span>
              <span className="font-semibold text-[#111827]">{currentNav?.label}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowQuickJump(true)}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F8F9FB] hover:bg-[#F3F4F6] border border-[#EAECEF] w-72 lg:w-80 text-xs text-[#6B7280] transition text-left"
          >
            <Search className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{t.searchPlaceholder}</span>
            <kbd className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-[#EAECEF] text-[#6B7280]">
              ⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {activeAgent && (
              <button
                type="button"
                onClick={() => setShowEmbed(true)}
                className="px-3 py-1.5 rounded-lg border border-[#EAECEF] hover:bg-[#F9FAFB] text-xs font-medium text-[#111827] inline-flex items-center gap-1.5 transition"
              >
                <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t.embedWidget}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleSelectTab('playground')}
              className="px-3 py-1.5 rounded-lg bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium inline-flex items-center gap-1.5 transition"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.openPlayground}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!activeAgent ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="bg-white border border-[#EAECEF] rounded-2xl p-8 text-center max-w-md space-y-3">
                <h1 className="text-base font-semibold text-[#111827]">
                  {t.createFirstAgentTitle}
                </h1>
                <p className="text-xs text-[#6B7280]">{t.createFirstAgentDesc}</p>
                <button
                  type="button"
                  onClick={() => setShowNewAgentWizard(true)}
                  className="px-4 py-2 rounded-lg bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium inline-flex items-center gap-1.5 transition"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.newAgent}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {tab === 'overview' && (
                <OverviewView
                  agent={activeAgent}
                  overview={overview}
                  lang={lang}
                  t={t}
                  onNavigate={handleSelectTab}
                  onOpenEmbed={() => setShowEmbed(true)}
                />
              )}
              {tab === 'behavior' && (
                <BehaviorView
                  agent={activeAgent}
                  lang={lang}
                  t={t}
                  onAgentUpdated={() => loadAgents(activeAgent.id)}
                  onRequestDeleteAgent={() => setAgentPendingDelete(activeAgent)}
                />
              )}
              {tab === 'widget' && (
                <WidgetStudioView
                  agent={activeAgent}
                  lang={lang}
                  t={t}
                  onAgentUpdated={() => loadAgents(activeAgent.id)}
                />
              )}
              {tab === 'playground' && <PlaygroundView agent={activeAgent} />}
              {tab === 'inbox' && <InboxView agent={activeAgent} />}
              {tab === 'knowledge' && <KnowledgeView agent={activeAgent} />}
              {tab === 'tools' && <ToolsMcpView agent={activeAgent} />}
              {tab === 'schedule' && <ScheduleView agent={activeAgent} />}
              {tab === 'products' && <ProductsView agent={activeAgent} />}
              {tab === 'tickets' && <TicketsView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'leads' && <LeadsView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'webhooks' && <WebhooksView agent={activeAgent} />}
              {tab === 'settings' && (
                <SettingsByokView
                  agent={activeAgent}
                  t={t}
                  onAgentUpdated={() => loadAgents(activeAgent.id)}
                  onRequestDeleteAgent={() => setAgentPendingDelete(activeAgent)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* New Agent Essential Onboarding Modal */}
      <AgentOnboardingFlow
        mode="new-agent"
        open={showNewAgentWizard}
        user={user}
        lang={lang}
        t={t}
        onClose={() => setShowNewAgentWizard(false)}
        onCreated={async (created) => {
          await loadAgents(created.id);
          handleSelectTab('overview');
        }}
      />

      {/* Delete Agent Confirmation Native Dialog */}
      <dialog
        ref={deleteDialogRef}
        onClose={() => setAgentPendingDelete(null)}
        aria-labelledby="delete-agent-title"
        {...({ closedby: 'closerequest' } as any)}
        className="m-auto bg-white border border-[#EAECEF] rounded-2xl max-w-md w-[calc(100%-2rem)] p-0 shadow-2xl"
      >
        {agentPendingDelete && (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span
                className="w-9 h-9 rounded-xl bg-[#FEF2F2] text-[#DC2626] flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <Trash2 className="w-4 h-4" />
              </span>
              <div className="space-y-1">
                <h2 id="delete-agent-title" className="text-sm font-semibold text-[#111827]">
                  {t.deleteAgentTitle}
                </h2>
                <p className="text-xs text-[#6B7280] leading-relaxed">
                  {t.deleteAgentWarning}{' '}
                  <strong className="text-[#111827]">{agentPendingDelete.name}</strong>{' '}
                  {t.deleteAgentWarningSuffix}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                autoFocus
                onClick={() => setAgentPendingDelete(null)}
                className="px-3.5 py-2 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-xs font-medium text-[#374151]"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={deletingAgent}
                onClick={confirmDeleteAgent}
                className="px-3.5 py-2 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] disabled:opacity-50 text-white text-xs font-semibold"
              >
                {deletingAgent ? t.deleting : t.confirmDelete}
              </button>
            </div>
          </div>
        )}
      </dialog>

      {/* Embed Widget Native Modal Dialog */}
      <dialog
        ref={embedDialogRef}
        onClose={() => setShowEmbed(false)}
        onClick={(e) => {
          if (e.target === embedDialogRef.current) setShowEmbed(false);
        }}
        aria-labelledby="embed-dialog-title"
        {...({ closedby: 'any' } as any)}
        className="m-auto bg-white border border-[#EAECEF] rounded-2xl max-w-lg w-[calc(100%-2rem)] p-0 shadow-xl"
      >
        {activeAgent && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="embed-dialog-title" className="text-sm font-semibold text-[#111827]">
                {t.embedWidget}
              </h2>
              <button
                type="button"
                onClick={() => setShowEmbed(false)}
                aria-label={t.close}
                className="w-7 h-7 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] flex items-center justify-center"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs text-[#6B7280]">{t.embedInstructions}</p>
            <div className="relative">
              <pre className="p-3 pr-24 rounded-xl bg-[#111827] text-[#E5E7EB] text-xs font-mono overflow-x-auto">
                {embedSnippet}
              </pre>
              <button
                type="button"
                onClick={() => handleCopySnippet(embedSnippet)}
                className="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium inline-flex items-center gap-1 transition"
              >
                {copiedSnippet ? (
                  <Check className="w-3 h-3 text-[#4ADE80]" aria-hidden="true" />
                ) : (
                  <Copy className="w-3 h-3" aria-hidden="true" />
                )}
                <span>{copiedSnippet ? t.copied : t.copySnippet}</span>
              </button>
            </div>
            <div className="text-xs text-[#6B7280]">
              JS API: <code>window.Askmink.identify(signedJwt)</code> ·{' '}
              <code>window.Askmink.setContext({'{ ... }'})</code> · <code>window.Askmink.open()</code>
            </div>
          </div>
        )}
      </dialog>

      {/* Quick Jump Command Dialog (Cmd/Ctrl+K) */}
      <dialog
        ref={quickJumpDialogRef}
        onClose={() => setShowQuickJump(false)}
        onClick={(e) => {
          if (e.target === quickJumpDialogRef.current) setShowQuickJump(false);
        }}
        aria-label={t.quickJump}
        {...({ closedby: 'any' } as any)}
        className="m-auto mt-20 bg-white border border-[#EAECEF] rounded-2xl max-w-md w-[calc(100%-2rem)] p-0 shadow-xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#EAECEF]">
          <Search className="w-4 h-4 text-[#9CA3AF] shrink-0" aria-hidden="true" />
          <input
            ref={quickInputRef}
            type="text"
            aria-label={t.quickJump}
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            placeholder={t.quickJump}
            className="flex-1 text-sm text-[#111827] placeholder:text-[#9CA3AF] bg-transparent outline-none"
          />
          <button
            type="button"
            onClick={() => setShowQuickJump(false)}
            aria-label={t.close}
            className="w-7 h-7 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] flex items-center justify-center"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto sidebar-scroll p-2 space-y-3">
          {filteredNav.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                {t.quickJumpSections}
              </div>
              <ul className="space-y-0.5">
                {filteredNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          handleSelectTab(item.id);
                          setShowQuickJump(false);
                        }}
                        className="w-full px-2.5 py-2 rounded-lg text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827] flex items-center gap-2.5 transition text-left"
                      >
                        <Icon className="w-4 h-4 text-[#6B7280]" aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {filteredAgents.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                {t.agentsSection}
              </div>
              <ul className="space-y-0.5">
                {filteredAgents.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveAgentId(a.id);
                        setShowQuickJump(false);
                      }}
                      className="w-full px-2.5 py-2 rounded-lg text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827] flex items-center justify-between gap-2 transition text-left"
                    >
                      <span className="inline-flex items-center gap-2 truncate">
                        <Bot className="w-4 h-4 text-[#6B7280]" aria-hidden="true" />
                        <span className="truncate">{a.name}</span>
                      </span>
                      {activeAgent?.id === a.id && (
                        <Check className="w-3.5 h-3.5 text-[#111827]" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filteredNav.length === 0 && filteredAgents.length === 0 && (
            <div className="py-8 text-center text-xs text-[#6B7280]">{t.quickJumpEmpty}</div>
          )}
        </div>
      </dialog>
    </div>
  );
}
