import { WarningRegular } from '@fluentui/react-icons';
import { UpgradeButton } from '@/components/dashboard/upgrade-button';

interface ScanLimitReachedNoticeProps {
  documentsScanned: number;
}

// Phase 5: rendered on the scan detail page when
// ScanResponse.limitReached is true — a scan in this state is a genuine
// success (status stays 'Completed'), never presented as a failure/error.
// role="status" (not "alert"): this is important information, not an
// urgent interruption — matches the persistent, non-disruptive tone the
// rest of the trial UX uses. documentsScanned keeps its existing meaning
// (this scan's own count, not account-wide usage) — see the sentence
// below, which is careful never to call it "total usage."
export function ScanLimitReachedNotice({ documentsScanned }: ScanLimitReachedNoticeProps): JSX.Element {
  return (
    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <WarningRegular fontSize={16} className="shrink-0" />
        Trial document limit reached during this scan
      </p>
      <p className="mt-2">
        Your trial document limit was reached while this scan was running, so it completed without indexing every
        remaining document. Documents indexed during this scan: {documentsScanned.toLocaleString()}.
      </p>
      <p className="mt-2">Your existing indexed documents and knowledge health results remain fully available.</p>
      <div className="mt-3">
        <UpgradeButton size="sm" />
      </div>
    </div>
  );
}
