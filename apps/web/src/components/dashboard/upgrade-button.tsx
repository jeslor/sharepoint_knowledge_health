'use client';

import { useState } from 'react';
import { Button, type ButtonSize } from '@/components/ui/button';

interface UpgradeButtonProps {
  size?: ButtonSize;
}

// Phase 5: no billing/upgrade flow exists yet — this is an honest
// placeholder acknowledgment, not a fake "request sent to sales" flow and
// not a dead/no-op button either. The onClick body is the integration
// point for a real upgrade flow once one exists; shared by the usage-limit
// dialog and the scan-result limit notice so the placeholder copy lives in
// exactly one place.
export function UpgradeButton({ size }: UpgradeButtonProps): JSX.Element {
  const [clicked, setClicked] = useState(false);

  if (clicked) {
    return (
      <p role="status" className="text-sm text-slate-600">
        Thanks for your interest — upgrade requests aren&rsquo;t available directly in the app yet.
      </p>
    );
  }

  return (
    <Button size={size} onClick={() => setClicked(true)}>
      Upgrade
    </Button>
  );
}
