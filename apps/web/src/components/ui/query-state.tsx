/**
 * Shared loading/error/empty rendering for every useApiQuery-backed view
 * (frontend-rules.md: "Always handle loading states. Handle error states.
 * Handle empty states."). One place for this instead of repeating the same
 * three branches in every page/component.
 */
export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return <p className="p-4 text-sm text-slate-500">{label}</p>;
}

export function ErrorState({ error }: { error: Error }): JSX.Element {
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {error.message || 'Something went wrong.'}
    </p>
  );
}

export function EmptyState({ label }: { label: string }): JSX.Element {
  return <p className="p-4 text-sm text-slate-500">{label}</p>;
}
