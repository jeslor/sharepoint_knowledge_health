import { GOVERNANCE_ISSUE_TYPE_LABELS, type GovernanceIssueStatusValue, type GovernanceIssueTypeValue, type IssueSeverityFilter } from '@sph/types';
import { CommandBar } from '@/components/ui/command-bar';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

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
    <CommandBar>
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
          options={[{ value: '', label: 'All' }, ...ISSUE_TYPES.map((type) => ({ value: type, label: GOVERNANCE_ISSUE_TYPE_LABELS[type] }))]}
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
