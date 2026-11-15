const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatExactTokens(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatTokens(n: number, mode: "compact" | "full" = "compact"): string {
  if (!Number.isFinite(n)) return "0";
  if (mode === "full") {
    return formatExactTokens(n);
  }
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 100_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return Math.round(n).toLocaleString("en-US");
}

export function formatMoney(amount: number, currency: "INR" | "USD" | string): string {
  if (!Number.isFinite(amount)) return currency === "USD" ? "$0.00" : "₹0";
  if (currency === "USD") {
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  // INR: no decimals for >= 100, 2 decimals below 100
  if (Math.abs(amount) >= 100) {
    return `₹${Math.round(amount).toLocaleString("en-US")}`;
  }
  return `₹${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(pct: number): string {
  if (!Number.isFinite(pct)) return "0%";
  if (Math.abs(pct) > 0 && Math.abs(pct) < 10) {
    return `${pct.toFixed(1)}%`;
  }
  return `${Math.round(pct)}%`;
}

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "Not recorded";
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3) return isoDate;
  const year = parseInt(parts[0], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(day) || monthIdx < 0 || monthIdx > 11) {
    return isoDate;
  }
  return `${day} ${MONTHS[monthIdx]} ${year}`;
}

export function formatDateShort(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3) return isoDate;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(day) || monthIdx < 0 || monthIdx > 11) return isoDate;
  return `${day} ${MONTHS[monthIdx]}`;
}

export function formatDateTime(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "Not recorded";
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc;
  const day = d.getDate();
  const mon = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${year}, ${hh}:${mm}`;
}

export function formatTimeHm(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "--:--";
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0s";
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  return remM > 0 ? `${hrs}h ${remM}m` : `${hrs}h`;
}

export function formatRelativeTime(isoUtc: string | null | undefined, nowMs = Date.now()): string {
  if (!isoUtc) return "";
  const t = Date.parse(isoUtc);
  if (Number.isNaN(t)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

export function middleTruncate(str: string, maxLen = 48): string {
  if (str.length <= maxLen) return str;
  const keep = Math.floor((maxLen - 1) / 2);
  return `${str.slice(0, keep)}…${str.slice(str.length - keep)}`;
}

export function sourceKeyOf(source: { kind: string; name?: string }): string {
  return source.kind === "custom" ? `custom:${source.name ?? ""}` : source.kind;
}
