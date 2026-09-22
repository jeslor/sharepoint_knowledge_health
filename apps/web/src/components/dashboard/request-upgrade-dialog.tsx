'use client';

import { useState } from 'react';
import { CheckmarkCircleFilled } from '@fluentui/react-icons';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useUsage } from '@/lib/api/hooks/use-usage';
import { useRequestUpgrade } from '@/lib/api/hooks/use-request-upgrade';

// Mirrors the API's own MAX_MESSAGE_LENGTH (apps/api/src/upgrade-request/
// upgrade-request.service.ts) — presentational only (keeps the textarea
// from growing unbounded as the user types); the backend remains the
// authoritative validator regardless of this client-side cap.
const MESSAGE_MAX_LENGTH = 2000;

interface RequestUpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Fires once, right when the request succeeds — lets a caller (e.g. the
  // sidebar usage indicator) show its own brief "Upgrade request sent"
  // acknowledgment without this dialog needing to know anything about
  // where it was opened from.
  onSuccess?: () => void;
}

// Phase 6: the one "Request an upgrade" experience, reused from every
// trigger point (the sidebar usage indicator at 100%, the scan-result
// limit notice) — self-contained (fetches its own organization/usage
// context) so no caller needs to prop-drill that data in. A real request
// workflow, not a placeholder acknowledgment: creates a persisted
// UpgradeRequest and a real email to hi@Jeslor.com
// (upgrade-request.service.ts) — see that service for exactly what
// "success" means server-side.
export function RequestUpgradeDialog({ open, onOpenChange, onSuccess }: RequestUpgradeDialogProps): JSX.Element {
  const { user } = useCurrentUser();
  const { data: usage, loading: usageLoading } = useUsage();
  const { submit, submitting, success, error, reset } = useRequestUpgrade();
  const [message, setMessage] = useState('');

  const handleOpenChange = (next: boolean): void => {
    onOpenChange(next);
    if (!next) {
      // Reset for a clean slate next time it's opened — this component
      // itself stays mounted across close/reopen (only the inner Fluent
      // Dialog's content conditionally renders), so local state would
      // otherwise persist stale.
      setMessage('');
      reset();
    }
  };

  const handleSubmit = (): void => {
    void submit(message.trim() || undefined).then(() => onSuccess?.());
  };

  if (success) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange} title="Upgrade request sent">
        <div className="space-y-3 text-sm text-slate-700">
          <p className="flex items-center gap-2 font-medium text-slate-900">
            <CheckmarkCircleFilled fontSize={20} className="shrink-0 text-green-600" />
            Your request has been sent.
          </p>
          <p>We&rsquo;ll review your organization&rsquo;s requirements and get in touch with you.</p>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => handleOpenChange(false)}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Request an upgrade"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Spinner className="h-4 w-4 text-white" />}
            {submitting ? 'Sending…' : 'Send request'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm text-slate-700">
        <p>
          Your organization has reached the document limit for the current trial. Submit a request and we&rsquo;ll
          get in touch about upgrading your organization&rsquo;s capacity.
        </p>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-slate-200/60 bg-slate-50 p-3">
          <dt className="font-medium text-slate-500">Organization</dt>
          <dd className="text-slate-900">{user?.organizationName || '—'}</dd>
          <dt className="font-medium text-slate-500">Current usage</dt>
          <dd className="text-slate-900">
            {!usageLoading && usage
              ? `${usage.currentDocumentCount.toLocaleString()} / ${usage.documentLimit.toLocaleString()} documents`
              : '—'}
          </dd>
          <dt className="font-medium text-slate-500">Plan</dt>
          <dd className="text-slate-900">{!usageLoading && usage ? usage.planType : '—'}</dd>
        </dl>

        <Field label="Message (optional)">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, MESSAGE_MAX_LENGTH))}
            placeholder="Tell us anything that would help us understand your requirements."
            rows={4}
            disabled={submitting}
            invalid={Boolean(error)}
            aria-describedby={error ? 'request-upgrade-error' : undefined}
          />
        </Field>

        {error && (
          <p id="request-upgrade-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
            We couldn&rsquo;t send your request. Please try again.
          </p>
        )}
      </div>
    </Dialog>
  );
}
