import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // Phase 10A.2/10A.3/10A.6 design system — see plan Part 3/4/2. Each
      // token bundles size+line-height+weight(+tracking) so one class
      // carries the full typographic intent. 10A.6 adds negative tracking
      // + a heavier metric weight — the confident weight/tracking contrast
      // premium products use, without changing any size.
      fontSize: {
        'page-title': ['1.5rem', { lineHeight: '2rem', fontWeight: '600', letterSpacing: '-0.01em' }],
        'section-title': ['1.125rem', { lineHeight: '1.75rem', fontWeight: '600', letterSpacing: '-0.01em' }],
        body: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400' }],
        'body-strong': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '500' }],
        caption: ['0.75rem', { lineHeight: '1rem', fontWeight: '400' }],
        metric: ['2rem', { lineHeight: '2.5rem', fontWeight: '700', letterSpacing: '-0.02em' }],
      },
      // Selective accent only (active nav, links, focus rings, chart line) —
      // not a repaint of the slate-neutral base. Tuned near Microsoft's
      // #0078D4 as inspiration, not an exact copy.
      colors: {
        brand: {
          50: '#eff6fc',
          100: '#d3e9f8',
          200: '#a6d3f1',
          300: '#71b6e8',
          400: '#3f97dc',
          500: '#1a7fce',
          600: '#0f6cb3',
          700: '#0c568e',
          800: '#0a4571',
          900: '#08375c',
        },
      },
      // Phase 10A.3/10A.6 motion tokens — plan Part 3/2. Kept short
      // (120-200ms) and purposeful: each one confirms a state change,
      // nothing decorative. 10A.6 swaps plain ease-out for `premium`, a
      // snappy-deceleration curve documented in this exact family of
      // products (Vercel/Linear/Stripe-adjacent — see easings.net's
      // ease-out-expo family), applied consistently everywhere motion
      // already existed — no new motion purpose introduced, only feel.
      keyframes: {
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-in-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        flash: { '0%, 100%': { backgroundColor: 'transparent' }, '50%': { backgroundColor: '#eff6fc' } },
      },
      animation: {
        'slide-in-left': 'slide-in-left 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in-up': 'fade-in-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.8s linear infinite',
        flash: 'flash 150ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      // Soft, tinted, two-layer elevation for Layer 1 surfaces (Card) — a
      // deliberate, confirmed reversal of the earlier "no shadow, ever"
      // rule (plan Part 2 §4). Tinted toward slate-900 rather than pure
      // black (Stripe's technique) so it reads as designed, not a generic
      // drop shadow. Layer 2 (Menu/Callout/Dialog/Toast) keeps the
      // existing, more pronounced `shadow-md` — unchanged.
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 1px 0 rgba(15, 23, 42, 0.03)',
        'card-hover': '0 4px 8px 0 rgba(15, 23, 42, 0.06), 0 2px 4px 0 rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
