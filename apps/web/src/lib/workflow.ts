import type { SupportedLanguage } from '@askmink/shared';

export type WorkflowNodeType = 'start' | 'step' | 'decision' | 'tool' | 'handoff';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  explanation: string;
  yesLabel?: string;
  yesTargetId?: string;
  noLabel?: string;
  noTargetId?: string;
  nextId?: string; // '' or undefined = auto next in array; '__none__' = explicitly disconnected
  x?: number;
  y?: number;
}

export interface WorkflowEdge {
  id: string;
  sourceId: string;
  sourceHandle: 'next' | 'yes' | 'no';
  targetId: string;
  label?: string;
}

export interface AgentWorkflowState {
  enabled: boolean;
  nodes: WorkflowNode[];
}

export const WORKFLOW_START_MARKER = '<!-- ASKMINK_WORKFLOW_START -->';
export const WORKFLOW_END_MARKER = '<!-- ASKMINK_WORKFLOW_END -->';
export const RULES_START_MARKER = '<!-- ASKMINK_RULES_START -->';
export const RULES_END_MARKER = '<!-- ASKMINK_RULES_END -->';
export const DISCONNECTED_TARGET = '__none__';

export type ResponseLengthOption = 'short' | 'balanced' | 'detailed';

export type TonePresetId =
  | 'professional'
  | 'friendly'
  | 'direct'
  | 'consultative'
  | 'empathetic'
  | 'no_emojis';

export const TONE_PRESET_IDS: readonly TonePresetId[] = [
  'professional',
  'friendly',
  'direct',
  'consultative',
  'empathetic',
  'no_emojis',
] as const;

const TONE_PRESET_PROMPT_TEXT: Record<TonePresetId, string> = {
  professional: 'Professional',
  friendly: 'Friendly and welcoming',
  direct: 'Direct and to the point',
  consultative: 'Consultative and helpful',
  empathetic: 'Empathetic and patient',
  no_emojis: 'Do not use emojis',
};

const RESPONSE_LENGTH_PROMPT_TEXT: Record<ResponseLengthOption, string> = {
  short: 'Keep responses short and concise (1–3 sentences or brief bullet points).',
  balanced: 'Provide clear, balanced responses with just enough detail to be helpful.',
  detailed: 'Provide thorough, detailed responses with examples and step-by-step explanations when useful.',
};

export interface PromptRulesConfig {
  basePrompt: string;
  tonePresets: TonePresetId[];
  toneCustom: string;
  responseLength: ResponseLengthOption;
  dontRules: string;
}

