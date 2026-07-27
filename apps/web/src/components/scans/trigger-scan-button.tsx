import { useTriggerScan } from '@/lib/api/hooks/use-trigger-scan';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export function TriggerScanButton({ disabled, onTriggered }: { disabled: boolean; onTriggered: () => void }): JSX.Element {
  const { trigger, triggering, error } = useTriggerScan(onTriggered);

  return (
    <div>
      <Button disabled={disabled || triggering} onClick={() => void trigger()}>
        {triggering && <Spinner className="h-4 w-4 text-white" />}
        {triggering ? 'Starting scan…' : 'Start scan'}
      </Button>
      {error && <p className="mt-2 text-sm text-red-700">{error.message}</p>}
    </div>
  );
}
