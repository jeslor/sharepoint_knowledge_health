import { createLightTheme, type BrandVariants, type Theme } from '@fluentui/react-components';

// Phase 10A.4 (plan Part 3.6 §3): a 16-step BrandVariants ramp (10 = darkest,
// 160 = lightest — Fluent's own convention) derived from this app's existing
// 10-step `brand` Tailwind scale (tailwind.config.ts), so Fluent-backed
// components (Dialog/Menu/ContextMenu/Callout) render in this app's own
// blue, not stock Microsoft blue. Most stops reuse an existing Tailwind hex
// exactly; a few intermediate stops are interpolated to fill Fluent's finer
// 16-step scale.
const brandRamp: BrandVariants = {
  10: '#041c2e',
  20: '#062843',
  30: '#08375c', // brand-900
  40: '#0a4571', // brand-800
  50: '#0c568e', // brand-700
  60: '#0f6cb3', // brand-600
  70: '#125f9e',
  80: '#1a7fce', // brand-500
  90: '#3f97dc', // brand-400
  100: '#71b6e8', // brand-300
  110: '#8bc3ec',
  120: '#a6d3f1', // brand-200
  130: '#bfe0f5',
  140: '#d3e9f8', // brand-100
  150: '#e4f2fb',
  160: '#eff6fc', // brand-50
};

export const brandTheme: Theme = createLightTheme(brandRamp);
