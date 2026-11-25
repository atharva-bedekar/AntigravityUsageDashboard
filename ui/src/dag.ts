import { DagEdge, DagNode, SessionDagGraph, SessionDagPayload } from "./types.ts";
import {
  escapeHtml,
  formatCacheHitRate,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "./format.ts";

const PILL_W = 164;
const PILL_H = 38;
const PILL_RX = 19;
const HALO_PAD = 4;
const HALO_RX = 23;

const CANVAS_PAD_X = 28;
const CANVAS_PAD_TOP = 24;
const CANVAS_PAD_BOTTOM = 26;
const MIN_SVG_HEIGHT = 260;

const SUBTITLE_AREA_H = 28;
const BRIDGE_ARC_CLEARANCE = 46;

interface PositionedNode {
  node: DagNode;
  /** Center X relative to ring center (0, 0). */
  cx: number;
  /** Center Y relative to ring center (0, 0). */
  cy: number;
}

interface RingLayout {
  graph: SessionDagGraph;
  rx: number;
  ry: number;
  hasSubagents: boolean;
  leftExtent: number;
  rightExtent: number;
  topExtentFromHub: number;
  bottomExtentFromHub: number;
  nodes: PositionedNode[];
}

interface AbsNodePos {
  node: DagNode;
  /** Top-left X of pill in SVG coordinates. */
  x: number;
  /** Top-left Y of pill in SVG coordinates. */
  y: number;
  /** Center X of pill in SVG coordinates. */
  cx: number;
  /** Center Y of pill in SVG coordinates. */
  cy: number;
}

function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

function agentBadgeKey(agentType: string): string {
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

function formatPillLabel(node: DagNode): string {
  if (node.isRoot) {
    const raw = node.agentType.trim() || node.roleLabel.trim() || "Main Agent";
    return truncateLabel(raw, 16);
  }
  const trimmedRole = node.roleLabel.trim();
  const trimmedType = node.agentType.trim();
  const raw =
    trimmedRole && trimmedRole.toLowerCase() !== trimmedType.toLowerCase()
      ? trimmedRole
      : trimmedType || "subagent";
  return truncateLabel(raw, 16);
}

function layoutRingCluster(graph: SessionDagGraph): RingLayout {
  const rootNode = graph.nodes.find((n) => n.isRoot) ?? graph.nodes[0];
  const subagents = graph.nodes
    .filter((n) => n.nodeId !== rootNode.nodeId)
    .sort((a, b) => a.waveIndex - b.waveIndex || a.nodeId.localeCompare(b.nodeId));

  if (subagents.length === 0) {
    const halfW = PILL_W / 2 + HALO_PAD + 2;
    const halfH = PILL_H / 2 + HALO_PAD + 2;
    return {
      graph,
      rx: 0,
      ry: 0,
      hasSubagents: false,
      leftExtent: halfW,
      rightExtent: halfW,
      topExtentFromHub: halfH,
      bottomExtentFromHub: halfH,
      nodes: [{ node: rootNode, cx: 0, cy: 0 }],
    };
  }

  let rx = 185;
  let ry = 115;
  if (subagents.length >= 9) {
    rx = 270 + (subagents.length - 8) * 14;
    ry = 175 + (subagents.length - 8) * 10;
  } else if (subagents.length >= 5) {
    rx = 230;
    ry = 145;
  }

  const startDeg = -40;
  const endDeg = 220;
  const spanDeg = endDeg - startDeg;
  const anglesRad =
    subagents.length === 1
      ? [Math.PI / 2]
      : subagents.map((_, idx) => {
          const deg = startDeg + ((idx + 0.5) / subagents.length) * spanDeg;
          return (deg * Math.PI) / 180;
        });

  const minGapX = PILL_W + 14;
  const minGapY = PILL_H + 10;

  for (let step = 0; step < 24; step += 1) {
    const candidates: Array<{ cx: number; cy: number }> = [{ cx: 0, cy: -ry }];
    for (const theta of anglesRad) {
      candidates.push({
        cx: rx * Math.cos(theta),
        cy: ry * Math.sin(theta),
      });
    }

    let overlaps = false;
    for (let i = 0; i < candidates.length && !overlaps; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const dx = Math.abs(candidates[i].cx - candidates[j].cx);
        const dy = Math.abs(candidates[i].cy - candidates[j].cy);
        if (dx < minGapX && dy < minGapY) {
          overlaps = true;
          break;
        }
      }
    }
    if (!overlaps) break;
    rx *= 1.08;
    ry *= 1.08;
  }

  const nodes: PositionedNode[] = [{ node: rootNode, cx: 0, cy: -ry }];
  subagents.forEach((node, idx) => {
    const theta = anglesRad[idx];
    nodes.push({
      node,
      cx: rx * Math.cos(theta),
      cy: ry * Math.sin(theta),
    });
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pos of nodes) {
    const pad = pos.node.isRoot ? HALO_PAD + 2 : 2;
    minX = Math.min(minX, pos.cx - PILL_W / 2 - pad);
    maxX = Math.max(maxX, pos.cx + PILL_W / 2 + pad);
    maxY = Math.max(maxY, pos.cy + PILL_H / 2 + pad);
  }

  const hubY = -ry;
  const topExtentFromHub = PILL_H / 2 + HALO_PAD + 2;
  const bottomExtentFromHub = Math.max(topExtentFromHub, maxY - hubY);

  return {
    graph,
    rx,
    ry,
    hasSubagents: true,
    leftExtent: Math.max(PILL_W / 2 + HALO_PAD + 2, -minX),
    rightExtent: Math.max(PILL_W / 2 + HALO_PAD + 2, maxX),
    topExtentFromHub,
    bottomExtentFromHub,
    nodes,
  };
}

/**
 * Computes the boundary intersection point on a horizontal capsule pill centered at (cx, cy)
 * along the ray toward (targetX, targetY).
 */
function capsuleBoundaryPoint(
  cx: number,
  cy: number,
  targetX: number,
  targetY: number,
  w: number,
  h: number
): { x: number; y: number } {
  const dx = targetX - cx;
  const dy = targetY - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) {
    return { x: cx, y: cy };
  }
  const ux = dx / len;
  const uy = dy / len;
  const r = h / 2;
  const s = Math.max(0, w / 2 - r);

  if (Math.abs(uy) > 1e-4) {
    const tFlat = r / Math.abs(uy);
    const xFlat = ux * tFlat;
    if (Math.abs(xFlat) <= s) {
      return {
        x: cx + xFlat,
        y: cy + (uy > 0 ? r : -r),
      };
    }
  }

  const sx = ux >= 0 ? s : -s;
  const b = ux * sx;
  const c = sx * sx - r * r;
  const disc = Math.max(0, b * b - c);
  const t = b + Math.sqrt(disc);
  return {
    x: cx + t * ux,
    y: cy + t * uy,
  };
}

function renderClusterEdges(
  graph: SessionDagGraph,
  absById: Map<string, AbsNodePos>
): string {
  const maxSubagentTotal = Math.max(
    0,
    ...graph.nodes.filter((n) => !n.isRoot).map((n) => n.total)
  );
  const maxEdgeTurns = Math.max(0, ...graph.edges.map((e) => e.messageTurns));

  return graph.edges
    .map((edge: DagEdge) => {
      if (edge.fromNodeId === edge.toNodeId) return "";
      const fromPos = absById.get(edge.fromNodeId);
      const toPos = absById.get(edge.toNodeId);
      if (!fromPos || !toPos) return "";

      const dx = toPos.cx - fromPos.cx;
      const dy = toPos.cy - fromPos.cy;
      const len = Math.hypot(dx, dy);
      if (len < 1) return "";

      const nx = -dy / len;
      const ny = dx / len;

      const fromPad = fromPos.node.isRoot ? HALO_PAD * 2 + 2 : 2;
      const toPad = toPos.node.isRoot ? HALO_PAD * 2 + 4 : 4;

      if (edge.kind === "feedback") {
        if (edge.messageTurns <= 0) return "";

        const curveOffset = Math.min(34, Math.max(18, len * 0.14));
        const ctrlX = (fromPos.cx + toPos.cx) / 2 + nx * curveOffset;
        const ctrlY = (fromPos.cy + toPos.cy) / 2 + ny * curveOffset;

        const p1 = capsuleBoundaryPoint(
          fromPos.cx,
          fromPos.cy,
          ctrlX,
          ctrlY,
          PILL_W + fromPad,
          PILL_H + fromPad
        );
        const p2 = capsuleBoundaryPoint(
          toPos.cx,
          toPos.cy,
          ctrlX,
          ctrlY,
          PILL_W + toPad,
          PILL_H + toPad
        );

        const midX = 0.25 * p1.x + 0.5 * ctrlX + 0.25 * p2.x;
        const midY = 0.25 * p1.y + 0.5 * ctrlY + 0.25 * p2.y;
        const turnText = String(edge.messageTurns);
        const badgeW = Math.max(18, turnText.length * 7 + 8);

        return `
          <g class="dag-edge-feedback">
            <path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="var(--text-muted)" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#dag-arrow-muted)" />
            <rect x="${(midX - badgeW / 2).toFixed(1)}" y="${(midY - 9).toFixed(1)}" width="${badgeW}" height="18" rx="9" fill="var(--bg-canvas)" stroke="var(--border-card)" stroke-width="1" />
            <text x="${midX.toFixed(1)}" y="${(midY + 3.5).toFixed(1)}" text-anchor="middle" fill="var(--text-standard)" font-size="10.5" font-family="var(--font-mono)" style="font-variant-numeric:tabular-nums">${escapeHtml(turnText)}</text>
          </g>
        `;
      }

      const curveOffset = Math.min(26, Math.max(12, len * 0.09));
      const ctrlX = (fromPos.cx + toPos.cx) / 2 + nx * curveOffset;
      const ctrlY = (fromPos.cy + toPos.cy) / 2 + ny * curveOffset;

      const p1 = capsuleBoundaryPoint(
        fromPos.cx,
        fromPos.cy,
        ctrlX,
        ctrlY,
        PILL_W + fromPad,
        PILL_H + fromPad
      );
      const p2 = capsuleBoundaryPoint(
        toPos.cx,
        toPos.cy,
        ctrlX,
        ctrlY,
        PILL_W + toPad,
        PILL_H + toPad
      );

      const weightRatio =
        maxSubagentTotal > 0
          ? Math.min(1, Math.max(0, toPos.node.total / maxSubagentTotal))
          : maxEdgeTurns > 0
            ? Math.min(1, Math.max(0, edge.messageTurns / maxEdgeTurns))
            : 0;
      const strokeWidth = (1.3 + weightRatio * 2.1).toFixed(2);

      return `<path class="dag-edge-dispatch" d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="var(--border-divider)" stroke-width="${strokeWidth}" marker-end="url(#dag-arrow)" />`;
    })
    .join("");
}

function renderClusterNodes(
  layout: RingLayout,
  ringCenterX: number,
  ringCenterY: number,
  numberFormat: "compact" | "full"
): { svg: string; absById: Map<string, AbsNodePos> } {
  const absById = new Map<string, AbsNodePos>();

  const svg = layout.nodes
    .map(({ node, cx, cy }) => {
      const absCx = ringCenterX + cx;
      const absCy = ringCenterY + cy;
      const absX = absCx - PILL_W / 2;
      const absY = absCy - PILL_H / 2;
      absById.set(node.nodeId, { node, x: absX, y: absY, cx: absCx, cy: absCy });

      const badgeKey = agentBadgeKey(node.agentType);
      const label = formatPillLabel(node);
      const displayRole = node.roleLabel.trim() || node.agentType;
      const ariaLabel = `${node.agentType}: ${displayRole}, ${formatTokens(node.total, numberFormat)} tokens, ${formatDuration(node.wallTimeSecs)}`;

      const haloSvg = node.isRoot
        ? `<rect class="dag-hub-halo" x="-${HALO_PAD}" y="-${HALO_PAD}" width="${PILL_W + HALO_PAD * 2}" height="${PILL_H + HALO_PAD * 2}" rx="${HALO_RX}" fill="none" stroke="var(--border-divider)" stroke-width="1" stroke-dasharray="3 3" />`
        : "";

      const centerDotSvg = node.isRoot
        ? `<circle cx="18" cy="${PILL_H / 2}" r="2.3" fill="var(--bg-surface)" />`
        : "";

      return `
        <g class="dag-node${node.isRoot ? " is-root" : ""}" data-node-id="${escapeHtml(node.nodeId)}" transform="translate(${absX.toFixed(1)}, ${absY.toFixed(1)})" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}">
          ${haloSvg}
          <rect class="dag-node-card" x="0" y="0" width="${PILL_W}" height="${PILL_H}" rx="${PILL_RX}" fill="var(--bg-surface)" stroke="var(--border-card)" stroke-width="1" />
          <circle class="dag-badge-ring dag-badge-${escapeHtml(badgeKey)}" cx="18" cy="${PILL_H / 2}" r="9.5" fill="none" stroke-width="1.2" />
          <circle class="dag-badge-dot dag-badge-${escapeHtml(badgeKey)}" cx="18" cy="${PILL_H / 2}" r="7" />
          ${centerDotSvg}
          <text class="dag-node-label" x="35" y="${(PILL_H / 2 + 4).toFixed(1)}" fill="var(--text-strong)" font-size="12.5" font-weight="500">${escapeHtml(label)}</text>
        </g>
      `;
    })
    .join("");

  return { svg, absById };
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
 * Renders an orchestration DAG (single session or linked Planner -> Orchestrator swarm rings)
 * into `container` using an elliptical Swarm constellation layout and accessible telemetry tooltips.
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
  const primaryLayout = layoutRingCluster(payload.primary);

  let svgWidth = 0;
  let svgHeight = 0;
  let orbitsSvg = "";
  let bridgeSvg = "";
  let edgesSvg = "";
  let nodesSvg = "";
  const allAbsPositions = new Map<string, AbsNodePos>();

  if (isLinked && payload.secondary && payload.link) {
    const secondaryLayout = layoutRingCluster(payload.secondary);

    const ringGap = Math.max(
      64,
      360 - primaryLayout.rightExtent - secondaryLayout.leftExtent
    );
    const hubCenterY = CANVAS_PAD_TOP + SUBTITLE_AREA_H + BRIDGE_ARC_CLEARANCE;

    const leftCx = CANVAS_PAD_X + primaryLayout.leftExtent;
    const leftCy = hubCenterY + primaryLayout.ry;

    const rightCx =
      leftCx + primaryLayout.rightExtent + ringGap + secondaryLayout.leftExtent;
    const rightCy = hubCenterY + secondaryLayout.ry;

    const leftActive = payload.selectedSessionId === payload.primary.sessionId;
    const rightActive = payload.selectedSessionId === payload.secondary.sessionId;

    const leftSubtitle = `${payload.primary.role.toUpperCase()} · ${truncateLabel(payload.primary.title, 28)}`;
    const rightSubtitle = `${payload.secondary.role.toUpperCase()} · ${truncateLabel(payload.secondary.title, 28)}`;
    const subtitleY = CANVAS_PAD_TOP + 12;

    const leftOrbit = primaryLayout.hasSubagents
      ? `<ellipse class="dag-ring-orbit${leftActive ? " is-active" : ""}" cx="${leftCx.toFixed(1)}" cy="${leftCy.toFixed(1)}" rx="${primaryLayout.rx.toFixed(1)}" ry="${primaryLayout.ry.toFixed(1)}" />`
      : "";
    const rightOrbit = secondaryLayout.hasSubagents
      ? `<ellipse class="dag-ring-orbit${rightActive ? " is-active" : ""}" cx="${rightCx.toFixed(1)}" cy="${rightCy.toFixed(1)}" rx="${secondaryLayout.rx.toFixed(1)}" ry="${secondaryLayout.ry.toFixed(1)}" />`
      : "";

    orbitsSvg = `
      <g class="dag-cluster">
        <text class="dag-cluster-subtitle${leftActive ? " is-active" : ""}" x="${leftCx.toFixed(1)}" y="${subtitleY}" text-anchor="middle">${escapeHtml(leftSubtitle)}</text>
        ${leftOrbit}
      </g>
      <g class="dag-cluster">
        <text class="dag-cluster-subtitle${rightActive ? " is-active" : ""}" x="${rightCx.toFixed(1)}" y="${subtitleY}" text-anchor="middle">${escapeHtml(rightSubtitle)}</text>
        ${rightOrbit}
      </g>
    `;

    const leftRendered = renderClusterNodes(
      primaryLayout,
      leftCx,
      leftCy,
      numberFormat
    );
    const rightRendered = renderClusterNodes(
      secondaryLayout,
      rightCx,
      rightCy,
      numberFormat
    );

    nodesSvg = leftRendered.svg + rightRendered.svg;
    leftRendered.absById.forEach((v, k) => allAbsPositions.set(k, v));
    rightRendered.absById.forEach((v, k) => allAbsPositions.set(k, v));

    edgesSvg =
      renderClusterEdges(payload.primary, leftRendered.absById) +
      renderClusterEdges(payload.secondary, rightRendered.absById);

    const plannerHubX1 = leftCx + PILL_W / 2 + HALO_PAD + 2;
    const orchHubX2 = rightCx - PILL_W / 2 - HALO_PAD - 4;
    const bridgeMidX = (plannerHubX1 + orchHubX2) / 2;
    const bridgeCtrlY = hubCenterY - 36;
    const bridgeApexY = hubCenterY - 18;

    const planLabel = truncateLabel(payload.link.planName, 26);
    const maxPillW = Math.max(88, orchHubX2 - plannerHubX1 - 24);
    const pillW = Math.min(maxPillW, Math.max(88, planLabel.length * 6.8 + 22));
    const pillH = 22;
    const pillCenterY = bridgeApexY - 14;

    bridgeSvg = `
      <g class="dag-bridge">
        <title>${escapeHtml(payload.link.planName)}</title>
        <path d="M ${plannerHubX1.toFixed(1)} ${hubCenterY.toFixed(1)} Q ${bridgeMidX.toFixed(1)} ${bridgeCtrlY.toFixed(1)} ${orchHubX2.toFixed(1)} ${hubCenterY.toFixed(1)}" fill="none" stroke="var(--cli-blue)" stroke-width="2" marker-end="url(#dag-arrow-bridge)" />
        <g class="dag-plan-pill">
          <rect class="dag-plan-pill-rect" x="${(bridgeMidX - pillW / 2).toFixed(1)}" y="${(pillCenterY - pillH / 2).toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH}" rx="11" />
          <text class="dag-plan-pill-text" x="${bridgeMidX.toFixed(1)}" y="${(pillCenterY + 3.5).toFixed(1)}" text-anchor="middle">${escapeHtml(planLabel)}</text>
        </g>
      </g>
    `;

    const maxBottomExtent = Math.max(
      primaryLayout.bottomExtentFromHub,
      secondaryLayout.bottomExtentFromHub
    );
    svgWidth = rightCx + secondaryLayout.rightExtent + CANVAS_PAD_X;
    svgHeight = Math.max(
      MIN_SVG_HEIGHT,
      hubCenterY + maxBottomExtent + CANVAS_PAD_BOTTOM
    );
  } else {
    const contentW = primaryLayout.leftExtent + primaryLayout.rightExtent;
    svgWidth = Math.max(460, CANVAS_PAD_X * 2 + contentW);
    const ringCenterX = svgWidth / 2;

    if (!primaryLayout.hasSubagents) {
      svgHeight = MIN_SVG_HEIGHT;
      const hubCenterY = 122;
      const rendered = renderClusterNodes(
        primaryLayout,
        ringCenterX,
        hubCenterY,
        numberFormat
      );
      nodesSvg = rendered.svg;
      rendered.absById.forEach((v, k) => allAbsPositions.set(k, v));
      edgesSvg = renderClusterEdges(payload.primary, rendered.absById);
    } else {
      const hubCenterY = CANVAS_PAD_TOP + primaryLayout.topExtentFromHub + 8;
      const ringCenterY = hubCenterY + primaryLayout.ry;
      svgHeight = Math.max(
        MIN_SVG_HEIGHT,
        hubCenterY + primaryLayout.bottomExtentFromHub + CANVAS_PAD_BOTTOM
      );

      orbitsSvg = `
        <g class="dag-cluster">
          <ellipse class="dag-ring-orbit" cx="${ringCenterX.toFixed(1)}" cy="${ringCenterY.toFixed(1)}" rx="${primaryLayout.rx.toFixed(1)}" ry="${primaryLayout.ry.toFixed(1)}" />
        </g>
      `;

      const rendered = renderClusterNodes(
        primaryLayout,
        ringCenterX,
        ringCenterY,
        numberFormat
      );
      nodesSvg = rendered.svg;
      rendered.absById.forEach((v, k) => allAbsPositions.set(k, v));
      edgesSvg = renderClusterEdges(payload.primary, rendered.absById);
    }
  }

  const soloNote =
    payload.secondary === null && !primaryLayout.hasSubagents
      ? `<div class="dag-empty-note">No subagents spawned in this session</div>`
      : "";

  container.innerHTML = `
    <div class="dag-canvas-wrap">
      <div class="dag-scroll-wrap">
        <div class="dag-canvas-stage" style="position:relative">
          <svg width="${Math.ceil(svgWidth)}" height="${Math.ceil(svgHeight)}" viewBox="0 0 ${Math.ceil(svgWidth)} ${Math.ceil(svgHeight)}" style="display:block;margin:0 auto" role="img" aria-label="${escapeHtml(payload.primary.title)} orchestration graph">
            <defs>
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
            ${orbitsSvg}
            ${bridgeSvg}
            ${edgesSvg}
            ${nodesSvg}
          </svg>
          <div class="dag-tooltip" role="status" aria-live="polite"></div>
        </div>
      </div>
      <div class="dag-legend-footer" aria-label="Graph legend">
        <span class="dag-legend-item">
          <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
            <line x1="1" y1="5" x2="18" y2="5" stroke="var(--border-divider)" stroke-width="2" />
            <path d="M 16 2 L 22 5 L 16 8 Z" fill="var(--text-muted)" />
          </svg>
          <span>Dispatch (width = usage)</span>
        </span>
        <span class="dag-legend-item">
          <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
            <line x1="1" y1="5" x2="18" y2="5" stroke="var(--text-muted)" stroke-width="1.4" stroke-dasharray="4 3" />
            <path d="M 16 2 L 22 5 L 16 8 Z" fill="var(--text-muted)" />
          </svg>
          <span>Feedback turns</span>
        </span>
        <span class="dag-legend-item">
          <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true">
            <rect x="1.5" y="1.5" width="21" height="11" rx="5.5" fill="none" stroke="var(--border-divider)" stroke-width="1.2" stroke-dasharray="3 2" />
            <circle cx="7" cy="7" r="2.5" fill="var(--cli-blue)" />
          </svg>
          <span>Hub (Planner / Orchestrator)</span>
        </span>
      </div>
    </div>
    ${soloNote}
  `;

  const stage = container.querySelector(".dag-canvas-stage") as HTMLElement | null;
  const svgEl = stage?.querySelector("svg") ?? null;
  const tooltip = container.querySelector(".dag-tooltip") as HTMLElement | null;
  if (!stage || !tooltip) return;

  const hideTooltip = () => {
    tooltip.classList.remove("visible");
  };

  const showTooltip = (pos: AbsNodePos) => {
    tooltip.innerHTML = buildTooltipHtml(pos.node, numberFormat);
    tooltip.classList.add("visible");

    const stageW = Math.max(svgWidth, stage.clientWidth);
    const stageH = Math.max(svgHeight, stage.clientHeight);
    const tipW = tooltip.offsetWidth || 250;
    const tipH = tooltip.offsetHeight || 190;
    const svgOffsetX = svgEl
      ? Math.max(0, svgEl.getBoundingClientRect().left - stage.getBoundingClientRect().left)
      : 0;
    const absLeft = svgOffsetX + pos.x;

    let left = absLeft + PILL_W + 12;
    if (left + tipW + 8 > stageW) {
      left = absLeft - tipW - 12;
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
    nodeEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showTooltip(pos);
      }
    });
    nodeEl.addEventListener("mouseleave", hideTooltip);
    nodeEl.addEventListener("blur", hideTooltip);
  });
}
