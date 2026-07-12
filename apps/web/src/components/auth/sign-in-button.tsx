'use client';

import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/auth/msal-config';

export function SignInButton(): JSX.Element {
  const { instance } = useMsal();

  return (
    <button
      type="button"
      onClick={() => void instance.loginRedirect(loginRequest)}
      className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      Sign in with Microsoft
    </button>
  );
}