export function parsePromptRules(fullPrompt: string): PromptRulesConfig {
  const withoutWorkflow = extractBaseSystemPrompt(fullPrompt || '');
  const startIdx = withoutWorkflow.indexOf(RULES_START_MARKER);
  const endIdx = withoutWorkflow.indexOf(RULES_END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return {
      basePrompt: withoutWorkflow,
      tonePresets: [],
      toneCustom: '',
      responseLength: 'balanced',
      dontRules: '',
    };
  }

  const before = withoutWorkflow.slice(0, startIdx).trim();
  const after = withoutWorkflow.slice(endIdx + RULES_END_MARKER.length).trim();
  const basePrompt = [before, after].filter(Boolean).join('\n\n');
  const block = withoutWorkflow.slice(startIdx + RULES_START_MARKER.length, endIdx);

  let tonePresets: TonePresetId[] = [];
  let responseLength: ResponseLengthOption = 'balanced';

  const metaMatch = block.match(/<!--\s*ASKMINK_RULES_META:(\{.*?\})\s*-->/);
  if (metaMatch?.[1]) {
    try {
      const parsed = JSON.parse(metaMatch[1]) as {
        tonePresets?: unknown;
        responseLength?: unknown;
      };
      if (Array.isArray(parsed.tonePresets)) {
        tonePresets = parsed.tonePresets.filter(
          (v): v is TonePresetId =>
            typeof v === 'string' && (TONE_PRESET_IDS as readonly string[]).includes(v)
        );
      }
      if (
        parsed.responseLength === 'short' ||
        parsed.responseLength === 'balanced' ||
        parsed.responseLength === 'detailed'
      ) {
        responseLength = parsed.responseLength;
      }
    } catch {
      // Ignore malformed meta JSON
    }
  }

  const extractSection = (heading: string): string => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`);
    const m = block.match(regex);
    return m?.[1]?.trim() || '';
  };

  const toneSection = extractSection('Tone & Personality');
  const toneCustom = toneSection
    .split('\n')
    .filter((line) => !line.startsWith('Traits: '))
    .join('\n')
    .trim();

  const dontRules = extractSection('Restrictions (What NOT to do)');

  return {
    basePrompt,
    tonePresets,
    toneCustom,
    responseLength,
    dontRules,
  };
}

export function compilePromptRules(config: PromptRulesConfig): string {
  const cleanBase = config.basePrompt.trim();
  const tonePresets = config.tonePresets.filter((id) => TONE_PRESET_IDS.includes(id));
  const toneCustom = config.toneCustom.trim();
  const dontRules = config.dontRules.trim();
  const responseLength = config.responseLength;

  const hasAnyRule =
    tonePresets.length > 0 ||
    toneCustom.length > 0 ||
    responseLength !== 'balanced' ||
    dontRules.length > 0;

  if (!hasAnyRule) {
    return cleanBase;
  }

  const sections: string[] = [
    RULES_START_MARKER,
    `<!-- ASKMINK_RULES_META:${JSON.stringify({ tonePresets, responseLength })} -->`,
  ];

  if (tonePresets.length > 0 || toneCustom.length > 0) {
    const toneLines: string[] = ['## Tone & Personality'];
    if (tonePresets.length > 0) {
      toneLines.push(`Traits: ${tonePresets.map((id) => TONE_PRESET_PROMPT_TEXT[id]).join(', ')}`);
    }
    if (toneCustom) {
      toneLines.push(toneCustom);
    }
    sections.push(toneLines.join('\n'));
  }

  if (responseLength !== 'balanced') {
    sections.push(`## Response Length\n${RESPONSE_LENGTH_PROMPT_TEXT[responseLength]}`);
  }

  if (dontRules) {
    sections.push(`## Restrictions (What NOT to do)\n${dontRules}`);
  }

  sections.push(RULES_END_MARKER);
  const rulesBlock = sections.join('\n\n');

  return cleanBase ? `${cleanBase}\n\n${rulesBlock}` : rulesBlock;
}

function sanitizeMermaidText(text: string): string {
  return text.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').replace(/[[\]{}]/g, '').trim() || 'Step';
}

export function resolveWorkflowEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
  const idSet = new Set(nodes.map((n) => n.id));
  const edges: WorkflowEdge[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === 'handoff') continue;

    if (node.type === 'decision') {
      const yesTarget =
        node.yesTargetId === DISCONNECTED_TARGET
          ? undefined
          : node.yesTargetId && idSet.has(node.yesTargetId)
            ? node.yesTargetId
            : nodes[i + 1]?.id;

      const noTarget =
        node.noTargetId === DISCONNECTED_TARGET
          ? undefined
          : node.noTargetId && idSet.has(node.noTargetId)
            ? node.noTargetId
            : nodes[i + 2]?.id;

      if (yesTarget && yesTarget !== node.id) {
        edges.push({
          id: `${node.id}-yes-${yesTarget}`,
          sourceId: node.id,
          sourceHandle: 'yes',
          targetId: yesTarget,
          label: node.yesLabel || 'Yes',
        });
      }
      if (noTarget && noTarget !== node.id) {
        edges.push({
          id: `${node.id}-no-${noTarget}`,
          sourceId: node.id,
          sourceHandle: 'no',
          targetId: noTarget,
          label: node.noLabel || 'No',
        });
      }
    } else {
      const target =
        node.nextId === DISCONNECTED_TARGET
          ? undefined
          : node.nextId && idSet.has(node.nextId)
            ? node.nextId
            : nodes[i + 1]?.id;

      if (target && target !== node.id) {
        edges.push({
          id: `${node.id}-next-${target}`,
          sourceId: node.id,
          sourceHandle: 'next',
          targetId: target,
        });
      }
    }
  }

  return edges;
}

