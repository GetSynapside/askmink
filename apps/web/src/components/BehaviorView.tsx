import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  GitBranch,
  Plus,
  Save,
  Wrench,
} from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  autoLayoutWorkflow,
  compilePromptRules,
  compileSystemPromptWithWorkflow,
  DISCONNECTED_TARGET,
  getAgentTemplates,
  loadAgentWorkflow,
  parsePromptRules,
  saveAgentWorkflow,
  TONE_PRESET_IDS,
  type AgentWorkflowState,
  type PromptRulesConfig,
  type ResponseLengthOption,
  type TonePresetId,
  type WorkflowNode,
  type WorkflowNodeType,
} from '@/lib/workflow';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { WorkflowCanvas } from '@/components/WorkflowCanvas';

interface BehaviorViewProps {
  section: 'workflow' | 'prompt';
  agent: any;
  lang: SupportedLanguage;
  t: Record<string, string>;
  onAgentUpdated: () => Promise<void> | void;
}

const AUTO_NEXT_SENTINEL = '__auto__';

function nextStepId(nodes: WorkflowNode[]): string {
  let max = 0;
  for (const n of nodes) {
    const num = Number(n.id.replace(/\D/g, ''));
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return `S${max + 1}`;
}

export function BehaviorView({
  section,
  agent,
  lang,
  t,
  onAgentUpdated,
}: BehaviorViewProps) {
  const [name, setName] = useState<string>(agent.name || '');
  const [description, setDescription] = useState<string>(agent.description || '');
  const [promptRules, setPromptRules] = useState<PromptRulesConfig>(() =>
    parsePromptRules(agent.systemPrompt || '')
  );
  const [workflow, setWorkflow] = useState<AgentWorkflowState>(() =>
    loadAgentWorkflow(agent.id, agent.systemPrompt || '')
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    () => loadAgentWorkflow(agent.id, agent.systemPrompt || '').nodes[0]?.id || ''
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [templatePickerValue, setTemplatePickerValue] = useState('');

  const templates = useMemo(() => getAgentTemplates(lang), [lang]);

  // Sync when switching active agent
  useEffect(() => {
    setName(agent.name || '');
    setDescription(agent.description || '');
    setPromptRules(parsePromptRules(agent.systemPrompt || ''));
    const loaded = loadAgentWorkflow(agent.id, agent.systemPrompt || '');
    setWorkflow(loaded);
    setSelectedNodeId(loaded.nodes[0]?.id || '');
    setNotice(null);
  }, [agent.id]);

  const compiledBaseWithRules = useMemo(
    () => compilePromptRules(promptRules),
    [promptRules]
  );

  const compiledPrompt = useMemo(
    () => compileSystemPromptWithWorkflow(compiledBaseWithRules, workflow),
    [compiledBaseWithRules, workflow]
  );

  const toneChipLabels: Record<TonePresetId, string> = {
    professional: t.toneChipProfessional || 'Professional',
    friendly: t.toneChipFriendly || 'Friendly',
    direct: t.toneChipDirect || 'Direct',
    consultative: t.toneChipConsultative || 'Consultative',
    empathetic: t.toneChipEmpathetic || 'Empathetic',
    no_emojis: t.toneChipNoEmojis || 'No emojis',
  };

  function toggleTonePreset(presetId: TonePresetId) {
    setPromptRules((prev) => {
      const exists = prev.tonePresets.includes(presetId);
      return {
        ...prev,
        tonePresets: exists
          ? prev.tonePresets.filter((id) => id !== presetId)
          : [...prev.tonePresets, presetId],
      };
    });
  }

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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header + Save Bar */}
      <div className="px-5 lg:px-6 py-4 bg-card border-b border-border flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {section === 'workflow'
              ? t.workflowTitle || 'Workflow'
              : t.tabPromptRules}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {section === 'workflow'
              ? t.workflowSubtitle || t.behaviorSubtitle
              : t.promptRulesSubtitle || t.behaviorSubtitle}
          </p>
        </div>

        <Button type="button" onClick={handleSave} disabled={saving}>
          <Save className="size-3.5" aria-hidden="true" />
          <span>{saving ? t.saving : t.saveChanges}</span>
        </Button>
      </div>

      {notice && (
        <div className="px-5 pt-3 shrink-0">
          <Alert variant={notice.type === 'ok' ? 'success' : 'destructive'}>
            <AlertDescription className="font-medium">{notice.text}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Visual Interactive Node Flow Builder */}
      {section === 'workflow' && (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* LEFT Inspector */}
          <aside className="w-full lg:w-[355px] xl:w-[380px] border-b lg:border-b-0 lg:border-r border-border bg-card flex flex-col shrink-0 max-h-[42vh] lg:max-h-none overflow-y-auto sidebar-scroll">
            <div className="p-5 space-y-4 border-b border-border">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t.workflowStepEditor}
              </h2>

              {!selectedNode ? (
                <p className="text-xs text-muted-foreground">{t.workflowSelectPrompt}</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label htmlFor="wf-node-type" className="text-[11px]">
                        {t.workflowNodeType}
                      </Label>
                      <Select
                        value={selectedNode.type}
                        onValueChange={(v) =>
                          updateNode(selectedNode.id, { type: v as WorkflowNodeType })
                        }
                      >
                        <SelectTrigger id="wf-node-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="start">{t.workflowTypeStart}</SelectItem>
                          <SelectItem value="step">{t.workflowTypeStep}</SelectItem>
                          <SelectItem value="decision">{t.workflowTypeDecision}</SelectItem>
                          <SelectItem value="tool">{t.workflowTypeTool}</SelectItem>
                          <SelectItem value="handoff">{t.workflowTypeHandoff}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="wf-node-id" className="text-[11px]">
                        ID
                      </Label>
                      <Input
                        id="wf-node-id"
                        readOnly
                        value={selectedNode.id}
                        className="font-mono bg-muted text-muted-foreground"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="wf-node-title" className="text-[11px]">
                      {t.workflowNodeTitle}
                    </Label>
                    <Input
                      id="wf-node-title"
                      type="text"
                      value={selectedNode.title}
                      onChange={(e) => updateNode(selectedNode.id, { title: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="wf-node-explanation" className="text-[11px]">
                      {t.workflowNodeExplanation}
                    </Label>
                    <Textarea
                      id="wf-node-explanation"
                      rows={4}
                      value={selectedNode.explanation}
                      placeholder={t.workflowNodeExplanationPh}
                      onChange={(e) =>
                        updateNode(selectedNode.id, { explanation: e.target.value })
                      }
                      className="resize-y"
                    />
                  </div>

                  {selectedNode.type === 'decision' ? (
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div className="space-y-1">
                        <Label htmlFor="wf-yes-label" className="text-[11px] text-emerald-700">
                          {t.workflowYesLabel}
                        </Label>
                        <Input
                          id="wf-yes-label"
                          type="text"
                          value={selectedNode.yesLabel || ''}
                          onChange={(e) =>
                            updateNode(selectedNode.id, { yesLabel: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="wf-yes-target" className="text-[11px] text-emerald-700">
                          {t.workflowYesTarget}
                        </Label>
                        <Select
                          value={selectedNode.yesTargetId || DISCONNECTED_TARGET}
                          onValueChange={(v) => updateNode(selectedNode.id, { yesTargetId: v })}
                        >
                          <SelectTrigger id="wf-yes-target">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={DISCONNECTED_TARGET}>
                              {t.workflowNoneTarget}
                            </SelectItem>
                            {workflow.nodes
                              .filter((n) => n.id !== selectedNode.id)
                              .map((n) => (
                                <SelectItem key={n.id} value={n.id}>
                                  {n.id} · {n.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="wf-no-label" className="text-[11px] text-rose-700">
                          {t.workflowNoLabel}
                        </Label>
                        <Input
                          id="wf-no-label"
                          type="text"
                          value={selectedNode.noLabel || ''}
                          onChange={(e) =>
                            updateNode(selectedNode.id, { noLabel: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="wf-no-target" className="text-[11px] text-rose-700">
                          {t.workflowNoTarget}
                        </Label>
                        <Select
                          value={selectedNode.noTargetId || DISCONNECTED_TARGET}
                          onValueChange={(v) => updateNode(selectedNode.id, { noTargetId: v })}
                        >
                          <SelectTrigger id="wf-no-target">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={DISCONNECTED_TARGET}>
                              {t.workflowNoneTarget}
                            </SelectItem>
                            {workflow.nodes
                              .filter((n) => n.id !== selectedNode.id)
                              .map((n) => (
                                <SelectItem key={n.id} value={n.id}>
                                  {n.id} · {n.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    selectedNode.type !== 'handoff' && (
                      <div className="space-y-1">
                        <Label htmlFor="wf-next-target" className="text-[11px]">
                          {t.workflowNextTarget}
                        </Label>
                        <Select
                          value={selectedNode.nextId || AUTO_NEXT_SENTINEL}
                          onValueChange={(v) =>
                            updateNode(selectedNode.id, {
                              nextId: v === AUTO_NEXT_SENTINEL ? '' : v,
                            })
                          }
                        >
                          <SelectTrigger id="wf-next-target">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={AUTO_NEXT_SENTINEL}>
                              {t.workflowNextAuto}
                            </SelectItem>
                            <SelectItem value={DISCONNECTED_TARGET}>
                              {t.workflowNoneTarget}
                            </SelectItem>
                            {workflow.nodes
                              .filter((n) => n.id !== selectedNode.id)
                              .map((n) => (
                                <SelectItem key={n.id} value={n.id}>
                                  {n.id} · {n.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </aside>

          {/* RIGHT Area: Toolbar + Interactive Drag-and-Connect Flow Canvas */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {/* Builder Toolbar */}
            <div className="px-4 py-2.5 bg-card border-b border-border flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button type="button" variant="outline" size="xs" onClick={() => addNode('step')}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>{t.workflowAddStep}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => addNode('decision')}
                >
                  <GitBranch className="size-3.5 text-amber-600" aria-hidden="true" />
                  <span>{t.workflowAddDecision}</span>
                </Button>
                <Button type="button" variant="outline" size="xs" onClick={() => addNode('tool')}>
                  <Wrench className="size-3.5 text-violet-600" aria-hidden="true" />
                  <span>{t.workflowAddTool}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => addNode('handoff')}
                >
                  <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t.workflowAddHandoff}</span>
                </Button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <Select
                  value={templatePickerValue}
                  onValueChange={(v) => {
                    if (v) {
                      applyWorkflowTemplate(v);
                      setTemplatePickerValue('');
                    }
                  }}
                >
                  <SelectTrigger aria-label={t.workflowTemplatesLabel} className="w-44 h-7">
                    <SelectValue placeholder={`${t.workflowTemplatesLabel}...`} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates
                      .filter((tpl) => tpl.workflow.length > 0)
                      .map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>

                <div className="inline-flex items-center gap-2">
                  <Switch
                    id="workflow-include-switch"
                    checked={workflow.enabled}
                    onCheckedChange={(checked) =>
                      setWorkflow((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                  <Label htmlFor="workflow-include-switch" className="cursor-pointer">
                    {t.workflowIncludeToggle}
                  </Label>
                </div>
              </div>
            </div>

            {workflow.nodes.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-6 bg-muted/40">
                <Card className="max-w-lg border-dashed rounded-2xl p-8 text-center space-y-4">
                  <div className="size-10 rounded-xl bg-secondary text-secondary-foreground mx-auto flex items-center justify-center">
                    <GitBranch className="size-5" aria-hidden="true" />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t.workflowEmpty}
                  </p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {templates
                      .filter((tpl) => tpl.workflow.length > 0)
                      .map((tpl) => (
                        <Button
                          key={tpl.id}
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => applyWorkflowTemplate(tpl.id)}
                        >
                          {tpl.name}
                        </Button>
                      ))}
                  </div>
                </Card>
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

      {/* Prompt & URL Rules + Danger Zone */}
      {section === 'prompt' && (
        <div className="flex-1 overflow-y-auto sidebar-scroll p-5 lg:p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            <Card className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="behavior-agent-name">{t.agentNameLabel}</Label>
                  <Input
                    id="behavior-agent-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="behavior-agent-desc">{t.agentDescLabel}</Label>
                  <Input
                    id="behavior-agent-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="behavior-base-prompt">{t.basePromptLabel}</Label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {compiledPrompt.length} / 8000 {t.charsLimit}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">{t.basePromptHint}</p>
                <Textarea
                  id="behavior-base-prompt"
                  rows={6}
                  value={promptRules.basePrompt}
                  onChange={(e) =>
                    setPromptRules((prev) => ({ ...prev, basePrompt: e.target.value }))
                  }
                  className="leading-relaxed font-mono"
                />
              </div>
            </Card>

            {/* Tone, Response Length & Restrictions */}
            <Card className="p-5 space-y-5">
              {/* Tone of voice & personality */}
              <div className="space-y-2.5">
                <div>
                  <Label htmlFor="behavior-tone-custom" className="text-sm font-semibold text-foreground">
                    {t.toneSectionLabel || 'Tone of voice & personality'}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.toneSectionHint ||
                      'Pick traits or describe how the agent should communicate.'}
                  </p>
                </div>

                <div
                  className="flex items-center gap-2 flex-wrap"
                  role="group"
                  aria-label={t.toneSectionLabel || 'Tone of voice & personality'}
                >
                  {TONE_PRESET_IDS.map((presetId) => {
                    const active = promptRules.tonePresets.includes(presetId);
                    return (
                      <button
                        key={presetId}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleTonePreset(presetId)}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition cursor-pointer',
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                        )}
                      >
                        {active && <Check className="size-3 shrink-0" aria-hidden="true" />}
                        <span>{toneChipLabels[presetId]}</span>
                      </button>
                    );
                  })}
                </div>

                <Textarea
                  id="behavior-tone-custom"
                  rows={2}
                  value={promptRules.toneCustom}
                  placeholder={t.toneCustomPh}
                  onChange={(e) =>
                    setPromptRules((prev) => ({ ...prev, toneCustom: e.target.value }))
                  }
                  className="leading-relaxed"
                />
              </div>

              {/* Response length */}
              <div className="space-y-1.5 max-w-xs">
                <Label htmlFor="behavior-response-length">
                  {t.responseLengthLabel || 'Response length'}
                </Label>
                <Select
                  value={promptRules.responseLength}
                  onValueChange={(v) =>
                    setPromptRules((prev) => ({
                      ...prev,
                      responseLength: v as ResponseLengthOption,
                    }))
                  }
                >
                  <SelectTrigger id="behavior-response-length">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">
                      {t.responseLengthShort || 'Short & concise'}
                    </SelectItem>
                    <SelectItem value="balanced">
                      {t.responseLengthBalanced || 'Balanced (default)'}
                    </SelectItem>
                    <SelectItem value="detailed">
                      {t.responseLengthDetailed || 'Detailed'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* What the agent must NOT do */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="behavior-dont-rules"
                  className="text-sm font-semibold text-foreground"
                >
                  {t.dontRulesLabel || 'What the agent must NOT do'}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t.dontRulesHint ||
                    'Clear restrictions and guardrails the agent must always follow.'}
                </p>
                <Textarea
                  id="behavior-dont-rules"
                  rows={4}
                  value={promptRules.dontRules}
                  placeholder={t.dontRulesPh}
                  onChange={(e) =>
                    setPromptRules((prev) => ({ ...prev, dontRules: e.target.value }))
                  }
                  className="leading-relaxed"
                />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
