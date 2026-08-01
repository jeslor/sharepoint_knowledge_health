import { Injectable } from '@nestjs/common';
import { ConsentVerificationError, type ConsentVerifier } from '@sph/database';
import { listSites, GraphPermissionError } from '@sph/graph-client';

/**
 * Real, Graph-aware ConsentVerifier (packages/database/src/consent-verifier.ts's
 * documented injection point) — the piece ADR-0012's 2026-07-15 amendment
 * named as deferred future work, closed 2026-08-01.
 *
 * That amendment's own text suggested `GET /servicePrincipals/{id}/appRoleAssignedTo`
 * as the verification call. Deliberately NOT implemented that way: reading
 * app role assignments requires `Directory.Read.All` or `Application.Read.All`,
 * neither of which is in this app's permission set — ADR-0003 grants only
 * `Files.Read.All`/`Sites.Read.All`, specifically to keep the requested
 * scope minimal for enterprise security review. An app with no directory-read
 * permission would get a 403 from that endpoint regardless of whether the
 * tenant actually granted Files.Read.All/Sites.Read.All — it would reject
 * every tenant unconditionally, not verify anything.
 *
 * Instead, this makes one real, permission-scoped Graph call using a
 * permission the app is actually granted: `listSites` (already the
 * production site-discovery call, ADR-0013 §4/§8). A single `.next()` pull
 * issues exactly one `/sites/getAllSites` page request — enough to prove
 * the app-only token genuinely works against this tenant, without
 * enumerating the whole tenant. A tenant with zero SharePoint sites but
 * genuine consent still resolves successfully (the call itself succeeds;
 * an empty result is not a permission error). Files.Read.All is not
 * separately probed: Microsoft's admin-consent grant is all-or-nothing for
 * this app's one static requested permission set (ADR-0003) — an admin
 * cannot consent to Sites.Read.All alone and withhold Files.Read.All — so
 * one successful Graph call under either scope is a valid proxy for both.
 */
@Injectable()
export class GraphConsentVerifierService implements ConsentVerifier {
  async verifyTenantConsent(entraTenantId: string): Promise<void> {
    try {
      await listSites(entraTenantId).next();
    } catch (error) {
      if (error instanceof GraphPermissionError) {
        throw new ConsentVerificationError(
          `Microsoft tenant ${entraTenantId} has not granted the required Graph permissions (Files.Read.All/Sites.Read.All)`,
        );
      }
      // A Graph outage, throttling, token-acquisition failure, or any other
      // unexpected error is an infrastructure problem, not a definitive
      // "consent missing" signal — propagate untouched, per ConsentVerifier's
      // own documented contract.
      throw error;
    }
  }
}
