import { DailyBucket, ForecastResult, StepPricedRow, TimeUsageBucket } from "./types.ts";
import {
  escapeHtml,
  formatDate,
  formatDateShort,
  formatExactTokens,
  formatMoney,
  formatTokens,
} from "./format.ts";

export function renderDailyUsageChart(
  container: HTMLElement,
  daily: DailyBucket[],
  currency: "INR" | "USD",
  numberFormat: "compact" | "full",
  colorBy: "token" | "source"
): void {
  if (daily.length === 0) {
    container.innerHTML = `<div class="empty-inline">No daily usage data in this range.</div>`;
    return;
  }

  const width = 920;
  const height = 280;
  const pad = { top: 20, right: 16, bottom: 32, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxTotal = Math.max(1, ...daily.map((d) => d.total));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    val: maxTotal * t,
    y: pad.top + plotH * (1 - t),
  }));

  // Detect disjoint CLI -> App transition
  let lastCliIdx = -1;
  let firstAppIdx = -1;
  daily.forEach((d, idx) => {
    if (d.cliTotal > 0) lastCliIdx = idx;
    if (firstAppIdx === -1 && d.appTotal > 0) firstAppIdx = idx;
  });
  const showTransition =
    lastCliIdx !== -1 && firstAppIdx !== -1 && lastCliIdx < firstAppIdx;

  const slotW = plotW / daily.length;
  const barW = Math.max(4, Math.min(26, slotW * 0.68));

  const barsSvg = daily
    .map((d, i) => {
      const x = pad.left + i * slotW + (slotW - barW) / 2;
      const delay = Math.min(360, i * 12);
      if (d.total === 0) {
        return `<rect class="daily-hit" data-idx="${i}" x="${pad.left + i * slotW}" y="${pad.top}" width="${slotW}" height="${plotH}" fill="transparent" />`;
      }

      const hTotal = (d.total / maxTotal) * plotH;
      if (colorBy === "source") {
        const hCli = (d.cliTotal / maxTotal) * plotH;
        const hApp = (d.appTotal / maxTotal) * plotH;
        const yCli = pad.top + plotH - hCli;
        const yApp = yCli - hApp;
        return `
          <g class="chart-bar-anim" style="animation-delay:${delay}ms">
            ${hCli > 0 ? `<rect x="${x}" y="${yCli}" width="${barW}" height="${hCli}" rx="2" fill="var(--source-cli)" />` : ""}
            ${hApp > 0 ? `<rect x="${x}" y="${yApp}" width="${barW}" height="${hApp}" rx="2" fill="var(--source-app)" />
            <rect x="${x}" y="${yApp}" width="${barW}" height="${hApp}" rx="2" fill="url(#appHatch)" />` : ""}
          </g>
          <rect class="daily-hit" data-idx="${i}" x="${pad.left + i * slotW}" y="${pad.top}" width="${slotW}" height="${plotH}" fill="transparent" />
        `;
      }

      // Token type mode: bottom = Cached, middle = New, top = Output
      const hCached = (d.cached / maxTotal) * plotH;
      const hNew = (d.freshIn / maxTotal) * plotH;
      const hOut = (d.output / maxTotal) * plotH;
      const yCached = pad.top + plotH - hCached;
      const yNew = yCached - hNew;
      const yOut = yNew - hOut;
      const hApp = (d.appTotal / maxTotal) * plotH;
      const yAppTop = pad.top + plotH - hTotal;

      return `
        <g class="chart-bar-anim" style="animation-delay:${delay}ms">
          ${hCached > 0 ? `<rect x="${x}" y="${yCached}" width="${barW}" height="${hCached}" fill="var(--data-cached)" />` : ""}
          ${hNew > 0 ? `<rect x="${x}" y="${yNew}" width="${barW}" height="${hNew}" fill="var(--data-new)" />` : ""}
          ${hOut > 0 ? `<rect x="${x}" y="${yOut}" width="${barW}" height="${hOut}" rx="2" fill="var(--data-output)" />` : ""}
          ${hApp > 0 && d.appTotal === d.total ? `<rect x="${x}" y="${yAppTop}" width="${barW}" height="${hTotal}" fill="url(#appHatch)" />` : ""}
        </g>
        <rect class="daily-hit" data-idx="${i}" x="${pad.left + i * slotW}" y="${pad.top}" width="${slotW}" height="${plotH}" fill="transparent" />
      `;
    })
    .join("");

  const transitionX = showTransition
    ? pad.left + ((lastCliIdx + firstAppIdx + 1) / 2) * slotW
    : 0;

  // X-axis date labels (about 6 evenly spaced)
  const labelStep = Math.max(1, Math.ceil(daily.length / 6));
  const xLabels = daily
    .map((d, i) => {
      if (i % labelStep !== 0 && i !== daily.length - 1) return "";
      const cx = pad.left + i * slotW + slotW / 2;
      return `<text x="${cx}" y="${height - 10}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${escapeHtml(formatDateShort(d.date))}</text>`;
    })
    .join("");

  container.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" style="display:block;overflow:visible">
        <defs>
          <pattern id="appHatch" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.42)" stroke-width="2" />
          </pattern>
        </defs>
        ${yTicks
          .map(
            (t) => `
          <line x1="${pad.left}" y1="${t.y}" x2="${width - pad.right}" y2="${t.y}" stroke="var(--border-subtle)" stroke-dasharray="${t.val === 0 ? "none" : "3 3"}" />
          <text x="${pad.left - 8}" y="${t.y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${t.val === 0 ? "0" : formatTokens(t.val, "compact")}</text>
        `
          )
          .join("")}
        ${
          showTransition
            ? `
          <line x1="${transitionX}" y1="${pad.top}" x2="${transitionX}" y2="${pad.top + plotH}" stroke="var(--text-faint)" stroke-dasharray="4 4" stroke-width="1.2" />
          <rect x="${transitionX - 38}" y="${pad.top + 2}" width="76" height="20" rx="10" fill="var(--bg-surface)" stroke="var(--border-card)" />
          <text x="${transitionX}" y="${pad.top + 15}" text-anchor="middle" fill="var(--text-muted)" font-size="10.5" font-family="var(--font-mono)">CLI → App</text>
        `
            : ""
        }
        <line id="daily-crosshair" x1="0" y1="${pad.top}" x2="0" y2="${pad.top + plotH}" stroke="var(--text-strong)" stroke-opacity="0.2" stroke-width="1" visibility="hidden" />
        ${barsSvg}
        ${xLabels}
      </svg>
      <div class="chart-tooltip" id="daily-tooltip"></div>
    </div>
  `;

  const tooltip = container.querySelector("#daily-tooltip") as HTMLElement;
  const crosshair = container.querySelector("#daily-crosshair") as SVGLineElement;
  const hits = container.querySelectorAll<SVGRectElement>(".daily-hit");

  hits.forEach((hit) => {
    hit.addEventListener("mouseenter", () => {
      const idx = Number(hit.dataset.idx);
      const d = daily[idx];
      if (!d) return;
      const cx = pad.left + idx * slotW + slotW / 2;
      crosshair.setAttribute("x1", String(cx));
      crosshair.setAttribute("x2", String(cx));
      crosshair.setAttribute("visibility", "visible");

      tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(formatDate(d.date))}</div>
        <div class="mono" style="font-size:11.5px;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;">
          <span style="color:var(--data-new)">● New:</span><span style="text-align:right">${formatTokens(d.freshIn, numberFormat)} (${formatExactTokens(d.freshIn)})</span>
          <span style="color:var(--data-cached)">● Cached:</span><span style="text-align:right">${formatTokens(d.cached, numberFormat)}</span>
          <span style="color:var(--data-output)">● Output:</span><span style="text-align:right">${formatTokens(d.output, numberFormat)}</span>
          <span style="color:var(--text-muted)">Sessions:</span><span style="text-align:right">${d.sessions} (CLI ${d.cliSessions} · App ${d.appSessions})</span>
          <span style="font-weight:600">≈ Cost:</span><span style="text-align:right;font-weight:600">${formatMoney(d.costCurrency, currency)}</span>
        </div>
      `;
      const pctLeft = (cx / width) * 100;
      tooltip.style.left = pctLeft > 65 ? "auto" : `${pctLeft + 2}%`;
      tooltip.style.right = pctLeft > 65 ? `${100 - pctLeft + 2}%` : "auto";
      tooltip.style.top = "14px";
      tooltip.classList.add("visible");
    });

    hit.addEventListener("mouseleave", () => {
      crosshair.setAttribute("visibility", "hidden");
      tooltip.classList.remove("visible");
    });
  });
}