export function autoLayoutWorkflow(nodes: WorkflowNode[]): WorkflowNode[] {
  if (nodes.length === 0) return [];
  const edges = resolveWorkflowEdges(nodes);
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    outgoing.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    outgoing.get(e.sourceId)?.push(e.targetId);
    inDegree.set(e.targetId, (inDegree.get(e.targetId) || 0) + 1);
  }

  // BFS layering from roots (start nodes or zero in-degree)
  const level = new Map<string, number>();
  const queue: string[] = [];

  const startNodes = nodes.filter((n) => n.type === 'start' || (inDegree.get(n.id) || 0) === 0);
  const roots = startNodes.length > 0 ? startNodes : [nodes[0]!];

  for (const root of roots) {
    if (!level.has(root.id)) {
      level.set(root.id, 0);
      queue.push(root.id);
    }
  }

  const visitedCount = new Map<string, number>();
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLvl = level.get(curr) || 0;
    for (const target of outgoing.get(curr) || []) {
      const seen = visitedCount.get(target) || 0;
      if (seen > nodes.length) continue; // guard against cycles
      const existing = level.get(target);
      if (existing === undefined || existing < currLvl + 1) {
        level.set(target, currLvl + 1);
        visitedCount.set(target, seen + 1);
        queue.push(target);
      }
    }
  }

  // Place any disconnected nodes at the bottom
  let maxLevel = 0;
  for (const lvl of level.values()) {
    if (lvl > maxLevel) maxLevel = lvl;
  }
  for (const n of nodes) {
    if (!level.has(n.id)) {
      maxLevel += 1;
      level.set(n.id, maxLevel);
    }
  }

  // Group by level preserving original order
  const layers = new Map<number, WorkflowNode[]>();
  for (const n of nodes) {
    const lvl = level.get(n.id) || 0;
    const arr = layers.get(lvl) || [];
    arr.push(n);
    layers.set(lvl, arr);
  }

  const NODE_SPACING_X = 310;
  const LEVEL_SPACING_Y = 200;
  const CENTER_X = 420;
  const START_Y = 48;

  const coords = new Map<string, { x: number; y: number }>();
  for (const [lvl, group] of layers.entries()) {
    const totalWidth = (group.length - 1) * NODE_SPACING_X;
    const startX = Math.max(40, CENTER_X - totalWidth / 2);
    group.forEach((node, idx) => {
      coords.set(node.id, {
        x: Math.round(startX + idx * NODE_SPACING_X),
        y: Math.round(START_Y + lvl * LEVEL_SPACING_Y),
      });
    });
  }

  return nodes.map((n) => {
    const pos = coords.get(n.id);
    return pos ? { ...n, x: pos.x, y: pos.y } : n;
  });
}

export function ensureWorkflowPositions(nodes: WorkflowNode[]): WorkflowNode[] {
  const needsLayout = nodes.some((n) => typeof n.x !== 'number' || typeof n.y !== 'number');
  if (!needsLayout) return nodes;
  return autoLayoutWorkflow(nodes);
}

