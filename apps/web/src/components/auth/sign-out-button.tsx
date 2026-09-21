'use client';

import { useMsal } from '@azure/msal-react';
import { SignOutRegular } from '@fluentui/react-icons';
import { Button } from '@/components/ui/button';

// Mobile fix: icon-only below sm: — the label text was one of the two
// things (alongside the brand name) competing for the header's limited
// width on a narrow phone, part of what pushed the brand text into an
// unreadable truncation. aria-label keeps this properly named for assistive
// tech at every width, not just when the visible text is hidden.
export function SignOutButton(): JSX.Element {
  const { instance } = useMsal();

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={SignOutRegular}
      aria-label="Sign out"
      onClick={() => void instance.logoutRedirect()}
    >
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