export function renderSessionDualCharts(
  container: HTMLElement,
  steps: StepPricedRow[],
  currency: "INR" | "USD",
  numberFormat: "compact" | "full"
): void {
  const tokenSteps = steps.filter((s) => s.hasTokens || s.isError || s.toolCalls.length > 0);
  if (tokenSteps.length === 0) {
    container.innerHTML = `<div class="card-subtitle">No step-level token progression available.</div>`;
    return;
  }

  const width = 920;
  const areaH = 180;
  const stripH = 72;
  const padL = 54;
  const padR = 16;
  const plotW = width - padL - padR;

  const maxCum = Math.max(1, ...tokenSteps.map((s) => s.cumulativeTotal));
  const maxStep = Math.max(1, ...tokenSteps.map((s) => s.total));
  const n = tokenSteps.length;
  const xAt = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);

  // Build stacked area polygons: bottom = Cached, mid = Cached+New, top = Total
  const ptsCached: string[] = [];
  const ptsNew: string[] = [];
  const ptsOut: string[] = [];
  const yAreaBase = areaH - 22;
  const areaPlotH = areaH - 36;

  tokenSteps.forEach((s, i) => {
    const x = xAt(i);
    const yC = yAreaBase - (s.cumulativeCached / maxCum) * areaPlotH;
    const yN = yAreaBase - ((s.cumulativeCached + s.cumulativeFreshIn) / maxCum) * areaPlotH;
    const yO = yAreaBase - (s.cumulativeTotal / maxCum) * areaPlotH;
    ptsCached.push(`${x},${yC}`);
    ptsNew.push(`${x},${yN}`);
    ptsOut.push(`${x},${yO}`);
  });

  const baseRight = `${xAt(n - 1)},${yAreaBase}`;
  const baseLeft = `${xAt(0)},${yAreaBase}`;

  const polyCached = `${baseLeft} ${ptsCached.join(" ")} ${baseRight}`;
  const polyNew = `${ptsCached.join(" ")} ${[...ptsNew].reverse().join(" ")}`;
  const polyOut = `${ptsNew.join(" ")} ${[...ptsOut].reverse().join(" ")}`;

  const colW = Math.max(2, Math.min(12, plotW / Math.max(1, n) * 0.7));
  const stripBase = stripH - 18;
  const stripPlotH = stripH - 26;

  const spikeCols = tokenSteps
    .map((s, i) => {
      const cx = xAt(i);
      const h = (s.total / maxStep) * stripPlotH;
      const y = stripBase - h;
      const fill = s.isError ? "var(--status-error)" : "var(--data-new)";
      const errDot = s.isError
        ? `<circle cx="${cx}" cy="${stripBase + 6}" r="3" fill="var(--status-error)" />`
        : "";
      const toolTick =
        s.toolCalls.length > 0 && !s.isError
          ? `<line x1="${cx}" y1="${stripBase + 2}" x2="${cx}" y2="${stripBase + 8}" stroke="var(--data-output)" stroke-width="1.5" />`
          : "";
      return `
        ${h > 0 ? `<rect x="${cx - colW / 2}" y="${y}" width="${colW}" height="${h}" rx="1" fill="${fill}" opacity="0.85" />` : ""}
        ${errDot}
        ${toolTick}
        <rect class="step-hit" data-idx="${i}" x="${cx - Math.max(4, plotW / n / 2)}" y="0" width="${Math.max(8, plotW / n)}" height="${stripH}" fill="transparent" />
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${areaH}" width="100%" height="${areaH}" style="display:block">
        <line x1="${padL}" y1="${yAreaBase}" x2="${width - padR}" y2="${yAreaBase}" stroke="var(--border-subtle)" />
        <line x1="${padL}" y1="14" x2="${width - padR}" y2="14" stroke="var(--border-subtle)" stroke-dasharray="3 3" />
        <text x="${padL - 8}" y="18" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${formatTokens(maxCum, "compact")}</text>
        <text x="${padL - 8}" y="${yAreaBase}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">0</text>
        <polygon points="${polyCached}" fill="var(--data-cached)" opacity="0.85" />
        <polygon points="${polyNew}" fill="var(--data-new)" opacity="0.9" />
        <polygon points="${polyOut}" fill="var(--data-output)" opacity="0.95" />
        <line id="step-crosshair-top" x1="0" y1="14" x2="0" y2="${yAreaBase}" stroke="var(--text-strong)" stroke-opacity="0.25" visibility="hidden" />
      </svg>
      <svg viewBox="0 0 ${width} ${stripH}" width="100%" height="${stripH}" style="display:block;margin-top:4px">
        <line x1="${padL}" y1="${stripBase}" x2="${width - padR}" y2="${stripBase}" stroke="var(--border-subtle)" />
        <text x="${padL - 8}" y="14" text-anchor="end" fill="var(--text-muted)" font-size="10.5" font-family="var(--font-mono)">${formatTokens(maxStep, "compact")}</text>
        ${spikeCols}
        <text x="${padL}" y="${stripH - 2}" fill="var(--text-muted)" font-size="10.5" font-family="var(--font-mono)">Step ${tokenSteps[0].stepIndex}</text>
        <text x="${width - padR}" y="${stripH - 2}" text-anchor="end" fill="var(--text-muted)" font-size="10.5" font-family="var(--font-mono)">Step ${tokenSteps[n - 1].stepIndex}</text>
      </svg>
      <div class="chart-tooltip" id="step-tooltip"></div>
    </div>
  `;

  const tooltip = container.querySelector("#step-tooltip") as HTMLElement;
  const crosshair = container.querySelector("#step-crosshair-top") as SVGLineElement;
  container.querySelectorAll<SVGRectElement>(".step-hit").forEach((hit) => {
    hit.addEventListener("mouseenter", () => {
      const idx = Number(hit.dataset.idx);
      const s = tokenSteps[idx];
      if (!s) return;
      const cx = xAt(idx);
      crosshair.setAttribute("x1", String(cx));
      crosshair.setAttribute("x2", String(cx));
      crosshair.setAttribute("visibility", "visible");
      tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;">Step #${s.stepIndex} ${s.localTime ? `· ${escapeHtml(s.localTime)}` : ""}</div>
        <div class="mono" style="font-size:11.5px;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;">
          <span>Step tokens:</span><span style="text-align:right">${formatTokens(s.total, numberFormat)}</span>
          <span>Cumulative:</span><span style="text-align:right">${formatTokens(s.cumulativeTotal, numberFormat)}</span>
          <span>≈ Step cost:</span><span style="text-align:right">${formatMoney(s.costCurrency, currency)}</span>
        </div>
      `;
      const pctLeft = (cx / width) * 100;
      tooltip.style.left = pctLeft > 65 ? "auto" : `${pctLeft + 2}%`;
      tooltip.style.right = pctLeft > 65 ? `${100 - pctLeft + 2}%` : "auto";
      tooltip.style.top = "10px";
      tooltip.classList.add("visible");
    });
    hit.addEventListener("mouseleave", () => {
      crosshair.setAttribute("visibility", "hidden");
      tooltip.classList.remove("visible");
    });
  });
}

export function renderProjectSparkline(container: HTMLElement, dailyTotals: number[]): void {
  if (dailyTotals.length === 0) {
    container.innerHTML = `<div class="card-subtitle">No daily activity</div>`;
    return;
  }
  const w = 420;
  const h = 68;
  const max = Math.max(1, ...dailyTotals);
  const slot = w / dailyTotals.length;
  const bw = Math.max(4, Math.min(20, slot * 0.72));
  const bars = dailyTotals
    .map((val, i) => {
      const bh = Math.max(2, (val / max) * (h - 10));
      const x = i * slot + (slot - bw) / 2;
      const y = h - bh;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="3" fill="var(--source-cli)" opacity="${val === 0 ? 0.15 : 0.85}" />`;
    })
    .join("");
  container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="display:block">${bars}</svg>`;
}

export function renderForecastChart(
  container: HTMLElement,
  forecast: ForecastResult,
  currency: "INR" | "USD",
  _numberFormat: "compact" | "full"
): void {
  const width = 880;
  const height = 210;
  const pad = { top: 16, right: 20, bottom: 28, left: 60 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (!forecast.supported || forecast.points.length === 0) {
    // Ghosted preview SVG behind locked overlay
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;opacity:0.22;filter:grayscale(0.4)">
        <polygon points="${pad.left},140 300,115 550,82 860,44 860,152 550,158 300,162 ${pad.left},166" fill="var(--data-cached)" />
        <polyline points="${pad.left},152 300,138 550,120 860,98" fill="none" stroke="var(--text-strong)" stroke-width="2" stroke-dasharray="5 4" />
      </svg>
    `;
    return;
  }

  const pts = forecast.points;
  const maxVal = Math.max(1, ...pts.map((p) => p.high));
  const n = pts.length;
  const xAt = (i: number) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i / (n - 1)) * plotW);
  const yAt = (v: number) => pad.top + plotH - (v / maxVal) * plotH;

  const highPts = pts.map((p, i) => `${xAt(i)},${yAt(p.high)}`);
  const lowPts = [...pts].reverse().map((p, i) => `${xAt(n - 1 - i)},${yAt(p.low)}`);
  const medPts = pts.map((p, i) => `${xAt(i)},${yAt(p.median)}`);

  const formatY = (v: number) =>
    forecast.metric === "cost" ? formatMoney(v, currency) : formatTokens(v, "compact");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block">
      <line x1="${pad.left}" y1="${pad.top}" x2="${width - pad.right}" y2="${pad.top}" stroke="var(--border-subtle)" stroke-dasharray="3 3" />
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}" stroke="var(--border-subtle)" />
      <text x="${pad.left - 8}" y="${pad.top + 4}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${escapeHtml(formatY(maxVal))}</text>
      <text x="${pad.left - 8}" y="${pad.top + plotH}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">0</text>
      <polygon points="${highPts.join(" ")} ${lowPts.join(" ")}" fill="var(--data-cached)" opacity="0.55" />
      <polyline points="${medPts.join(" ")}" fill="none" stroke="var(--data-new)" stroke-width="2.2" />
      <text x="${pad.left}" y="${height - 8}" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${escapeHtml(formatDateShort(pts[0].date))}</text>
      <text x="${width - pad.right}" y="${height - 8}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${escapeHtml(formatDateShort(pts[n - 1].date))}</text>
    </svg>
  `;
}

export function renderTokenTimeChart(
  container: HTMLElement,
  buckets: TimeUsageBucket[],
  numberFormat: "compact" | "full"
): void {
  const width = 920;
  const height = 240;
  const pad = { top: 20, right: 16, bottom: 32, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const yBase = pad.top + plotH;

  if (buckets.length === 0 || buckets.every((b) => b.total === 0)) {
    container.innerHTML = `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block">
          <line x1="${pad.left}" y1="${yBase}" x2="${width - pad.right}" y2="${yBase}" stroke="var(--border-card)" stroke-width="1" />
          <text x="${pad.left + plotW / 2}" y="${pad.top + plotH / 2}" text-anchor="middle" fill="var(--text-muted)" font-size="13">No token activity in this period</text>
        </svg>
      </div>
    `;
    return;
  }

  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
  const n = buckets.length;
  const slotW = plotW / n;
  const barW = Math.max(4, Math.min(28, slotW * 0.68));

  const fmtCount = (val: number): string => {
    const primary = formatTokens(val, numberFormat);
    const exact = formatExactTokens(val);
    return primary === exact ? exact : `${primary} (${exact})`;
  };

  const barsSvg = buckets
    .map((b, i) => {
      const slotX = pad.left + i * slotW;
      const x = slotX + (slotW - barW) / 2;
      const delay = Math.min(360, i * 10);
      const ariaLabel = `${b.rangeLabel}: Total ${formatExactTokens(b.total)} tokens, Input ${formatExactTokens(b.freshIn)}, Cached ${formatExactTokens(b.cached)}, Output ${formatExactTokens(b.output)}`;

      if (b.total === 0) {
        return `<rect class="time-hit" data-idx="${i}" tabindex="0" role="img" aria-label="${escapeHtml(ariaLabel)}" x="${slotX}" y="${pad.top}" width="${slotW}" height="${plotH}" fill="transparent" />`;
      }

      // Bottom-to-top: Input (--data-new), Cached (--data-cached), Output (--data-output)
      const hIn = (b.freshIn / maxTotal) * plotH;
      const hCached = (b.cached / maxTotal) * plotH;
      const hOut = (b.output / maxTotal) * plotH;
      const yIn = yBase - hIn;
      const yCached = yIn - hCached;
      const yOut = yCached - hOut;

      const topSegment = hOut > 0 ? "out" : hCached > 0 ? "cached" : "in";
      const rxFor = (seg: "in" | "cached" | "out", h: number) =>
        topSegment === seg && barW >= 6 && h >= 3 ? ' rx="1.5"' : "";

      return `
        <g class="chart-bar-anim" style="animation-delay:${delay}ms">
          ${hIn > 0 ? `<rect x="${x}" y="${yIn}" width="${barW}" height="${hIn}"${rxFor("in", hIn)} fill="var(--data-new)" />` : ""}
          ${hCached > 0 ? `<rect x="${x}" y="${yCached}" width="${barW}" height="${hCached}"${rxFor("cached", hCached)} fill="var(--data-cached)" />` : ""}
          ${hOut > 0 ? `<rect x="${x}" y="${yOut}" width="${barW}" height="${hOut}"${rxFor("out", hOut)} fill="var(--data-output)" />` : ""}
        </g>
        <rect class="time-hit" data-idx="${i}" tabindex="0" role="img" aria-label="${escapeHtml(ariaLabel)}" x="${slotX}" y="${pad.top}" width="${slotW}" height="${plotH}" fill="transparent" />
      `;
    })
    .join("");

  // Sparse x-axis tick labels (max ~7 evenly spaced so 24h / 30d / 26w / >24m labels never overlap)
  const labelStep = n <= 7 ? 1 : Math.max(1, Math.ceil((n - 1) / 6));
  const xLabels = buckets
    .map((b, i) => {
      const isLast = i === n - 1;
      const isStep = i % labelStep === 0;
      if (!isLast && (!isStep || (n > 7 && n - 1 - i < Math.ceil(labelStep / 2)))) {
        return "";
      }
      const cx = pad.left + i * slotW + slotW / 2;
      return `<text x="${cx}" y="${height - 10}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${escapeHtml(b.axisLabel)}</text>`;
    })
    .join("");

  container.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="display:block;overflow:visible">
        <line x1="${pad.left}" y1="${yBase}" x2="${width - pad.right}" y2="${yBase}" stroke="var(--border-card)" stroke-width="1" />
        <text x="${pad.left - 8}" y="${pad.top + 4}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="var(--font-mono)">${escapeHtml(formatTokens(maxTotal, "compact"))}</text>
        <rect id="time-col-highlight" x="0" y="${pad.top}" width="${slotW}" height="${plotH}" rx="3" fill="var(--bg-hover)" visibility="hidden" />
        ${barsSvg}
        ${xLabels}
      </svg>
      <div class="chart-tooltip" id="time-tooltip"></div>
    </div>
  `;

  const tooltip = container.querySelector("#time-tooltip") as HTMLElement | null;
  const colHighlight = container.querySelector("#time-col-highlight") as SVGRectElement | null;
  const hits = container.querySelectorAll<SVGRectElement>(".time-hit");
  if (!tooltip || !colHighlight) return;

  const showTooltip = (idx: number) => {
    const b = buckets[idx];
    if (!b) return;
    const slotX = pad.left + idx * slotW;
    const cx = slotX + slotW / 2;

    colHighlight.setAttribute("x", String(slotX));
    colHighlight.setAttribute("visibility", "visible");

    tooltip.innerHTML = `
      <div style="font-weight:600;color:var(--text-strong);margin-bottom:5px;">${escapeHtml(b.rangeLabel)}</div>
      <div class="mono" style="font-size:11.5px;display:grid;grid-template-columns:auto 1fr;gap:3px 14px;color:var(--text-standard);">
        <span style="font-weight:600;color:var(--text-strong);">Total</span>
        <span style="text-align:right;font-weight:600;color:var(--text-strong);">${escapeHtml(fmtCount(b.total))}</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span class="tu-seg-dot is-input"></span>Input</span>
        <span style="text-align:right;">${escapeHtml(fmtCount(b.freshIn))}</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span class="tu-seg-dot is-cached"></span>Cached</span>
        <span style="text-align:right;">${escapeHtml(fmtCount(b.cached))}</span>
        <span style="display:inline-flex;align-items:center;gap:5px;"><span class="tu-seg-dot is-output"></span>Output</span>
        <span style="text-align:right;">${escapeHtml(fmtCount(b.output))}</span>
      </div>
    `;

    const pctLeft = (cx / width) * 100;
    tooltip.style.left = pctLeft > 65 ? "auto" : `${pctLeft + 2}%`;
    tooltip.style.right = pctLeft > 65 ? `${100 - pctLeft + 2}%` : "auto";
    tooltip.style.top = "12px";
    tooltip.classList.add("visible");
  };

  const hideTooltip = () => {
    colHighlight.setAttribute("visibility", "hidden");
    tooltip.classList.remove("visible");
  };

  hits.forEach((hit) => {
    const idx = Number(hit.dataset.idx);
    hit.addEventListener("mouseenter", () => showTooltip(idx));
    hit.addEventListener("mousemove", () => showTooltip(idx));
    hit.addEventListener("focus", () => showTooltip(idx));
    hit.addEventListener("mouseleave", hideTooltip);
    hit.addEventListener("blur", hideTooltip);
  });
}
