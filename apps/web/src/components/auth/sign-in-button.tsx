'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/auth/msal-config';
import { Button } from '@/components/ui/button';
import { MicrosoftLogo } from '@/components/auth/microsoft-logo';

export function SignInButton({ className }: { className?: string }): JSX.Element {
  const { instance } = useMsal();

  return (
    <Button onClick={() => void instance.loginRedirect(loginRequest)} className={className}>
      <MicrosoftLogo className="h-4 w-4" />
      Sign in with Microsoft
    </Button>
  );
}
