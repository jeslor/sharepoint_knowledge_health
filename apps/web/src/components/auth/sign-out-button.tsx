'use client';

import { useMsal } from '@azure/msal-react';
import { SignOutRegular } from '@fluentui/react-icons';
import { Button } from '@/components/ui/button';

export function SignOutButton(): JSX.Element {
  const { instance } = useMsal();

  return (
    <Button variant="secondary" size="sm" icon={SignOutRegular} onClick={() => void instance.logoutRedirect()}>
      Sign out
    </Button>
  );
}
