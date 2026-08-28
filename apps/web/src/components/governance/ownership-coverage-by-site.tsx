import type { OwnershipCoverageBySite } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';

// ADR-0024 §3.2/§4: same table styling as RemediationJobList/ScanList —
// one row per site, every site with at least one Active document
// (Invariant 4 — never filtered to Approved sites only, see the ADR's own
// correction of that mistake before implementation).
export function OwnershipCoverageBySiteTable({ sites }: { sites: OwnershipCoverageBySite[] }): JSX.Element {
  if (sites.length === 0) {
    return <EmptyState label="No sites with active documents yet." />;
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200/60 text-slate-500">
          <th className="py-2.5 pr-4 font-medium">Site</th>
          <th className="py-2.5 pr-4 font-medium">Total</th>
          <th className="py-2.5 pr-4 font-medium">Covered</th>
          <th className="py-2.5 pr-4 font-medium">No identifiable owner</th>
          <th className="py-2.5 pr-4 font-medium">All owners deactivated</th>
          <th className="py-2.5 pr-4 font-medium">Not yet scored</th>
          <th className="py-2.5 pr-4 font-medium">Coverage</th>
        </tr>
      </thead>
      <tbody>
        {sites.map((site) => (
          <tr key={site.siteId} className="transition-colors duration-150 ease-premium hover:bg-slate-50">
            <td className="py-3 pr-4 text-slate-900">{site.siteName}</td>
            <td className="py-3 pr-4 text-slate-600">{site.totalDocuments}</td>
            <td className="py-3 pr-4 text-slate-600">{site.covered}</td>
            <td className="py-3 pr-4 text-slate-600">{site.noIdentifiableOwner}</td>
            <td className="py-3 pr-4 text-slate-600">{site.allOwnersInactive}</td>
            <td className="py-3 pr-4 text-slate-600">{site.notYetScored}</td>
            <td className="py-3 pr-4 text-slate-600">
              {site.coveragePercentage === null ? 'Not yet scored' : `${site.coveragePercentage}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
