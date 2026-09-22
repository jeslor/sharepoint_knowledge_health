'use client';

import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UpgradeButton } from './upgrade-button';

interface UsageLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentDocumentCount: number;
  documentLimit: number;
}

// Phase 5: the full explanation of the limit-reached state — deliberately
// never auto-opened (the persistent sidebar indicator already communicates
// this state on every page without interrupting anything); this only opens
// on an explicit click, so it can never "show a modal every time the user
// navigates." Copy follows the task's own core UX principle: never imply
// existing indexed documents disappear, never call this a failure.
export function UsageLimitDialog({ open, onOpenChange, currentDocumentCount, documentLimit }: UsageLimitDialogProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Trial document limit reached"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <UpgradeButton />
        </div>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          You&rsquo;ve indexed <span className="font-medium text-slate-900">{currentDocumentCount.toLocaleString()}</span> documents,
          which is the current trial limit of {documentLimit.toLocaleString()}.
        </p>
        <p>Your existing knowledge health results remain fully available — nothing has been removed or hidden.</p>
        <p>Upgrade to continue indexing additional documents.</p>
      </div>
    </Dialog>
  );
}
