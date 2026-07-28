// Shared inline spinner — Tailwind's built-in animate-spin utility only,
// no new dependency. Reused by TriggerScanButton (in-flight feedback) and
// ScanList (a live indicator on the currently Running row).
export function Spinner({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
