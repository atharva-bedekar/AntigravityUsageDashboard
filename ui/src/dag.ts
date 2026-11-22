import { DagEdge, DagNode, SessionDagGraph, SessionDagPayload } from "./types.ts";
import {
  escapeHtml,
  formatCacheHitRate,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "./format.ts";

const NODE_W = 204;
const NODE_H = 74;
const COL_GAP = 64;
const ROW_GAP = 18;
const CLUSTER_GAP = 148;
const CANVAS_PAD_X = 24;
const CANVAS_PAD_Y = 24;
const CLUSTER_PAD_X = 18;
const CLUSTER_PAD_TOP = 38;
const CLUSTER_PAD_BOTTOM = 18;
const FEEDBACK_BAND_BASE = 32;
const FEEDBACK_BAND_STEP = 26;

interface PositionedNode {
  node: DagNode;
  x: number;
  y: number;
}

interface ClusterLayout {
  graph: SessionDagGraph;
  boxW: number;
  boxH: number;
  nodesTopOffset: number;
  nodes: PositionedNode[];
  posById: Map<string, PositionedNode>;
}

function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

function agentStripeKey(agentType: string): string {
  const norm = agentType.trim().toLowerCase().replace(/[\s_]+/g, "-");
  switch (norm) {
    case "planner":
      return "planner";
    case "orchestrator":
      return "orchestrator";
    case "main":
    case "main-agent":
      return "main";
    case "researcher":
      return "researcher";
    case "plan-critic":
    case "critic":
      return "plan-critic";
    case "implementer":
      return "implementer";
    case "code-reviewer":
    case "reviewer":
      return "code-reviewer";
    case "verifier":
      return "verifier";
    default:
      return "default";
  }
}

function layoutCluster(graph: SessionDagGraph, showClusterBox: boolean): ClusterLayout {
  const maxWave = Math.max(
    graph.waveCount,
    ...graph.nodes.map((n) => Math.max(0, n.waveIndex)),
    0
  );
  const columns: DagNode[][] = Array.from({ length: maxWave + 1 }, () => []);
  for (const node of graph.nodes) {
    const colIdx = Math.max(0, node.waveIndex);
    columns[colIdx].push(node);
  }

  const maxRows = Math.max(1, ...columns.map((col) => col.length));
  const nodesHeight = maxRows * NODE_H + (maxRows - 1) * ROW_GAP;
  const numCols = maxWave + 1;
  const nodesWidth = numCols * NODE_W + (numCols - 1) * COL_GAP;

  const feedbackCount = graph.edges.filter((e) => e.kind === "feedback").length;
  const feedbackExtraTop =
    feedbackCount > 0 ? FEEDBACK_BAND_BASE + (feedbackCount - 1) * FEEDBACK_BAND_STEP : 0;

  const padX = showClusterBox ? CLUSTER_PAD_X : 0;
  const padTop = (showClusterBox ? CLUSTER_PAD_TOP : 0) + feedbackExtraTop;
  const padBottom = showClusterBox ? CLUSTER_PAD_BOTTOM : 0;

  const boxW = nodesWidth + padX * 2;
  const boxH = nodesHeight + padTop + padBottom;

  const nodes: PositionedNode[] = [];
  const posById = new Map<string, PositionedNode>();

  columns.forEach((colNodes, colIdx) => {
    if (colNodes.length === 0) return;
    const colHeight = colNodes.length * NODE_H + (colNodes.length - 1) * ROW_GAP;
    const colStartY = padTop + (nodesHeight - colHeight) / 2;
    const colX = padX + colIdx * (NODE_W + COL_GAP);

    colNodes.forEach((node, rowIdx) => {
      const positioned: PositionedNode = {
        node,
        x: colX,
        y: colStartY + rowIdx * (NODE_H + ROW_GAP),
      };
      nodes.push(positioned);
      posById.set(node.nodeId, positioned);
    });
  });

  return {
    graph,
    boxW,
    boxH,
    nodesTopOffset: padTop,
    nodes,
    posById,
  };
}

function renderClusterEdges(
  edges: DagEdge[],
  posById: Map<string, PositionedNode>,
  offsetX: number,
  offsetY: number,
  clusterNodesMinY: number
): string {
  let feedbackIdx = 0;

  return edges
    .map((edge) => {
      const fromPos = posById.get(edge.fromNodeId);
      const toPos = posById.get(edge.toNodeId);
      if (!fromPos || !toPos) return "";

      if (edge.kind === "feedback") {
        const x1 = offsetX + fromPos.x + NODE_W / 2;
        const y1 = offsetY + fromPos.y;
        const x2 = offsetX + toPos.x + NODE_W / 2;
        const y2 = offsetY + toPos.y - 1;

        const apexY = offsetY + clusterNodesMinY - 22 - feedbackIdx * FEEDBACK_BAND_STEP;
        feedbackIdx += 1;
        // Solve cubic Bezier y(0.5) = 0.125*(y1 + y2) + 0.75*ctrlY = apexY
        const ctrlY = (apexY - 0.125 * (y1 + y2)) / 0.75;
        const midX = (x1 + x2) / 2;

        const turnText = `${edge.messageTurns} turn${edge.messageTurns === 1 ? "" : "s"}`;
        const pillW = Math.max(54, turnText.length * 6.8 + 16);
        const pillH = 20;

        return `
          <g class="dag-edge-feedback">
            <path d="M ${x1} ${y1} C ${x1} ${ctrlY}, ${x2} ${ctrlY}, ${x2} ${y2}" fill="none" stroke="var(--text-muted)" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#dag-arrow-muted)" />
            <rect x="${midX - pillW / 2}" y="${apexY - pillH / 2}" width="${pillW}" height="${pillH}" rx="10" fill="var(--bg-subtle)" stroke="var(--border-card)" stroke-width="1" />
            <text x="${midX}" y="${apexY + 3.5}" text-anchor="middle" fill="var(--text-standard)" font-size="10.5" font-family="var(--font-mono)" style="font-variant-numeric:tabular-nums">${escapeHtml(turnText)}</text>
          </g>
        `;
      }

      const x1 = offsetX + fromPos.x + NODE_W;
      const y1 = offsetY + fromPos.y + NODE_H / 2;
      const x2 = offsetX + toPos.x;
      const y2 = offsetY + toPos.y + NODE_H / 2;
      const dx = Math.max(32, Math.abs(x2 - x1) * 0.48);

      return `<path class="dag-edge-dispatch" d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="var(--border-divider)" stroke-width="1.5" marker-end="url(#dag-arrow)" />`;
    })
    .join("");
}

function renderClusterNodes(
  nodes: PositionedNode[],
  offsetX: number,
  offsetY: number,
  numberFormat: "compact" | "full"
): { svg: string; absPositions: Map<string, { node: DagNode; x: number; y: number }> } {
  const absPositions = new Map<string, { node: DagNode; x: number; y: number }>();

  const svg = nodes
    .map(({ node, x, y }) => {
      const absX = offsetX + x;
      const absY = offsetY + y;
      absPositions.set(node.nodeId, { node, x: absX, y: absY });

      const stripeKey = agentStripeKey(node.agentType);
      const displayRole = node.roleLabel.trim() || node.agentType;
      const shortRole = truncateLabel(displayRole, 24);
      const footerText = `${formatTokens(node.total, numberFormat)} · ${formatDuration(node.wallTimeSecs)}`;
      const ariaLabel = `${node.agentType}: ${displayRole}, ${formatTokens(node.total, numberFormat)} tokens, ${formatDuration(node.wallTimeSecs)}`;

      return `
        <g class="dag-node" data-node-id="${escapeHtml(node.nodeId)}" transform="translate(${absX}, ${absY})" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}">
          <rect class="dag-node-card" x="0" y="0" width="${NODE_W}" height="${NODE_H}" rx="8" fill="var(--bg-surface)" stroke="var(--border-card)" stroke-width="1" />
          <rect x="0.5" y="0.5" width="4.5" height="${NODE_H - 1}" clip-path="url(#dag-card-clip)" class="dag-stripe-${escapeHtml(stripeKey)}" />
          <text class="dag-node-badge" x="14" y="21" fill="var(--text-muted)" font-size="10.5" font-family="var(--font-mono)" font-weight="600" letter-spacing="0.04em">${escapeHtml(node.agentType)}</text>
          <text x="14" y="41" fill="var(--text-strong)" font-size="12.5" font-weight="500">${escapeHtml(shortRole)}</text>
          <text x="14" y="59" fill="var(--text-muted)" font-size="11.5" font-family="var(--font-mono)" style="font-variant-numeric:tabular-nums">${escapeHtml(footerText)}</text>
        </g>
      `;
    })
    .join("");

  return { svg, absPositions };
}

function buildTooltipHtml(node: DagNode, numberFormat: "compact" | "full"): string {
  const fmtCount = (val: number): string => {
    const primary = formatTokens(val, numberFormat);
    const exact = formatExactTokens(val);
    return primary === exact ? exact : `${primary} (${exact})`;
  };

  const displayRole = node.roleLabel.trim() || node.agentType;
  const cacheHit = formatCacheHitRate(node.freshIn, node.cached, node.cacheHitRate);
  const messageTurnsRow =
    node.messageTurns > 0
      ? `
        <span>Message Turns</span>
        <span class="dag-tooltip-val">${escapeHtml(formatExactTokens(node.messageTurns))}</span>
      `
      : "";

  return `
    <div class="dag-tooltip-title">${escapeHtml(node.agentType)} · ${escapeHtml(displayRole)}</div>
    <div class="dag-tooltip-grid">
      <span>Model</span>
      <span class="dag-tooltip-val">${escapeHtml(node.model || "—")}</span>
      <span>Total</span>
      <span class="dag-tooltip-val">${escapeHtml(fmtCount(node.total))}</span>
      <span>Input</span>
      <span class="dag-tooltip-val">${escapeHtml(fmtCount(node.freshIn))}</span>
      <span>Cached</span>
      <span class="dag-tooltip-val">${escapeHtml(fmtCount(node.cached))}</span>
      <span>Output</span>
      <span class="dag-tooltip-val">${escapeHtml(fmtCount(node.output))}</span>
      <span>Cache Hit Rate</span>
      <span class="dag-tooltip-val">${escapeHtml(cacheHit)}</span>
      <span>Wall Time</span>
      <span class="dag-tooltip-val">${escapeHtml(formatDuration(node.wallTimeSecs))}</span>
      <span>LLM Calls</span>
      <span class="dag-tooltip-val">${escapeHtml(formatExactTokens(node.calls))}</span>
      <span>Tool Calls</span>
      <span class="dag-tooltip-val">${escapeHtml(formatExactTokens(node.toolCallCount))}</span>
      ${messageTurnsRow}
    </div>
  `;
}

/**
 * Renders an orchestration DAG (single session or linked Planner -> Orchestrator pair)
 * into `container` using deterministic SVG layout and accessible floating telemetry tooltips.
 */
export function renderOrchestrationDag(
  container: HTMLElement,
  payload: SessionDagPayload,
  numberFormat: "compact" | "full"
): void {
  if (payload.primary.nodes.length === 0) {
    container.innerHTML = `<div class="dag-empty-note">No orchestration nodes recorded in this session.</div>`;
    return;
  }

  const isLinked = payload.secondary !== null && payload.link !== null;
  const primaryLayout = layoutCluster(payload.primary, isLinked);

  let svgWidth = 0;
  let svgHeight = 0;
  let clustersSvg = "";
  let bridgeSvg = "";
  let edgesSvg = "";
  let nodesSvg = "";
  const allAbsPositions = new Map<string, { node: DagNode; x: number; y: number }>();

  if (isLinked && payload.secondary && payload.link) {
    const secondaryLayout = layoutCluster(payload.secondary, true);
    const sharedBoxH = Math.max(primaryLayout.boxH, secondaryLayout.boxH);

    const leftBoxX = CANVAS_PAD_X;
    const leftBoxY = CANVAS_PAD_Y;
    const leftExtraY = (sharedBoxH - primaryLayout.boxH) / 2;

    const rightBoxX = leftBoxX + primaryLayout.boxW + CLUSTER_GAP;
    const rightBoxY = CANVAS_PAD_Y;
    const rightExtraY = (sharedBoxH - secondaryLayout.boxH) / 2;

    const leftActive = payload.selectedSessionId === payload.primary.sessionId;
    const rightActive = payload.selectedSessionId === payload.secondary.sessionId;

    const leftLabel = `${payload.primary.role.toUpperCase()} · ${truncateLabel(payload.primary.title, 34)}`;
    const rightLabel = `${payload.secondary.role.toUpperCase()} · ${truncateLabel(payload.secondary.title, 34)}`;

    clustersSvg = `
      <g class="dag-cluster">
        <rect class="dag-cluster-box${leftActive ? " is-active" : ""}" x="${leftBoxX}" y="${leftBoxY}" width="${primaryLayout.boxW}" height="${sharedBoxH}" rx="12" />
        <text x="${leftBoxX + 14}" y="${leftBoxY + 22}" fill="${leftActive ? "var(--cli-blue)" : "var(--text-muted)"}" font-size="10.5" font-family="var(--font-mono)" font-weight="600" letter-spacing="0.04em">${escapeHtml(leftLabel)}</text>
      </g>
      <g class="dag-cluster">
        <rect class="dag-cluster-box${rightActive ? " is-active" : ""}" x="${rightBoxX}" y="${rightBoxY}" width="${secondaryLayout.boxW}" height="${sharedBoxH}" rx="12" />
        <text x="${rightBoxX + 14}" y="${rightBoxY + 22}" fill="${rightActive ? "var(--cli-blue)" : "var(--text-muted)"}" font-size="10.5" font-family="var(--font-mono)" font-weight="600" letter-spacing="0.04em">${escapeHtml(rightLabel)}</text>
      </g>
    `;

    const bridgeY = CANVAS_PAD_Y + sharedBoxH / 2;
    const bridgeX1 = leftBoxX + primaryLayout.boxW + 8;
    const bridgeX2 = rightBoxX - 10;
    const bridgeMidX = leftBoxX + primaryLayout.boxW + CLUSTER_GAP / 2;
    const planLabel = truncateLabel(payload.link.planName, 19);
    const pillW = Math.min(CLUSTER_GAP - 14, Math.max(76, planLabel.length * 6.5 + 18));
    const pillH = 22;

    bridgeSvg = `
      <g class="dag-bridge">
        <title>${escapeHtml(payload.link.planName)}</title>
        <line x1="${bridgeX1}" y1="${bridgeY}" x2="${bridgeX2}" y2="${bridgeY}" stroke="var(--cli-blue)" stroke-width="2" marker-end="url(#dag-arrow-bridge)" />
        <rect x="${bridgeMidX - pillW / 2}" y="${bridgeY - 26 - pillH / 2}" width="${pillW}" height="${pillH}" rx="11" fill="var(--bg-subtle)" stroke="var(--border-card)" stroke-width="1" />
        <text x="${bridgeMidX}" y="${bridgeY - 26 + 3.5}" text-anchor="middle" fill="var(--text-standard)" font-size="10.5" font-family="var(--font-mono)">${escapeHtml(planLabel)}</text>
      </g>
    `;

    edgesSvg =
      renderClusterEdges(
        payload.primary.edges,
        primaryLayout.posById,
        leftBoxX,
        leftBoxY + leftExtraY,
        primaryLayout.nodesTopOffset
      ) +
      renderClusterEdges(
        payload.secondary.edges,
        secondaryLayout.posById,
        rightBoxX,
        rightBoxY + rightExtraY,
        secondaryLayout.nodesTopOffset
      );

    const leftRendered = renderClusterNodes(
      primaryLayout.nodes,
      leftBoxX,
      leftBoxY + leftExtraY,
      numberFormat
    );
    const rightRendered = renderClusterNodes(
      secondaryLayout.nodes,
      rightBoxX,
      rightBoxY + rightExtraY,
      numberFormat
    );
    nodesSvg = leftRendered.svg + rightRendered.svg;
    leftRendered.absPositions.forEach((v, k) => allAbsPositions.set(k, v));
    rightRendered.absPositions.forEach((v, k) => allAbsPositions.set(k, v));

    svgWidth = CANVAS_PAD_X * 2 + primaryLayout.boxW + CLUSTER_GAP + secondaryLayout.boxW;
    svgHeight = Math.max(240, CANVAS_PAD_Y * 2 + sharedBoxH);
  } else {
    const offsetX = CANVAS_PAD_X;
    const offsetY = CANVAS_PAD_Y;

    edgesSvg = renderClusterEdges(
      payload.primary.edges,
      primaryLayout.posById,
      offsetX,
      offsetY,
      primaryLayout.nodesTopOffset
    );
    const rendered = renderClusterNodes(primaryLayout.nodes, offsetX, offsetY, numberFormat);
    nodesSvg = rendered.svg;
    rendered.absPositions.forEach((v, k) => allAbsPositions.set(k, v));

    svgWidth = Math.max(252, CANVAS_PAD_X * 2 + primaryLayout.boxW);
    svgHeight = Math.max(220, CANVAS_PAD_Y * 2 + primaryLayout.boxH);
  }

  const soloNote =
    payload.secondary === null && payload.primary.nodes.length === 1
      ? `<div class="dag-empty-note">No subagents spawned in this session</div>`
      : "";

  container.innerHTML = `
    <div class="dag-scroll-wrap">
      <div class="dag-canvas-stage" style="position:relative">
        <svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="display:block" role="img" aria-label="${escapeHtml(payload.primary.title)} orchestration graph">
          <defs>
            <clipPath id="dag-card-clip">
              <rect x="1" y="1" width="${NODE_W - 2}" height="${NODE_H - 2}" rx="7" />
            </clipPath>
            <marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--text-muted)" />
            </marker>
            <marker id="dag-arrow-muted" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--text-muted)" />
            </marker>
            <marker id="dag-arrow-bridge" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--cli-blue)" />
            </marker>
          </defs>
          ${clustersSvg}
          ${bridgeSvg}
          ${edgesSvg}
          ${nodesSvg}
        </svg>
        <div class="dag-tooltip" role="status" aria-live="polite"></div>
      </div>
    </div>
    ${soloNote}
  `;

  const stage = container.querySelector(".dag-canvas-stage") as HTMLElement | null;
  const tooltip = container.querySelector(".dag-tooltip") as HTMLElement | null;
  if (!stage || !tooltip) return;

  const hideTooltip = () => {
    tooltip.classList.remove("visible");
  };

  const showTooltip = (pos: { node: DagNode; x: number; y: number }) => {
    tooltip.innerHTML = buildTooltipHtml(pos.node, numberFormat);
    tooltip.classList.add("visible");

    const stageW = Math.max(svgWidth, stage.clientWidth);
    const stageH = Math.max(svgHeight, stage.clientHeight);
    const tipW = tooltip.offsetWidth || 250;
    const tipH = tooltip.offsetHeight || 190;

    let left = pos.x + NODE_W + 12;
    if (left + tipW + 8 > stageW) {
      left = pos.x - tipW - 12;
    }
    left = Math.max(8, Math.min(stageW - tipW - 8, left));

    let top = pos.y;
    if (top + tipH + 8 > stageH) {
      top = stageH - tipH - 8;
    }
    top = Math.max(8, top);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  // Attach Escape listener to .dag-canvas-stage (never window/document) so re-renders never leak.
  stage.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && tooltip.classList.contains("visible")) {
      hideTooltip();
      e.stopPropagation();
    }
  });

  const nodeEls = stage.querySelectorAll<SVGGElement>(".dag-node");
  nodeEls.forEach((nodeEl) => {
    const nodeId = nodeEl.dataset.nodeId;
    if (!nodeId) return;
    const pos = allAbsPositions.get(nodeId);
    if (!pos) return;

    nodeEl.addEventListener("mouseenter", () => showTooltip(pos));
    nodeEl.addEventListener("focus", () => showTooltip(pos));
    nodeEl.addEventListener("click", () => {
      if (document.activeElement !== nodeEl) {
        nodeEl.focus({ preventScroll: true });
      }
      showTooltip(pos);
    });
    nodeEl.addEventListener("mouseleave", hideTooltip);
    nodeEl.addEventListener("blur", hideTooltip);
  });
}
