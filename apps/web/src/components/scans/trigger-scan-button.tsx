import { useTriggerScan } from '@/lib/api/hooks/use-trigger-scan';
import { Button } from '@/components/ui/button';

export function TriggerScanButton({ disabled, onTriggered }: { disabled: boolean; onTriggered: () => void }): JSX.Element {
  const { trigger, triggering, error } = useTriggerScan(onTriggered);

  return (
    <div>
      <Button disabled={disabled || triggering} onClick={() => void trigger()}>
        {triggering ? 'Starting scan…' : 'Start scan'}
      </Button>
      {error && <p className="mt-2 text-sm text-red-700">{error.message}</p>}
    </div>
  );
}
