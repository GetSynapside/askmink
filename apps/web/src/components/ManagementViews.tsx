import { useEffect, useState } from 'react';
import { Download, Mail, Play, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '../lib/api';

export function InboxView({ agent }: { agent: any }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    const q = filter ? `?status=${filter}` : '';
    apiRequest(`/api/agents/${agent.id}/conversations${q}`).then((r) => setItems(r.items || []));
  }, [agent.id, filter]);

  async function openConv(id: string) {
    const detail = await apiRequest(`/api/conversations/${id}`);
    setSelected(detail);
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className="w-80 border-r border-[#EAECEF] bg-white flex flex-col">
        <div className="p-3 border-b border-[#EAECEF] flex gap-1.5 flex-wrap">
          {([
            ['', 'All'],
            ['resolved_ai', 'Resolved AI'],
            ['ticket_open', 'Ticket'],
            ['lead_booked', 'Lead/Booked'],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                filter === val ? 'bg-[#18181B] text-white border-[#18181B]' : 'border-[#EAECEF] text-[#6B7280]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[#F3F4F6]">
          {items.map((c) => (
            <button
              key={c.id}
              onClick={() => openConv(c.id)}
              className="w-full p-3 text-left hover:bg-[#F8F9FB]"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#111827]">{c.visitorEmail || c.pageUrl}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#374151]">
                  {c.mode}
                </span>
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                {c.messageCount} msgs · {c.status}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {!selected ? (
          <div className="text-xs text-[#9CA3AF]">Select a conversation to view transcript and traces.</div>
        ) : (
          <>
            <h3 className="text-sm font-semibold">
              Conversation {selected.conversation.id.slice(0, 8)} ({selected.conversation.mode})
            </h3>
            <div className="space-y-2.5">
              {selected.messages.map((m: any) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-xl text-xs max-w-2xl ${
                    m.role === 'user' ? 'bg-[#18181B] text-white ml-auto' : 'bg-white border border-[#EAECEF]'
                  }`}
                >
                  {m.content}
                </div>
              ))}
            </div>
            <div className="pt-4 border-t border-[#EAECEF]">
              <h4 className="text-xs font-semibold mb-2">Execution Traces ({selected.traces.length})</h4>
              <pre className="p-3 rounded-xl bg-[#111827] text-[#E5E7EB] text-[11px] font-mono overflow-x-auto">
                {JSON.stringify(selected.traces, null, 2)}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function KnowledgeView({ agent }: { agent: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [crawlType, setCrawlType] = useState<'url' | 'sitemap' | 'llms_txt'>('url');
  const [msg, setMsg] = useState('');

  async function refresh() {
    const r = await apiRequest(`/api/agents/${agent.id}/knowledge`);
    setItems(r.items || []);
  }
  useEffect(() => {
    refresh();
  }, [agent.id]);

  async function addText(e: React.FormEvent) {
    e.preventDefault();
    await apiRequest(`/api/agents/${agent.id}/knowledge/text`, {
      method: 'POST',
      body: { title, content },
    });
    setTitle('');
    setContent('');
    setMsg('Queued manual knowledge for indexing.');
    refresh();
  }

  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    await apiRequest(`/api/agents/${agent.id}/knowledge/url`, {
      method: 'POST',
      body: { url, crawlType },
    });
    setUrl('');
    setMsg('Queued URL crawl via pg-boss.');
    refresh();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    await apiRequest(`/api/agents/${agent.id}/knowledge/upload`, {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
    setMsg(`Uploaded ${file.name} and queued indexing.`);
    refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Knowledge Base (Hybrid RAG)</h2>
          <p className="text-xs text-[#6B7280]">
            Active embedding model: <code className="font-mono">{agent.embeddingModel}</code>
          </p>
        </div>
        <label className="px-3.5 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium cursor-pointer inline-flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5" /> Upload PDF / MD / TXT
          <input type="file" accept=".pdf,.md,.txt" className="hidden" onChange={handleFile} />
        </label>
      </div>

      {msg && <div className="text-xs bg-[#EFF6FF] text-[#1D4ED8] px-3 py-2 rounded-lg">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={addUrl} className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">Crawl URL / Sitemap / llms.txt</h3>
          <div className="flex gap-2">
            <select
              className="text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB]"
              value={crawlType}
              onChange={(e) => setCrawlType(e.target.value as any)}
            >
              <option value="url">URL</option>
              <option value="sitemap">sitemap.xml</option>
              <option value="llms_txt">llms.txt</option>
            </select>
            <input
              type="url"
              required
              placeholder="https://docs.example.com/llms.txt"
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <button className="px-3 py-1.5 rounded-lg bg-[#18181B] text-white text-xs font-medium">
            Start Crawl
          </button>
        </form>

        <form onSubmit={addText} className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">Manual Text / Q&amp;A</h3>
          <input
            required
            placeholder="Title (e.g. Pricing & Refund Policy)"
            className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            required
            rows={3}
            placeholder="Paste FAQ, policies, or product rules..."
            className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button className="px-3 py-1.5 rounded-lg bg-[#18181B] text-white text-xs font-medium">
            Add &amp; Index
          </button>
        </form>
      </div>

      <div className="bg-white border border-[#EAECEF] rounded-xl overflow-hidden">
        <table className="w-full text-xs text-left">
          <thead className="bg-[#F8F9FB] border-b border-[#EAECEF] text-[#6B7280]">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">Type</th>
              <th className="p-3">Status</th>
              <th className="p-3">Chunks</th>
              <th className="p-3">Vector</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {items.map((s) => (
              <tr key={s.id}>
                <td className="p-3 font-medium text-[#111827]">{s.title}</td>
                <td className="p-3 text-[#6B7280]">{s.type}</td>
                <td className="p-3">
                  <span className="px-2 py-0.5 rounded-full bg-[#F3F4F6] font-medium">{s.status}</span>
                </td>
                <td className="p-3 tabular-nums">{s.chunkCount}</td>
                <td className="p-3 font-mono text-[11px]">
                  {s.embeddingDimensions ? `${s.embeddingDimensions}d` : '—'}
                </td>
                <td className="p-3 text-right">
                  <button
                    onClick={async () => {
                      await apiRequest(`/api/agents/${agent.id}/knowledge/${s.id}`, { method: 'DELETE' });
                      refresh();
                    }}
                    className="text-[#9CA3AF] hover:text-[#EF4444]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ToolsMcpView({ agent }: { agent: any }) {
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
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-lg font-semibold">Tools Studio &amp; Remote MCP</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={createTool} className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">New HTTP Tool</h3>
          <div className="grid grid-cols-3 gap-2">
            <select
              className="text-xs px-2 py-2 rounded-lg border border-[#E5E7EB]"
              value={method}
              onChange={(e) => setMethod(e.target.value as any)}
            >
              <option>GET</option>
              <option>POST</option>
              <option>PUT</option>
              <option>PATCH</option>
            </select>
            <input
              required
              placeholder="tool_name"
              className="col-span-2 text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <input
            required
            type="url"
            placeholder="https://api.example.com/orders/{{session.user_id}}"
            className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            required
            placeholder="Description for the LLM"
            className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs text-[#374151]">
            <input
              type="checkbox"
              checked={requiresConfirmation}
              onChange={(e) => setRequiresConfirmation(e.target.checked)}
            />
            Require Human-in-the-Loop confirmation in widget
          </label>
          <button className="px-3.5 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Save HTTP Tool
          </button>
        </form>

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
          className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold">Remote MCP Server (HTTP/SSE)</h3>
          <input
            required
            placeholder="Server Name (e.g. Billing MCP)"
            className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
            value={mcpName}
            onChange={(e) => setMcpName(e.target.value)}
          />
          <input
            required
            type="url"
            placeholder="https://mcp.example.com/sse"
            className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
          />
          <button className="px-3.5 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium">
            Connect MCP Server
          </button>
          <div className="pt-2 space-y-1.5">
            {mcpList.map((m) => (
              <div key={m.id} className="text-xs flex items-center justify-between p-2 rounded-lg bg-[#F8F9FB]">
                <span className="font-medium">{m.name}</span>
                <span className="font-mono text-[11px] text-[#6B7280] truncate max-w-[200px]">{m.url}</span>
              </div>
            ))}
          </div>
        </form>
      </div>

      <div className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold">Configured HTTP Tools</h3>
        {tools.map((tool) => (
          <div key={tool.id} className="flex items-center justify-between p-3 rounded-xl border border-[#EAECEF]">
            <div>
              <div className="text-xs font-semibold">
                <span className="font-mono text-[#2563EB] mr-2">{tool.method}</span>
                {tool.name}
              </div>
              <div className="text-[11px] text-[#6B7280]">{tool.url}</div>
            </div>
            <button
              onClick={() => runTest(tool.id)}
              className="px-3 py-1.5 rounded-lg border border-[#EAECEF] hover:bg-[#F3F4F6] text-xs font-medium inline-flex items-center gap-1"
            >
              <Play className="w-3 h-3" /> Test Tool
            </button>
          </div>
        ))}
        {testResult && (
          <pre className="p-3 rounded-xl bg-[#111827] text-[#E5E7EB] text-[11px] font-mono overflow-x-auto">
            {JSON.stringify(testResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function ScheduleView({ agent }: { agent: any }) {
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

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-lg font-semibold">Native Schedule &amp; Bookings</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await apiRequest(`/api/agents/${agent.id}/availability-rules`, {
            method: 'POST',
            body: { dayOfWeek, startTime, endTime, slotDurationMinutes: 30, timezone: 'UTC' },
          });
          refresh();
        }}
        className="bg-white border border-[#EAECEF] rounded-xl p-4 flex flex-wrap items-end gap-3"
      >
        <div>
          <label className="block text-[11px] text-[#6B7280] mb-1">Day</label>
          <select
            className="text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB]"
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
          >
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-[#6B7280] mb-1">Start</label>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB]" />
        </div>
        <div>
          <label className="block text-[11px] text-[#6B7280] mb-1">End</label>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB]" />
        </div>
        <button className="px-3.5 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium">
          Add Availability Rule
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold">Weekly Rules ({data.rules.length})</h3>
          {data.rules.map((r) => (
            <div key={r.id} className="text-xs flex justify-between p-2 rounded-lg bg-[#F8F9FB]">
              <span>Day {r.dayOfWeek} · {r.startTime}–{r.endTime} ({r.slotDurationMinutes}m)</span>
              <span className="text-[#6B7280]">{r.timezone}</span>
            </div>
          ))}
        </div>
        <div className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold">Bookings ({data.bookings.length})</h3>
          {data.bookings.map((b) => (
            <div key={b.id} className="text-xs flex items-center justify-between p-2.5 rounded-lg bg-[#F8F9FB]">
              <div>
                <div className="font-medium">{b.visitorName} ({b.visitorEmail})</div>
                <div className="text-[11px] text-[#6B7280]">{new Date(b.startsAt).toLocaleString()}</div>
              </div>
              <a
                href={`/api/widget/${agent.id}/bookings/${b.id}/ics`}
                className="text-[#2563EB] hover:underline font-medium"
              >
                .ics
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProductsView({ agent }: { agent: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceLabel, setPriceLabel] = useState('$49/mo');
  const [checkoutUrl, setCheckoutUrl] = useState('');

  async function refresh() {
    const r = await apiRequest(`/api/agents/${agent.id}/products`);
    setItems(r.items || []);
  }
  useEffect(() => {
    refresh();
  }, [agent.id]);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-lg font-semibold">Products &amp; Checkout Cards</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await apiRequest(`/api/agents/${agent.id}/products`, {
            method: 'POST',
            body: { name, description, priceLabel, checkoutUrl },
          });
          setName('');
          setDescription('');
          setCheckoutUrl('');
          refresh();
        }}
        className="bg-white border border-[#EAECEF] rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3"
      >
        <input required placeholder="Product / Plan Name" value={name} onChange={(e) => setName(e.target.value)} className="text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
        <input required placeholder="Price label ($49/mo)" value={priceLabel} onChange={(e) => setPriceLabel(e.target.value)} className="text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
        <input required placeholder="Short description" value={description} onChange={(e) => setDescription(e.target.value)} className="text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
        <input required type="url" placeholder="https://buy.stripe.com/..." value={checkoutUrl} onChange={(e) => setCheckoutUrl(e.target.value)} className="text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
        <button className="md:col-span-2 justify-self-start px-4 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium">
          Add Product Card
        </button>
      </form>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((p) => (
          <div key={p.id} className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-2">
            <div className="font-semibold text-sm">{p.name}</div>
            <div className="text-xs text-[#6B7280]">{p.description}</div>
            <div className="text-lg font-bold tabular-nums">{p.priceLabel}</div>
            <a href={p.checkoutUrl} target="_blank" rel="noreferrer" className="text-xs text-[#2563EB] hover:underline block truncate">
              {p.checkoutUrl}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

const VIEW_LOCALES: Record<SupportedLanguage, string> = {
  en: 'en-US',
  pt: 'pt-BR',
  es: 'es-ES',
};

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
    <div className="flex-1 overflow-y-auto sidebar-scroll p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#111827]">{t.ticketsTitle}</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">{t.ticketsSubtitle}</p>
          </div>

          <div className="inline-flex p-0.5 rounded-lg bg-white border border-[#EAECEF] self-start">
            {(
              [
                { id: 'all', label: `${t.filterAll} (${tickets.length})` },
                { id: 'open', label: `${t.filterOpen} (${openCount})` },
                { id: 'resolved', label: `${t.filterResolved} (${resolvedCount})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={statusFilter === f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  statusFilter === f.id
                    ? 'bg-[#18181B] text-white'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-[#EAECEF] rounded-xl p-10 text-center space-y-1.5">
            <p className="text-xs font-medium text-[#374151]">{t.noTicketsYet}</p>
            <p className="text-xs text-[#6B7280]">{t.noTicketsHint}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((tk) => (
              <article
                key={tk.id}
                className="bg-white border border-[#EAECEF] rounded-xl p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-[#111827]">{tk.subject}</h2>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                        tk.status === 'open'
                          ? 'bg-[#FEF2F2] text-[#B91C1C]'
                          : 'bg-[#ECFDF5] text-[#047857]'
                      }`}
                    >
                      {tk.status === 'open' ? t.ticketOpen : t.ticketResolved}
                    </span>
                    {tk.priority && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#4B5563] uppercase font-medium">
                        {tk.priority}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#4B5563] leading-relaxed">{tk.summary}</p>
                  <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
                    <span>{tk.visitorEmail}</span>
                    {tk.createdAt && (
                      <span>· {new Date(tk.createdAt).toLocaleString(locale)}</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    await apiRequest(`/api/agents/${agent.id}/tickets/${tk.id}`, {
                      method: 'PATCH',
                      body: { status: tk.status === 'open' ? 'resolved' : 'open' },
                    });
                    refresh();
                  }}
                  className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB] text-xs font-medium text-[#111827] shrink-0 transition"
                >
                  {tk.status === 'open' ? t.markResolved : t.reopenTicket}
                </button>
              </article>
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
    <div className="flex-1 overflow-y-auto sidebar-scroll p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#111827]">
              {t.leadsTitle} ({leads.length})
            </h1>
            <p className="text-xs text-[#6B7280] mt-0.5">{t.leadsSubtitle}</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label={t.searchLeadsPlaceholder}
                placeholder={t.searchLeadsPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-xs w-60"
              />
            </div>

            {filtered.length > 0 && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] text-xs font-medium text-[#111827] inline-flex items-center gap-1.5 transition"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.exportCsv}</span>
              </button>
            )}
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="bg-white border border-[#EAECEF] rounded-xl p-10 text-center">
            <p className="text-xs text-[#6B7280]">{t.noClientsYet}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-[#EAECEF] rounded-xl p-10 text-center">
            <p className="text-xs text-[#6B7280]">{t.noLeadsFiltered}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filtered.map((ld) => (
              <article
                key={ld.id}
                className="bg-white border border-[#EAECEF] rounded-xl p-4 flex items-start gap-3"
              >
                <span
                  className="w-9 h-9 rounded-lg bg-[#F5F3FF] text-[#7C3AED] font-semibold text-xs flex items-center justify-center shrink-0"
                  aria-hidden="true"
                >
                  {String(ld.name || ld.email || '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm font-semibold text-[#111827] truncate">
                    {ld.name || ld.email}
                  </div>
                  <a
                    href={`mailto:${ld.email}`}
                    className="text-xs text-[#2563EB] hover:underline inline-flex items-center gap-1 truncate max-w-full"
                  >
                    <Mail className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{ld.email}</span>
                  </a>
                  {ld.interest && (
                    <p className="text-xs text-[#4B5563] bg-[#F8F9FB] border border-[#EAECEF] rounded-lg px-2.5 py-1.5 mt-1">
                      {ld.interest}
                    </p>
                  )}
                  {ld.createdAt && (
                    <div className="text-[11px] text-[#9CA3AF]">
                      {new Date(ld.createdAt).toLocaleString(locale)}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function WebhooksView({ agent }: { agent: any }) {
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
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-lg font-semibold">Outbound Webhooks (HMAC-SHA256)</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await apiRequest(`/api/agents/${agent.id}/webhooks`, {
            method: 'POST',
            body: { url, secret, events: ['ticket.created', 'booking.created', 'lead.captured'] },
          });
          setUrl('');
          setSecret('');
          refresh();
        }}
        className="bg-white border border-[#EAECEF] rounded-xl p-4 flex flex-wrap gap-3"
      >
        <input required type="url" placeholder="https://hooks.example.com/askmink" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
        <input required minLength={16} placeholder="HMAC Secret (min 16 chars)" value={secret} onChange={(e) => setSecret(e.target.value)} className="w-64 text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
        <button className="px-4 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium">Add Webhook</button>
      </form>
      <div className="space-y-2">
        {hooks.map((h) => (
          <div key={h.id} className="bg-white border border-[#EAECEF] rounded-xl p-3 flex justify-between items-center text-xs">
            <div>
              <div className="font-mono">{h.url}</div>
              <div className="text-[11px] text-[#6B7280]">{(h.events || []).join(', ')}</div>
            </div>
            <button
              onClick={async () => {
                await apiRequest(`/api/agents/${agent.id}/webhooks/${h.id}`, { method: 'DELETE' });
                refresh();
              }}
              className="text-[#9CA3AF] hover:text-[#EF4444]"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsByokView({
  agent,
  t,
  onAgentUpdated,
  onRequestDeleteAgent,
}: {
  agent: any;
  t?: Record<string, string>;
  onAgentUpdated: () => void;
  onRequestDeleteAgent?: () => void;
}) {
  const [keys, setKeys] = useState<any[]>([]);
  const [provider, setProvider] = useState('vercel-ai-gateway');
  const [purpose, setPurpose] = useState<'chat' | 'embedding'>('chat');
  const [label, setLabel] = useState('Vercel AI Gateway');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://ai-gateway.vercel.sh/v1');
  const [chatModel, setChatModel] = useState(agent.chatModel);
  const [embeddingModel, setEmbeddingModel] = useState(agent.embeddingModel);
  const [domainsText, setDomainsText] = useState((agent.allowedDomains || []).join('\n'));
  const [notice, setNotice] = useState('');

  async function refresh() {
    const r = await apiRequest('/api/provider-keys');
    setKeys(r.items || []);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function saveKey(e: React.FormEvent) {
    e.preventDefault();
    await apiRequest('/api/provider-keys', {
      method: 'POST',
      body: { provider, purpose, label, apiKey, baseUrl: baseUrl || undefined },
    });
    setApiKey('');
    setNotice('Encrypted BYOK key stored (AES-256-GCM).');
    refresh();
  }

  async function saveAgentSettings(confirmReindex = false) {
    try {
      await apiRequest(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        body: {
          chatModel,
          embeddingModel,
          allowedDomains: domainsText.split('\n').map((s: string) => s.trim()).filter(Boolean),
          confirmReindex,
        },
      });
      setNotice('Agent settings saved.');
      onAgentUpdated();
    } catch (err: any) {
      if (err.status === 409 && err.data?.error === 'EMBEDDING_REINDEX_REQUIRED') {
        setNotice(`${err.data.message} Click "Confirm & Reindex" below.`);
      } else {
        setNotice(err.message);
      }
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-lg font-semibold">BYOK Providers &amp; Agent Configuration</h2>
      {notice && <div className="text-xs bg-[#EFF6FF] text-[#1D4ED8] px-3 py-2 rounded-lg">{notice}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={saveKey} className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">Add BYOK Key (Chat &amp; Embedding Separated)</h3>
          <div className="grid grid-cols-2 gap-2">
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className="text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB]">
              <option value="vercel-ai-gateway">Vercel AI Gateway</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Chat only)</option>
              <option value="google">Google AI Studio (Gemini)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="openai-compatible">OpenAI-Compatible (Ollama/LM Studio)</option>
            </select>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as any)} className="text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB]">
              <option value="chat">Chat Model</option>
              <option value="embedding">Embedding Model</option>
            </select>
          </div>
          <input required placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
          <input required type="password" placeholder="API Key (stored encrypted, never shown again)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
          <input placeholder="Optional Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]" />
          <button className="px-4 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium">
            Encrypt &amp; Save Key
          </button>

          <div className="pt-2 space-y-1.5">
            {keys.map((k) => (
              <div key={k.id} className="text-xs flex items-center justify-between p-2 rounded-lg bg-[#F8F9FB]">
                <span>
                  <strong>{k.label}</strong> ({k.provider} · {k.purpose}) ••••{k.keyLast4}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await apiRequest(`/api/provider-keys/${k.id}`, { method: 'DELETE' });
                    refresh();
                  }}
                  className="text-[#9CA3AF] hover:text-[#EF4444]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </form>

        <div className="bg-white border border-[#EAECEF] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold">Models &amp; Allowed Domains</h3>
          <div>
            <label className="block text-[11px] text-[#6B7280] mb-1">Chat Model</label>
            <input value={chatModel} onChange={(e) => setChatModel(e.target.value)} className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-[#E5E7EB]" />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] mb-1">Embedding Model (native multi-dim)</label>
            <input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-[#E5E7EB]" />
          </div>
          <div>
            <label className="block text-[11px] text-[#6B7280] mb-1">Allowed Origins (one per line)</label>
            <textarea rows={3} value={domainsText} onChange={(e) => setDomainsText(e.target.value)} className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-[#E5E7EB]" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => saveAgentSettings(false)} className="px-4 py-2 rounded-lg bg-[#18181B] text-white text-xs font-medium">
              Save Settings
            </button>
            <button onClick={() => saveAgentSettings(true)} className="px-3 py-2 rounded-lg border border-[#EAECEF] text-xs font-medium">
              Confirm &amp; Reindex
            </button>
          </div>
        </div>
      </div>

      {onRequestDeleteAgent && (
        <div className="bg-white border border-[#FECACA] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#B91C1C]">
              {t?.dangerZoneTitle || 'Danger zone'}
            </h3>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {t?.dangerZoneDesc ||
                'Permanently delete this agent along with its conversations, knowledge, tools, and bookings.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onRequestDeleteAgent}
            className="px-4 py-2 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C] text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t?.deleteAgent || 'Delete agent'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
