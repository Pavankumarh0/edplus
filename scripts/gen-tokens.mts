/**
 * Generates `apps/web/app/tokens.css` from `packages/core/src/design/tokens.ts`.
 *
 * Tailwind 4 is CSS-first, so its theme lives in CSS rather than a JS config.
 * Rather than maintain the palette twice, this emits the CSS from the
 * TypeScript tokens — which are also what the charts and components import and
 * what the contrast test asserts against. One source, three consumers.
 *
 * Run via tsx, automatically before `next dev` and `next build`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLORS,
  FONT_STACK,
  INSUFFICIENT_DATA_PALETTE,
  LEVEL_GRADIENT,
  LEVEL_PALETTE,
  MOTION,
  RADIUS,
  SHADOW,
  TYPE_SCALE,
} from '@eduplus/core/design';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'apps/web/app/tokens.css');

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const lines: string[] = [
  '/*',
  ' * GENERATED FILE — do not edit.',
  ' * Source: packages/core/src/design/tokens.ts',
  ' * Regenerate: npm run tokens --workspace @eduplus/web',
  ' */',
  '',
  '@theme {',
  '  /* canvas and ink */',
];

for (const [name, value] of Object.entries(COLORS)) {
  lines.push(`  --color-${kebab(name)}: ${value};`);
}

lines.push('', '  /* risk levels — fill + text, never colour alone */');
for (const [level, palette] of Object.entries(LEVEL_PALETTE)) {
  const key = level.replace(/_/g, '-');
  lines.push(`  --color-level-${key}: ${palette.fg};`);
  lines.push(`  --color-level-${key}-fill: ${palette.fill};`);
}
lines.push(`  --color-level-nodata: ${INSUFFICIENT_DATA_PALETTE.fg};`);
lines.push(`  --color-level-nodata-fill: ${INSUFFICIENT_DATA_PALETTE.fill};`);

lines.push('', '  /* radius — varies by role, deliberately */');
for (const [name, value] of Object.entries(RADIUS)) {
  lines.push(`  --radius-${kebab(name)}: ${value};`);
}

lines.push('', '  /* elevation — only genuinely floating things */');
lines.push(`  --shadow-raised: ${SHADOW.raised};`);

lines.push('', '  /* type */');
lines.push(`  --font-sans: ${FONT_STACK.sans};`);
lines.push(`  --font-mono: ${FONT_STACK.mono};`);
for (const [name, step] of Object.entries(TYPE_SCALE)) {
  const [size, lineHeight, weight, tracking] = step;
  const key = kebab(name);
  lines.push(`  --text-${key}: ${size};`);
  lines.push(`  --text-${key}--line-height: ${lineHeight};`);
  lines.push(`  --text-${key}--font-weight: ${weight};`);
  lines.push(`  --text-${key}--letter-spacing: ${tracking};`);
}

lines.push('', '  /* motion */');
lines.push(`  --ease-ui: ${MOTION.easing};`);
lines.push('}');

lines.push('', ':root {');
lines.push('  /* student-app gradients, keyed by level so feel matches label */');
for (const [level, [from, to]] of Object.entries(LEVEL_GRADIENT)) {
  const key = level.replace(/_/g, '-');
  lines.push(`  --gradient-${key}: linear-gradient(140deg, ${from} 0%, ${to} 100%);`);
}
lines.push(`  --motion-duration: ${MOTION.duration};`);
lines.push('}', '');

const css = lines.join('\n');

mkdirSync(dirname(OUT), { recursive: true });

let previous = '';
try {
  previous = readFileSync(OUT, 'utf8');
} catch {
  /* first run */
}

if (previous === css) {
  console.log('tokens.css already current');
} else {
  writeFileSync(OUT, css, 'utf8');
  console.log(
    `tokens.css written — ${Object.keys(COLORS).length} colours, ` +
      `${Object.keys(LEVEL_PALETTE).length + 1} level palettes, ` +
      `${Object.keys(TYPE_SCALE).length} type steps`,
  );
}
