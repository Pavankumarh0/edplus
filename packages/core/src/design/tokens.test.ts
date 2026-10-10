import { describe, expect, it } from 'vitest';
import { RISK_LEVELS } from '../schemas/common.js';
import {
  COLORS,
  INSUFFICIENT_DATA_PALETTE,
  LEVEL_GRADIENT,
  LEVEL_PALETTE,
  WCAG,
  contrastRatio,
} from './tokens.js';

/**
 * Accessibility claims in docs/design/DESIGN.md are asserted here rather than
 * trusted. A palette tweak that breaks contrast fails `npm test`, not review.
 */
describe('contrast — risk levels', () => {
  it.each(RISK_LEVELS)('%s text on its own fill clears AAA', (level) => {
    const palette = LEVEL_PALETTE[level];
    expect(contrastRatio(palette.fg, palette.fill)).toBeGreaterThanOrEqual(WCAG.AAA_TEXT);
  });

  it.each(RISK_LEVELS)('%s text also clears AA on the card surface', (level) => {
    // Level colour is sometimes used for a figure on the card, not just in a pill.
    expect(contrastRatio(LEVEL_PALETTE[level].fg, COLORS.surface)).toBeGreaterThanOrEqual(
      WCAG.AA_TEXT,
    );
  });

  it('insufficient-data state clears AAA too', () => {
    expect(
      contrastRatio(INSUFFICIENT_DATA_PALETTE.fg, INSUFFICIENT_DATA_PALETTE.fill),
    ).toBeGreaterThanOrEqual(WCAG.AAA_TEXT);
  });

  it('every level carries a written label, so colour is never the only signal', () => {
    for (const level of RISK_LEVELS) {
      expect(LEVEL_PALETTE[level].label.trim().length).toBeGreaterThan(0);
    }
    expect(INSUFFICIENT_DATA_PALETTE.label).toBe('Insufficient data');
  });

  it('levels are visually distinct from each other by fill', () => {
    const fills = RISK_LEVELS.map((l) => LEVEL_PALETTE[l].fill);
    expect(new Set(fills).size).toBe(fills.length);
  });

  it('insufficient-data is not mistakable for a point on the green-to-red scale', () => {
    // Its fill must differ from every level fill.
    for (const level of RISK_LEVELS) {
      expect(INSUFFICIENT_DATA_PALETTE.fill).not.toBe(LEVEL_PALETTE[level].fill);
    }
  });

  it('stable and critical differ in lightness, not only hue', () => {
    // So a deuteranope can still tell them apart.
    const stable = contrastRatio(LEVEL_PALETTE.stable.fill, COLORS.white);
    const critical = contrastRatio(LEVEL_PALETTE.critical.fill, COLORS.white);
    expect(Math.abs(stable - critical)).toBeGreaterThan(0.05);
  });
});

describe('contrast — canvas and ink', () => {
  it('body ink clears AAA on both canvas and card', () => {
    expect(contrastRatio(COLORS.ink, COLORS.canvas)).toBeGreaterThanOrEqual(WCAG.AAA_TEXT);
    expect(contrastRatio(COLORS.ink, COLORS.surface)).toBeGreaterThanOrEqual(WCAG.AAA_TEXT);
  });

  it('muted ink clears AA for body text', () => {
    expect(contrastRatio(COLORS.inkMuted, COLORS.canvas)).toBeGreaterThanOrEqual(WCAG.AA_TEXT);
    expect(contrastRatio(COLORS.inkMuted, COLORS.surface)).toBeGreaterThanOrEqual(WCAG.AA_TEXT);
  });

  it('faint ink is only ever used at large/non-text sizes', () => {
    const ratio = contrastRatio(COLORS.inkFaint, COLORS.canvas);
    expect(ratio).toBeGreaterThanOrEqual(WCAG.AA_LARGE);
    // Documents the limit: this token must not be used for body copy.
    expect(ratio).toBeLessThan(WCAG.AA_TEXT);
  });

  it('hairline is visible against the canvas', () => {
    expect(contrastRatio(COLORS.hairline, COLORS.canvas)).toBeGreaterThan(1.1);
  });
});

describe('contrast — lime', () => {
  it('ink on lime is highly legible, which is the only permitted pairing', () => {
    expect(contrastRatio(COLORS.ink, COLORS.lime)).toBeGreaterThanOrEqual(WCAG.AAA_TEXT);
  });

  it('white on lime is unusable — the reason lime never carries light text', () => {
    // Pinned deliberately: if someone "fixes" lime to work with white, the
    // accent is no longer the lime the brief asked for.
    expect(contrastRatio(COLORS.white, COLORS.lime)).toBeLessThan(WCAG.AA_LARGE);
  });

  it('lime-edge works for borders and icons on a card', () => {
    expect(contrastRatio(COLORS.limeEdge, COLORS.surface)).toBeGreaterThanOrEqual(
      WCAG.AA_LARGE,
    );
  });

  it('lime-text works for body text on a card', () => {
    expect(contrastRatio(COLORS.limeText, COLORS.surface)).toBeGreaterThanOrEqual(
      WCAG.AA_TEXT,
    );
  });
});

describe('student-app gradients', () => {
  it('covers every level, so the card feel always matches the label', () => {
    for (const level of RISK_LEVELS) {
      expect(LEVEL_GRADIENT[level]).toHaveLength(2);
    }
  });

  it('keeps ink legible at both ends of every gradient', () => {
    // Gradients sit behind text in the student app, so both stops must work.
    for (const level of RISK_LEVELS) {
      for (const stop of LEVEL_GRADIENT[level]) {
        expect(
          contrastRatio(COLORS.ink, stop),
          `${level} stop ${stop}`,
        ).toBeGreaterThanOrEqual(WCAG.AAA_TEXT);
      }
    }
  });
});
