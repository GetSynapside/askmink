import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  GitBranch,
  GripVertical,
  LayoutGrid,
  Maximize2,
  MessageSquareText,
  Minus,
  Play,
  Plus,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  resolveWorkflowEdges,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeType,
} from '../lib/workflow';

const NODE_WIDTH = 256;
const DEFAULT_NODE_HEIGHT = 124;

interface WorkflowCanvasProps {
  nodes: WorkflowNode[];
  selectedNodeId: string;
  t: Record<string, string>;
  nodeTypeLabel: (type: WorkflowNodeType) => string;
  onSelectNode: (id: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onDeleteNode: (id: string) => void;
  onConnect: (sourceId: string, sourceHandle: 'next' | 'yes' | 'no', targetId: string) => void;
  onDisconnect: (sourceId: string, sourceHandle: 'next' | 'yes' | 'no') => void;
  onAutoLayout: () => void;
}

const NODE_THEME: Record<
  WorkflowNodeType,
  { badge: string; accent: string; icon: typeof Play }
> = {
  start: {
    badge: 'bg-[#ECFDF5] text-[#047857] border-[#D1FAE5]',
    accent: '#10B981',
    icon: Play,
  },
  step: {
    badge: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#DBEAFE]',
    accent: '#2563EB',
    icon: MessageSquareText,
  },
  decision: {
    badge: 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]',
    accent: '#D97706',
    icon: GitBranch,
  },
  tool: {
    badge: 'bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]',
    accent: '#7C3AED',
    icon: Wrench,
  },
  handoff: {
    badge: 'bg-[#F3F4F6] text-[#374151] border-[#E5E7EB]',
    accent: '#4B5563',
    icon: Bot,
  },
};

function computeBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { path: string; midX: number; midY: number } {
  const dy = y2 - y1;
  if (dy >= -10) {
    const c = Math.max(54, Math.abs(dy) * 0.52);
    const cx1 = x1;
    const cy1 = y1 + c;
    const cx2 = x2;
    const cy2 = y2 - c;
    const path = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
    const midX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
    const midY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
    return { path, midX, midY };
  }

  // Upward / loop-back edge: route cleanly around the side
  const side = x2 >= x1 ? 1 : -1;
  const spread = Math.max(130, Math.abs(x2 - x1) * 0.65);
  const cx1 = x1 + side * spread;
  const cy1 = y1 + 60;
  const cx2 = x2 + side * spread;
  const cy2 = y2 - 60;
  const path = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  const midX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
  const midY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
  return { path, midX, midY };
}

