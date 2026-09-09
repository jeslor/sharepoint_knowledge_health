import type { DocumentTaxonomyCoverage as DocumentTaxonomyCoverageData } from '@sph/types';
import { Badge, type BadgeTone } from '@/components/ui/badge';

// ADR-0025: presents the three distinct taxonomy states so a neutral 100
// for an unconfigured library is never shown as measured coverage. Tone for
// a measured score mirrors the health-score bands (>=70 success, 40-69
// warning, <40 critical).
function measuredTone(score: number): BadgeTone {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'critical';
}

export function DocumentTaxonomyCoverage({ coverage }: { coverage: DocumentTaxonomyCoverageData }): JSX.Element {
  if (coverage.state === 'notYetScored') {
    return (
      <div>
        <Badge tone="neutral">Not yet scored</Badge>
        <p className="mt-1 text-xs text-slate-500">Classification coverage has not been evaluated for this document yet.</p>
      </div>
    );
  }

  if (coverage.state === 'notConfigured') {
    return (
      <div>
        <Badge tone="neutral">Not configured</Badge>
        <p className="mt-1 text-xs text-slate-500">
          No classification fields are configured for this document&apos;s library, so taxonomy coverage is not measured.
        </p>
      </div>
    );
  }

  const score = coverage.score ?? 0;
  return (
    <div>
      <Badge tone={measuredTone(score)}>Classification coverage: {score}%</Badge>
      <p className="mt-1 text-xs text-slate-500">
        Measured against {coverage.configuredFieldCount} designated classification field
        {coverage.configuredFieldCount === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
