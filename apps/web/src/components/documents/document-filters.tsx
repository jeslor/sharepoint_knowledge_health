import type { SharePointSiteOption } from '@/lib/api/endpoints';

export interface DocumentFilterValues {
  severity?: string;
  siteId?: string;
  minScore?: number;
  maxScore?: number;
}

interface DocumentFiltersProps {
  values: DocumentFilterValues;
  sites: SharePointSiteOption[];
  onChange: (values: DocumentFilterValues) => void;
}

export function DocumentFilters({ values, sites, onChange }: DocumentFiltersProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col text-sm text-slate-600">
        Severity
        <select
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={values.severity ?? ''}
          onChange={(event) => onChange({ ...values, severity: event.target.value || undefined })}
        >
          <option value="">All</option>
          <option value="RequiresReview">Critical</option>
          <option value="NeedsAttention">Warning</option>
        </select>
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        Site
        <select
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={values.siteId ?? ''}
          onChange={(event) => onChange({ ...values, siteId: event.target.value || undefined })}
        >
          <option value="">All sites</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.displayName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        Min score
        <input
          type="number"
          min={0}
          max={100}
          className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1"
          value={values.minScore ?? ''}
          onChange={(event) => onChange({ ...values, minScore: event.target.value ? Number(event.target.value) : undefined })}
        />
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        Max score
        <input
          type="number"
          min={0}
          max={100}
          className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1"
          value={values.maxScore ?? ''}
          onChange={(event) => onChange({ ...values, maxScore: event.target.value ? Number(event.target.value) : undefined })}
        />
      </label>
    </div>
  );
}
