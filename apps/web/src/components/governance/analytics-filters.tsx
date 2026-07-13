import type { GovernanceIssueStatusValue, GovernanceIssueTypeValue, IssueSeverityFilter } from '@sph/types';

export interface AnalyticsFilterValues {
  since?: string;
  until?: string;
  status?: GovernanceIssueStatusValue;
  severity?: IssueSeverityFilter;
  issueType?: GovernanceIssueTypeValue;
  assignedUserId?: string;
}

const ISSUE_TYPES: GovernanceIssueTypeValue[] = ['Freshness', 'Ownership', 'ReviewStatus', 'Metadata', 'Duplication', 'Age'];

interface AnalyticsFiltersProps {
  values: AnalyticsFilterValues;
  assignableUsers: { id: string; displayName: string }[];
  onChange: (values: AnalyticsFilterValues) => void;
}

function toDateInputValue(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

export function AnalyticsFilters({ values, assignableUsers, onChange }: AnalyticsFiltersProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col text-sm text-slate-600">
        From
        <input
          type="date"
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={toDateInputValue(values.since)}
          onChange={(event) => onChange({ ...values, since: event.target.value ? new Date(event.target.value).toISOString() : undefined })}
        />
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        To
        <input
          type="date"
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={toDateInputValue(values.until)}
          onChange={(event) => onChange({ ...values, until: event.target.value ? new Date(event.target.value).toISOString() : undefined })}
        />
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        Status
        <select
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={values.status ?? ''}
          onChange={(event) => onChange({ ...values, status: (event.target.value || undefined) as GovernanceIssueStatusValue | undefined })}
        >
          <option value="">All</option>
          <option value="Open">Open</option>
          <option value="InProgress">In progress</option>
          <option value="Resolved">Resolved</option>
        </select>
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        Severity
        <select
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={values.severity ?? ''}
          onChange={(event) => onChange({ ...values, severity: (event.target.value || undefined) as IssueSeverityFilter | undefined })}
        >
          <option value="">All</option>
          <option value="RequiresReview">Critical</option>
          <option value="NeedsAttention">Warning</option>
        </select>
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        Issue type
        <select
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={values.issueType ?? ''}
          onChange={(event) => onChange({ ...values, issueType: (event.target.value || undefined) as GovernanceIssueTypeValue | undefined })}
        >
          <option value="">All</option>
          {ISSUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-sm text-slate-600">
        Assigned to
        <select
          className="mt-1 rounded-md border border-slate-300 px-2 py-1"
          value={values.assignedUserId ?? ''}
          onChange={(event) => onChange({ ...values, assignedUserId: event.target.value || undefined })}
        >
          <option value="">Anyone</option>
          {assignableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
