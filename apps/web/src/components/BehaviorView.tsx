import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  GitBranch,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { SupportedLanguage, UrlRule } from '@askmink/shared';
import { apiRequest } from '../lib/api';
import {
  autoLayoutWorkflow,
  compileSystemPromptWithWorkflow,
  DISCONNECTED_TARGET,
  extractBaseSystemPrompt,
  generateMermaidFlowchart,
  getAgentTemplates,
  loadAgentWorkflow,
  saveAgentWorkflow,
  type AgentWorkflowState,
  type WorkflowNode,
  type WorkflowNodeType,
} from '../lib/workflow';
import { WorkflowCanvas } from './WorkflowCanvas';

interface BehaviorViewProps {
  agent: any;
  lang: SupportedLanguage;
  t: Record<string, string>;
  onAgentUpdated: () => Promise<void> | void;
  onRequestDeleteAgent: () => void;
}

function nextStepId(nodes: WorkflowNode[]): string {
  let max = 0;
  for (const n of nodes) {
    const num = Number(n.id.replace(/\D/g, ''));
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return `S${max + 1}`;
}

export function BehaviorView({
  agent,
  lang,
  t,
  onAgentUpdated,
  onRequestDeleteAgent,
}: BehaviorViewProps) {
  const [subTab, setSubTab] = useState<'prompt' | 'workflow' | 'compiled'>('workflow');
  const [name, setName] = useState<string>(agent.name || '');
  const [description, setDescription] = useState<string>(agent.description || '');
  const [basePrompt, setBasePrompt] = useState<string>(() =>
    extractBaseSystemPrompt(agent.systemPrompt || '')
  );
  const [urlRules, setUrlRules] = useState<UrlRule[]>(() =>
    Array.isArray(agent.urlRules) ? agent.urlRules : []
  );
  const [workflow, setWorkflow] = useState<AgentWorkflowState>(() =>
    loadAgentWorkflow(agent.id, agent.systemPrompt || '')
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    () => loadAgentWorkflow(agent.id, agent.systemPrompt || '').nodes[0]?.id || ''
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedMermaid, setCopiedMermaid] = useState(false);
  const [mermaidOpen, setMermaidOpen] = useState(false);

  const templates = useMemo(() => getAgentTemplates(lang), [lang]);

  // Sync when switching active agent
  useEffect(() => {
    setName(agent.name || '');
    setDescription(agent.description || '');
    setBasePrompt(extractBaseSystemPrompt(agent.systemPrompt || ''));
    setUrlRules(Array.isArray(agent.urlRules) ? agent.urlRules : []);
    const loaded = loadAgentWorkflow(agent.id, agent.systemPrompt || '');
    setWorkflow(loaded);
    setSelectedNodeId(loaded.nodes[0]?.id || '');
    setNotice(null);
  }, [agent.id]);

  const mermaidCode = useMemo(
    () => generateMermaidFlowchart(workflow.nodes),
    [workflow.nodes]
  );

  const compiledPrompt = useMemo(
    () => compileSystemPromptWithWorkflow(basePrompt, workflow),
    [basePrompt, workflow]
  );

  const selectedNode =
    workflow.nodes.find((n) => n.id === selectedNodeId) || workflow.nodes[0] || null;

  const nodeTypeLabel = useCallback(
    (type: WorkflowNodeType): string => {
      switch (type) {
        case 'start':
          return t.workflowTypeStart || 'Start';
        case 'decision':
          return t.workflowTypeDecision || 'Decision';
        case 'tool':
          return t.workflowTypeTool || 'Tool';
        case 'handoff':
          return t.workflowTypeHandoff || 'Closing';
        default:
          return t.workflowTypeStep || 'Step';
      }
    },
    [t]
  );

  function addNode(type: WorkflowNodeType) {
    const id = nextStepId(workflow.nodes);
    const defaultTitles: Record<WorkflowNodeType, string> = {
      start: t.workflowTypeStart || 'Start',
      step: lang === 'pt' ? 'Novo passo' : lang === 'es' ? 'Nuevo paso' : 'New step',
      decision:
        lang === 'pt'
          ? 'Qual o objetivo do cliente?'
          : lang === 'es'
            ? '¿Cuál es el objetivo?'
            : 'What is the user goal?',
      tool:
        lang === 'pt'
          ? 'Executar ação / agenda'
          : lang === 'es'
            ? 'Ejecutar acción / agenda'
            : 'Run tool / schedule',
      handoff:
        lang === 'pt'
          ? 'Encerrar atendimento'
          : lang === 'es'
            ? 'Cerrar conversación'
            : 'Wrap up conversation',
    };

    const actualType: WorkflowNodeType = workflow.nodes.length === 0 ? 'start' : type;
    const anchor = selectedNode || workflow.nodes[workflow.nodes.length - 1];
    const x = anchor ? (anchor.x ?? 320) + (actualType === 'decision' ? 0 : 40) : 340;
    const y = anchor ? (anchor.y ?? 60) + 190 : 48;

    const newNode: WorkflowNode = {
      id,
      type: actualType,
      title: defaultTitles[actualType],
      explanation: '',
      nextId: DISCONNECTED_TARGET,
      x,
      y,
      ...(actualType === 'decision'
        ? {
            yesLabel: lang === 'pt' ? 'Sim' : lang === 'es' ? 'Sí' : 'Yes',
            yesTargetId: DISCONNECTED_TARGET,
            noLabel: lang === 'pt' ? 'Não' : 'No',
            noTargetId: DISCONNECTED_TARGET,
          }
        : {}),
    };

    setWorkflow((prev) => {
      // Automatically connect from currently selected linear node if it wasn't connected yet
      const updated = prev.nodes.map((n) => {
        if (
          anchor &&
          n.id === anchor.id &&
          n.type !== 'decision' &&
          n.type !== 'handoff' &&
          (!n.nextId || n.nextId === DISCONNECTED_TARGET)
        ) {
          return { ...n, nextId: id };
        }
        return n;
      });
      return { enabled: true, nodes: [...updated, newNode] };
    });
    setSelectedNodeId(id);
  }

  function updateNode(id: string, patch: Partial<WorkflowNode>) {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
  }

  const handleMoveNode = useCallback((id: string, x: number, y: number) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    }));
  }, []);

  const handleConnect = useCallback(
    (sourceId: string, sourceHandle: 'next' | 'yes' | 'no', targetId: string) => {
      if (sourceId === targetId) return;
      setWorkflow((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== sourceId) return n;
          if (sourceHandle === 'yes') return { ...n, yesTargetId: targetId };
          if (sourceHandle === 'no') return { ...n, noTargetId: targetId };
          return { ...n, nextId: targetId };
        }),
      }));
    },
    []
  );

  const handleDisconnect = useCallback(
    (sourceId: string, sourceHandle: 'next' | 'yes' | 'no') => {
      setWorkflow((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== sourceId) return n;
          if (sourceHandle === 'yes') return { ...n, yesTargetId: DISCONNECTED_TARGET };
          if (sourceHandle === 'no') return { ...n, noTargetId: DISCONNECTED_TARGET };
          return { ...n, nextId: DISCONNECTED_TARGET };
        }),
      }));
    },
    []
  );

  const handleAutoLayout = useCallback(() => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: autoLayoutWorkflow(prev.nodes),
    }));
  }, []);

  const removeNode = useCallback(
    (id: string) => {
      setWorkflow((prev) => {
        const nextNodes = prev.nodes
          .filter((n) => n.id !== id)
          .map((n) => ({
            ...n,
            nextId: n.nextId === id ? DISCONNECTED_TARGET : n.nextId,
            yesTargetId: n.yesTargetId === id ? DISCONNECTED_TARGET : n.yesTargetId,
            noTargetId: n.noTargetId === id ? DISCONNECTED_TARGET : n.noTargetId,
          }));
        if (selectedNodeId === id) {
          setSelectedNodeId(nextNodes[0]?.id || '');
        }
        return { ...prev, nodes: nextNodes };
      });
    },
    [selectedNodeId]
  );

  function applyWorkflowTemplate(templateId: string) {
    const tpl = templates.find((item) => item.id === templateId);
    if (!tpl) return;
    const cloned = autoLayoutWorkflow(tpl.workflow.map((n) => ({ ...n })));
    setWorkflow({ enabled: cloned.length > 0, nodes: cloned });
    setSelectedNodeId(cloned[0]?.id || '');
  }

  async function handleSave() {
    if (compiledPrompt.length > 8000) {
      setNotice({
        type: 'err',
        text: `Prompt exceeds 8000 characters (${compiledPrompt.length}). Shorten step explanations or base instructions.`,
      });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiRequest(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        body: {
          name: name.trim() || agent.name,
          description: description.trim(),
          systemPrompt: compiledPrompt,
          urlRules: urlRules.filter((r) => r.pattern.trim()),
        },
      });
      saveAgentWorkflow(agent.id, workflow);
      await onAgentUpdated();
      setNotice({ type: 'ok', text: t.behaviorSaved || 'Saved.' });
    } catch (err) {
      setNotice({ type: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMermaid(true);
      setTimeout(() => setCopiedMermaid(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header + Sub-tabs + Save Bar */}
      <div className="px-5 py-3.5 bg-white border-b border-[#EAECEF] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-[#111827]">{t.behaviorTitle}</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">{t.behaviorSubtitle}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex p-0.5 rounded-lg bg-[#F3F4F6] border border-[#EAECEF]">
            {(
              [
                { id: 'workflow', label: t.tabVisualWorkflow },
                { id: 'prompt', label: t.tabPromptRules },
                { id: 'compiled', label: t.tabCompiledPreview },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={subTab === item.id}
                onClick={() => setSubTab(item.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  subTab === item.id
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

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
      </div>

      {notice && (
        <div className="px-5 pt-3 shrink-0">
          <div
            role="status"
            className={`px-3.5 py-2 rounded-lg text-xs font-medium ${
              notice.type === 'ok'
                ? 'bg-[#ECFDF5] text-[#047857] border border-[#D1FAE5]'
                : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]'
            }`}
          >
            {notice.text}
          </div>
        </div>
      )}

      {/* Sub-tab 1: Visual Interactive Node Flow Builder (Inspector LEFT, Canvas RIGHT) */}
      {subTab === 'workflow' && (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* LEFT Inspector (sits naturally right next to main sidebar): Step Config + Mermaid */}
          <aside className="w-full lg:w-[355px] xl:w-[380px] border-b lg:border-b-0 lg:border-r border-[#EAECEF] bg-white flex flex-col shrink-0 max-h-[42vh] lg:max-h-none overflow-y-auto sidebar-scroll">
            <div className="p-5 space-y-4 border-b border-[#EAECEF]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                {t.workflowStepEditor}
              </h2>

              {!selectedNode ? (
                <p className="text-xs text-[#9CA3AF]">{t.workflowSelectPrompt}</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="wf-node-type"
                        className="block text-[11px] font-medium text-[#374151] mb-1"
                      >
                        {t.workflowNodeType}
                      </label>
                      <select
                        id="wf-node-type"
                        value={selectedNode.type}
                        onChange={(e) =>
                          updateNode(selectedNode.id, {
                            type: e.target.value as WorkflowNodeType,
                          })
                        }
                        className="w-full text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB] bg-white"
                      >
                        <option value="start">{t.workflowTypeStart}</option>
                        <option value="step">{t.workflowTypeStep}</option>
                        <option value="decision">{t.workflowTypeDecision}</option>
                        <option value="tool">{t.workflowTypeTool}</option>
                        <option value="handoff">{t.workflowTypeHandoff}</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="wf-node-id"
                        className="block text-[11px] font-medium text-[#374151] mb-1"
                      >
                        ID
                      </label>
                      <input
                        id="wf-node-id"
                        readOnly
                        value={selectedNode.id}
                        className="w-full text-xs font-mono px-2.5 py-2 rounded-lg border border-[#EAECEF] bg-[#F8F9FB] text-[#6B7280]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="wf-node-title"
                      className="block text-[11px] font-medium text-[#374151] mb-1"
                    >
                      {t.workflowNodeTitle}
                    </label>
                    <input
                      id="wf-node-title"
                      type="text"
                      value={selectedNode.title}
                      onChange={(e) =>
                        updateNode(selectedNode.id, { title: e.target.value })
                      }
                      className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="wf-node-explanation"
                      className="block text-[11px] font-medium text-[#374151] mb-1"
                    >
                      {t.workflowNodeExplanation}
                    </label>
                    <textarea
                      id="wf-node-explanation"
                      rows={4}
                      value={selectedNode.explanation}
                      placeholder={t.workflowNodeExplanationPh}
                      onChange={(e) =>
                        updateNode(selectedNode.id, { explanation: e.target.value })
                      }
                      className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB] resize-y"
                    />
                  </div>

                  {selectedNode.type === 'decision' ? (
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div>
                        <label className="block text-[11px] font-medium text-[#047857] mb-1">
                          {t.workflowYesLabel}
                        </label>
                        <input
                          type="text"
                          value={selectedNode.yesLabel || ''}
                          onChange={(e) =>
                            updateNode(selectedNode.id, { yesLabel: e.target.value })
                          }
                          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E7EB]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#047857] mb-1">
                          {t.workflowYesTarget}
                        </label>
                        <select
                          value={selectedNode.yesTargetId || ''}
                          onChange={(e) =>
                            updateNode(selectedNode.id, { yesTargetId: e.target.value })
                          }
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-[#E5E7EB] bg-white"
                        >
                          <option value={DISCONNECTED_TARGET}>{t.workflowNoneTarget}</option>
                          {workflow.nodes
                            .filter((n) => n.id !== selectedNode.id)
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.id} · {n.title}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#BE123C] mb-1">
                          {t.workflowNoLabel}
                        </label>
                        <input
                          type="text"
                          value={selectedNode.noLabel || ''}
                          onChange={(e) =>
                            updateNode(selectedNode.id, { noLabel: e.target.value })
                          }
                          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E7EB]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#BE123C] mb-1">
                          {t.workflowNoTarget}
                        </label>
                        <select
                          value={selectedNode.noTargetId || ''}
                          onChange={(e) =>
                            updateNode(selectedNode.id, { noTargetId: e.target.value })
                          }
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-[#E5E7EB] bg-white"
                        >
                          <option value={DISCONNECTED_TARGET}>{t.workflowNoneTarget}</option>
                          {workflow.nodes
                            .filter((n) => n.id !== selectedNode.id)
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.id} · {n.title}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    selectedNode.type !== 'handoff' && (
                      <div>
                        <label className="block text-[11px] font-medium text-[#374151] mb-1">
                          {t.workflowNextTarget}
                        </label>
                        <select
                          value={selectedNode.nextId || ''}
                          onChange={(e) =>
                            updateNode(selectedNode.id, { nextId: e.target.value })
                          }
                          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] bg-white"
                        >
                          <option value="">{t.workflowNextAuto}</option>
                          <option value={DISCONNECTED_TARGET}>{t.workflowNoneTarget}</option>
                          {workflow.nodes
                            .filter((n) => n.id !== selectedNode.id)
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.id} · {n.title}
                              </option>
                            ))}
                        </select>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Live Mermaid Output (collapsed by default) */}
            <div className="p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setMermaidOpen((prev) => !prev)}
                  aria-expanded={mermaidOpen}
                  aria-controls="mermaid-output-panel"
                  className="flex-1 flex items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider text-[#6B7280] hover:text-[#111827] transition py-1"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                      mermaidOpen ? 'rotate-0' : '-rotate-90'
                    }`}
                    aria-hidden="true"
                  />
                  <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t.workflowMermaidOutput}</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyText(mermaidCode)}
                  className="text-[11px] font-medium text-[#374151] hover:text-[#111827] inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-md hover:bg-[#F3F4F6] transition"
                >
                  {copiedMermaid ? (
                    <Check className="w-3 h-3 text-[#10B981]" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  )}
                  <span>{copiedMermaid ? t.copied : t.copySnippet}</span>
                </button>
              </div>
              {mermaidOpen && (
                <pre
                  id="mermaid-output-panel"
                  className="p-3.5 rounded-xl bg-[#111827] text-[#E5E7EB] text-[11px] font-mono overflow-x-auto leading-relaxed"
                >
                  {mermaidCode}
                </pre>
              )}
            </div>
          </aside>

          {/* RIGHT Area: Toolbar + Interactive Drag-and-Connect Flow Canvas */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {/* Builder Toolbar */}
            <div className="px-4 py-2.5 bg-white border-b border-[#EAECEF] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => addNode('step')}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-xs font-medium text-[#111827] inline-flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.workflowAddStep}</span>
                </button>
                <button
                  type="button"
                  onClick={() => addNode('decision')}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#FEF3C7]/40 text-xs font-medium text-[#111827] inline-flex items-center gap-1 transition"
                >
                  <GitBranch className="w-3.5 h-3.5 text-[#D97706]" aria-hidden="true" />
                  <span>{t.workflowAddDecision}</span>
                </button>
                <button
                  type="button"
                  onClick={() => addNode('tool')}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F5F3FF]/60 text-xs font-medium text-[#111827] inline-flex items-center gap-1 transition"
                >
                  <Wrench className="w-3.5 h-3.5 text-[#7C3AED]" aria-hidden="true" />
                  <span>{t.workflowAddTool}</span>
                </button>
                <button
                  type="button"
                  onClick={() => addNode('handoff')}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-xs font-medium text-[#111827] inline-flex items-center gap-1 transition"
                >
                  <Bot className="w-3.5 h-3.5 text-[#4B5563]" aria-hidden="true" />
                  <span>{t.workflowAddHandoff}</span>
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <select
                  aria-label={t.workflowTemplatesLabel}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      applyWorkflowTemplate(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#374151]"
                >
                  <option value="">{t.workflowTemplatesLabel}...</option>
                  {templates
                    .filter((tpl) => tpl.workflow.length > 0)
                    .map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                </select>

                <label
                  htmlFor="workflow-include-switch"
                  className="inline-flex items-center gap-2 text-xs font-medium text-[#374151] cursor-pointer"
                >
                  <input
                    id="workflow-include-switch"
                    type="checkbox"
                    checked={workflow.enabled}
                    onChange={(e) =>
                      setWorkflow((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    {...({ switch: '' } as any)}
                    className="w-4 h-4 rounded"
                  />
                  <span>{t.workflowIncludeToggle}</span>
                </label>
              </div>
            </div>

            {workflow.nodes.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-6 bg-[#F8FAFC]">
                <div className="max-w-lg bg-white border border-dashed border-[#CBD5E1] rounded-2xl p-8 text-center space-y-4">
                  <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] text-[#4B5563] mx-auto flex items-center justify-center">
                    <GitBranch className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <p className="text-xs text-[#6B7280] leading-relaxed">{t.workflowEmpty}</p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {templates
                      .filter((tpl) => tpl.workflow.length > 0)
                      .map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => applyWorkflowTemplate(tpl.id)}
                          className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-xs font-medium text-[#111827] transition"
                        >
                          {tpl.name}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            ) : (
              <WorkflowCanvas
                nodes={workflow.nodes}
                selectedNodeId={selectedNode?.id || ''}
                t={t}
                nodeTypeLabel={nodeTypeLabel}
                onSelectNode={setSelectedNodeId}
                onMoveNode={handleMoveNode}
                onDeleteNode={removeNode}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onAutoLayout={handleAutoLayout}
              />
            )}
          </div>
        </div>
      )}

      {/* Sub-tab 2: Prompt & URL Rules + Danger Zone */}
      {subTab === 'prompt' && (
        <div className="flex-1 overflow-y-auto sidebar-scroll p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <section className="bg-white border border-[#EAECEF] rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor="behavior-agent-name"
                    className="block text-xs font-medium text-[#374151] mb-1"
                  >
                    {t.agentNameLabel}
                  </label>
                  <input
                    id="behavior-agent-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="behavior-agent-desc"
                    className="block text-xs font-medium text-[#374151] mb-1"
                  >
                    {t.agentDescLabel}
                  </label>
                  <input
                    id="behavior-agent-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-[#E5E7EB]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="behavior-base-prompt"
                    className="block text-xs font-medium text-[#374151]"
                  >
                    {t.basePromptLabel}
                  </label>
                  <span className="text-[11px] text-[#6B7280] tabular-nums">
                    {compiledPrompt.length} / 8000 {t.charsLimit}
                  </span>
                </div>
                <p className="text-[11px] text-[#6B7280] mb-2">{t.basePromptHint}</p>
                <textarea
                  id="behavior-base-prompt"
                  rows={8}
                  value={basePrompt}
                  onChange={(e) => setBasePrompt(e.target.value)}
                  className="w-full text-xs px-3 py-2.5 rounded-lg border border-[#E5E7EB] leading-relaxed font-mono"
                />
              </div>
            </section>

            {/* Dual-Mode URL Rules */}
            <section className="bg-white border border-[#EAECEF] rounded-xl p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#111827]">{t.urlRulesTitle}</h2>
                  <p className="text-xs text-[#6B7280] mt-0.5">{t.urlRulesHint}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setUrlRules((prev) => [...prev, { pattern: '/pricing*', mode: 'sales' }])
                  }
                  className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F9FAFB] text-xs font-medium text-[#111827] inline-flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.addRule}</span>
                </button>
              </div>

              <div className="space-y-2">
                {urlRules.map((rule, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={rule.pattern}
                      placeholder={t.urlPatternPlaceholder}
                      onChange={(e) =>
                        setUrlRules((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, pattern: e.target.value } : r))
                        )
                      }
                      className="flex-1 text-xs font-mono px-3 py-2 rounded-lg border border-[#E5E7EB]"
                    />
                    <select
                      value={rule.mode}
                      onChange={(e) =>
                        setUrlRules((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, mode: e.target.value as 'sales' | 'support' } : r
                          )
                        )
                      }
                      className="text-xs px-2.5 py-2 rounded-lg border border-[#E5E7EB] bg-white"
                    >
                      <option value="sales">{t.modeSales}</option>
                      <option value="support">{t.modeSupport}</option>
                    </select>
                    <button
                      type="button"
                      aria-label="Remove rule"
                      onClick={() => setUrlRules((prev) => prev.filter((_, i) => i !== idx))}
                      className="w-8 h-8 rounded-lg text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Danger Zone */}
            <section className="bg-white border border-[#FECACA] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-[#B91C1C]">{t.dangerZoneTitle}</h2>
                <p className="text-xs text-[#6B7280] mt-0.5">{t.dangerZoneDesc}</p>
              </div>
              <button
                type="button"
                onClick={onRequestDeleteAgent}
                className="px-4 py-2 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C] text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.deleteAgent}</span>
              </button>
            </section>
          </div>
        </div>
      )}

      {/* Sub-tab 3: Compiled Final Prompt Preview */}
      {subTab === 'compiled' && (
        <div className="flex-1 overflow-y-auto sidebar-scroll p-6">
          <div className="max-w-3xl mx-auto bg-white border border-[#EAECEF] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#111827]">
                <Sparkles className="w-4 h-4 text-[#2563EB]" aria-hidden="true" />
                <span>
                  {t.tabCompiledPreview} ({compiledPrompt.length} / 8000 {t.charsLimit})
                </span>
              </div>
              <button
                type="button"
                onClick={() => copyText(compiledPrompt)}
                className="px-2.5 py-1 rounded-lg border border-[#EAECEF] hover:bg-[#F9FAFB] text-xs font-medium text-[#374151] inline-flex items-center gap-1"
              >
                {copiedMermaid ? (
                  <Check className="w-3.5 h-3.5 text-[#10B981]" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copiedMermaid ? t.copied : t.copySnippet}</span>
              </button>
            </div>
            <pre className="p-4 rounded-xl bg-[#111827] text-[#E5E7EB] text-xs font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed">
              {compiledPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
