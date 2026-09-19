// The standard 4-color Microsoft "squares" mark — a static inline SVG (no
// icon-font/image asset, no new dependency) used on pre-auth screens to
// signal "this connects to Microsoft" at a glance, matching how Microsoft's
// own product surfaces (M365, Entra, Azure portal) brand their sign-in entry
// points.
export function MicrosoftLogo({ className = 'h-5 w-5' }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
