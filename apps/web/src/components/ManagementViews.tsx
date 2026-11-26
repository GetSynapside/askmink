import { useEffect, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Inbox,
  KeyRound,
  LifeBuoy,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  ShieldCheck,
  ShoppingBag,
  Terminal,
  Trash2,
  Upload,
  User,
  Users,
  Webhook,
  Wrench,
  X,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '@/lib/api';
import { cn } from '@/lib/utils';
import { isSafeHttpUrl } from '@/components/SafeMarkdown';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const VIEW_LOCALES: Record<SupportedLanguage, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-ES',
};

const WEEKDAY_LABELS: Record<SupportedLanguage, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  pt: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
};

function EmptyState({
  icon: Icon,
  title,
  hint,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('text-center space-y-2', compact ? 'px-5 py-7' : 'px-6 py-10')}>
      <div
        className="size-10 rounded-xl bg-muted border border-border/70 text-muted-foreground mx-auto flex items-center justify-center"
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </div>
      <p className="text-xs font-medium text-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">{hint}</p>}
    </div>
  );
}

const PENDING_KB_STATUSES = new Set(['pending', 'processing', 'indexing', 'queued']);

function getKnowledgeStatusVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (status === 'ready') return 'success';
  if (status === 'failed' || status === 'error') return 'destructive';
  if (PENDING_KB_STATUSES.has(status)) return 'warning';
  return 'secondary';
}

function formatKnowledgeType(type: string, t?: Record<string, string>): string {
  switch (type) {
    case 'text':
      return t?.knowledgeTypeText || 'Text';
    case 'file':
      return t?.knowledgeTypeFile || 'File';
    case 'url':
      return t?.knowledgeTypeUrl || 'URL';
    case 'sitemap':
      return t?.knowledgeTypeSitemap || 'Sitemap';
    case 'llms_txt':
      return t?.knowledgeTypeLlmsTxt || 'llms.txt';
    default:
      return type;
  }
}

function formatKnowledgeStatus(status: string, t?: Record<string, string>): string {
  if (status === 'ready') return t?.knowledgeStatusReady || 'Ready';
  if (PENDING_KB_STATUSES.has(status)) return t?.knowledgeStatusIndexing || 'Indexing...';
  if (status === 'failed' || status === 'error') return t?.knowledgeStatusError || 'Error';
  return status;
}

function getConversationStatusVariant(status: string): 'success' | 'destructive' | 'info' | 'secondary' {
  if (status === 'resolved_ai') return 'success';
  if (status === 'ticket_open') return 'destructive';
  if (status === 'lead_booked') return 'info';
  return 'secondary';
}

