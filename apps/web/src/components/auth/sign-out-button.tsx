'use client';

import { useMsal } from '@azure/msal-react';

export function SignOutButton(): JSX.Element {
  const { instance } = useMsal();

  return (
    <button
      type="button"
      onClick={() => void instance.logoutRedirect()}
      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      Sign out
    </button>
  );
}
