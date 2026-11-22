import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  Cpu,
  FileText,
  GitBranch,
  Globe,
  KeyRound,
  Link2,
  LogOut,
  Paintbrush,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '../lib/api';
import {
  compileSystemPromptWithWorkflow,
  getAgentTemplates,
  saveAgentWorkflow,
  type AgentTemplateId,
} from '../lib/workflow';

interface AgentOnboardingFlowProps {
  mode: 'first-agent' | 'new-agent';
  open?: boolean;
  user?: any;
  lang: SupportedLanguage;
  onChangeLang?: (lang: SupportedLanguage) => void;
  onLogout?: () => void;
  t: Record<string, string>;
  onClose?: () => void;
  onCreated: (agent: any) => Promise<void> | void;
}

const COLOR_PRESETS = ['#2563EB', '#18181B', '#4F46E5', '#059669', '#E11D48', '#D97706'];

export function AgentOnboardingFlow({
  mode,
  open = true,
  user,
  lang,
  onChangeLang,
  onLogout,
  t,
  onClose,
  onCreated,
}: AgentOnboardingFlowProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const templates = useMemo(() => getAgentTemplates(lang), [lang]);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [templateId, setTemplateId] = useState<AgentTemplateId>('sales');
  const [name, setName] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState<SupportedLanguage>(lang);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [basePrompt, setBasePrompt] = useState('');
  const [includeWorkflow, setIncludeWorkflow] = useState(true);

  // Step 3: Initial Knowledge (optional)
  const [knowledgeMode, setKnowledgeMode] = useState<'url' | 'text' | 'skip'>('url');
  const [knowledgeUrl, setKnowledgeUrl] = useState('');
  const [knowledgeCrawlType, setKnowledgeCrawlType] = useState<'url' | 'sitemap' | 'llms_txt'>('url');
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeText, setKnowledgeText] = useState('');

  // Step 4: AI Provider + Widget + Domains
  const [aiReady, setAiReady] = useState<{ gateway: boolean; keyCount: number; defaultModel: string }>({
    gateway: true,
    keyCount: 0,
    defaultModel: 'tencent/hy4-flash',
  });
  const [showByokForm, setShowByokForm] = useState(false);
  const [byokProvider, setByokProvider] = useState('openai');
  const [byokLabel, setByokLabel] = useState('Primary Chat Key');
  const [byokApiKey, setByokApiKey] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563EB');
  const [showBranding, setShowBranding] = useState(true);
  const [domainsText, setDomainsText] = useState(
    'http://127.0.0.1:5173\nhttp://localhost:5173\nhttp://127.0.0.1:3000'
  );

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const isVisible = mode === 'first-agent' || open;

  // Reset form state on open or language switch (first step)
  useEffect(() => {
    if (!isVisible) return;
    const initial = templates[0]!;
    setStep(1);
    setTemplateId(initial.id);
    setName(initial.name);
    setDefaultLanguage(lang);
    setWelcomeMessage(initial.welcomeMessage);
    setBasePrompt(initial.systemPrompt);
    setIncludeWorkflow(initial.workflow.length > 0);
    setKnowledgeMode('url');
    setKnowledgeUrl('');
    setKnowledgeTitle('');
    setKnowledgeText('');
    setPrimaryColor(initial.primaryColor);
    setShowBranding(true);
    setByokApiKey('');
    setError('');

    Promise.all([
      fetch('/health')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      apiRequest<{ items: any[] }>('/api/provider-keys').catch(() => ({ items: [] })),
    ]).then(([health, keys]) => {
      const gateway = Boolean(health?.defaults?.gatewayConfigured);
      const keyCount = (keys?.items || []).length;
      setAiReady({
        gateway,
        keyCount,
        defaultModel: health?.defaults?.chatModel || 'tencent/hy4-flash',
      });
      setShowByokForm(!gateway && keyCount === 0);
    });
  }, [isVisible, lang]);

  // Sync native <dialog> when in modal mode
  useEffect(() => {
    if (mode !== 'new-agent') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [mode, open]);

  const activeTemplate = templates.find((tpl) => tpl.id === templateId) || templates[0]!;
  const validHex = /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#2563EB';
  const hasAiConfigured = aiReady.gateway || aiReady.keyCount > 0 || byokApiKey.trim().length > 0;

  function selectTemplate(id: AgentTemplateId) {
    const tpl = templates.find((item) => item.id === id);
    if (!tpl) return;
    setTemplateId(id);
    setName(tpl.name);
    setWelcomeMessage(tpl.welcomeMessage);
    setBasePrompt(tpl.systemPrompt);
    setPrimaryColor(tpl.primaryColor);
    setIncludeWorkflow(tpl.workflow.length > 0);
  }

  async function handleFinish() {
    if (name.trim().length < 2) {
      setError('Agent name must have at least 2 characters.');
      setStep(1);
      return;
    }

    setCreating(true);
    setError('');
    try {
      // 1. Optional BYOK key creation first
      let createdKeyId: string | undefined;
      if (byokApiKey.trim().length > 0) {
        const keyRes = await apiRequest<{ item: { id: string } }>('/api/provider-keys', {
          method: 'POST',
          body: {
            provider: byokProvider,
            purpose: 'chat',
            label: byokLabel.trim() || 'Primary Chat Key',
            apiKey: byokApiKey.trim(),
          },
        });
        createdKeyId = keyRes.item?.id;
      }

      // 2. Create the agent with compiled Mermaid workflow
      const workflowState = {
        enabled: includeWorkflow && activeTemplate.workflow.length > 0,
        nodes: includeWorkflow ? activeTemplate.workflow.map((n) => ({ ...n })) : [],
      };
      const compiledPrompt = compileSystemPromptWithWorkflow(basePrompt, workflowState);
      const allowedDomains = domainsText
        .split('\n')
        .map((d) => d.trim())
        .filter(Boolean);

      const res = await apiRequest<{ item: any }>('/api/agents', {
        method: 'POST',
        body: {
          name: name.trim(),
          defaultLanguage,
          welcomeMessage: welcomeMessage.trim() || activeTemplate.welcomeMessage,
          systemPrompt: compiledPrompt,
          primaryColor: validHex,
          showBranding,
          chatProviderKeyId: createdKeyId ?? null,
          allowedDomains:
            allowedDomains.length > 0 ? allowedDomains : ['http://127.0.0.1:3000'],
        },
      });

      const created = res.item;

      if (created?.id && workflowState.nodes.length > 0) {
        saveAgentWorkflow(created.id, workflowState);
      }

      // 3. Optional initial knowledge ingestion (best-effort so agent creation still succeeds)
      if (created?.id) {
        if (knowledgeMode === 'url' && knowledgeUrl.trim()) {
          await apiRequest(`/api/agents/${created.id}/knowledge/url`, {
            method: 'POST',
            body: {
              url: knowledgeUrl.trim(),
              crawlType: knowledgeCrawlType,
              maxPages: 10,
            },
          }).catch(() => undefined);
        } else if (
          knowledgeMode === 'text' &&
          knowledgeTitle.trim().length >= 2 &&
          knowledgeText.trim().length >= 10
        ) {
          await apiRequest(`/api/agents/${created.id}/knowledge/text`, {
            method: 'POST',
            body: {
              title: knowledgeTitle.trim(),
              content: knowledgeText.trim(),
            },
          }).catch(() => undefined);
        }
      }

      await onCreated(created);
      onClose?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const stepsMeta = [
    {
      num: 1 as const,
      title: t.onboardingStep1Title,
      sub: t.onboardingStep1Sub,
      done: name.trim().length >= 2,
    },
    {
      num: 2 as const,
      title: t.onboardingStep2Title,
      sub: t.onboardingStep2Sub,
      done: step > 2 || basePrompt.trim().length >= 10,
    },
    {
      num: 3 as const,
      title: t.onboardingStep3Title,
      sub: t.onboardingStep3Sub,
      done:
        step > 3 ||
        (knowledgeMode === 'url' && knowledgeUrl.trim().length > 0) ||
        (knowledgeMode === 'text' && knowledgeText.trim().length >= 10) ||
        knowledgeMode === 'skip',
    },
    {
      num: 4 as const,
      title: t.onboardingStep4Title,
      sub: t.onboardingStep4Sub,
      done: hasAiConfigured,
    },
  ];

  // Live Miniature Widget Preview Card
  const liveWidgetPreview = (
    <div className="space-y-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-[#2563EB]" aria-hidden="true" />
        <span>{t.onboardingLivePreview}</span>
      </div>
      <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-md overflow-hidden flex flex-col">
        <div className="px-3.5 py-3 border-b border-[#EAECEF] flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-lg text-white font-bold text-xs flex items-center justify-center shrink-0"
            style={{ backgroundColor: validHex }}
          >
            {(name || 'A').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#111827] truncate">
              {name || 'Askmink'}
            </div>
            <div className="text-[10px] text-[#16A34A] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" aria-hidden="true" />
              <span>{t.online}</span>
            </div>
          </div>
        </div>

        <div className="p-3.5 bg-[#F8F9FB] space-y-2.5 min-h-[180px]">
          <div className="max-w-[90%] bg-white border border-[#EAECEF] rounded-xl rounded-bl-sm px-3 py-2 text-xs text-[#111827] leading-relaxed">
            {welcomeMessage || activeTemplate.welcomeMessage}
          </div>

          {includeWorkflow && activeTemplate.workflow.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeTemplate.workflow.slice(0, 2).map((wf) => (
                <span
                  key={wf.id}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#E5E7EB] text-[#4B5563]"
                >
                  {wf.title}
                </span>
              ))}
            </div>
          )}

          <div
            className="max-w-[75%] ml-auto rounded-xl rounded-br-sm px-3 py-1.5 text-[11px] text-white"
            style={{ backgroundColor: validHex }}
          >
            {defaultLanguage === 'pt'
              ? 'Quero saber mais sobre os planos!'
              : defaultLanguage === 'es'
                ? '¡Quiero conocer los planes!'
                : 'Tell me about your plans!'}
          </div>
        </div>

        <div className="p-2.5 border-t border-[#EAECEF] bg-white flex items-center gap-2">
          <div className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] text-[11px] text-[#9CA3AF] truncate">
            {t.widgetInputPlaceholder}
          </div>
          <span
            className="w-7 h-7 rounded-lg text-white flex items-center justify-center shrink-0"
            style={{ backgroundColor: validHex }}
            aria-hidden="true"
          >
            <Send className="w-3 h-3" />
          </span>
        </div>

        {showBranding && (
          <div className="py-1 text-center text-[10px] text-[#9CA3AF] bg-white border-t border-[#F3F4F6]">
            Powered by Askmink
          </div>
        )}
      </div>

      {/* Floating launcher preview */}
      <div className="flex justify-end">
        <span
          className="w-11 h-11 rounded-full text-white shadow-md flex items-center justify-center"
          style={{ backgroundColor: validHex }}
          aria-hidden="true"
        >
          <Sparkles className="w-4 h-4" />
        </span>
      </div>
    </div>
  );

  // Shared Step Content
  const stepContent = (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="px-3 py-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C]"
        >
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-xs text-[#6B7280]">{t.wizardStep1Desc}</p>

          <div>
            <span className="block text-xs font-medium text-[#374151] mb-2">
              {t.wizardChooseTemplate}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((tpl) => {
                const selected = templateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => selectTemplate(tpl.id)}
                    aria-pressed={selected}
                    className={`p-3 rounded-xl border text-left transition flex items-center gap-2.5 ${
                      selected
                        ? 'border-[#18181B] bg-[#F8F9FB] ring-1 ring-[#18181B]'
                        : 'border-[#EAECEF] hover:border-[#D1D5DB] bg-white'
                    }`}
                  >
                    <span
                      className="w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0"
                      style={{ backgroundColor: tpl.primaryColor }}
                      aria-hidden="true"
                    >
                      <Bot className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#111827] truncate">
                        {tpl.name}
                      </div>
                      <div className="text-[10px] text-[#6B7280] truncate">
                        {tpl.workflow.length > 0
                          ? `${tpl.workflow.length} steps Mermaid`
                          : 'Blank'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="onb-agent-name"
                className="block text-xs font-medium text-[#374151] mb-1"
              >
                {t.agentNameLabel}
              </label>
              <input
                id="onb-agent-name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
              />
            </div>
            <div>
              <label
                htmlFor="onb-agent-lang"
                className="block text-xs font-medium text-[#374151] mb-1"
              >
                {t.widgetDefaultLangLabel}
              </label>
              <select
                id="onb-agent-lang"
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value as SupportedLanguage)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white"
              >
                <option value="pt">Português</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="onb-welcome-msg"
              className="block text-xs font-medium text-[#374151] mb-1"
            >
              {t.welcomeMessageLabel}
            </label>
            <input
              id="onb-welcome-msg"
              type="text"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-xs text-[#6B7280]">{t.wizardStep2Desc}</p>

          <div>
            <label
              htmlFor="onb-system-prompt"
              className="block text-xs font-medium text-[#374151] mb-1"
            >
              {t.basePromptLabel}
            </label>
            <textarea
              id="onb-system-prompt"
              rows={5}
              value={basePrompt}
              onChange={(e) => setBasePrompt(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] leading-relaxed"
            />
          </div>

          {activeTemplate.workflow.length > 0 && (
            <div className="p-3.5 rounded-xl bg-[#F8F9FB] border border-[#EAECEF] space-y-2.5">
              <label
                htmlFor="onb-include-wf"
                className="flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="text-xs font-semibold text-[#111827] inline-flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-[#2563EB]" aria-hidden="true" />
                  <span>{t.wizardIncludeStarterFlow}</span>
                </span>
                <input
                  id="onb-include-wf"
                  type="checkbox"
                  checked={includeWorkflow}
                  onChange={(e) => setIncludeWorkflow(e.target.checked)}
                  {...({ switch: '' } as any)}
                  className="w-4 h-4 rounded"
                />
              </label>

              {includeWorkflow && (
                <ol className="space-y-1.5 text-[11px] text-[#4B5563]">
                  {activeTemplate.workflow.map((wf) => (
                    <li key={wf.id} className="flex items-start gap-2">
                      <span className="font-mono text-[10px] text-[#6B7280] bg-white border border-[#EAECEF] px-1.5 py-0.5 rounded shrink-0">
                        {wf.id}
                      </span>
                      <div className="min-w-0">
                        <span className="font-semibold text-[#111827]">{wf.title}</span>
                        {wf.explanation && (
                          <span className="text-[#6B7280]"> — {wf.explanation}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'url', label: t.onboardingKnowledgeUrlTab, icon: Link2 },
                { id: 'text', label: t.onboardingKnowledgeTextTab, icon: FileText },
                { id: 'skip', label: t.onboardingKnowledgeSkipTab, icon: BookOpen },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={knowledgeMode === opt.id}
                  onClick={() => setKnowledgeMode(opt.id)}
                  className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center justify-center gap-1.5 text-center transition ${
                    knowledgeMode === opt.id
                      ? 'bg-[#18181B] text-white border-[#18181B]'
                      : 'bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <span className="leading-tight text-[11px]">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {knowledgeMode === 'url' && (
            <div className="space-y-3 p-4 rounded-xl bg-[#F8F9FB] border border-[#EAECEF]">
              <div>
                <label
                  htmlFor="onb-kb-url"
                  className="block text-xs font-medium text-[#374151] mb-1"
                >
                  {t.onboardingKnowledgeUrlLabel}
                </label>
                <input
                  id="onb-kb-url"
                  type="url"
                  placeholder="https://seusite.com.br/faq"
                  value={knowledgeUrl}
                  onChange={(e) => setKnowledgeUrl(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="onb-kb-type"
                  className="block text-xs font-medium text-[#374151] mb-1"
                >
                  {t.onboardingKnowledgeUrlType}
                </label>
                <select
                  id="onb-kb-type"
                  value={knowledgeCrawlType}
                  onChange={(e) => setKnowledgeCrawlType(e.target.value as any)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white"
                >
                  <option value="url">Single page / URL</option>
                  <option value="sitemap">sitemap.xml (multi-page)</option>
                  <option value="llms_txt">llms.txt</option>
                </select>
              </div>
            </div>
          )}

          {knowledgeMode === 'text' && (
            <div className="space-y-3 p-4 rounded-xl bg-[#F8F9FB] border border-[#EAECEF]">
              <div>
                <label
                  htmlFor="onb-kb-title"
                  className="block text-xs font-medium text-[#374151] mb-1"
                >
                  {t.onboardingKnowledgeTextTitle}
                </label>
                <input
                  id="onb-kb-title"
                  type="text"
                  placeholder={t.onboardingKnowledgeTextTitlePh}
                  value={knowledgeTitle}
                  onChange={(e) => setKnowledgeTitle(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="onb-kb-body"
                  className="block text-xs font-medium text-[#374151] mb-1"
                >
                  {t.onboardingKnowledgeTextBody}
                </label>
                <textarea
                  id="onb-kb-body"
                  rows={5}
                  placeholder={t.onboardingKnowledgeTextBodyPh}
                  value={knowledgeText}
                  onChange={(e) => setKnowledgeText(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white"
                />
              </div>
            </div>
          )}

          {knowledgeMode === 'skip' && (
            <div className="p-4 rounded-xl bg-[#F8F9FB] border border-[#EAECEF] text-xs text-[#6B7280] leading-relaxed">
              {t.onboardingKnowledgeSkipNote}
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          {/* AI Provider Status / Optional BYOK */}
          <div
            className={`p-3.5 rounded-xl border space-y-2.5 ${
              aiReady.gateway || aiReady.keyCount > 0
                ? 'bg-[#ECFDF5]/60 border-[#D1FAE5]'
                : 'bg-[#FEF3C7]/40 border-[#FDE68A]'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {aiReady.gateway || aiReady.keyCount > 0 ? (
                <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <KeyRound className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[#111827]">
                  {aiReady.gateway || aiReady.keyCount > 0
                    ? t.onboardingAiReadyTitle
                    : t.onboardingAiMissingTitle}
                </div>
                <p className="text-[11px] text-[#4B5563] mt-0.5">
                  {aiReady.gateway || aiReady.keyCount > 0
                    ? `${t.onboardingAiReadyDesc} (${aiReady.defaultModel})`
                    : t.onboardingAiMissingDesc}
                </p>
              </div>
            </div>

            {(aiReady.gateway || aiReady.keyCount > 0) && (
              <button
                type="button"
                onClick={() => setShowByokForm((v) => !v)}
                className="text-[11px] font-medium text-[#111827] underline underline-offset-2"
              >
                {t.onboardingAddOptionalByok}
              </button>
            )}

            {showByokForm && (
              <div className="pt-1 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={byokProvider}
                    onChange={(e) => setByokProvider(e.target.value)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] bg-white"
                  >
                    <option value="vercel-ai-gateway">Vercel AI Gateway</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google Gemini</option>
                    <option value="openrouter">OpenRouter</option>
                  </select>
                  <input
                    type="text"
                    value={byokLabel}
                    onChange={(e) => setByokLabel(e.target.value)}
                    placeholder="Label"
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] bg-white"
                  />
                </div>
                <input
                  type="password"
                  value={byokApiKey}
                  onChange={(e) => setByokApiKey(e.target.value)}
                  placeholder={t.onboardingByokKeyPh}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] bg-white"
                />
              </div>
            )}
          </div>

          {/* Accent Color */}
          <div>
            <span className="block text-xs font-medium text-[#374151] mb-2">
              {t.primaryColorLabel}
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map((hex) => {
                const selected = validHex.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setPrimaryColor(hex)}
                    aria-label={hex}
                    className={`w-7 h-7 rounded-full border flex items-center justify-center transition ${
                      selected ? 'ring-2 ring-offset-2 ring-[#111827]' : 'border-black/15'
                    }`}
                    style={{ backgroundColor: hex }}
                  >
                    {selected && <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
                  </button>
                );
              })}
              <input
                type="color"
                aria-label={t.primaryColorLabel}
                value={validHex}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-7 h-7 p-0.5 rounded-lg border border-[#E5E7EB] cursor-pointer"
              />
            </div>
          </div>

          {/* Branding */}
          <label
            htmlFor="onb-show-branding"
            className="flex items-center justify-between gap-3 cursor-pointer"
          >
            <span className="text-xs font-medium text-[#374151] inline-flex items-center gap-1.5">
              <Paintbrush className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
              <span>{t.showBrandingLabel}</span>
            </span>
            <input
              id="onb-show-branding"
              type="checkbox"
              checked={showBranding}
              onChange={(e) => setShowBranding(e.target.checked)}
              {...({ switch: '' } as any)}
              className="w-4 h-4 rounded"
            />
          </label>

          {/* Allowed Domains */}
          <div>
            <label
              htmlFor="onb-domains"
              className="block text-xs font-medium text-[#374151] mb-1"
            >
              {t.wizardDomainsLabel}
            </label>
            <textarea
              id="onb-domains"
              rows={3}
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-[#E5E7EB]"
            />
          </div>
        </div>
      )}
    </div>
  );

  const footerActions = (
    <div className="flex items-center justify-between gap-3">
      <div>
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : 1))}
            className="px-3.5 py-2 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-xs font-medium text-[#374151] inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t.wizardBack}</span>
          </button>
        ) : mode === 'new-agent' && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs font-medium text-[#6B7280] hover:text-[#111827]"
          >
            {t.cancel}
          </button>
        ) : (
          <span className="text-[11px] text-[#9CA3AF]">
            {step} / 4
          </span>
        )}
      </div>

      <div>
        {step < 4 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : 4))}
            className="px-4 py-2 rounded-lg bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium inline-flex items-center gap-1.5"
          >
            <span>{t.wizardNext}</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-[#18181B] hover:bg-[#27272A] disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {creating
                ? t.wizardCreating
                : mode === 'first-agent'
                  ? t.onboardingLaunchFirst
                  : t.wizardCreate}
            </span>
          </button>
        )}
      </div>
    </div>
  );

  // MODE 1: Mandatory Full-Screen First-Agent Onboarding
  if (mode === 'first-agent') {
    return (
      <div className="min-h-screen bg-[#F8F9FB] flex flex-col">
        {/* Minimal Top Header */}
        <header className="h-14 px-5 bg-white border-b border-[#EAECEF] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg bg-[#18181B] text-white flex items-center justify-center"
              aria-hidden="true"
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-sm text-[#111827] leading-tight">Askmink</div>
              <div className="text-[10px] text-[#6B7280] leading-tight">by Synapside</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {onChangeLang && (
              <div
                className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[#F3F4F6] border border-[#EAECEF]"
                role="group"
                aria-label={t.language}
              >
                <Globe className="w-3 h-3 text-[#6B7280] ml-1 mr-0.5" aria-hidden="true" />
                {(['en', 'pt', 'es'] as SupportedLanguage[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onChangeLang(code)}
                    aria-pressed={lang === code}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase transition ${
                      lang === code
                        ? 'bg-white text-[#111827] shadow-2xs'
                        : 'text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>
            )}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#6B7280] hover:text-[#DC2626] hover:bg-[#FEF2F2] inline-flex items-center gap-1.5 transition"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.logout}</span>
              </button>
            )}
          </div>
        </header>

        {/* Full-Screen Guided Studio */}
        <main className="flex-1 flex items-start justify-center p-5 lg:p-8 overflow-y-auto">
          <div className="w-full max-w-6xl space-y-6">
            {/* Hero Intro */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[#2563EB]">
                {t.onboardingWelcome}
                {user?.name ? `, ${user.name}` : ''}
              </div>
              <h1 className="text-2xl font-semibold text-[#111827] tracking-tight">
                {t.onboardingHero}
              </h1>
              <p className="text-xs text-[#6B7280] max-w-2xl">{t.onboardingHeroDesc}</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Checklist Stepper */}
              <aside className="lg:col-span-3 bg-white border border-[#EAECEF] rounded-2xl p-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#111827]">
                      {t.onboardingProgressLabel}
                    </span>
                    <span className="font-medium text-[#6B7280] tabular-nums">
                      {Math.round((step / 4) * 100)}%
                    </span>
                  </div>
                  <progress
                    className="askmink-progress"
                    value={step}
                    max={4}
                    aria-label={t.onboardingProgressLabel}
                  />
                </div>

                <ol className="space-y-1.5">
                  {stepsMeta.map((s) => {
                    const active = step === s.num;
                    const completed = step > s.num;
                    return (
                      <li key={s.num}>
                        <button
                          type="button"
                          onClick={() => setStep(s.num)}
                          className={`w-full p-2.5 rounded-xl text-left flex items-start gap-2.5 transition ${
                            active
                              ? 'bg-[#F3F4F6] ring-1 ring-inset ring-[#E5E7EB]'
                              : 'hover:bg-[#F9FAFB]'
                          }`}
                        >
                          <span
                            className={`w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5 ${
                              completed
                                ? 'bg-[#10B981] text-white'
                                : active
                                  ? 'bg-[#18181B] text-white'
                                  : 'bg-[#E5E7EB] text-[#6B7280]'
                            }`}
                          >
                            {completed ? <Check className="w-3 h-3" aria-hidden="true" /> : s.num}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-[#111827] leading-tight">
                              {s.title}
                            </span>
                            <span className="block text-[11px] text-[#6B7280] mt-0.5 leading-snug">
                              {s.sub}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </aside>

              {/* Center Step Form */}
              <section className="lg:col-span-6 bg-white border border-[#EAECEF] rounded-2xl overflow-hidden shadow-2xs">
                <div className="px-6 py-4 border-b border-[#EAECEF] flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[#111827]">
                      {stepsMeta[step - 1]?.title}
                    </h2>
                    <p className="text-[11px] text-[#6B7280]">{stepsMeta[step - 1]?.sub}</p>
                  </div>
                  <span className="text-[11px] font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-0.5 rounded-full">
                    {step} / 4
                  </span>
                </div>
                <div className="p-6">{stepContent}</div>
                <div className="px-6 py-4 border-t border-[#EAECEF] bg-[#FAFAFB]">
                  {footerActions}
                </div>
              </section>

              {/* Right Live Widget Preview */}
              <aside className="lg:col-span-3">{liveWidgetPreview}</aside>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // MODE 2: Essential New Agent Modal Dialog
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="new-agent-dialog-title"
      {...({ closedby: 'closerequest' } as any)}
      className="m-auto bg-white border border-[#EAECEF] rounded-2xl max-w-4xl w-[calc(100%-2rem)] p-0 shadow-2xl overflow-hidden"
    >
      {/* Modal Header */}
      <div className="px-6 py-4 border-b border-[#EAECEF] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-8 h-8 rounded-lg bg-[#18181B] text-white flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <Cpu className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 id="new-agent-dialog-title" className="text-sm font-semibold text-[#111827]">
              {t.wizardTitle}
            </h2>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#6B7280] flex-wrap">
              {stepsMeta.map((s, idx) => (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => setStep(s.num)}
                  className={`inline-flex items-center gap-1 hover:text-[#111827] ${
                    step === s.num ? 'font-semibold text-[#111827]' : ''
                  }`}
                >
                  {idx > 0 && <span aria-hidden="true">·</span>}
                  <span>
                    {s.num}. {s.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="w-8 h-8 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] flex items-center justify-center shrink-0"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Modal Body: Form Left + Live Preview Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 max-h-[72vh] overflow-y-auto sidebar-scroll">
        <div className="lg:col-span-7 p-6">{stepContent}</div>
        <div className="lg:col-span-5 p-6 bg-[#FAFAFB] border-t lg:border-t-0 lg:border-l border-[#EAECEF]">
          {liveWidgetPreview}
        </div>
      </div>

      {/* Modal Footer */}
      <div className="px-6 py-3.5 border-t border-[#EAECEF] bg-[#FAFAFB]">{footerActions}</div>
    </dialog>
  );
}
