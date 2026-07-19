'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/auth/msal-config';
import { Button } from '@/components/ui/button';

export function SignInButton(): JSX.Element {
  const { instance } = useMsal();

  return <Button onClick={() => void instance.loginRedirect(loginRequest)}>Sign in with Microsoft</Button>;
}
