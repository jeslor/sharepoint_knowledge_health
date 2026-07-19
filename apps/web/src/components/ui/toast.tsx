import { useEffect } from 'react';
import { CheckmarkCircleFilled, DismissRegular } from '@fluentui/react-icons';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  // Auto-dismiss after this many ms — a one-shot action confirmation isn't
  // meant to linger. Set to 0 to disable auto-dismiss.
  durationMs?: number;
}

// Minimal, dependency-free toast (fixed-position div + timeout) for one-shot
// action feedback (e.g. "Assignment updated") — the one place in the design
// system that uses shadow-md on static-feeling content, because a toast is
// a genuinely floating layer, not part of the page's static surface.
export function Toast({ message, onDismiss, durationMs = 4000 }: ToastProps): JSX.Element {
  useEffect(() => {
    if (durationMs === 0) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-20 flex animate-fade-in items-center gap-2 rounded-md border border-slate-200/60 bg-white px-4 py-3 text-sm text-slate-900 shadow-md"
    >
      <CheckmarkCircleFilled fontSize={20} className="shrink-0 text-green-600" />
      {message}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-2 rounded text-slate-400 transition-colors duration-150 ease-premium hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <DismissRegular fontSize={16} />
      </button>
    </div>
  );
}