export function generateMermaidFlowchart(nodes: WorkflowNode[]): string {
  if (nodes.length === 0) return 'flowchart TD\n  S1(["Start"])';

  const lines: string[] = ['flowchart TD'];

  for (const node of nodes) {
    const label = sanitizeMermaidText(node.title);
    if (node.type === 'start' || node.type === 'handoff') {
      lines.push(`  ${node.id}(["${label}"])`);
    } else if (node.type === 'decision') {
      lines.push(`  ${node.id}{"${label}"}`);
    } else if (node.type === 'tool') {
      lines.push(`  ${node.id}[["${label}"]]`);
    } else {
      lines.push(`  ${node.id}["${label}"]`);
    }
  }

  const edges = resolveWorkflowEdges(nodes);
  for (const edge of edges) {
    if (edge.label) {
      lines.push(`  ${edge.sourceId} -->|${sanitizeMermaidText(edge.label)}| ${edge.targetId}`);
    } else {
      lines.push(`  ${edge.sourceId} --> ${edge.targetId}`);
    }
  }

  return lines.join('\n');
}

export function extractBaseSystemPrompt(fullPrompt: string): string {
  const startIdx = fullPrompt.indexOf(WORKFLOW_START_MARKER);
  if (startIdx === -1) return fullPrompt.trim();
  const endIdx = fullPrompt.indexOf(WORKFLOW_END_MARKER);
  if (endIdx === -1) return fullPrompt.slice(0, startIdx).trim();
  const before = fullPrompt.slice(0, startIdx).trim();
  const after = fullPrompt.slice(endIdx + WORKFLOW_END_MARKER.length).trim();
  return [before, after].filter(Boolean).join('\n\n');
}

export function compileSystemPromptWithWorkflow(
  basePrompt: string,
  workflow: AgentWorkflowState
): string {
  const cleanBase = extractBaseSystemPrompt(basePrompt);
  if (!workflow.enabled || workflow.nodes.length === 0) {
    return cleanBase;
  }

  const mermaid = generateMermaidFlowchart(workflow.nodes);
  const stepLines = workflow.nodes.map((node) => {
    const detail = node.explanation.trim() || node.title;
    return `- **${node.id} (${node.title})**: ${detail}`;
  });

  const block = [
    WORKFLOW_START_MARKER,
    '## Conversation Workflow (Mermaid)',
    'Follow this conversation workflow strictly, adapting naturally to the user:',
    '```mermaid',
    mermaid,
    '```',
    '',
    '### Step Instructions',
    ...stepLines,
    WORKFLOW_END_MARKER,
  ].join('\n');

  return cleanBase ? `${cleanBase}\n\n${block}` : block;
}

export function parseWorkflowFromPrompt(fullPrompt: string): AgentWorkflowState | null {
  const startIdx = fullPrompt.indexOf(WORKFLOW_START_MARKER);
  const endIdx = fullPrompt.indexOf(WORKFLOW_END_MARKER);
  if (startIdx === -1 || endIdx === -1) return null;

  const block = fullPrompt.slice(startIdx, endIdx);
  const stepRegex = /^- \*\*([A-Za-z0-9_]+) \(([^)]+)\)\*\*: (.+)$/gm;
  const nodes: WorkflowNode[] = [];
  let match: RegExpExecArray | null;
  while ((match = stepRegex.exec(block)) !== null) {
    const id = match[1]!;
    const title = match[2]!;
    const explanation = match[3]!;
    const type: WorkflowNodeType =
      nodes.length === 0
        ? 'start'
        : block.includes(`${id}{"`)
          ? 'decision'
          : block.includes(`${id}[["`)
            ? 'tool'
            : 'step';
    nodes.push({ id, type, title, explanation });
  }
  if (nodes.length === 0) return null;
  return { enabled: true, nodes: autoLayoutWorkflow(nodes) };
}

