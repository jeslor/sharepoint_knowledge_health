import 'reflect-metadata';
import { backfillOrganizationEntitlements } from '@sph/database';

/**
 * One-time, manual, operator-run migration step — never imported by any
 * application flow, matching demo-seed's own posture exactly ("nothing in
 * the deployed application knows this directory exists"). Run once after
 * deploying the OrganizationEntitlement schema migration, in any
 * environment that has pre-existing Organizations: creates a Trial
 * entitlement (2,000-document limit, seeded from each organization's real
 * current Active-document count) for every Organization that doesn't
 * already have one. Safe to run more than once — only ever touches
 * organizations still missing an entitlement.
 *
 * Usage: pnpm backfill:entitlements
 */
async function main(): Promise<void> {
  const results = await backfillOrganizationEntitlements();

  if (results.length === 0) {
    console.log('No organizations needed backfilling — every organization already has an entitlement.');
    return;
  }

  console.log(`Backfilled ${results.length} organization(s):`);
  for (const result of results) {
    console.log(
      `  ${result.organizationName} (${result.organizationId}): Trial, ${result.currentDocumentCount}/${result.documentLimit} documents`,
    );
  }
}

main()
  .catch((error) => {
    console.error('Entitlement backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
