# Antigravity Usage — Design System (v3)

## Aesthetic & Chrome
- **Monochrome App Chrome (Antigravity 2.0 App)**:
  - Window canvas (menu bar, toolbar, sidebar): `#FAFAFA`
  - Content panel & cards: `#FFFFFF` (content panel 16px radius, `1px solid #E0E0E0`; cards 12px radius, `1px solid #E6E6E6`, no shadow)
  - Subtle fill (inline code, table header, hover): `#F5F5F5`
  - Selected nav row / top sidebar button: `#FFFFFF` 10px radius, `1px solid #F0F0F0`, `0 1px 2px rgba(0,0,0,.04)`
  - Filter bar (composer-style): `#FFFFFF` 20px radius, `1px solid #E6E6E6`, `0 1px 3px rgba(0,0,0,.06)`
  - Primary action button / pill: `#0A0A0C` fill, white text
  - Text hierarchy: `#0A0A0C` strongest, `#3F3F46` standard, `#71717A` muted, `#828283` section label, `#6C6C6D` relative time, `#BBBBBF` faint
  - Inline code / paths / IDs: `#F5F5F5` chip with `#3E5270` monospace text
  - Links & focus ring: `#1A73E8`

## Semantic Data Colours (Antigravity CLI Palette)
- **New input**: `#1967D2`
- **Cached input**: `#AECBFA`
- **Output**: `#E37400`
- **Source App**: `#3F3F46` zinc, `APP` badge + small black "A" glyph (hatched in charts)
- **Source CLI**: `#9334E6` purple, `CLI` badge + small pixel-"A" glyph (solid in charts)
- **Status**: OK `#188038` on `#E6F4EA`, Warning `#E37400` on `#FEF7E0` (icon `#FFB02E`), Error `#D93025` on `#FCE8E6`
- **CLI accents**: Header/key hints `#4285F4`, Diff added `#E6F4EA`, Diff removed `#FCE8E6`

## Typography
- **UI**: Google Sans (fallbacks: Inter, Segoe UI Variable). Sentence case everywhere; ALL CAPS only for `APP`/`CLI` badges.
- **Mono / Numbers / IDs / Status line**: Google Sans Code / Cascadia Mono with tabular figures.
- Summary sentence: 24/36 regular (numbers medium); Page title: 20/28 medium; Card title: 15/22 medium; Body: 14/22; KPI number: 30/38 regular mono; Caption: 12/16 `#71717A`.
