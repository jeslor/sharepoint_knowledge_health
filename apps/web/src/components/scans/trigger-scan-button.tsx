import { useTriggerScan } from '@/lib/api/hooks/use-trigger-scan';

export function TriggerScanButton({ disabled, onTriggered }: { disabled: boolean; onTriggered: () => void }): JSX.Element {
  const { trigger, triggering, error } = useTriggerScan(onTriggered);

  return (
    <div>
      <button
        type="button"
        disabled={disabled || triggering}
        onClick={() => void trigger()}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {triggering ? 'Starting scan…' : 'Start scan'}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error.message}</p>}
    </div>
  );
}
