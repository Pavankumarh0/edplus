import type { RiskLevel } from '../schemas/common';

/**
 * Design tokens — the machine-readable source of truth.
 *
 * `docs/design/DESIGN.md` is the prose that explains these choices; this file
 * is what the Tailwind config and the contrast test actually read, so the two
 * cannot drift. Change a colour here, not in a component.
 */

export const COLORS = {
  canvas: '#F2F0EB',
  surface: '#FBFAF8',
  surfaceSunk: '#EAE7E0',

  /** Warm near-black. A cold black on a warm-grey canvas reads as two palettes. */
  ink: '#121110',
  inkMuted: '#5C5852',
  inkFaint: '#8F8A82',
  hairline: '#DDD9D1',

  /** The accent. A surface, never a foreground — it cannot carry text. */
  lime: '#D9F99D',
  /** Dark enough for borders and icons on a light surface. */
  limeEdge: '#7B9C2F',
  /** The only lime dark enough for body text. */
  limeText: '#627C25',

  white: '#FFFFFF',
} as const;

export interface LevelPalette {
  /** Text and border colour. */
  fg: string;
  /** Pill / chart fill. */
  fill: string;
  /** Written label. Colour is never the only signal. */
  label: string;
}

/**
 * Risk level palettes. Every pair clears 7:1 (AAA) — asserted in
 * `tokens.test.ts`, not merely claimed.
 */
export const LEVEL_PALETTE: Record<RiskLevel, LevelPalette> = {
  stable: { fg: '#195936', fill: '#DCF2E4', label: 'Stable' },
  watch: { fg: '#704900', fill: '#FBF0D2', label: 'Watch' },
  at_risk: { fg: '#7C380E', fill: '#FBE3D2', label: 'At Risk' },
  critical: { fg: '#8D1A1A', fill: '#FBDAD9', label: 'Critical' },
};

/**
 * A fifth visual state, NOT a level.
 *
 * Slate on purpose, so it cannot be read as a position on the green→red scale.
 * A student we know nothing about must never look like a student we know is fine.
 */
export const INSUFFICIENT_DATA_PALETTE: LevelPalette = {
  fg: '#484866',
  fill: '#E6E6F0',
  label: 'Insufficient data',
};

/** Student-app gradients, keyed by level so the feel matches the label. */
export const LEVEL_GRADIENT: Record<RiskLevel, [string, string]> = {
  stable: ['#DFF5EA', '#CFE9F7'],
  watch: ['#DCEBFA', '#E6F4F1'],
  at_risk: ['#E8E2F7', '#F3E4F0'],
  critical: ['#F3E4F0', '#FBE3D2'],
};

export const RADIUS = {
  control: '10px',
  card: '24px',
  hero: '32px',
  pill: '999px',
} as const;

export const SHADOW = {
  none: 'none',
  raised: '0 1px 2px rgba(18,17,16,.05), 0 8px 24px -12px rgba(18,17,16,.14)',
} as const;

export const FONT_STACK = {
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** [size, lineHeight, weight, letterSpacing] */
export const TYPE_SCALE = {
  display: ['56px', '1.0', 680, '-0.03em'],
  metric: ['34px', '1.1', 640, '-0.02em'],
  h1: ['26px', '1.25', 600, '-0.015em'],
  h2: ['17px', '1.35', 600, '-0.01em'],
  body: ['15px', '1.55', 440, '0'],
  bodySm: ['13.5px', '1.5', 440, '0'],
  label: ['12.5px', '1.3', 560, '0.01em'],
  mono: ['13px', '1.4', 500, '0'],
} as const satisfies Record<string, readonly [string, string, number, string]>;

export const MOTION = {
  duration: '180ms',
  easing: 'cubic-bezier(.2,.7,.3,1)',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Contrast
// ─────────────────────────────────────────────────────────────────────────────

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (
    0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
  );
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG = { AA_TEXT: 4.5, AA_LARGE: 3, AAA_TEXT: 7 } as const;