export function InboxView({
  agent,
  lang = 'en',
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t?: Record<string, string>;
}) {
  const [filter, setFilter] = useState<'all' | 'resolved_ai' | 'ticket_open' | 'lead_booked'>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    const q = filter !== 'all' ? `?status=${filter}` : '';
    apiRequest(`/api/agents/${agent.id}/conversations${q}`).then((r) => setItems(r.items || []));
  }, [agent.id, filter]);

  async function openConv(id: string) {
    const detail = await apiRequest(`/api/conversations/${id}`);
    setSelected(detail);
  }

  const locale = VIEW_LOCALES[lang] || 'en-US';
  const normalized = query.trim().toLowerCase();
  const filteredItems = items.filter(
    (c) =>
      !normalized ||
      String(c.visitorEmail || '').toLowerCase().includes(normalized) ||
      String(c.pageUrl || '').toLowerCase().includes(normalized) ||
      String(c.id || '').toLowerCase().includes(normalized)
  );

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
      {/* Left Conversation List Pane */}
      <div className="w-full md:w-80 lg:w-[340px] max-h-80 md:max-h-none border-b md:border-b-0 md:border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-4 border-b border-border space-y-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base font-semibold text-foreground tracking-tight truncate">
                {t?.inboxTitle || 'Conversations'}
              </h1>
              <Badge variant="secondary" className="tabular-nums">
                {items.length}
              </Badge>
            </div>
          </div>

          <div className="relative">
            <Search
              className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label={t?.inboxSearchPh || 'Filter by email or page...'}
              placeholder={t?.inboxSearchPh || 'Filter by email or page...'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          <Tabs
            value={filter}
            onValueChange={(v) =>
              setFilter(v as 'all' | 'resolved_ai' | 'ticket_open' | 'lead_booked')
            }
          >
            <TabsList className="w-full grid grid-cols-4 h-8">
              <TabsTrigger value="all" className="text-[11px] px-1.5">
                {t?.inboxFilterAll || 'All'}
              </TabsTrigger>
              <TabsTrigger value="resolved_ai" className="text-[11px] px-1.5">
                {t?.inboxFilterResolvedAi || 'AI'}
              </TabsTrigger>
              <TabsTrigger value="ticket_open" className="text-[11px] px-1.5">
                {t?.inboxFilterTicket || 'Ticket'}
              </TabsTrigger>
              <TabsTrigger value="lead_booked" className="text-[11px] px-1.5">
                {t?.inboxFilterLeadBooked || 'Lead'}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll divide-y divide-border">
          {filteredItems.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t?.inboxEmptyList || 'No conversations found for this filter.'}
              compact
            />
          ) : (
            filteredItems.map((c) => {
              const isSelected = selected?.conversation?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openConv(c.id)}
                  className={cn(
                    'w-full px-4 py-3 text-left hover:bg-muted/50 transition cursor-pointer flex items-start gap-2.5 border-l-2',
                    isSelected
                      ? 'bg-accent/60 border-l-primary'
                      : 'border-l-transparent'
                  )}
                >
                  <span
                    className="size-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5"
                    aria-hidden="true"
                  >
                    <MessageSquare className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground truncate">
                        {c.visitorEmail || c.pageUrl || '/'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">
                        {c.messageCount} {t?.messagesShort || 'msgs'}
                      </span>
                      <Badge
                        variant={getConversationStatusVariant(c.status)}
                        className="text-[10px]"
                      >
                        {c.status}
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Detail Pane */}
      <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
        {!selected ? (
          <div className="h-full flex items-center justify-center">
            <Card className="max-w-md w-full">
              <EmptyState
                icon={MessageSquare}
                title={t?.inboxSelectTitle || 'Select a conversation'}
                hint={
                  t?.inboxSelectDesc ||
                  'Choose a thread from the left to inspect the full transcript and execution traces.'
                }
              />
            </Card>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-5">
            {/* Conversation Header Card */}
            <Card className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-foreground truncate">
                      {selected.conversation.visitorEmail ||
                        selected.conversation.pageUrl ||
                        `Conversation ${selected.conversation.id.slice(0, 8)}`}
                    </h2>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      #{selected.conversation.id.slice(0, 8)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 flex-wrap">
                    {selected.conversation.pageUrl && (
                      <span className="font-mono truncate max-w-xs">
                        {selected.conversation.pageUrl}
                      </span>
                    )}
                    {selected.conversation.createdAt && (
                      <span>
                        · {new Date(selected.conversation.createdAt).toLocaleString(locale)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge variant={getConversationStatusVariant(selected.conversation.status)}>
                    {selected.conversation.status}
                  </Badge>
                </div>
              </div>
            </Card>

            {/* Transcript Card */}
            <Card className="overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>{t?.inboxTranscriptTitle || 'Transcript'}</span>
                </h3>
                <Badge variant="secondary" className="tabular-nums">
                  {(selected.messages || []).length} {t?.messagesShort || 'msgs'}
                </Badge>
              </div>
              <div className="p-5 space-y-3">
                {(selected.messages || []).map((m: any) => (
                  <div
                    key={m.id}
                    className={cn(
                      'p-3.5 rounded-xl text-xs leading-relaxed max-w-2xl whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground ml-auto'
                        : 'bg-muted/50 border border-border text-foreground'
                    )}
                  >
                    {m.content}
                  </div>
                ))}
              </div>
            </Card>

            {/* Execution Traces Card */}
            <Card className="overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>{t?.inboxTracesTitle || 'Execution Traces'}</span>
                </h3>
                <Badge variant="secondary" className="tabular-nums">
                  {(selected.traces || []).length}
                </Badge>
              </div>
              <div className="p-5">
                {(selected.traces || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t?.inboxNoTraces ||
                      'No tool calls or RAG traces recorded for this conversation.'}
                  </p>
                ) : (
                  <pre className="p-3.5 rounded-xl bg-zinc-950 text-zinc-100 text-[11px] font-mono overflow-x-auto leading-relaxed">
                    {JSON.stringify(selected.traces, null, 2)}
                  </pre>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeView({
  agent,
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t?: Record<string, string>;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [crawlType, setCrawlType] = useState<'url' | 'sitemap' | 'llms_txt'>('url');
  const [notice, setNotice] = useState<{ type: 'info' | 'ok' | 'err'; text: string } | null>(null);

  const [editingSource, setEditingSource] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editSourceUrl, setEditSourceUrl] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [sourcePendingDelete, setSourcePendingDelete] = useState<any | null>(null);
  const [deletingSource, setDeletingSource] = useState(false);

  async function refresh() {
    const r = await apiRequest(`/api/agents/${agent.id}/knowledge`);
    setItems(r.items || []);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [agent.id]);

  const readyCount = items.filter((s) => s.status === 'ready').length;
  const pendingCount = items.filter((s) => PENDING_KB_STATUSES.has(s.status)).length;

  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [agent.id, pendingCount]);

  function openEditSource(s: any) {
    setEditingSource(s);
    setEditTitle(s.title || '');
    setEditContent(s.rawContent || '');
    setEditSourceUrl(s.sourceUrl || '');
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSource || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const body: Record<string, string> = {
        title: editTitle.trim(),
      };
      if (editingSource.type === 'text') {
        body.content = editContent.trim();
        body.sourceUrl = editSourceUrl.trim();
      } else if (
        editingSource.type === 'url' ||
        editingSource.type === 'sitemap' ||
        editingSource.type === 'llms_txt'
      ) {
        const trimmedUrl = editSourceUrl.trim();
        if (trimmedUrl) {
          body.sourceUrl = trimmedUrl;
        }
      }

      await apiRequest(`/api/agents/${agent.id}/knowledge/${editingSource.id}`, {
        method: 'PATCH',
        body,
      });
      setEditingSource(null);
      setNotice({
        type: 'ok',
        text:
          t?.knowledgeUpdatedMsg || 'Knowledge source updated and queued for re-indexing.',
      });
      await refresh().catch(() => undefined);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDelete() {
    if (!sourcePendingDelete || deletingSource) return;
    setDeletingSource(true);
    try {
      await apiRequest(`/api/agents/${agent.id}/knowledge/${sourcePendingDelete.id}`, {
        method: 'DELETE',
      });
      setSourcePendingDelete(null);
      setNotice({
        type: 'ok',
        text: t?.knowledgeDeletedMsg || 'Knowledge source deleted.',
      });
      await refresh().catch(() => undefined);
    } catch (err) {
      setSourcePendingDelete(null);
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setDeletingSource(false);
    }
  }

  async function addText(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/agents/${agent.id}/knowledge/text`, {
        method: 'POST',
        body: { title, content },
      });
      setTitle('');
      setContent('');
      setNotice({
        type: 'info',
        text: t?.knowledgeQueuedTextMsg || 'Queued manual knowledge for indexing.',
      });
      refresh();
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    }
  }

  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/agents/${agent.id}/knowledge/url`, {
        method: 'POST',
        body: { url, crawlType },
      });
      setUrl('');
      setNotice({
        type: 'info',
        text: t?.knowledgeQueuedUrlMsg || 'Queued URL crawl via background worker.',
      });
      refresh();
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiRequest(`/api/agents/${agent.id}/knowledge/upload`, {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      setNotice({
        type: 'info',
        text: `${file.name}: ${t?.knowledgeQueuedUploadMsg || 'Uploaded and queued for indexing.'}`,
      });
      refresh();
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    }
  }

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              {t?.knowledgeTitle || 'Knowledge Base'}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {t?.knowledgeSubtitle ||
                'Index documentation, websites, and FAQs for Hybrid RAG retrieval.'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Button asChild>
              <label className="cursor-pointer">
                <Upload className="size-3.5" aria-hidden="true" />
                <span>{t?.knowledgeUploadBtn || 'Upload PDF / MD / TXT'}</span>
                <input
                  type="file"
                  accept=".pdf,.md,.txt"
                  className="hidden"
                  onChange={handleFile}
                />
              </label>
            </Button>
          </div>
        </div>

        {notice && (
          <Alert
            variant={
              notice.type === 'err' ? 'destructive' : notice.type === 'ok' ? 'success' : 'info'
            }
            className="flex items-center justify-between gap-3"
          >
            <AlertDescription>{notice.text}</AlertDescription>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label={t?.closeNotice || 'Dismiss notice'}
              className="shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 hover:bg-black/5 transition cursor-pointer"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </Alert>
        )}

        {/* Ingestion Forms Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card className="p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <span
                className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <Globe className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  {t?.knowledgeCrawlTitle || 'Crawl URL / Sitemap / llms.txt'}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t?.knowledgeCrawlDesc ||
                    'Import live documentation pages, sitemaps, or llms.txt indexes.'}
                </p>
              </div>
            </div>

            <form onSubmit={addUrl} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="kb-crawl-type">
                    {t?.knowledgeSourceTypeLabel || 'Source type'}
                  </Label>
                  <Select
                    value={crawlType}
                    onValueChange={(v) => setCrawlType(v as 'url' | 'sitemap' | 'llms_txt')}
                  >
                    <SelectTrigger id="kb-crawl-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="url">URL</SelectItem>
                      <SelectItem value="sitemap">sitemap.xml</SelectItem>
                      <SelectItem value="llms_txt">llms.txt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="kb-crawl-url">
                    {t?.knowledgeSourceUrlLabel || 'Source URL'}
                  </Label>
                  <Input
                    id="kb-crawl-url"
                    type="url"
                    required
                    placeholder="https://docs.example.com/llms.txt"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
              </div>

              <Button type="submit">
                <Globe className="size-3.5" aria-hidden="true" />
                <span>{t?.knowledgeStartCrawlBtn || 'Start Crawl'}</span>
              </Button>
            </form>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <span
                className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <FileText className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  {t?.knowledgeManualTitle || 'Manual Text / Q&A'}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t?.knowledgeManualDesc ||
                    'Paste pricing rules, refund policies, or custom FAQs directly.'}
                </p>
              </div>
            </div>

            <form onSubmit={addText} className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="kb-manual-title">
                  {t?.knowledgeDocTitleLabel || 'Document title'}
                </Label>
                <Input
                  id="kb-manual-title"
                  required
                  placeholder={t?.knowledgeDocTitlePh || 'e.g. Pricing & Refund Policy'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="kb-manual-content">
                  {t?.knowledgeDocContentLabel || 'Content'}
                </Label>
                <Textarea
                  id="kb-manual-content"
                  required
                  rows={3}
                  placeholder={
                    t?.knowledgeDocContentPh || 'Paste FAQ, policies, or product rules...'
                  }
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>

              <Button type="submit">
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{t?.knowledgeAddIndexBtn || 'Add & Index'}</span>
              </Button>
            </form>
          </Card>
        </div>

        {/* Indexed Sources Table Card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">
                {t?.knowledgeSourcesTitle || 'Indexed Sources'}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <Badge variant="warning" className="tabular-nums gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  <span>
                    {pendingCount} {t?.knowledgePendingBadge || 'indexing'}
                  </span>
                </Badge>
              )}
              <Badge variant="secondary" className="tabular-nums">
                {readyCount}
              </Badge>
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t?.knowledgeEmptyTitle || 'No knowledge sources yet'}
              hint={
                t?.knowledgeEmptyHint ||
                'Upload a PDF/Markdown file, crawl a URL, or add manual text above to train your agent.'
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t?.knowledgeColTitle || 'Title'}</TableHead>
                  <TableHead>{t?.knowledgeColType || 'Type'}</TableHead>
                  <TableHead>{t?.knowledgeColStatus || 'Status'}</TableHead>
                  <TableHead>{t?.knowledgeColChunks || 'Chunks'}</TableHead>
                  <TableHead className="w-24 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-foreground">{s.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {formatKnowledgeType(s.type, t)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getKnowledgeStatusVariant(s.status)} className="gap-1">
                        {PENDING_KB_STATUSES.has(s.status) && (
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        )}
                        <span>{formatKnowledgeStatus(s.status, t)}</span>
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{s.chunkCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={t?.knowledgeViewEditBtn || 'View / Edit'}
                          aria-label={`${t?.knowledgeEditAria || 'View or edit'} ${s.title}`}
                          onClick={() => openEditSource(s)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t?.knowledgeDeleteAria || 'Delete'} ${s.title}`}
                          onClick={() => setSourcePendingDelete(s)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Collapsible className="border-t border-border bg-muted/20">
            <CollapsibleTrigger className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition cursor-pointer group">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Cpu className="size-3.5" aria-hidden="true" />
                <span>{t?.knowledgeTechDetails || 'Technical details'}</span>
              </span>
              <ChevronDown
                className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-5 pb-3 pt-1 text-xs text-muted-foreground space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  {t?.embeddingModelLabel || 'Embedding model'}:{' '}
                  <code className="font-mono text-foreground">{agent.embeddingModel}</code>
                </span>
                {items.some((s) => s.embeddingDimensions) && (
                  <span>
                    {t?.knowledgeColVector || 'Vector'}:{' '}
                    <code className="font-mono text-foreground">
                      {Array.from(
                        new Set(
                          items
                            .map((s) => s.embeddingDimensions)
                            .filter(Boolean)
                            .map((d) => `${d}d`)
                        )
                      ).join(', ')}
                    </code>
                  </span>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {/* View / Edit Knowledge Source Dialog */}
        <Dialog
          open={Boolean(editingSource)}
          onOpenChange={(open) => {
            if (!open) setEditingSource(null);
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{t?.knowledgeEditTitle || 'Knowledge Source Details'}</DialogTitle>
              <DialogDescription>
                {t?.knowledgeEditDesc ||
                  'Inspect or update this knowledge source. Changing content re-queues indexing.'}
              </DialogDescription>
            </DialogHeader>

            {editingSource && (
              <form onSubmit={handleSaveEdit} className="space-y-4">
                {editError && (
                  <Alert variant="destructive">
                    <AlertDescription>{editError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{formatKnowledgeType(editingSource.type, t)}</Badge>
                  <Badge variant={getKnowledgeStatusVariant(editingSource.status)}>
                    {formatKnowledgeStatus(editingSource.status, t)}
                  </Badge>
                  <span className="text-muted-foreground tabular-nums">
                    {editingSource.chunkCount} {t?.knowledgeColChunks || 'Chunks'}
                  </span>
                  {editingSource.embeddingDimensions && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {editingSource.embeddingDimensions}d
                    </span>
                  )}
                </div>

                {editingSource.errorMessage && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">
                      {editingSource.errorMessage}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="kb-edit-title">
                    {t?.knowledgeDocTitleLabel || 'Document title'}
                  </Label>
                  <Input
                    id="kb-edit-title"
                    required
                    minLength={2}
                    maxLength={200}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>

                {editingSource.type === 'text' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="kb-edit-content">
                        {t?.knowledgeDocContentLabel || 'Content'}
                      </Label>
                      <Textarea
                        id="kb-edit-content"
                        required
                        minLength={10}
                        maxLength={200000}
                        rows={7}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="font-mono text-xs leading-relaxed"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="kb-edit-source-url">
                        {t?.knowledgeSourceUrlOptionalLabel || 'Reference URL (optional)'}
                      </Label>
                      <Input
                        id="kb-edit-source-url"
                        type="url"
                        maxLength={1000}
                        placeholder="https://docs.example.com/..."
                        value={editSourceUrl}
                        onChange={(e) => setEditSourceUrl(e.target.value)}
                      />
                    </div>
                  </>
                ) : editingSource.type === 'url' ||
                  editingSource.type === 'sitemap' ||
                  editingSource.type === 'llms_txt' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="kb-edit-url">
                      {t?.knowledgeSourceUrlLabel || 'Source URL'}
                    </Label>
                    <Input
                      id="kb-edit-url"
                      type="url"
                      required
                      maxLength={1000}
                      value={editSourceUrl}
                      onChange={(e) => setEditSourceUrl(e.target.value)}
                    />
                  </div>
                ) : (
                  isSafeHttpUrl(editingSource.sourceUrl) && (
                    <div className="text-xs text-muted-foreground break-all">
                      <a
                        href={editingSource.sourceUrl.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                        <span>{editingSource.sourceUrl}</span>
                      </a>
                    </div>
                  )
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingSource(null)}
                    disabled={savingEdit}
                  >
                    {t?.cancel || 'Cancel'}
                  </Button>
                  <Button type="submit" disabled={savingEdit}>
                    {savingEdit ? t?.saving || 'Saving...' : t?.knowledgeSaveBtn || 'Save changes'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Knowledge Source Confirmation */}
        <AlertDialog
          open={Boolean(sourcePendingDelete)}
          onOpenChange={(open) => {
            if (!open && !deletingSource) setSourcePendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t?.knowledgeDeleteTitle || 'Delete knowledge source?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t?.knowledgeDeleteDesc ||
                  'This action cannot be undone. The source and all its indexed chunks will be permanently removed:'}{' '}
                <strong className="text-foreground">{sourcePendingDelete?.title}</strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingSource}>
                {t?.cancel || 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleConfirmDelete();
                }}
                disabled={deletingSource}
                className={buttonVariants({ variant: 'destructive' })}
              >
                {t?.knowledgeConfirmDeleteBtn || 'Yes, delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function ToolsMcpView({
  agent,
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t?: Record<string, string>;
}) {
  const [tools, setTools] = useState<any[]>([]);
  const [mcpList, setMcpList] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'PATCH'>('GET');
  const [url, setUrl] = useState('');
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');

  async function refresh() {
    const [tRes, mRes] = await Promise.all([
      apiRequest(`/api/agents/${agent.id}/tools`),
      apiRequest(`/api/agents/${agent.id}/mcp-servers`),
    ]);
    setTools(tRes.items || []);
    setMcpList(mRes.items || []);
  }
  useEffect(() => {
    refresh();
  }, [agent.id]);

  async function createTool(e: React.FormEvent) {
    e.preventDefault();
    await apiRequest(`/api/agents/${agent.id}/tools`, {
      method: 'POST',
      body: { name, description, method, url, requiresConfirmation, parameters: [] },
    });
    setName('');
    setDescription('');
    setUrl('');
    setRequiresConfirmation(false);
    refresh();
  }

  async function runTest(toolId: string) {
    try {
      const res = await apiRequest(`/api/agents/${agent.id}/tools/${toolId}/test`, {
        method: 'POST',
        body: { args: {}, mockSession: { user_id: 'demo-user', email: 'demo@example.com' } },
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ error: (err as Error).message });
    }
  }

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              {t?.toolsTitle || 'Tools Studio & Remote MCP'}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {t?.toolsSubtitle ||
                'Connect custom HTTP APIs and remote MCP servers so your agent can execute live actions.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Badge variant="secondary" className="tabular-nums">
              {tools.length} HTTP
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              {mcpList.length} MCP
            </Badge>
          </div>
        </div>

        {/* Forms Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card className="p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <span
                className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <Wrench className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  {t?.toolsHttpTitle || 'New HTTP Tool'}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t?.toolsHttpDesc ||
                    'Define a REST endpoint the agent can call with session variables.'}
                </p>
              </div>
            </div>

            <form onSubmit={createTool} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tool-method">{t?.toolsMethodLabel || 'Method'}</Label>
                  <Select
                    value={method}
                    onValueChange={(v) => setMethod(v as 'GET' | 'POST' | 'PUT' | 'PATCH')}
                  >
                    <SelectTrigger id="tool-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="tool-name">{t?.toolsNameLabel || 'Tool name'}</Label>
                  <Input
                    id="tool-name"
                    required
                    placeholder="get_order_status"
                    className="font-mono"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tool-url">{t?.toolsEndpointLabel || 'Endpoint URL'}</Label>
                <Input
                  id="tool-url"
                  required
                  type="url"
                  placeholder="https://api.example.com/orders/{{session.user_id}}"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tool-desc">{t?.toolsDescLabel || 'Description for the LLM'}</Label>
                <Input
                  id="tool-desc"
                  required
                  placeholder="Look up the latest order status for the signed-in visitor"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <Checkbox
                  id="tool-requires-confirm"
                  checked={requiresConfirmation}
                  onCheckedChange={(checked) => setRequiresConfirmation(checked === true)}
                />
                <Label htmlFor="tool-requires-confirm" className="font-normal cursor-pointer">
                  {t?.toolsConfirmLabel || 'Require Human-in-the-Loop confirmation in widget'}
                </Label>
              </div>

              <Button type="submit">
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{t?.toolsSaveBtn || 'Save HTTP Tool'}</span>
              </Button>
            </form>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <span
                className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <Server className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  {t?.toolsMcpTitle || 'Remote MCP Server (HTTP/SSE)'}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t?.toolsMcpDesc ||
                    'Connect external Model Context Protocol servers to expose their tools.'}
                </p>
              </div>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiRequest(`/api/agents/${agent.id}/mcp-servers`, {
                  method: 'POST',
                  body: { name: mcpName, url: mcpUrl, headers: {} },
                });
                setMcpName('');
                setMcpUrl('');
                refresh();
              }}
              className="space-y-3.5"
            >
              <div className="space-y-1.5">
                <Label htmlFor="mcp-name">{t?.toolsMcpNameLabel || 'Server name'}</Label>
                <Input
                  id="mcp-name"
                  required
                  placeholder="Billing MCP"
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mcp-url">{t?.toolsMcpUrlLabel || 'Server URL'}</Label>
                <Input
                  id="mcp-url"
                  required
                  type="url"
                  placeholder="https://mcp.example.com/sse"
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                />
              </div>

              <Button type="submit">
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{t?.toolsMcpConnectBtn || 'Connect MCP Server'}</span>
              </Button>
            </form>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t?.toolsMcpConnectedLabel || 'Connected servers'}
                </span>
                <Badge variant="secondary" className="tabular-nums">
                  {mcpList.length}
                </Badge>
              </div>

              {mcpList.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  {t?.toolsMcpEmpty || 'No remote MCP servers connected yet.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {mcpList.map((m) => (
                    <div
                      key={m.id}
                      className="text-xs flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/50 border border-border"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">{m.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate">
                          {m.url}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete MCP server ${m.name}`}
                        onClick={async () => {
                          await apiRequest(`/api/agents/${agent.id}/mcp-servers/${m.id}`, {
                            method: 'DELETE',
                          });
                          refresh();
                        }}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Configured HTTP Tools Card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wrench className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">
                {t?.toolsConfiguredTitle || 'Configured HTTP Tools'}
              </h2>
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {tools.length}
            </Badge>
          </div>

          {tools.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title={t?.toolsConfiguredEmptyTitle || 'No HTTP tools configured yet'}
              hint={
                t?.toolsConfiguredEmptyHint ||
                'Create your first HTTP tool above to let the agent look up orders, create records, or trigger workflows.'
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {tools.map((tool) => (
                <div
                  key={tool.id}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="text-xs font-semibold flex items-center gap-2 flex-wrap">
                      <Badge variant="info" className="font-mono text-[10px]">
                        {tool.method}
                      </Badge>
                      <span className="font-mono text-foreground">{tool.name}</span>
                      {tool.requiresConfirmation && (
                        <Badge variant="warning" className="text-[10px]">
                          {t?.toolsHitlBadge || 'Confirmation required'}
                        </Badge>
                      )}
                    </div>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    )}
                    <div className="text-[11px] font-mono text-muted-foreground truncate">
                      {tool.url}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => runTest(tool.id)}
                    >
                      <Play className="size-3" aria-hidden="true" />
                      <span>{t?.toolsTestBtn || 'Test Tool'}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete tool ${tool.name}`}
                      onClick={async () => {
                        await apiRequest(`/api/agents/${agent.id}/tools/${tool.id}`, {
                          method: 'DELETE',
                        });
                        refresh();
                      }}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {testResult && (
            <div className="p-5 border-t border-border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Terminal className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t?.toolsTestResultTitle || 'Test output'}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t?.close || 'Close'}
                  onClick={() => setTestResult(null)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              <pre className="p-3.5 rounded-xl bg-zinc-950 text-zinc-100 text-[11px] font-mono overflow-x-auto leading-relaxed">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export function ScheduleView({
  agent,
  lang = 'en',
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t?: Record<string, string>;
}) {
  const [data, setData] = useState<{ rules: any[]; blocks: any[]; bookings: any[] }>({
    rules: [],
    blocks: [],
    bookings: [],
  });
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');

  async function refresh() {
    const r = await apiRequest(`/api/agents/${agent.id}/schedule`);
    setData(r);
  }
  useEffect(() => {
    refresh();
  }, [agent.id]);

  const locale = VIEW_LOCALES[lang] || 'en-US';
  const weekdays = WEEKDAY_LABELS[lang] || WEEKDAY_LABELS.en;

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              {t?.scheduleTitle || 'Schedule & Bookings'}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {t?.scheduleSubtitle ||
                'Configure weekly availability windows and manage meetings booked via the widget.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Badge variant="secondary" className="tabular-nums">
              {data.rules.length} {t?.scheduleRulesTitle || 'Weekly Rules'}
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              {data.bookings.length} {t?.scheduleBookingsTitle || 'Bookings'}
            </Badge>
          </div>
        </div>

        {/* Add Availability Rule Card */}
        <Card className="p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <span
              className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Clock className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t?.scheduleAddRuleTitle || 'Add Availability Window'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t?.scheduleAddRuleDesc ||
                  'Set recurring 30-minute booking slots (UTC) for your agent to offer visitors.'}
              </p>
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest(`/api/agents/${agent.id}/availability-rules`, {
                method: 'POST',
                body: { dayOfWeek, startTime, endTime, slotDurationMinutes: 30, timezone: 'UTC' },
              });
              refresh();
            }}
            className="flex flex-wrap items-end gap-3.5"
          >
            <div className="space-y-1.5">
              <Label htmlFor="sched-day">{t?.scheduleDayLabel || 'Day'}</Label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                <SelectTrigger id="sched-day" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekdays.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sched-start">{t?.scheduleStartLabel || 'Start'}</Label>
              <Input
                id="sched-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-32"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sched-end">{t?.scheduleEndLabel || 'End'}</Label>
              <Input
                id="sched-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-32"
              />
            </div>

            <Button type="submit">
              <Plus className="size-3.5" aria-hidden="true" />
              <span>{t?.scheduleAddRuleBtn || 'Add Availability Rule'}</span>
            </Button>
          </form>
        </Card>

        {/* Rules & Bookings Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground">
                  {t?.scheduleRulesTitle || 'Weekly Rules'}
                </h2>
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {data.rules.length}
              </Badge>
            </div>

            {data.rules.length === 0 ? (
              <EmptyState
                icon={Clock}
                title={t?.scheduleRulesEmptyTitle || 'No availability rules yet'}
                hint={
                  t?.scheduleRulesEmptyHint ||
                  'Add at least one weekly window above so visitors can book meetings.'
                }
                compact
              />
            ) : (
              <div className="divide-y divide-border">
                {data.rules.map((r) => (
                  <div
                    key={r.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-muted/30 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Badge variant="outline" className="w-11 justify-center">
                        {weekdays[r.dayOfWeek] ?? `Day ${r.dayOfWeek}`}
                      </Badge>
                      <span className="font-medium text-foreground tabular-nums">
                        {r.startTime}–{r.endTime}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        ({r.slotDurationMinutes}m)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="secondary" className="text-[10px]">
                        {r.timezone}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete availability rule ${weekdays[r.dayOfWeek] ?? r.dayOfWeek} ${r.startTime}-${r.endTime}`}
                        onClick={async () => {
                          await apiRequest(`/api/agents/${agent.id}/availability-rules/${r.id}`, {
                            method: 'DELETE',
                          });
                          refresh();
                        }}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground">
                  {t?.scheduleBookingsTitle || 'Bookings'}
                </h2>
              </div>
              <Badge variant="secondary" className="tabular-nums">
                {data.bookings.length}
              </Badge>
            </div>

            {data.bookings.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title={t?.scheduleBookingsEmptyTitle || 'No bookings yet'}
                hint={
                  t?.scheduleBookingsEmptyHint ||
                  'Confirmed meetings scheduled through your widget will appear here.'
                }
                compact
              />
            ) : (
              <div className="divide-y divide-border">
                {data.bookings.map((b) => (
                  <div
                    key={b.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-muted/30 transition"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{b.visitorName}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {b.visitorEmail}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                        {new Date(b.startsAt).toLocaleString(locale)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button variant="outline" size="xs" asChild>
                        <a href={`/api/widget/${agent.id}/bookings/${b.id}/ics`}>
                          <Download className="size-3" aria-hidden="true" />
                          <span>.ics</span>
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete booking for ${b.visitorName}`}
                        onClick={async () => {
                          await apiRequest(`/api/agents/${agent.id}/bookings/${b.id}`, {
                            method: 'DELETE',
                          });
                          refresh();
                        }}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ProductsView({
  agent,
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t?: Record<string, string>;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceLabel, setPriceLabel] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState('');

  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editPriceLabel, setEditPriceLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCheckoutUrl, setEditCheckoutUrl] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [productPendingDelete, setProductPendingDelete] = useState<any | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);

  async function refresh() {
    const r = await apiRequest(`/api/agents/${agent.id}/products`);
    setItems(r.items || []);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotice(null);
    apiRequest(`/api/agents/${agent.id}/products`)
      .then((r) => {
        if (!cancelled) setItems(r.items || []);
      })
      .catch((err) => {
        if (!cancelled) setNotice({ type: 'err', text: (err as Error).message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  function openEditProduct(p: any) {
    setEditingProduct(p);
    setEditName(p.name || '');
    setEditPriceLabel(p.priceLabel || '');
    setEditDescription(p.description || '');
    setEditCheckoutUrl(p.checkoutUrl || '');
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProduct || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      await apiRequest(`/api/agents/${agent.id}/products/${editingProduct.id}`, {
        method: 'PATCH',
        body: {
          name: editName.trim(),
          priceLabel: editPriceLabel.trim(),
          description: editDescription.trim(),
          checkoutUrl: editCheckoutUrl.trim(),
        },
      });
      setEditingProduct(null);
      setNotice({ type: 'ok', text: t?.productsUpdatedMsg || 'Product card updated.' });
      await refresh().catch(() => undefined);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDelete() {
    if (!productPendingDelete || deletingProduct) return;
    setDeletingProduct(true);
    try {
      await apiRequest(`/api/agents/${agent.id}/products/${productPendingDelete.id}`, {
        method: 'DELETE',
      });
      setProductPendingDelete(null);
      setNotice({ type: 'ok', text: t?.productsDeletedMsg || 'Product card deleted.' });
      await refresh().catch(() => undefined);
    } catch (err) {
      setProductPendingDelete(null);
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setDeletingProduct(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                {t?.productsTitle || 'Products & Checkout Cards'}
              </h1>
              {loading ? (
                <Badge variant="secondary" className="tabular-nums animate-pulse">
                  ...
                </Badge>
              ) : (
                <Badge variant="secondary" className="tabular-nums">
                  {items.length}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t?.productsSubtitle ||
                'Create structured product cards your agent can display inline during sales chats.'}
            </p>
          </div>
        </div>

        {notice && (
          <Alert
            variant={notice.type === 'err' ? 'destructive' : 'success'}
            className="flex items-center justify-between gap-3"
          >
            <AlertDescription>{notice.text}</AlertDescription>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label={t?.closeNotice || 'Dismiss notice'}
              className="shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 hover:bg-black/5 transition cursor-pointer"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </Alert>
        )}

        {/* Add Product Form Card */}
        <Card className="p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <span
              className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <ShoppingBag className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t?.productsAddTitle || 'New Product Card'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t?.productsAddDesc ||
                  'Add a plan or product with pricing and a direct checkout link.'}
              </p>
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting) return;
              setSubmitting(true);
              setNotice(null);
              try {
                await apiRequest(`/api/agents/${agent.id}/products`, {
                  method: 'POST',
                  body: {
                    name: name.trim(),
                    description: description.trim(),
                    priceLabel: priceLabel.trim(),
                    checkoutUrl: checkoutUrl.trim(),
                  },
                });
                setName('');
                setDescription('');
                setPriceLabel('');
                setCheckoutUrl('');
                setNotice({ type: 'ok', text: t?.productsCreatedMsg || 'Product card added.' });
                await refresh().catch(() => undefined);
              } catch (err) {
                setNotice({ type: 'err', text: (err as Error).message });
              } finally {
                setSubmitting(false);
              }
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="prod-name">
                  {t?.productsNameLabel || 'Product / Plan Name'}
                </Label>
                <Input
                  id="prod-name"
                  required
                  placeholder={t?.productsNamePh || 'e.g. Pro Plan'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prod-price">{t?.productsPriceLabel || 'Price label'}</Label>
                <Input
                  id="prod-price"
                  required
                  placeholder={t?.productsPricePh || 'e.g. $49/mo'}
                  value={priceLabel}
                  onChange={(e) => setPriceLabel(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prod-desc">{t?.productsDescLabel || 'Short description'}</Label>
                <Input
                  id="prod-desc"
                  required
                  placeholder={
                    t?.productsDescPh ||
                    'Unlimited conversations, priority support, and custom domain'
                  }
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prod-url">{t?.productsCheckoutLabel || 'Checkout URL'}</Label>
                <Input
                  id="prod-url"
                  required
                  type="url"
                  placeholder={t?.productsCheckoutPh || 'https://checkout.example.com/pro'}
                  value={checkoutUrl}
                  onChange={(e) => setCheckoutUrl(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit" disabled={submitting}>
              <Plus className="size-3.5" aria-hidden="true" />
              <span>{t?.productsAddBtn || 'Add Product Card'}</span>
            </Button>
          </form>
        </Card>

        {/* Product Cards Grid */}
        {loading ? (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            aria-busy="true"
          >
            <span className="sr-only">{t?.productsLoading || 'Loading products...'}</span>
            {[0, 1, 2].map((idx) => (
              <Card key={idx} className="p-5 space-y-3 animate-pulse">
                <div className="h-4 w-2/3 rounded bg-muted" />
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-4/5 rounded bg-muted" />
                <div className="pt-2 border-t border-border space-y-2">
                  <div className="h-5 w-1/3 rounded bg-muted" />
                  <div className="h-3 w-3/4 rounded bg-muted" />
                </div>
              </Card>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={ShoppingBag}
              title={t?.productsEmptyTitle || 'No products configured yet'}
              hint={
                t?.productsEmptyHint ||
                'Add your first product or plan above so your agent can recommend checkout cards in chat.'
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((p) => (
              <Card key={p.id} className="p-5 flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm text-foreground leading-snug">{p.name}</h3>
                    <div className="inline-flex items-center gap-0.5 -mt-1 -mr-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t?.productsEditAria || 'Edit product'} ${p.name}`}
                        onClick={() => openEditProduct(p)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t?.productsDeleteAria || 'Delete product'} ${p.name}`}
                        onClick={() => setProductPendingDelete(p)}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
                </div>

                <div className="pt-2 border-t border-border space-y-2">
                  <div className="text-lg font-semibold tabular-nums text-foreground">
                    {p.priceLabel}
                  </div>
                  {isSafeHttpUrl(p.checkoutUrl) && (
                    <a
                      href={p.checkoutUrl.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 max-w-full"
                    >
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{p.checkoutUrl}</span>
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Edit Product Dialog */}
        <Dialog
          open={Boolean(editingProduct)}
          onOpenChange={(open) => {
            if (!open) setEditingProduct(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t?.productsEditTitle || 'Edit Product Card'}</DialogTitle>
              <DialogDescription>
                {t?.productsEditDesc || 'Update the product details and checkout link.'}
              </DialogDescription>
            </DialogHeader>

            {editingProduct && (
              <form onSubmit={handleSaveEdit} className="space-y-3.5">
                {editError && (
                  <Alert variant="destructive">
                    <AlertDescription>{editError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="prod-edit-name">
                    {t?.productsNameLabel || 'Product / Plan Name'}
                  </Label>
                  <Input
                    id="prod-edit-name"
                    required
                    minLength={2}
                    maxLength={150}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="prod-edit-price">
                    {t?.productsPriceLabel || 'Price label'}
                  </Label>
                  <Input
                    id="prod-edit-price"
                    required
                    minLength={1}
                    maxLength={60}
                    value={editPriceLabel}
                    onChange={(e) => setEditPriceLabel(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="prod-edit-desc">
                    {t?.productsDescLabel || 'Short description'}
                  </Label>
                  <Textarea
                    id="prod-edit-desc"
                    required
                    minLength={5}
                    maxLength={1000}
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="prod-edit-url">
                    {t?.productsCheckoutLabel || 'Checkout URL'}
                  </Label>
                  <Input
                    id="prod-edit-url"
                    required
                    type="url"
                    maxLength={1000}
                    value={editCheckoutUrl}
                    onChange={(e) => setEditCheckoutUrl(e.target.value)}
                  />
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingProduct(null)}
                    disabled={savingEdit}
                  >
                    {t?.cancel || 'Cancel'}
                  </Button>
                  <Button type="submit" disabled={savingEdit}>
                    {savingEdit ? t?.saving || 'Saving...' : t?.productsSaveBtn || 'Save product'}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Product Confirmation */}
        <AlertDialog
          open={Boolean(productPendingDelete)}
          onOpenChange={(open) => {
            if (!open && !deletingProduct) setProductPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t?.productsDeleteTitle || 'Delete this product?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t?.productsDeleteDesc ||
                  'This action cannot be undone. The product card will no longer be recommended by the agent:'}{' '}
                <strong className="text-foreground">{productPendingDelete?.name}</strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingProduct}>
                {t?.cancel || 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleConfirmDelete();
                }}
                disabled={deletingProduct}
                className={buttonVariants({ variant: 'destructive' })}
              >
                {t?.productsConfirmDeleteBtn || 'Yes, delete product'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function TicketsView({
  agent,
  lang = 'en',
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t: Record<string, string>;
}) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');

  async function refresh() {
    const res = await apiRequest(`/api/agents/${agent.id}/tickets`);
    setTickets(res.items || []);
  }
  useEffect(() => {
    refresh();
  }, [agent.id]);

  const openCount = tickets.filter((tk) => tk.status === 'open').length;
  const resolvedCount = tickets.filter((tk) => tk.status === 'resolved').length;
  const filtered = tickets.filter((tk) =>
    statusFilter === 'all' ? true : tk.status === statusFilter
  );
  const locale = VIEW_LOCALES[lang] || 'en-US';

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              {t.ticketsTitle}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">{t.ticketsSubtitle}</p>
          </div>

          <Tabs
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as 'all' | 'open' | 'resolved')}
            className="self-start sm:self-center shrink-0"
          >
            <TabsList>
              <TabsTrigger value="all">
                {t.filterAll} ({tickets.length})
              </TabsTrigger>
              <TabsTrigger value="open">
                {t.filterOpen} ({openCount})
              </TabsTrigger>
              <TabsTrigger value="resolved">
                {t.filterResolved} ({resolvedCount})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={LifeBuoy}
              title={t.noTicketsYet || 'No escalations or support tickets yet.'}
              hint={t.noTicketsHint}
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((tk) => (
              <Card
                key={tk.id}
                className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-foreground">{tk.subject}</h2>
                    <Badge
                      variant={tk.status === 'open' ? 'destructive' : 'success'}
                      className="text-[10px] uppercase"
                    >
                      {tk.status === 'open' ? t.ticketOpen : t.ticketResolved}
                    </Badge>
                    {tk.priority && (
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {tk.priority}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tk.summary}</p>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{tk.visitorEmail}</span>
                    {tk.createdAt && (
                      <span>· {new Date(tk.createdAt).toLocaleString(locale)}</span>
                    )}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={async () => {
                    await apiRequest(`/api/agents/${agent.id}/tickets/${tk.id}`, {
                      method: 'PATCH',
                      body: { status: tk.status === 'open' ? 'resolved' : 'open' },
                    });
                    refresh();
                  }}
                  className="shrink-0"
                >
                  {tk.status === 'open' ? t.markResolved : t.reopenTicket}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function escapeCsvCell(val: unknown): string {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export function LeadsView({
  agent,
  lang = 'en',
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t: Record<string, string>;
}) {
  const [leads, setLeads] = useState<any[]>([]);
  const [query, setQuery] = useState('');

  async function refresh() {
    const res = await apiRequest(`/api/agents/${agent.id}/leads`);
    setLeads(res.items || []);
  }
  useEffect(() => {
    refresh();
  }, [agent.id]);

  const normalized = query.trim().toLowerCase();
  const filtered = leads.filter(
    (ld) =>
      !normalized ||
      String(ld.name || '').toLowerCase().includes(normalized) ||
      String(ld.email || '').toLowerCase().includes(normalized) ||
      String(ld.interest || '').toLowerCase().includes(normalized)
  );
  const locale = VIEW_LOCALES[lang] || 'en-US';

  function handleExportCsv() {
    const header = ['Name', 'Email', 'Interest', 'Created At'];
    const rows = filtered.map((ld) =>
      [ld.name || '', ld.email || '', ld.interest || '', ld.createdAt || '']
        .map(escapeCsvCell)
        .join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `askmink-leads-${agent.id.slice(0, 8)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                {t.leadsTitle}
              </h1>
              <Badge variant="secondary" className="tabular-nums">
                {leads.length}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t.leadsSubtitle}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <div className="relative">
              <Search
                className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label={t.searchLeadsPlaceholder}
                placeholder={t.searchLeadsPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 w-60"
              />
            </div>

            {filtered.length > 0 && (
              <Button type="button" variant="outline" onClick={handleExportCsv}>
                <Download className="size-3.5" aria-hidden="true" />
                <span>{t.exportCsv}</span>
              </Button>
            )}
          </div>
        </div>

        {leads.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title={t.noClientsYet || 'No leads captured yet.'}
              hint={
                t.leadsEmptyHint ||
                'Visitors who share their contact details during widget conversations will appear here.'
              }
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={Search}
              title={t.noLeadsFiltered || 'No leads match your search.'}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((ld) => (
              <Card key={ld.id} className="p-5 flex flex-row items-start gap-3">
                <Avatar className="size-9 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-violet-50 text-violet-600">
                    {String(ld.name || ld.email || '?').slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {ld.name || ld.email}
                  </div>
                  <a
                    href={`mailto:${ld.email}`}
                    className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 truncate max-w-full"
                  >
                    <Mail className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{ld.email}</span>
                  </a>
                  {ld.interest && (
                    <p className="text-xs text-foreground bg-muted/60 border border-border rounded-lg px-2.5 py-1.5 mt-1">
                      {ld.interest}
                    </p>
                  )}
                  {ld.createdAt && (
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {new Date(ld.createdAt).toLocaleString(locale)}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function WebhooksView({
  agent,
  t,
}: {
  agent: any;
  lang?: SupportedLanguage;
  t?: Record<string, string>;
}) {
  const [hooks, setHooks] = useState<any[]>([]);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');

  async function refresh() {
    const r = await apiRequest(`/api/agents/${agent.id}/webhooks`);
    setHooks(r.items || []);
  }
  useEffect(() => {
    refresh();
  }, [agent.id]);

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                {t?.webhooksTitle || 'Outbound Webhooks'}
              </h1>
              <Badge variant="secondary" className="font-mono text-[11px]">
                HMAC-SHA256
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t?.webhooksSubtitle ||
                'Receive HMAC-SHA256 signed HTTP events when tickets, bookings, or leads are created.'}
            </p>
          </div>
        </div>

        {/* Add Webhook Form Card */}
        <Card className="p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <span
              className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Webhook className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t?.webhooksAddTitle || 'Add Webhook Endpoint'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t?.webhooksAddDesc ||
                  'Payloads are signed with your secret and delivered for ticket, booking, and lead events.'}
              </p>
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiRequest(`/api/agents/${agent.id}/webhooks`, {
                method: 'POST',
                body: {
                  url,
                  secret,
                  events: ['ticket.created', 'booking.created', 'lead.captured'],
                },
              });
              setUrl('');
              setSecret('');
              refresh();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-url">{t?.webhooksUrlLabel || 'Endpoint URL'}</Label>
                <Input
                  id="webhook-url"
                  required
                  type="url"
                  placeholder="https://hooks.example.com/askmink"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="webhook-secret">
                  {t?.webhooksSecretLabel || 'HMAC Secret (min 16 chars)'}
                </Label>
                <Input
                  id="webhook-secret"
                  required
                  minLength={16}
                  placeholder="whsec_••••••••••••••••"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit">
              <Plus className="size-3.5" aria-hidden="true" />
              <span>{t?.webhooksAddBtn || 'Add Webhook'}</span>
            </Button>
          </form>
        </Card>

        {/* Configured Webhooks Card */}
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Webhook className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">
                {t?.webhooksListTitle || 'Configured Endpoints'}
              </h2>
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {hooks.length}
            </Badge>
          </div>

          {hooks.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title={t?.webhooksEmptyTitle || 'No webhooks configured yet'}
              hint={
                t?.webhooksEmptyHint ||
                'Add an endpoint URL and signing secret above to stream real-time events to your backend.'
              }
            />
          ) : (
            <div className="divide-y divide-border">
              {hooks.map((h) => (
                <div
                  key={h.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-muted/30 transition"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-xs font-mono font-medium text-foreground truncate">
                      {h.url}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(h.events || []).map((ev: string) => (
                        <Badge key={ev} variant="secondary" className="font-mono text-[10px]">
                          {ev}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete webhook ${h.url}`}
                    onClick={async () => {
                      await apiRequest(`/api/agents/${agent.id}/webhooks/${h.id}`, {
                        method: 'DELETE',
                      });
                      refresh();
                    }}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const PROVIDER_DEFAULT_MODELS: Record<
  string,
  { chat?: string; embedding?: string; baseUrl?: string }
> = {
  'vercel-ai-gateway': {
    chat: 'tencent/hy4-flash',
    embedding: 'alibaba/qwen3-embedding-0.6b',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
  },
  openai: { chat: 'gpt-4o-mini', embedding: 'text-embedding-3-small', baseUrl: '' },
  anthropic: { chat: 'claude-sonnet-4-20250514', baseUrl: '' },
  google: { chat: 'gemini-2.5-flash', embedding: 'text-embedding-004', baseUrl: '' },
  openrouter: { chat: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
  'openai-compatible': { chat: '', embedding: '', baseUrl: '' },
};

const CHAT_PROVIDER_OPTIONS = [
  { value: 'vercel-ai-gateway', label: 'Vercel AI Gateway' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'google', label: 'Google AI Studio (Gemini)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai-compatible', label: 'OpenAI-Compatible (Ollama / LM Studio)' },
] as const;

const EMBEDDING_PROVIDER_OPTIONS = [
  { value: 'vercel-ai-gateway', label: 'Vercel AI Gateway' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google AI Studio (Gemini)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai-compatible', label: 'OpenAI-Compatible (Ollama / LM Studio)' },
] as const;

function ByokPurposeCard({
  purpose,
  settings,
  keys,
  t,
  onSaved,
  onNotify,
}: {
  purpose: 'chat' | 'embedding';
  settings: any;
  keys: any[];
  t?: Record<string, string>;
  onSaved: () => Promise<void> | void;
  onNotify: (msg: string) => void;
}) {
  const isChat = purpose === 'chat';
  const activeKeyId = isChat
    ? settings?.chatProviderKeyId || ''
    : settings?.embeddingProviderKeyId || '';
  const activeKey = keys.find((k) => k.id === activeKeyId) || null;
  const activeModelFromServer = isChat
    ? settings?.chatModel || 'tencent/hy4-flash'
    : settings?.embeddingModel || 'alibaba/qwen3-embedding-0.6b';

  const [provider, setProvider] = useState(activeKey?.provider || 'openai');
  const [label, setLabel] = useState(isChat ? 'Primary Chat Key' : 'Primary Embedding Key');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(activeKey?.baseUrl || '');
  const [model, setModel] = useState(activeModelFromServer);
  const [saving, setSaving] = useState(false);
  const [reindexPending, setReindexPending] = useState<{
    message: string;
    targetModel: string;
    pendingKeyId?: string;
  } | null>(null);

  useEffect(() => {
    setModel(activeModelFromServer);
    if (activeKey) {
      setProvider(activeKey.provider);
      setBaseUrl(activeKey.baseUrl || PROVIDER_DEFAULT_MODELS[activeKey.provider]?.baseUrl || '');
    }
  }, [activeModelFromServer, activeKey?.id]);

  function handleProviderChange(nextProvider: string) {
    setProvider(nextProvider);
    const meta = PROVIDER_DEFAULT_MODELS[nextProvider];
    setBaseUrl(meta?.baseUrl ?? '');
    const defaultForPurpose = isChat ? meta?.chat : meta?.embedding;
    if (defaultForPurpose) {
      setModel(defaultForPurpose);
    }
    if (label.startsWith('Primary ') || label.endsWith(' Key')) {
      setLabel(`${nextProvider} (${isChat ? 'Chat' : 'Embedding'})`);
    }
  }

  async function submitConfig(confirmReindex = false, explicitKeyId?: string) {
    setSaving(true);
    setReindexPending(null);
    try {
      let targetKeyId = explicitKeyId;
      const trimmedKey = apiKey.trim();

      if (!targetKeyId && trimmedKey.length > 0) {
        const res = await apiRequest<{ item: { id: string } }>('/api/provider-keys', {
          method: 'POST',
          body: {
            provider,
            purpose,
            label: label.trim() || `${provider} (${purpose})`,
            apiKey: trimmedKey,
            baseUrl: baseUrl.trim() || undefined,
            activate: true,
          },
        });
        targetKeyId = res.item?.id;
        setApiKey('');
      }

      const patch: Record<string, unknown> = isChat
        ? {
            ...(targetKeyId ? { chatProviderKeyId: targetKeyId } : {}),
            ...(model.trim() ? { chatModel: model.trim() } : {}),
          }
        : {
            ...(targetKeyId ? { embeddingProviderKeyId: targetKeyId } : {}),
            ...(model.trim() ? { embeddingModel: model.trim() } : {}),
            confirmReindex,
          };

      await apiRequest('/api/account/ai-settings', {
        method: 'PATCH',
        body: patch,
      });

      onNotify(
        isChat
          ? t?.byokSavedChatMsg || 'Global account Chat key & model saved for all agents.'
          : confirmReindex
            ? t?.byokSavedEmbeddingReindexMsg ||
              'Global Embedding key saved and full knowledge re-index queued.'
            : t?.byokSavedEmbeddingMsg ||
              'Global account Embedding key & model saved for all agents.'
      );
      await onSaved();
    } catch (err: any) {
      if (!isChat && err.status === 409 && err.data?.error === 'EMBEDDING_REINDEX_REQUIRED') {
        setReindexPending({
          message: err.data.message,
          targetModel: model.trim(),
          pendingKeyId: explicitKeyId,
        });
        await onSaved();
      } else {
        onNotify(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function activateSavedKey(keyItem: any) {
    const meta = PROVIDER_DEFAULT_MODELS[keyItem.provider];
    const nextModel = (isChat ? meta?.chat : meta?.embedding) || model;
    if (nextModel) setModel(nextModel);

    setSaving(true);
    setReindexPending(null);
    try {
      const patch: Record<string, unknown> = isChat
        ? { chatProviderKeyId: keyItem.id, ...(nextModel ? { chatModel: nextModel } : {}) }
        : {
            embeddingProviderKeyId: keyItem.id,
            ...(nextModel ? { embeddingModel: nextModel } : {}),
            confirmReindex: false,
          };
      await apiRequest('/api/account/ai-settings', {
        method: 'PATCH',
        body: patch,
      });
      onNotify(
        t?.byokActivatedKeyMsg
          ? `${t.byokActivatedKeyMsg} (${keyItem.label})`
          : `Activated "${keyItem.label}" globally for the entire account.`
      );
      await onSaved();
    } catch (err: any) {
      if (!isChat && err.status === 409 && err.data?.error === 'EMBEDDING_REINDEX_REQUIRED') {
        setReindexPending({
          message: err.data.message,
          targetModel: nextModel,
          pendingKeyId: keyItem.id,
        });
      } else {
        onNotify(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  const providerOptions = isChat ? CHAT_PROVIDER_OPTIONS : EMBEDDING_PROVIDER_OPTIONS;
  const idPrefix = `byok-${purpose}`;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {isChat
              ? t?.byokChatCardTitle || 'Chat Model Key (BYOK)'
              : t?.byokEmbeddingCardTitle || 'Embedding Model Key (BYOK)'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isChat
              ? t?.byokChatCardDesc || 'Used by all agents in your account to generate answers.'
              : t?.byokEmbeddingCardDesc ||
                'Used for knowledge indexing & search. Can be from a different provider than Chat.'}
          </p>
        </div>
        <Badge
          variant={activeKey ? 'success' : settings?.gatewayConfigured ? 'info' : 'warning'}
          className="shrink-0"
        >
          {activeKey ? (
            <>
              <CheckCircle2 className="size-3" aria-hidden="true" />
              <span>
                {activeKey.provider} ••••{activeKey.keyLast4}
              </span>
            </>
          ) : settings?.gatewayConfigured ? (
            <span>{t?.byokStatusGateway || 'Server AI Gateway active'}</span>
          ) : (
            <span>{t?.byokStatusMissing || 'No BYOK key active'}</span>
          )}
        </Badge>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitConfig(false);
        }}
        className="space-y-3.5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-provider`} className="text-[11px]">
              {t?.byokProviderLabel || 'Provider'}
            </Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger id={`${idPrefix}-provider`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-label`} className="text-[11px]">
              {t?.byokKeyLabelField || 'Key label'}
            </Label>
            <Input
              id={`${idPrefix}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-apikey`} className="text-[11px]">
            {t?.byokApiKeyField || 'API Key (AES-256-GCM encrypted)'}
          </Label>
          <Input
            id={`${idPrefix}-apikey`}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              activeKey
                ? t?.byokApiKeyOptionalPh || 'Enter new API key (leave blank to keep active key)'
                : 'sk-...'
            }
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-model`} className="text-[11px]">
              {isChat
                ? t?.byokChatModelField || 'Chat model'
                : t?.byokEmbeddingModelField || 'Embedding model (native multi-dim)'}
            </Label>
            <Input
              id={`${idPrefix}-model`}
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-baseurl`} className="text-[11px]">
              {t?.byokBaseUrlField || 'Base URL (optional)'}
            </Label>
            <Input
              id={`${idPrefix}-baseurl`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        {reindexPending && (
          <Alert variant="warning" className="space-y-2">
            <AlertTitle>
              {t?.byokReindexWarningTitle || 'Re-indexing required for new embedding model'}
            </AlertTitle>
            <AlertDescription>{reindexPending.message}</AlertDescription>
            <Button
              type="button"
              size="xs"
              disabled={saving}
              onClick={() => submitConfig(true, reindexPending.pendingKeyId)}
              className="bg-amber-800 hover:bg-amber-900 text-white"
            >
              {t?.byokConfirmReindex || 'Confirm & Reindex All Knowledge'}
            </Button>
          </Alert>
        )}

        <Button type="submit" disabled={saving}>
          {isChat
            ? t?.byokSaveChat || 'Save Chat Configuration'
            : t?.byokSaveEmbedding || 'Save Embedding Configuration'}
        </Button>
      </form>

      {keys.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t?.byokSavedKeysLabel || 'Saved keys'} ({keys.length})
            </div>
            {keys.map((k) => {
              const isActive = k.id === activeKeyId;
              return (
                <div
                  key={k.id}
                  className={cn(
                    'text-xs flex items-center justify-between gap-2 p-2.5 rounded-lg border',
                    isActive
                      ? 'bg-emerald-50/50 border-emerald-200'
                      : 'bg-muted/50 border-border'
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{k.label}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {k.provider} · ••••{k.keyLast4}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isActive ? (
                      <Badge variant="success" className="text-[10px]">
                        {t?.byokActiveBadge || 'Active'}
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={saving}
                        onClick={() => activateSavedKey(k)}
                      >
                        {t?.byokActivateBtn || 'Activate'}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${k.label}`}
                      onClick={async () => {
                        await apiRequest(`/api/provider-keys/${k.id}`, { method: 'DELETE' });
                        await onSaved();
                      }}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

export function SettingsByokView({
  t,
  onAccountUpdated,
}: {
  t?: Record<string, string>;
  onAccountUpdated: () => void;
}) {
  const [settings, setSettings] = useState<any>(null);
  const [keys, setKeys] = useState<any[]>([]);
  const [notice, setNotice] = useState('');

  async function refresh() {
    const r = await apiRequest<{ settings: any; keys: any[] }>('/api/account/ai-settings');
    setSettings(r.settings);
    setKeys(r.keys || []);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function handleAccountSaved() {
    await refresh();
    onAccountUpdated();
  }

  const chatKeys = keys.filter((k) => k.purpose === 'chat');
  const embeddingKeys = keys.filter((k) => k.purpose === 'embedding');

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              {t?.byokGlobalTitle || 'Account BYOK Providers & Models'}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {t?.byokGlobalSubtitle ||
                'Configure API keys once for your whole account. Chat and Embedding models can use different providers.'}
            </p>
          </div>
        </div>

        {notice && (
          <Alert variant="info">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <ByokPurposeCard
            purpose="chat"
            settings={settings}
            keys={chatKeys}
            t={t}
            onSaved={handleAccountSaved}
            onNotify={setNotice}
          />
          <ByokPurposeCard
            purpose="embedding"
            settings={settings}
            keys={embeddingKeys}
            t={t}
            onSaved={handleAccountSaved}
            onNotify={setNotice}
          />
        </div>
      </div>
    </div>
  );
}

export function AccountSettingsView({
  t,
  onAccountUpdated,
}: {
  t?: Record<string, string>;
  onAccountUpdated: () => Promise<void> | void;
}) {
  const [domainsText, setDomainsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ settings: { allowedDomains?: string[] } }>('/api/account/settings')
      .then((res) => {
        const list = Array.isArray(res.settings?.allowedDomains)
          ? res.settings.allowedDomains
          : [];
        setDomainsText(list.join('\n'));
      })
      .catch((err) => {
        setNotice({ type: 'err', text: (err as Error).message });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!notice || notice.type !== 'ok') return;
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => {
      setJustSaved(false);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  const parsedDomains = domainsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  async function handleSaveDomains(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    setJustSaved(false);
    try {
      const res = await apiRequest<{ settings: { allowedDomains: string[] } }>(
        '/api/account/settings',
        {
          method: 'PATCH',
          body: { allowedDomains: parsedDomains },
        }
      );
      setDomainsText((res.settings?.allowedDomains || []).join('\n'));
      setNotice({
        type: 'ok',
        text: t?.globalDomainsSavedMsg || 'Allowed domains updated globally for all agents.',
      });
      setJustSaved(true);
      await Promise.resolve(onAccountUpdated()).catch(() => undefined);
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {t?.accountSettingsTitle || 'Account Settings'}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t?.accountSettingsSubtitle ||
              'Manage global settings applied to all agents in your account.'}
          </p>
        </div>

        {notice && (
          <Alert
            variant={notice.type === 'ok' ? 'success' : 'destructive'}
            role={notice.type === 'err' ? 'alert' : 'status'}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              {notice.type === 'ok' && (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              )}
              <AlertDescription className="font-medium">{notice.text}</AlertDescription>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label={t?.closeNotice || 'Dismiss notice'}
              className="shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 hover:bg-black/5 transition cursor-pointer"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </Alert>
        )}

        <Card className="p-5">
          <form onSubmit={handleSaveDomains} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span
                  className="size-8 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center shrink-0 mt-0.5"
                  aria-hidden="true"
                >
                  <Globe className="size-4" />
                </span>
                <div className="min-w-0">
                  <Label
                    htmlFor="account-allowed-domains"
                    className="text-sm font-semibold text-foreground"
                  >
                    {t?.globalDomainsTitle || 'Allowed Domains'}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t?.globalDomainsSubtitle ||
                      'Authorized origins allowed to embed any agent in this account (one per line).'}
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {parsedDomains.length}
              </Badge>
            </div>

            <div className="space-y-1.5">
              <Textarea
                id="account-allowed-domains"
                name="allowed_domains"
                rows={6}
                disabled={loading}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={'https://seusite.com.br\nhttp://localhost:5173'}
                value={domainsText}
                onChange={(e) => {
                  setDomainsText(e.target.value);
                  setJustSaved(false);
                }}
                aria-describedby="account-allowed-domains-hint"
                className="font-mono text-xs leading-relaxed"
              />
              <p id="account-allowed-domains-hint" className="text-[11px] text-muted-foreground">
                {t?.globalDomainsHint ||
                  'Example: https://yourdomain.com (include protocol http:// or https://).'}
              </p>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={loading || saving}>
                {justSaved && !saving && (
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                )}
                <span>
                  {saving
                    ? t?.saving || 'Saving...'
                    : justSaved
                      ? t?.savedShort || 'Saved!'
                      : t?.byokSaveDomains || 'Save Domains'}
                </span>
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function AccountProfileView({
  t,
  onProfileUpdated,
  onNavigateToByok,
  onLogout,
}: {
  t?: Record<string, string>;
  onProfileUpdated?: (profile: { name: string }) => void;
  onNavigateToByok?: () => void;
  onLogout?: () => void;
}) {
  const [profile, setProfile] = useState<any>(null);
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    apiRequest<{ profile: any }>('/api/account/profile')
      .then((res) => {
        setProfile(res.profile);
        setName(res.profile?.name || '');
        setWorkspaceName(res.profile?.workspaceName || '');
      })
      .catch((err) => setNotice({ type: 'err', text: (err as Error).message }));
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setNotice(null);
    try {
      const res = await apiRequest<{ profile: any }>('/api/account/profile', {
        method: 'PATCH',
        body: {
          name: name.trim(),
          ...(workspaceName.trim() ? { workspaceName: workspaceName.trim() } : {}),
        },
      });
      setProfile((prev: any) => ({ ...prev, ...res.profile }));
      onProfileUpdated?.({ name: res.profile.name });
      setNotice({ type: 'ok', text: t?.profileSavedMsg || 'Profile updated successfully.' });
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPw(true);
    setNotice(null);
    try {
      await apiRequest('/api/account/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setNotice({ type: 'ok', text: t?.profilePwUpdatedMsg || 'Password updated successfully.' });
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              {t?.profileTitle || 'Account Profile'}
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              {t?.profileSubtitle ||
                'Manage your personal details, workspace name, and account security.'}
            </p>
          </div>
          {onNavigateToByok && (
            <Button
              type="button"
              variant="outline"
              onClick={onNavigateToByok}
              className="self-start sm:self-center shrink-0"
            >
              <KeyRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{t?.profileQuickByokBtn || 'Manage Global BYOK Keys'}</span>
            </Button>
          )}
        </div>

        {notice && (
          <Alert variant={notice.type === 'ok' ? 'success' : 'destructive'}>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}

        {/* Summary Header Card */}
        <Card className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <Avatar className="size-12">
              <AvatarFallback className="bg-primary text-primary-foreground text-base font-semibold">
                {(profile?.name || 'U').slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {profile?.name || '—'}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {profile?.email || '—'}
              </div>
            </div>
          </div>

          <dl className="flex flex-wrap gap-5 text-xs">
            <div>
              <dt className="text-[11px] text-muted-foreground">
                {t?.profileRoleLabel || 'Role'}
              </dt>
              <dd className="font-semibold text-foreground uppercase mt-0.5">
                {profile?.role || 'owner'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">
                {t?.profileAuthMethodLabel || 'Authentication'}
              </dt>
              <dd className="font-semibold text-foreground uppercase mt-0.5">
                {profile?.authProvider || 'local'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">
                {t?.profileAgentsCountLabel || 'Active agents'}
              </dt>
              <dd className="font-semibold text-foreground tabular-nums mt-0.5">
                {profile?.agentsCount ?? 0}
              </dd>
            </div>
          </dl>
        </Card>

        {/* Personal & Workspace Form */}
        <Card className="p-5">
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="flex items-center gap-2">
              <User className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">
                {t?.profileTitle || 'Account Profile'}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">{t?.profileNameLabel || 'Full name'}</Label>
                <Input
                  id="profile-name"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-email">{t?.profileEmailLabel || 'Email address'}</Label>
                <Input
                  id="profile-email"
                  readOnly
                  value={profile?.email || ''}
                  className="bg-muted text-muted-foreground"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-workspace">
                {t?.profileWorkspaceLabel || 'Workspace name'}
              </Label>
              <Input
                id="profile-workspace"
                minLength={2}
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                disabled={profile?.role !== 'owner' && profile?.role !== 'admin'}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <Button type="submit" disabled={savingProfile}>
                {t?.profileSaveBtn || 'Save Profile'}
              </Button>

              {onLogout && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onLogout}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  {t?.logout || 'Sign out'}
                </Button>
              )}
            </div>
          </form>
        </Card>

        {/* Change Password */}
        {profile?.authProvider === 'local' && (
          <Card className="p-5">
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t?.profileSecurityTitle || 'Change Password'}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t?.profileSecuritySubtitle || 'Use at least 8 characters (12+ recommended).'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-curr-pw">
                    {t?.profileCurrentPw || 'Current password'}
                  </Label>
                  <Input
                    id="profile-curr-pw"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-new-pw">{t?.profileNewPw || 'New password'}</Label>
                  <Input
                    id="profile-new-pw"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>

              <Button type="submit" disabled={savingPw}>
                {t?.profileUpdatePwBtn || 'Update Password'}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
