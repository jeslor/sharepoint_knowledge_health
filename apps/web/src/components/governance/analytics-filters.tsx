import type { GovernanceIssueStatusValue, GovernanceIssueTypeValue, IssueSeverityFilter } from '@sph/types';
import { CommandBar } from '@/components/ui/command-bar';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

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
    <CommandBar>
      <Field label="From">
        <Input
          type="date"
          value={toDateInputValue(values.since)}
          onChange={(event) => onChange({ ...values, since: event.target.value ? new Date(event.target.value).toISOString() : undefined })}
        />
      </Field>

      <Field label="To">
        <Input
          type="date"
          value={toDateInputValue(values.until)}
          onChange={(event) => onChange({ ...values, until: event.target.value ? new Date(event.target.value).toISOString() : undefined })}
        />
      </Field>

      <Field label="Status">
        <Select
          value={values.status ?? ''}
          onChange={(newValue) => onChange({ ...values, status: (newValue || undefined) as GovernanceIssueStatusValue | undefined })}
          options={[
            { value: '', label: 'All' },
            { value: 'Open', label: 'Open' },
            { value: 'InProgress', label: 'In progress' },
            { value: 'Resolved', label: 'Resolved' },
          ]}
        />
      </Field>

      <Field label="Severity">
        <Select
          value={values.severity ?? ''}
          onChange={(newValue) => onChange({ ...values, severity: (newValue || undefined) as IssueSeverityFilter | undefined })}
          options={[
            { value: '', label: 'All' },
            { value: 'RequiresReview', label: 'Critical' },
            { value: 'NeedsAttention', label: 'Warning' },
          ]}
        />
      </Field>

      <Field label="Issue type">
        <Select
          value={values.issueType ?? ''}
          onChange={(newValue) => onChange({ ...values, issueType: (newValue || undefined) as GovernanceIssueTypeValue | undefined })}
          options={[{ value: '', label: 'All' }, ...ISSUE_TYPES.map((type) => ({ value: type, label: type }))]}
        />
      </Field>

      <Field label="Assigned to">
        <Select
          value={values.assignedUserId ?? ''}
          onChange={(newValue) => onChange({ ...values, assignedUserId: newValue || undefined })}
          options={[
            { value: '', label: 'Anyone' },
            ...assignableUsers.map((user) => ({ value: user.id, label: user.displayName })),
          ]}
        />
      </Field>
    </CommandBar>
  );
}
