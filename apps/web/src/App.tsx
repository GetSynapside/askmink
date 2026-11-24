import { useEffect, useState } from 'react';
import {
  BookOpen,
  Bot,
  Calendar,
  Check,
  ChevronsUpDown,
  Code2,
  Copy,
  FileText,
  GitBranch,
  Globe,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MoreVertical,
  Paintbrush,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Trash2,
  User,
  Users,
  Webhook,
  Wrench,
  X,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '@/lib/api';
import { DICT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { AuthScreen } from '@/components/AuthScreen';
import { OverviewView } from '@/components/OverviewView';
import { BehaviorView } from '@/components/BehaviorView';
import { PlaygroundView } from '@/components/PlaygroundView';
import { WidgetStudioView } from '@/components/WidgetStudioView';
import { AgentOnboardingFlow } from '@/components/AgentOnboardingFlow';
import {
  AccountProfileView,
  AccountSettingsView,
  InboxView,
  KnowledgeView,
  LeadsView,
  ProductsView,
  ScheduleView,
  SettingsByokView,
  TicketsView,
  ToolsMcpView,
  WebhooksView,
} from '@/components/ManagementViews';

const LANG_STORAGE_KEY = 'askmink_ui_lang';
const AGENT_STORAGE_KEY = 'askmink_active_agent';

const LANGUAGE_OPTIONS: { code: SupportedLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
  { code: 'es', label: 'Español' },
];

function getUserInitials(name?: string, email?: string): string {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && first && last) {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function maskEmail(email?: string): string {
  if (!email) return '';
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

const ACCOUNT_TABS = new Set(['account/byok', 'account/settings', 'account/profile']);

const VALID_TABS = new Set([
  'overview',
  'workflow',
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
  'account/byok',
  'account/settings',
  'account/profile',
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
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (path === 'account/byok' || path === 'byok') {
    return 'account/byok';
  }
  if (path === 'account/settings' || path === 'account/setting' || path === 'settings') {
    return 'account/settings';
  }
  if (path === 'account/profile' || path === 'profile') {
    return 'account/profile';
  }
  const seg = path.split('/')[0] || '';
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
  const [showNewAgentWizard, setShowNewAgentWizard] = useState(false);
  const [agentPendingDelete, setAgentPendingDelete] = useState<any | null>(null);
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [showQuickJump, setShowQuickJump] = useState(false);

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
    const isAccountTab = ACCOUNT_TABS.has(safeTab);
    const params = new URLSearchParams(window.location.search);
    if (isAccountTab) {
      params.delete('agent');
    } else if (nextAgentId) {
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
        { id: 'workflow', label: t.workflowNavLabel || 'Workflow', icon: GitBranch },
        { id: 'behavior', label: t.tabPromptRules, icon: FileText },
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
      ],
    },
  ];

  const accountNavItems = [
    { id: 'account/byok', label: t.byokNavLabel || 'BYOK', icon: KeyRound },
    { id: 'account/settings', label: t.settingsNavLabel || 'Settings', icon: Settings },
    { id: 'account/profile', label: t.profileNavLabel || 'Profile', icon: User },
  ];

  const allNavItems = [...navGroups.flatMap((g) => g.items), ...accountNavItems];
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
    const initialPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
    const normalizedPath = `/${tab}`;
    if (
      window.location.pathname === '/' ||
      initialPath === 'settings' ||
      initialPath === 'account/setting' ||
      initialPath === 'byok' ||
      initialPath === 'profile' ||
      (ACCOUNT_TABS.has(tab) && window.location.search.includes('agent=')) ||
      window.location.pathname !== normalizedPath
    ) {
      updateBrowserUrl(tab, ACCOUNT_TABS.has(tab) ? undefined : activeAgentId || undefined, true);
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
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
      <div className="min-h-screen flex items-center justify-center text-xs text-muted-foreground">
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

  // Mandatory Full-Screen Onboarding when user has 0 agents
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

  return (
    <div className="h-screen flex bg-background overflow-hidden">
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
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 transition-transform duration-200 ease-out lg:static lg:translate-x-0',
          mobileMenuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        )}
      >
        {/* Brand Header */}
        <div className="h-14 px-4 border-b border-sidebar-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-xs shrink-0"
              aria-hidden="true"
            >
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm text-foreground leading-tight truncate">
                Askmink
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight truncate">
                by Synapside
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(false)}
            aria-label={t.closeMenu}
            className="lg:hidden"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Agent Switcher (shadcn DropdownMenu) */}
        <div className="p-3 border-b border-sidebar-border/70">
          {activeAgent ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="w-full p-2 rounded-xl border border-border bg-muted/40 hover:bg-accent/70 transition flex items-center gap-2.5 text-left cursor-pointer"
                >
                  <span
                    className="size-8 rounded-lg text-white flex items-center justify-center shrink-0"
                    style={{ backgroundColor: activeAgent.primaryColor || '#2563EB' }}
                    aria-hidden="true"
                  >
                    <Bot className="size-4" />
                  </span>
                  <span className="flex-1 min-w-0 text-xs font-semibold text-foreground truncate">
                    {activeAgent.name}
                  </span>
                  <ChevronsUpDown
                    className="size-3.5 text-muted-foreground shrink-0"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="start" className="w-[232px]">
                <DropdownMenuLabel>
                  {t.agentsSection} ({agents.length})
                </DropdownMenuLabel>
                <div className="max-h-52 overflow-y-auto sidebar-scroll space-y-0.5">
                  {agents.map((a) => {
                    const isSelected = activeAgent.id === a.id;
                    return (
                      <div key={a.id} className="flex items-center gap-1 group">
                        <DropdownMenuItem
                          onSelect={() => setActiveAgentId(a.id)}
                          className={cn(
                            'flex-1 min-w-0 justify-between',
                            isSelected && 'bg-accent font-semibold text-accent-foreground'
                          )}
                        >
                          <span className="truncate">{a.name}</span>
                          {isSelected && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
                        </DropdownMenuItem>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t.deleteAgent}: ${a.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setAgentPendingDelete(a);
                          }}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setShowNewAgentWizard(true)}
                  className="font-medium"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>{t.newAgent}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button type="button" onClick={() => setShowNewAgentWizard(true)} className="w-full">
              <Plus className="size-3.5" aria-hidden="true" />
              <span>{t.newAgent}</span>
            </Button>
          )}
        </div>

        {/* Grouped Navigation */}
        <nav aria-label="Primary" className="flex-1 overflow-y-auto sidebar-scroll px-3 py-3 space-y-5">
          {navGroups.map((group) => (
            <div key={group.id}>
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = tab === item.id;
                  const isAccountItem = ACCOUNT_TABS.has(item.id);
                  const href =
                    !isAccountItem && activeAgentId
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
                        className={cn(
                          'nav-item w-full px-2.5 py-2 rounded-lg text-[13px] flex items-center gap-2.5 transition text-left',
                          isActive
                            ? 'bg-accent text-accent-foreground font-semibold ring-1 ring-inset ring-border'
                            : 'text-muted-foreground font-medium hover:bg-accent/60 hover:text-foreground'
                        )}
                      >
                        <Icon
                          className={cn(
                            'size-4 shrink-0',
                            isActive ? 'text-foreground' : 'text-muted-foreground'
                          )}
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

        {/* Bottom Sidebar: BYOK + Settings + User Profile Submenu */}
        <div className="shrink-0 bg-sidebar">
          <nav
            aria-label={t.accountSectionLabel || 'Account'}
            className="px-3 pt-2 pb-1.5"
          >
            <ul className="space-y-0.5">
              {[
                { id: 'account/byok', label: t.byokNavLabel || 'BYOK', icon: KeyRound },
                { id: 'account/settings', label: t.settingsNavLabel || 'Settings', icon: Settings },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = tab === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`/${item.id}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                          return;
                        }
                        e.preventDefault();
                        handleSelectTab(item.id);
                      }}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'nav-item w-full px-2.5 py-2 rounded-lg text-[13px] flex items-center gap-2.5 transition text-left',
                        isActive
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground font-medium hover:bg-accent/60 hover:text-foreground'
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-foreground' : 'text-muted-foreground'
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="px-3 pb-3 pt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="w-full p-2 rounded-xl border border-transparent hover:border-border bg-muted/40 hover:bg-accent/70 data-[state=open]:bg-accent data-[state=open]:border-border transition flex items-center gap-2.5 text-left cursor-pointer"
                >
                  <Avatar className="size-8 rounded-lg shrink-0">
                    <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                      {getUserInitials(user?.name, user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-foreground leading-tight truncate">
                      {user?.name || t.accountSectionLabel || 'Account'}
                    </span>
                    {user?.email && (
                      <span className="block text-[11px] text-muted-foreground leading-tight truncate mt-0.5">
                        {maskEmail(user.email)}
                      </span>
                    )}
                  </span>
                  <MoreVertical
                    className="size-4 text-muted-foreground shrink-0"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-[232px]"
              >
                <div className="rounded-lg bg-muted/60 px-2.5 py-2 mb-1">
                  <div className="text-xs font-semibold text-foreground truncate">
                    {user?.name || t.accountSectionLabel || 'Account'}
                  </div>
                  {user?.email && (
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {maskEmail(user.email)}
                    </div>
                  )}
                </div>

                <DropdownMenuItem
                  onSelect={() => handleSelectTab('account/profile')}
                  className={cn(
                    tab === 'account/profile' && 'bg-accent font-semibold text-accent-foreground'
                  )}
                >
                  <User className="size-3.5" aria-hidden="true" />
                  <span className="flex-1 truncate">{t.profileNavLabel || 'Profile'}</span>
                  {tab === 'account/profile' && (
                    <Check className="size-3.5 shrink-0" aria-hidden="true" />
                  )}
                </DropdownMenuItem>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Globe className="size-3.5" aria-hidden="true" />
                    <span className="flex-1 truncate">{t.language}</span>
                    <span className="text-[10px] font-semibold uppercase text-muted-foreground mr-1">
                      {lang}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={lang}
                      onValueChange={(value) => {
                        if (value === 'en' || value === 'pt' || value === 'es') {
                          setLang(value);
                        }
                      }}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem key={option.code} value={option.code}>
                          <span lang={option.code}>{option.label}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSeparator />

                <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
                  <LogOut className="size-3.5" aria-hidden="true" />
                  <span>{t.logout}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Main Column: Topbar + Main Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-card border-b border-border px-4 lg:px-5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={t.openMenu}
              aria-expanded={mobileMenuOpen}
              aria-controls="primary-sidebar"
              className="lg:hidden shrink-0"
            >
              <Menu className="size-4" aria-hidden="true" />
            </Button>

            <div className="text-xs text-muted-foreground truncate">
              <span className="hidden sm:inline">
                {ACCOUNT_TABS.has(tab)
                  ? t.accountSectionLabel || 'Account'
                  : activeAgent?.name || 'Askmink'}{' '}
                /{' '}
              </span>
              <span className="font-semibold text-foreground">{currentNav?.label}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => setShowQuickJump(true)}
            className="hidden md:flex justify-between bg-muted/50 hover:bg-muted w-72 lg:w-80 text-muted-foreground font-normal"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t.searchPlaceholder}</span>
            </span>
            <kbd className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
              ⌘K
            </kbd>
          </Button>

          <div className="flex items-center gap-2 shrink-0">
            {activeAgent && (
              <Button type="button" variant="outline" onClick={() => setShowEmbed(true)}>
                <Code2 className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t.embedWidget}</span>
              </Button>
            )}
            <Button type="button" onClick={() => handleSelectTab('playground')}>
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span>{t.openPlayground}</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {tab === 'account/byok' ? (
            <SettingsByokView
              t={t}
              onAccountUpdated={() => loadAgents(activeAgent?.id)}
            />
          ) : tab === 'account/settings' ? (
            <AccountSettingsView
              t={t}
              onAccountUpdated={() => loadAgents(activeAgent?.id)}
            />
          ) : tab === 'account/profile' ? (
            <AccountProfileView
              t={t}
              onProfileUpdated={(updated) =>
                setUser((prev: any) => (prev ? { ...prev, name: updated.name } : prev))
              }
              onNavigateToByok={() => handleSelectTab('account/byok')}
              onLogout={handleLogout}
            />
          ) : !activeAgent ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <Card className="p-8 text-center max-w-md space-y-3 rounded-2xl">
                <h1 className="text-base font-semibold text-foreground">
                  {t.createFirstAgentTitle}
                </h1>
                <p className="text-xs text-muted-foreground">{t.createFirstAgentDesc}</p>
                <div className="pt-1">
                  <Button type="button" onClick={() => setShowNewAgentWizard(true)}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    <span>{t.newAgent}</span>
                  </Button>
                </div>
              </Card>
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
              {(tab === 'workflow' || tab === 'behavior') && (
                <BehaviorView
                  section={tab === 'workflow' ? 'workflow' : 'prompt'}
                  agent={activeAgent}
                  lang={lang}
                  t={t}
                  onAgentUpdated={() => loadAgents(activeAgent.id)}
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
              {tab === 'playground' && <PlaygroundView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'inbox' && <InboxView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'knowledge' && <KnowledgeView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'tools' && <ToolsMcpView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'schedule' && <ScheduleView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'products' && <ProductsView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'tickets' && <TicketsView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'leads' && <LeadsView agent={activeAgent} lang={lang} t={t} />}
              {tab === 'webhooks' && <WebhooksView agent={activeAgent} lang={lang} t={t} />}
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

      {/* Delete Agent Confirmation (shadcn AlertDialog) */}
      <AlertDialog
        open={Boolean(agentPendingDelete)}
        onOpenChange={(open) => {
          if (!open) setAgentPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          {agentPendingDelete && (
            <>
              <div className="flex items-start gap-3">
                <span
                  className="size-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  <Trash2 className="size-4" />
                </span>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.deleteAgentTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.deleteAgentWarning}{' '}
                    <strong className="text-foreground">{agentPendingDelete.name}</strong>{' '}
                    {t.deleteAgentWarningSuffix}
                  </AlertDialogDescription>
                </AlertDialogHeader>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deletingAgent}
                  onClick={(e) => {
                    e.preventDefault();
                    confirmDeleteAgent();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletingAgent ? t.deleting : t.confirmDelete}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Embed Widget Modal (shadcn Dialog) */}
      <Dialog open={showEmbed} onOpenChange={setShowEmbed}>
        <DialogContent className="max-w-lg">
          {activeAgent && (
            <>
              <DialogHeader>
                <DialogTitle>{t.embedWidget}</DialogTitle>
                <DialogDescription>{t.embedInstructions}</DialogDescription>
              </DialogHeader>
              <div className="relative">
                <pre className="p-3 pr-24 rounded-xl bg-zinc-900 text-zinc-100 text-xs font-mono overflow-x-auto">
                  {embedSnippet}
                </pre>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => handleCopySnippet(embedSnippet)}
                  className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white hover:text-white"
                >
                  {copiedSnippet ? (
                    <Check className="size-3 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3" aria-hidden="true" />
                  )}
                  <span>{copiedSnippet ? t.copied : t.copySnippet}</span>
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                JS API: <code>window.Askmink.identify(signedJwt)</code> ·{' '}
                <code>window.Askmink.setContext({'{ ... }'})</code> ·{' '}
                <code>window.Askmink.open()</code>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Quick Jump Command Dialog (shadcn CommandDialog, Cmd/Ctrl+K) */}
      <CommandDialog
        open={showQuickJump}
        onOpenChange={setShowQuickJump}
        title={t.quickJump}
        description={t.quickJumpSections}
      >
        <CommandInput placeholder={t.quickJump} />
        <CommandList>
          <CommandEmpty>{t.quickJumpEmpty}</CommandEmpty>
          <CommandGroup heading={t.quickJumpSections}>
            {allNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.id}
                  value={item.label}
                  onSelect={() => {
                    handleSelectTab(item.id);
                    setShowQuickJump(false);
                  }}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
          {agents.length > 0 && (
            <CommandGroup heading={t.agentsSection}>
              {agents.map((a) => (
                <CommandItem
                  key={a.id}
                  value={String(a.name || a.id)}
                  onSelect={() => {
                    setActiveAgentId(a.id);
                    setShowQuickJump(false);
                  }}
                  className="justify-between"
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{a.name}</span>
                  </span>
                  {activeAgent?.id === a.id && (
                    <Check className="size-3.5 text-foreground" aria-hidden="true" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  );
}
