import { SourceKind } from "./types.ts";
import { escapeHtml } from "./format.ts";

export function appLogoSvg(size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3.2C10.9 3.2 10.1 3.8 9.6 4.9L4.3 18.8C4.0 19.6 4.5 20.4 5.4 20.4H7.5C8.2 20.4 8.8 19.9 9.1 19.2L10.3 15.8H13.7L14.9 19.2C15.2 19.9 15.8 20.4 16.5 20.4H18.6C19.5 20.4 20.0 19.6 19.7 18.8L14.4 4.9C13.9 3.8 13.1 3.2 12 3.2ZM11.0 13.4L12.0 10.3L13.0 13.4H11.0Z" fill="currentColor"/>
  </svg>`;
}

// 7-colour pixel "A" from the Antigravity CLI screenshot
// Palette: #F2922E orange, #EF5442 red, #DBB131 yellow, #7CC251 green, #62BAD5 teal, #3D89FB blue, #8F64B4 purple
const PIXEL_A_BLOCKS: Array<{ x: number; y: number; color: string; delay: number }> = [
  { x: 3, y: 0, color: "#F2922E", delay: 0 },
  { x: 4, y: 0, color: "#EF5442", delay: 45 },
  { x: 2, y: 1, color: "#F2922E", delay: 90 },
  { x: 5, y: 1, color: "#EF5442", delay: 135 },
  { x: 2, y: 2, color: "#DBB131", delay: 180 },
  { x: 5, y: 2, color: "#7CC251", delay: 225 },
  { x: 1, y: 3, color: "#DBB131", delay: 270 },
  { x: 6, y: 3, color: "#7CC251", delay: 315 },
  { x: 1, y: 4, color: "#7CC251", delay: 360 },
  { x: 2, y: 4, color: "#62BAD5", delay: 405 },
  { x: 3, y: 4, color: "#3D89FB", delay: 450 },
  { x: 4, y: 4, color: "#3D89FB", delay: 495 },
  { x: 5, y: 4, color: "#62BAD5", delay: 540 },
  { x: 6, y: 4, color: "#8F64B4", delay: 585 },
  { x: 0, y: 5, color: "#62BAD5", delay: 630 },
  { x: 7, y: 5, color: "#8F64B4", delay: 675 },
  { x: 0, y: 6, color: "#3D89FB", delay: 720 },
  { x: 7, y: 6, color: "#8F64B4", delay: 765 },
];

export function pixelASvg(size = 16): string {
  const rects = PIXEL_A_BLOCKS.map(
    (b) => `<rect x="${b.x * 2}" y="${b.y * 2}" width="1.85" height="1.85" rx="0.25" fill="${b.color}" />`
  ).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 14" fill="none" aria-hidden="true">${rects}</svg>`;
}

export function pixelALoaderSvg(size = 80): string {
  const rects = PIXEL_A_BLOCKS.map(
    (b) =>
      `<rect class="pixel-a-block" style="animation-delay:${b.delay}ms" x="${b.x * 10}" y="${b.y * 10}" width="8.5" height="8.5" rx="1.2" fill="${b.color}" />`
  ).join("");
  return `<svg class="pixel-a-loader" width="${size}" height="${Math.round((size * 7) / 8)}" viewBox="0 0 80 70" fill="none" aria-hidden="true">${rects}</svg>`;
}

export function sourceGlyphHtml(source: SourceKind, size = 14): string {
  if (source.kind === "cli") {
    return `<span class="source-glyph source-glyph-cli" title="Antigravity CLI">${pixelASvg(size)}</span>`;
  }
  if (source.kind === "app") {
    return `<span class="source-glyph source-glyph-app" title="Antigravity App">${appLogoSvg(size)}</span>`;
  }
  return `<span class="source-glyph source-glyph-custom" title="${escapeHtml(source.name)}">${icons.folder(size)}</span>`;
}

export function sourceBadgeHtml(source: SourceKind): string {
  if (source.kind === "cli") {
    return `<span class="source-badge source-badge-cli">${pixelASvg(12)}<span>CLI</span></span>`;
  }
  if (source.kind === "app") {
    return `<span class="source-badge source-badge-app">${appLogoSvg(12)}<span>APP</span></span>`;
  }
  return `<span class="source-badge source-badge-custom"><span>${escapeHtml(source.name.toUpperCase().slice(0, 6))}</span></span>`;
}

export function infoIconHtml(glossaryKey: string, label?: string): string {
  const title = label ? `About ${escapeHtml(label)}` : "About this metric";
  return `<button type="button" class="info-btn" data-glossary="${escapeHtml(glossaryKey)}" title="${title}" aria-label="${title}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
  </button>`;
}

function svg(path: string, size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export const icons = {
  sidebar: (s = 18) => svg(`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>`, s),
  back: (s = 18) => svg(`<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>`, s),
  forward: (s = 18) => svg(`<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>`, s),
  search: (s = 18) => svg(`<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`, s),
  refresh: (s = 18) => svg(`<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>`, s),
  overview: (s = 18) => svg(`<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`, s),
  sessions: (s = 18) => svg(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>`, s),
  projects: (s = 18) => svg(`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`, s),
  costs: (s = 18) => svg(`<circle cx="12" cy="12" r="9"/><path d="M14.8 9a2 2 0 0 0-1.8-1h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a2 2 0 0 1-1.8-1"/><path d="M12 6v2m0 8v2"/>`, s),
  sources: (s = 18) => svg(`<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>`, s),
  settings: (s = 18) => svg(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`, s),
  folder: (s = 16) => svg(`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`, s),
  moreVert: (s = 18) => svg(`<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>`, s),
  panelRight: (s = 18) => svg(`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>`, s),
  chevronDown: (s = 14) => svg(`<path d="m6 9 6 6 6-6"/>`, s),
  chevronRight: (s = 14) => svg(`<path d="m9 18 6-6-6-6"/>`, s),
  arrowDown: (s = 16) => svg(`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`, s),
  copy: (s = 14) => svg(`<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`, s),
  external: (s = 14) => svg(`<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`, s),
  lock: (s = 20) => svg(`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`, s),
  warning: (s = 16) => svg(`<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`, s),
  info: (s = 18) => svg(`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`, s),
  close: (s = 16) => svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`, s),
  filter: (s = 14) => svg(`<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>`, s),
  plus: (s = 14) => svg(`<path d="M12 5v14"/><path d="M5 12h14"/>`, s),
};