export function loadAgentWorkflow(agentId: string, systemPrompt: string): AgentWorkflowState {
  try {
    const raw = localStorage.getItem(`askmink_workflow_${agentId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as AgentWorkflowState;
      if (Array.isArray(parsed.nodes)) {
        return {
          enabled: Boolean(parsed.enabled),
          nodes: ensureWorkflowPositions(parsed.nodes),
        };
      }
    }
  } catch {
    // Ignore storage read errors
  }

  const parsedFromPrompt = parseWorkflowFromPrompt(systemPrompt);
  if (parsedFromPrompt) return parsedFromPrompt;

  return { enabled: false, nodes: [] };
}

export function saveAgentWorkflow(agentId: string, state: AgentWorkflowState): void {
  try {
    localStorage.setItem(`askmink_workflow_${agentId}`, JSON.stringify(state));
  } catch {
    // Ignore storage write errors
  }
}

export type AgentTemplateId = 'sales' | 'support' | 'booking' | 'custom';

export interface AgentTemplate {
  id: AgentTemplateId;
  name: string;
  welcomeMessage: string;
  systemPrompt: string;
  primaryColor: string;
  workflow: WorkflowNode[];
}

export function getAgentTemplates(lang: SupportedLanguage): AgentTemplate[] {
  if (lang === 'pt') {
    return [
      {
        id: 'sales',
        name: 'Consultor de Vendas',
        welcomeMessage: 'Olá! Como posso ajudar você a encontrar o plano ideal hoje?',
        systemPrompt:
          'Você é um consultor comercial prestativo e objetivo. Responda usando a base de conhecimento, destaque benefícios com clareza, apresente planos/produtos quando relevante e conduza leads interessados para o checkout ou agendamento.',
        primaryColor: '#2563EB',
        workflow: autoLayoutWorkflow([
          {
            id: 'S1',
            type: 'start',
            title: 'Saudação cordial',
            explanation: 'Comece sempre com um bom dia/boa tarde simpático e pergunte como pode ajudar.',
            nextId: 'S2',
          },
          {
            id: 'S2',
            type: 'step',
            title: 'Perguntar nome e necessidade',
            explanation: 'Peça o nome do visitante e entenda qual problema ou objetivo ele busca resolver.',
            nextId: 'S3',
          },
          {
            id: 'S3',
            type: 'decision',
            title: 'Quer agendar ou ver planos?',
            explanation: 'Identifique se o visitante já quer conhecer preços/checkout ou prefere uma demonstração.',
            yesLabel: 'Agendar demo',
            yesTargetId: 'S4',
            noLabel: 'Ver planos',
            noTargetId: 'S5',
          },
          {
            id: 'S4',
            type: 'tool',
            title: 'Oferecer horários na Agenda',
            explanation: 'Consulte a agenda e exiba os horários disponíveis para agendar uma demonstração.',
            nextId: 'S6',
          },
          {
            id: 'S5',
            type: 'tool',
            title: 'Mostrar cards de produtos',
            explanation: 'Apresente o produto ou plano mais adequado com o link direto de checkout.',
            nextId: 'S6',
          },
          {
            id: 'S6',
            type: 'handoff',
            title: 'Capturar lead e encerrar',
            explanation: 'Confirme se restou alguma dúvida e registre o contato caso o cliente deseje acompanhamento.',
          },
        ]),
      },
      {
        id: 'support',
        name: 'Suporte Técnico',
        welcomeMessage: 'Oi! Em que posso ajudar com sua conta ou dúvida técnica?',
        systemPrompt:
          'Você é um especialista de suporte técnico. Consulte sempre a base de conhecimento antes de responder, cite as fontes relevantes, faça perguntas de diagnóstico curtas e abra um chamado quando o problema exigir intervenção humana.',
        primaryColor: '#059669',
        workflow: autoLayoutWorkflow([
          {
            id: 'S1',
            type: 'start',
            title: 'Boas-vindas de suporte',
            explanation: 'Cumprimente de forma empática e pergunte qual dificuldade o cliente está enfrentando.',
            nextId: 'S2',
          },
          {
            id: 'S2',
            type: 'step',
            title: 'Coletar contexto',
            explanation: 'Peça o nome e detalhes objetivos do erro ou tela onde o problema ocorreu.',
            nextId: 'S3',
          },
          {
            id: 'S3',
            type: 'decision',
            title: 'Resolvido pela base de conhecimento?',
            explanation: 'Verifique se a documentação resolve a questão de imediato.',
            yesLabel: 'Sim, resolvido',
            yesTargetId: 'S5',
            noLabel: 'Precisa escalar',
            noTargetId: 'S4',
          },
          {
            id: 'S4',
            type: 'tool',
            title: 'Abrir ticket de suporte',
            explanation: 'Peça o e-mail do cliente, resuma o problema e abra um chamado automaticamente.',
            nextId: 'S5',
          },
          {
            id: 'S5',
            type: 'handoff',
            title: 'Confirmar resolução',
            explanation: 'Confirme se o cliente precisa de mais ajuda e encerre com cordialidade.',
          },
        ]),
      },
      {
        id: 'booking',
        name: 'Concierge & Agendamento',
        welcomeMessage: 'Olá! Posso tirar suas dúvidas ou agendar um horário para você.',
        systemPrompt:
          'Você é um assistente de recepção e agendamentos. Seja educado, responda dúvidas sobre serviços e horários, e ajude o visitante a marcar uma reunião rapidamente.',
        primaryColor: '#4F46E5',
        workflow: autoLayoutWorkflow([
          {
            id: 'S1',
            type: 'start',
            title: 'Cumprimentar visitante',
            explanation: 'Dê boas-vindas com tom amigável e apresente como pode ajudar.',
            nextId: 'S2',
          },
          {
            id: 'S2',
            type: 'step',
            title: 'Identificar nome e assunto',
            explanation: 'Pergunte o nome da pessoa e o assunto da conversa ou reunião.',
            nextId: 'S3',
          },
          {
            id: 'S3',
            type: 'tool',
            title: 'Exibir horários livres',
            explanation: 'Mostre os horários disponíveis na agenda e auxilie na confirmação da reserva.',
            nextId: 'S4',
          },
          {
            id: 'S4',
            type: 'handoff',
            title: 'Confirmar agendamento',
            explanation: 'Reforce a confirmação e informe que o convite .ics está disponível.',
          },
        ]),
      },
      {
        id: 'custom',
        name: 'Agente Personalizado',
        welcomeMessage: 'Olá! Como posso ajudar você hoje?',
        systemPrompt:
          'Você é o assistente de IA da empresa. Responda com precisão usando a base de conhecimento, cite fontes quando aplicável e utilize as tools configuradas sempre que útil.',
        primaryColor: '#18181B',
        workflow: [],
      },
    ];
  }

  if (lang === 'es') {
    return [
      {
        id: 'sales',
        name: 'Asesor de Ventas',
        welcomeMessage: '¡Hola! ¿Cómo puedo ayudarte a elegir el plan ideal hoy?',
        systemPrompt:
          'Eres un asesor comercial claro y servicial. Responde usando la base de conocimiento, presenta planes o productos relevantes y guía a los interesados hacia el checkout o una demostración.',
        primaryColor: '#2563EB',
        workflow: autoLayoutWorkflow([
          {
            id: 'S1',
            type: 'start',
            title: 'Saludo inicial',
            explanation: 'Empieza siempre con un saludo cordial y pregunta en qué puedes ayudar.',
            nextId: 'S2',
          },
          {
            id: 'S2',
            type: 'step',
            title: 'Preguntar nombre y objetivo',
            explanation: 'Pide el nombre del visitante y comprende qué necesidad busca resolver.',
            nextId: 'S3',
          },
          {
            id: 'S3',
            type: 'decision',
            title: '¿Prefiere demo o ver planes?',
            explanation: 'Detecta si desea agendar una llamada o ver los precios de inmediato.',
            yesLabel: 'Agendar demo',
            yesTargetId: 'S4',
            noLabel: 'Ver planes',
            noTargetId: 'S5',
          },
          {
            id: 'S4',
            type: 'tool',
            title: 'Mostrar horarios disponibles',
            explanation: 'Muestra los horarios disponibles de la agenda para confirmar la reunión.',
            nextId: 'S6',
          },
          {
            id: 'S5',
            type: 'tool',
            title: 'Mostrar tarjetas de productos',
            explanation: 'Presenta el producto recomendado con su botón de checkout.',
            nextId: 'S6',
          },
          {
            id: 'S6',
            type: 'handoff',
            title: 'Capturar lead y cerrar',
            explanation: 'Confirma si tiene más dudas y registra sus datos de contacto.',
          },
        ]),
      },
      {
        id: 'support',
        name: 'Soporte Técnico',
        welcomeMessage: '¡Hola! ¿En qué puedo ayudarte con tu cuenta o duda técnica?',
        systemPrompt:
          'Eres un especialista de soporte técnico. Consulta primero la base de conocimiento, cita tus fuentes y crea un ticket cuando se necesite asistencia humana.',
        primaryColor: '#059669',
        workflow: autoLayoutWorkflow([
          {
            id: 'S1',
            type: 'start',
            title: 'Bienvenida de soporte',
            explanation: 'Saluda con empatía y pregunta qué inconveniente está experimentando.',
            nextId: 'S2',
          },
          {
            id: 'S2',
            type: 'step',
            title: 'Recopilar detalles',
            explanation: 'Pide su nombre y una breve descripción del error.',
            nextId: 'S3',
          },
          {
            id: 'S3',
            type: 'decision',
            title: '¿Resuelto con la documentación?',
            explanation: 'Comprueba si la base de conocimiento soluciona la consulta.',
            yesLabel: 'Resuelto',
            yesTargetId: 'S5',
            noLabel: 'Escalar',
            noTargetId: 'S4',
          },
          {
            id: 'S4',
            type: 'tool',
            title: 'Crear ticket de soporte',
            explanation: 'Solicita el correo del usuario y abre un ticket con el resumen.',
            nextId: 'S5',
          },
          {
            id: 'S5',
            type: 'handoff',
            title: 'Confirmar cierre',
            explanation: 'Pregunta si necesita algo más antes de despedirte.',
          },
        ]),
      },
      {
        id: 'booking',
        name: 'Concierge y Reservas',
        welcomeMessage: '¡Hola! Puedo resolver tus dudas o agendar una reunión.',
        systemPrompt:
          'Eres un asistente de recepción y reservas. Responde con amabilidad y facilita el agendamiento de reuniones.',
        primaryColor: '#4F46E5',
        workflow: autoLayoutWorkflow([
          {
            id: 'S1',
            type: 'start',
            title: 'Saludar al visitante',
            explanation: 'Da una bienvenida amable y ofrece ayuda.',
            nextId: 'S2',
          },
          {
            id: 'S2',
            type: 'step',
            title: 'Pedir nombre y motivo',
            explanation: 'Pregunta su nombre y el motivo de la cita.',
            nextId: 'S3',
          },
          {
            id: 'S3',
            type: 'tool',
            title: 'Ofrecer horarios',
            explanation: 'Muestra los horarios disponibles y ayuda a reservar.',
          },
        ]),
      },
      {
        id: 'custom',
        name: 'Agente Personalizado',
        welcomeMessage: '¡Hola! ¿Cómo puedo ayudarte hoy?',
        systemPrompt:
          'Eres un asistente de IA útil y preciso. Usa la base de conocimiento y las herramientas configuradas cuando sea necesario.',
        primaryColor: '#18181B',
        workflow: [],
      },
    ];
  }

  return [
    {
      id: 'sales',
      name: 'Sales Advisor',
      welcomeMessage: 'Hi! How can I help you find the right plan today?',
      systemPrompt:
        'You are a helpful, concise sales advisor. Answer accurately using the knowledge base, highlight value clearly, share product checkout cards when relevant, and offer demos when visitors want a walkthrough.',
      primaryColor: '#2563EB',
      workflow: autoLayoutWorkflow([
        {
          id: 'S1',
          type: 'start',
          title: 'Warm greeting',
          explanation: 'Always start with a friendly greeting and ask how you can help today.',
          nextId: 'S2',
        },
        {
          id: 'S2',
          type: 'step',
          title: 'Ask name & goal',
          explanation: 'Ask for the visitor name and understand what problem or use case they want to solve.',
          nextId: 'S3',
        },
        {
          id: 'S3',
          type: 'decision',
          title: 'Demo or pricing?',
          explanation: 'Determine if they prefer booking a live demo or exploring plans directly.',
          yesLabel: 'Book demo',
          yesTargetId: 'S4',
          noLabel: 'View plans',
          noTargetId: 'S5',
        },
        {
          id: 'S4',
          type: 'tool',
          title: 'Show booking slots',
          explanation: 'Fetch available calendar slots and present interactive booking times.',
          nextId: 'S6',
        },
        {
          id: 'S5',
          type: 'tool',
          title: 'Show product cards',
          explanation: 'Recommend the best-fitting plan with a direct checkout card.',
          nextId: 'S6',
        },
        {
          id: 'S6',
          type: 'handoff',
          title: 'Capture lead & wrap up',
          explanation: 'Confirm if they have remaining questions and capture their email for follow-up.',
        },
      ]),
    },
    {
      id: 'support',
      name: 'Technical Support',
      welcomeMessage: 'Hi there! How can I help troubleshoot your issue today?',
      systemPrompt:
        'You are a technical support specialist. Always search the knowledge base first, cite relevant docs, ask short diagnostic questions, and create a support ticket when human escalation is needed.',
      primaryColor: '#059669',
      workflow: autoLayoutWorkflow([
        {
          id: 'S1',
          type: 'start',
          title: 'Support greeting',
          explanation: 'Greet the user empathetically and ask what issue they are experiencing.',
          nextId: 'S2',
        },
        {
          id: 'S2',
          type: 'step',
          title: 'Gather context',
          explanation: 'Ask for their name and key details about the error or page.',
          nextId: 'S3',
        },
        {
          id: 'S3',
          type: 'decision',
          title: 'Resolved by knowledge base?',
          explanation: 'Check whether the docs solve the question immediately.',
          yesLabel: 'Resolved',
          yesTargetId: 'S5',
          noLabel: 'Escalate',
          noTargetId: 'S4',
        },
        {
          id: 'S4',
          type: 'tool',
          title: 'Create support ticket',
          explanation: 'Ask for their email, summarize the issue, and open a ticket.',
          nextId: 'S5',
        },
        {
          id: 'S5',
          type: 'handoff',
          title: 'Confirm resolution',
          explanation: 'Verify if anything else is needed and close politely.',
        },
      ]),
    },
    {
      id: 'booking',
      name: 'Booking Concierge',
      welcomeMessage: 'Hello! I can answer questions or help you schedule a meeting.',
      systemPrompt:
        'You are a friendly scheduling concierge. Answer service questions clearly and help visitors pick a convenient time slot.',
      primaryColor: '#4F46E5',
      workflow: autoLayoutWorkflow([
        {
          id: 'S1',
          type: 'start',
          title: 'Welcome visitor',
          explanation: 'Greet warmly and offer assistance.',
          nextId: 'S2',
        },
        {
          id: 'S2',
          type: 'step',
          title: 'Ask name & topic',
          explanation: 'Collect the visitor name and meeting topic.',
          nextId: 'S3',
        },
        {
          id: 'S3',
          type: 'tool',
          title: 'Offer calendar slots',
          explanation: 'Display available slots and guide them through confirming the booking.',
        },
      ]),
    },
    {
      id: 'custom',
      name: 'Custom Agent',
      welcomeMessage: 'Hi! How can I help you today?',
      systemPrompt:
        'You are Askmink, a helpful AI sales and support agent. Answer accurately using the knowledge base, cite sources when applicable, and use tools when helpful.',
      primaryColor: '#18181B',
      workflow: [],
    },
  ];
}
