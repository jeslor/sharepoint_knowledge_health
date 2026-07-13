import type { GovernanceIssueStatusValue, GovernanceIssueTypeValue, IssueSeverityFilter } from '@sph/types';

export interface GovernanceIssueFilterValues {
  status?: GovernanceIssueStatusValue;
  severity?: IssueSeverityFilter;
  issueType?: GovernanceIssueTypeValue;
  assignedUserId?: string;
}

const ISSUE_TYPES: GovernanceIssueTypeValue[] = ['Freshness', 'Ownership', 'ReviewStatus', 'Metadata', 'Duplication', 'Age'];

interface GovernanceIssueFiltersProps {
  values: GovernanceIssueFilterValues;
  assignableUsers: { id: string; displayName: string }[];
  onChange: (values: GovernanceIssueFilterValues) => void;
}

export function GovernanceIssueFilters({ values, assignableUsers, onChange }: GovernanceIssueFiltersProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-4">
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
