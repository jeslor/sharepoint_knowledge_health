'use client';

import { useCurrentUser } from '@/lib/auth/current-user-context';
import { requireClientId } from '@/lib/auth/msal-config';
import { adminConsentRedirectUri, buildAdminConsentUrl, startConnectFlow } from '@/lib/auth/connect-flow';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';

/**
 * ADR-0023 §3.8: the approved re-consent entry point for an
 * already-Consented tenant. Deliberately not a new backend endpoint or a
 * second OAuth implementation — this reuses exactly the same
 * buildAdminConsentUrl()/adminConsentRedirectUri()/startConnectFlow()
 * plumbing `/connect` already uses, and lands on the same
 * `/connect/admin-consent-callback` → sign-in → `/connect/finishing` →
 * `POST /auth/consent-callback` path, unchanged. The only thing this page
 * adds is a route an already-signed-in Admin can actually reach —
 * `/connect` itself auto-redirects any already-resolvable authenticated
 * user straight to `/dashboard` (`connect/page.tsx`), which is exactly why
 * a dedicated Settings entry point is needed instead of reusing that page.
 *
 * Authorization: this page reuses the same client-side Admin gate every
 * other Administration-group page already uses (`dashboard/users`,
 * `dashboard/sharepoint`) — there is no new backend action to guard here,
 * since starting the Microsoft redirect calls no endpoint of ours at all;
 * the real enforcement remains what it always was for this flow: only a
 * genuine Microsoft Global Administrator can complete Microsoft's own
 * admin-consent dialog, and only a verified ID token reaches
 * `POST /auth/consent-callback` afterward.
 */
export default function SettingsPage(): JSX.Element {
  const { user } = useCurrentUser();

  if (user && user.role !== 'Admin') {
    return <Card className="text-sm text-slate-600">Only an Admin can manage organization settings.</Card>;
  }

  function handleRefreshPermissions(): void {
    const tenantName = user?.tenantName ?? '';
    const state = startConnectFlow(tenantName);
    const url = buildAdminConsentUrl(requireClientId(), adminConsentRedirectUri(), state);
    window.location.href = url;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Microsoft 365 connection</h2>
          <p className="mt-1 text-sm text-slate-600">
            {user?.tenantName ? `Connected to ${user.tenantName}.` : 'No Microsoft 365 tenant connected.'}
          </p>
        </div>

        {user?.needsReconsent && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Some permissions for this organization may need to be refreshed. This will not affect your
            existing documents, scans, or governance data — only a Global Administrator needs to
            complete this step.
          </div>
        )}

        <Button variant="secondary" onClick={handleRefreshPermissions}>
          Refresh Microsoft 365 permissions
        </Button>
      </Card>
    </div>
  );
}