export function WorkflowCanvas({
  nodes,
  selectedNodeId,
  t,
  nodeTypeLabel,
  onSelectNode,
  onMoveNode,
  onDeleteNode,
  onConnect,
  onDisconnect,
  onAutoLayout,
}: WorkflowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});

  const [pan, setPan] = useState({ x: 40, y: 24 });
  const [zoom, setZoom] = useState(0.92);
  const [isPanning, setIsPanning] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');

  // Node drag state
  const dragNodeRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  // Canvas pan state
  const panStartRef = useRef<{
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
  } | null>(null);

  // Connection drag state
  const [draftConn, setDraftConn] = useState<{
    sourceId: string;
    sourceHandle: 'next' | 'yes' | 'no';
    startX: number;
    startY: number;
    currX: number;
    currY: number;
    hoveredTargetId: string | null;
  } | null>(null);

  // Measure actual DOM heights of nodes so bottom ports align to the exact pixel
  useLayoutEffect(() => {
    const measured: Record<string, number> = {};
    let changed = false;
    for (const n of nodes) {
      const el = nodeElsRef.current.get(n.id);
      const h = el ? el.offsetHeight : DEFAULT_NODE_HEIGHT;
      measured[n.id] = h;
      if (nodeHeights[n.id] !== h) changed = true;
    }
    if (changed) {
      setNodeHeights(measured);
    }
  }, [nodes]);

  const edges = useMemo(() => resolveWorkflowEdges(nodes), [nodes]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const getPortCoords = useCallback(
    (nodeId: string, handle: 'in' | 'next' | 'yes' | 'no') => {
      const node = nodeMap.get(nodeId);
      if (!node) return { x: 0, y: 0 };
      const x = node.x ?? 80;
      const y = node.y ?? 60;
      const h = nodeHeights[nodeId] || DEFAULT_NODE_HEIGHT;
      if (handle === 'in') return { x: x + NODE_WIDTH / 2, y };
      if (handle === 'yes') return { x: x + NODE_WIDTH * 0.28, y: y + h };
      if (handle === 'no') return { x: x + NODE_WIDTH * 0.72, y: y + h };
      return { x: x + NODE_WIDTH / 2, y: y + h };
    },
    [nodeMap, nodeHeights]
  );

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const nx = n.x ?? 80;
      const ny = n.y ?? 60;
      const nh = nodeHeights[n.id] || DEFAULT_NODE_HEIGHT;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx + NODE_WIDTH);
      maxY = Math.max(maxY, ny + nh);
    }
    const contentW = Math.max(200, maxX - minX + 120);
    const contentH = Math.max(200, maxY - minY + 120);
    const nextZoom = Math.max(
      0.55,
      Math.min(1.05, Math.min(rect.width / contentW, rect.height / contentH))
    );
    const nextPanX = (rect.width - (maxX - minX) * nextZoom) / 2 - minX * nextZoom;
    const nextPanY = Math.max(28, (rect.height - (maxY - minY) * nextZoom) / 2 - minY * nextZoom);
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) });
  }, [nodes, nodeHeights]);

  // Fit on initial non-empty load
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (nodes.length > 0 && !didInitialFitRef.current) {
      didInitialFitRef.current = true;
      requestAnimationFrame(() => fitView());
    }
  }, [nodes.length, fitView]);

  // Handle mouse/pointer connection dragging across document
  useEffect(() => {
    if (!draftConn) return;

    function findTargetAt(wx: number, wy: number, sourceId: string): string | null {
      const PAD = 24;
      for (const n of nodes) {
        if (n.id === sourceId) continue;
        const nx = n.x ?? 80;
        const ny = n.y ?? 60;
        const nh = nodeHeights[n.id] || DEFAULT_NODE_HEIGHT;
        if (wx >= nx - PAD && wx <= nx + NODE_WIDTH + PAD && wy >= ny - PAD && wy <= ny + nh + PAD) {
          return n.id;
        }
      }
      return null;
    }

    function onMove(e: PointerEvent) {
      const world = clientToWorld(e.clientX, e.clientY);
      setDraftConn((prev) => {
        if (!prev) return null;
        const hoveredTargetId = findTargetAt(world.x, world.y, prev.sourceId);
        if (hoveredTargetId) {
          const snap = getPortCoords(hoveredTargetId, 'in');
          return { ...prev, currX: snap.x, currY: snap.y, hoveredTargetId };
        }
        return { ...prev, currX: world.x, currY: world.y, hoveredTargetId: null };
      });
    }

    function onUp() {
      setDraftConn((prev) => {
        if (prev?.hoveredTargetId) {
          onConnect(prev.sourceId, prev.sourceHandle, prev.hoveredTargetId);
        }
        return null;
      });
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [draftConn?.sourceId, draftConn?.sourceHandle, clientToWorld, getPortCoords, nodes, nodeHeights, onConnect]);

  function startPan(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-wf-node="true"], [data-wf-control="true"]')) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    panStartRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
    };
    setIsPanning(true);
  }

  function movePan(e: React.PointerEvent<HTMLDivElement>) {
    const p = panStartRef.current;
    if (!p || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setPan({
      x: Math.round(p.origPanX + (e.clientX - p.startClientX)),
      y: Math.round(p.origPanY + (e.clientY - p.startClientY)),
    });
  }

  function endPan() {
    panStartRef.current = null;
    setIsPanning(false);
  }

  function startNodeDrag(e: React.PointerEvent<HTMLElement>, node: WorkflowNode) {
    if (e.button !== 0) return;
    const interactive = (e.target as HTMLElement).closest(
      'button:not([data-drag-handle="true"]), input, select, textarea, a, [data-port="true"]'
    );
    if (interactive) return;

    e.stopPropagation();
    onSelectNode(node.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragNodeRef.current = {
      id: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: node.x ?? 80,
      origY: node.y ?? 60,
    };
    setDraggingNodeId(node.id);
  }

  function moveNodeDrag(e: React.PointerEvent<HTMLElement>) {
    const drag = dragNodeRef.current;
    if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = (e.clientX - drag.startClientX) / zoom;
    const dy = (e.clientY - drag.startClientY) / zoom;
    onMoveNode(drag.id, Math.round(drag.origX + dx), Math.round(drag.origY + dy));
  }

  function endNodeDrag() {
    dragNodeRef.current = null;
    setDraggingNodeId(null);
  }

  function handleHandleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, node: WorkflowNode) {
    const STEP = 20;
    const nx = node.x ?? 80;
    const ny = node.y ?? 60;
    let direction = '';
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onMoveNode(node.id, nx, ny - STEP);
      direction = 'up';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onMoveNode(node.id, nx, ny + STEP);
      direction = 'down';
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onMoveNode(node.id, nx - STEP, ny);
      direction = 'left';
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onMoveNode(node.id, nx + STEP, ny);
      direction = 'right';
    }
    if (direction) {
      setLiveMessage(`${node.title} moved ${direction}`);
    }
  }

  function startConnection(
    e: React.PointerEvent<HTMLButtonElement>,
    nodeId: string,
    handle: 'next' | 'yes' | 'no'
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = getPortCoords(nodeId, handle);
    setDraftConn({
      sourceId: nodeId,
      sourceHandle: handle,
      startX: start.x,
      startY: start.y,
      currX: start.x,
      currY: start.y + 18,
      hoveredTargetId: null,
    });
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      setZoom((z) => Number(Math.max(0.45, Math.min(1.45, z + delta)).toFixed(2)));
    } else {
      setPan((p) => ({
        x: Math.round(p.x - e.deltaX),
        y: Math.round(p.y - e.deltaY),
      }));
    }
  }

  function edgeColor(edge: WorkflowEdge): string {
    if (edge.sourceHandle === 'yes') return '#10B981';
    if (edge.sourceHandle === 'no') return '#F43F5E';
    return '#64748B';
  }

  const gridSize = Math.max(12, Math.round(22 * zoom));

  return (
    <div
      ref={containerRef}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onLostPointerCapture={endPan}
      onWheel={handleWheel}
      style={{
        backgroundImage: 'radial-gradient(#CBD5E1 1.15px, transparent 1.15px)',
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      className={`wf-canvas relative flex-1 overflow-hidden bg-[#F8FAFC] ${
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      <div className="visually-hidden" aria-live="polite">
        {liveMessage}
      </div>

      {/* World Transform Layer */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        className="absolute inset-0 pointer-events-none"
      >
        {/* SVG Edges Layer */}
        <svg
          className="overflow-visible absolute top-0 left-0 w-1 h-1 pointer-events-none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="wf-arrow-next"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#64748B" />
            </marker>
            <marker
              id="wf-arrow-yes"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#10B981" />
            </marker>
            <marker
              id="wf-arrow-no"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#F43F5E" />
            </marker>
            <marker
              id="wf-arrow-draft"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#2563EB" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const p1 = getPortCoords(edge.sourceId, edge.sourceHandle);
            const p2 = getPortCoords(edge.targetId, 'in');
            const { path } = computeBezier(p1.x, p1.y, p2.x, p2.y);
            const color = edgeColor(edge);
            const marker =
              edge.sourceHandle === 'yes'
                ? 'url(#wf-arrow-yes)'
                : edge.sourceHandle === 'no'
                  ? 'url(#wf-arrow-no)'
                  : 'url(#wf-arrow-next)';
            return (
              <g key={edge.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  markerEnd={marker}
                />
              </g>
            );
          })}

          {draftConn && (() => {
            const { path } = computeBezier(
              draftConn.startX,
              draftConn.startY,
              draftConn.currX,
              draftConn.currY
            );
            return (
              <path
                d={path}
                fill="none"
                stroke="#2563EB"
                strokeWidth={2.4}
                strokeDasharray="6 5"
                strokeLinecap="round"
                markerEnd="url(#wf-arrow-draft)"
              />
            );
          })()}
        </svg>

        {/* Interactive Edge Pills (Label + Disconnect Button) */}
        {edges.map((edge) => {
          const p1 = getPortCoords(edge.sourceId, edge.sourceHandle);
          const p2 = getPortCoords(edge.targetId, 'in');
          const { midX, midY } = computeBezier(p1.x, p1.y, p2.x, p2.y);
          const pillTone =
            edge.sourceHandle === 'yes'
              ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]'
              : edge.sourceHandle === 'no'
                ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#BE123C]'
                : 'bg-white border-[#E2E8F0] text-[#475569]';

          return (
            <div
              key={`lbl-${edge.id}`}
              data-wf-control="true"
              style={{
                left: midX,
                top: midY,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute pointer-events-auto group inline-flex items-center gap-1 rounded-full border shadow-2xs text-[10px] font-semibold transition ${
                edge.label ? 'px-2 py-0.5' : 'p-0.5 opacity-60 hover:opacity-100'
              } ${pillTone}`}
            >
              {edge.label && <span className="max-w-[110px] truncate">{edge.label}</span>}
              <button
                type="button"
                title={t.workflowDisconnect}
                aria-label={`${t.workflowDisconnect}: ${edge.sourceId} → ${edge.targetId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDisconnect(edge.sourceId, edge.sourceHandle);
                }}
                className="w-3.5 h-3.5 rounded-full hover:bg-black/10 flex items-center justify-center cursor-pointer"
              >
                <X className="w-2.5 h-2.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}

        {/* Draggable Node Cards */}
        {nodes.map((node) => {
          const theme = NODE_THEME[node.type];
          const Icon = theme.icon;
          const isSelected = selectedNodeId === node.id;
          const isDragging = draggingNodeId === node.id;
          const isSnapTarget = draftConn?.hoveredTargetId === node.id;
          const nx = node.x ?? 80;
          const ny = node.y ?? 60;

          return (
            <div
              key={node.id}
              ref={(el) => {
                if (el) nodeElsRef.current.set(node.id, el);
                else nodeElsRef.current.delete(node.id);
              }}
              data-wf-node="true"
              onPointerDown={(e) => startNodeDrag(e, node)}
              onPointerMove={moveNodeDrag}
              onPointerUp={endNodeDrag}
              onLostPointerCapture={endNodeDrag}
              style={{
                left: nx,
                top: ny,
                width: NODE_WIDTH,
              }}
              className={`absolute pointer-events-auto bg-white rounded-xl border transition-shadow ${
                isSnapTarget
                  ? 'border-[#2563EB] ring-4 ring-[#2563EB]/20 shadow-lg'
                  : isSelected
                    ? 'border-[#18181B] ring-2 ring-[#18181B]/15 shadow-md'
                    : 'border-[#E2E8F0] hover:border-[#94A3B8] shadow-xs'
              } ${isDragging ? 'cursor-grabbing shadow-xl z-30' : 'cursor-grab z-10'}`}
            >
              {/* Top Input Port */}
              {node.type !== 'start' && (
                <div
                  data-port="true"
                  title="Input"
                  className={`absolute -top-2 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 transition ${
                    isSnapTarget
                      ? 'bg-[#2563EB] border-white scale-125 shadow-sm'
                      : 'bg-white border-[#94A3B8]'
                  }`}
                />
              )}

              {/* Node Header */}
              <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    data-drag-handle="true"
                    aria-label={`${node.title} drag handle. Use arrow keys to move.`}
                    onKeyDown={(e) => handleHandleKeyDown(e, node)}
                    className="wf-drag-handle w-5 h-5 rounded text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6] flex items-center justify-center shrink-0"
                  >
                    <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <span className="text-[10px] font-mono font-bold text-[#4B5563] bg-[#F3F4F6] px-1.5 py-0.5 rounded">
                    {node.id}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border truncate ${theme.badge}`}
                  >
                    <Icon className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{nodeTypeLabel(node.type)}</span>
                  </span>
                </div>

                <button
                  type="button"
                  aria-label={`Delete ${node.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteNode(node.id);
                  }}
                  className="w-6 h-6 rounded-md text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* Node Body */}
              <div className="px-3.5 pb-3.5 space-y-1">
                <div className="text-[13px] font-semibold text-[#111827] leading-snug">
                  {node.title}
                </div>
                {node.explanation && (
                  <p className="text-[11px] text-[#6B7280] leading-relaxed line-clamp-2">
                    {node.explanation}
                  </p>
                )}
              </div>

              {/* Bottom Output Ports */}
              {node.type === 'decision' ? (
                <>
                  {/* Decision footer labels */}
                  <div className="px-3 pb-2.5 pt-1 border-t border-[#F1F5F9] grid grid-cols-2 gap-1.5 text-[10px] font-semibold">
                    <div className="text-center text-[#047857] bg-[#ECFDF5] rounded-md py-0.5 px-1 truncate">
                      {node.yesLabel || 'Yes'}
                    </div>
                    <div className="text-center text-[#BE123C] bg-[#FFF1F2] rounded-md py-0.5 px-1 truncate">
                      {node.noLabel || 'No'}
                    </div>
                  </div>
                  {/* Branch A Port (left) */}
                  <button
                    type="button"
                    data-port="true"
                    aria-label={`Connect ${node.yesLabel || 'Branch A'} from ${node.id}`}
                    onPointerDown={(e) => startConnection(e, node.id, 'yes')}
                    style={{ left: '28%' }}
                    className="absolute -bottom-2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#10B981] border-2 border-white shadow-xs hover:scale-125 cursor-crosshair transition"
                  />
                  {/* Branch B Port (right) */}
                  <button
                    type="button"
                    data-port="true"
                    aria-label={`Connect ${node.noLabel || 'Branch B'} from ${node.id}`}
                    onPointerDown={(e) => startConnection(e, node.id, 'no')}
                    style={{ left: '72%' }}
                    className="absolute -bottom-2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#F43F5E] border-2 border-white shadow-xs hover:scale-125 cursor-crosshair transition"
                  />
                </>
              ) : (
                node.type !== 'handoff' && (
                  <button
                    type="button"
                    data-port="true"
                    aria-label={`Connect output from ${node.id}`}
                    onPointerDown={(e) => startConnection(e, node.id, 'next')}
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#18181B] border-2 border-white shadow-xs hover:scale-125 hover:bg-[#2563EB] cursor-crosshair transition"
                  />
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom-left helper hint */}
      <div
        data-wf-control="true"
        className="hidden sm:flex absolute bottom-3 left-3 z-20 px-3 py-1.5 rounded-lg bg-white/90 backdrop-blur-xs border border-[#E2E8F0] text-[11px] text-[#64748B] shadow-2xs pointer-events-none"
      >
        {t.workflowCanvasHint}
      </div>

      {/* Bottom-right Zoom & Auto-Layout Controls */}
      <div
        data-wf-control="true"
        className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1 p-1 rounded-xl bg-white border border-[#E2E8F0] shadow-sm"
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Number(Math.max(0.45, z - 0.1).toFixed(2)))}
          aria-label="Zoom out"
          className="w-7 h-7 rounded-lg text-[#475569] hover:bg-[#F1F5F9] flex items-center justify-center cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <span className="px-1.5 text-[11px] font-medium text-[#334155] tabular-nums min-w-[40px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Number(Math.min(1.45, z + 0.1).toFixed(2)))}
          aria-label="Zoom in"
          className="w-7 h-7 rounded-lg text-[#475569] hover:bg-[#F1F5F9] flex items-center justify-center cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <div className="w-px h-4 bg-[#E2E8F0] mx-0.5" aria-hidden="true" />
        <button
          type="button"
          onClick={fitView}
          title={t.workflowFitView}
          aria-label={t.workflowFitView}
          className="w-7 h-7 rounded-lg text-[#475569] hover:bg-[#F1F5F9] flex items-center justify-center cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            onAutoLayout();
            requestAnimationFrame(() => fitView());
          }}
          className="px-2.5 h-7 rounded-lg text-[11px] font-medium text-[#111827] hover:bg-[#F1F5F9] inline-flex items-center gap-1.5 cursor-pointer"
        >
          <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t.workflowAutoLayout}</span>
        </button>
      </div>
    </div>
  );
}
