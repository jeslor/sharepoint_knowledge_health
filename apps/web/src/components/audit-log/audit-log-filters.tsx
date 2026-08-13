import type { AuditLogAction, AuditLogTargetType } from '@sph/types';
import { CommandBar } from '@/components/ui/command-bar';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export interface AuditLogFilterValues {
  action?: string;
  targetType?: string;
  since?: string;
  until?: string;
}

// The exact 8/5 closed sets AuditLogAction/AuditLogTargetType currently
// enumerate (packages/types/src/api/audit-log.ts) — action/targetType are
// plain string columns server-side (a closed set in practice, not in the
// type system, per that file's own comment), so this list is a frontend
// convenience for the dropdown, not a validation boundary; an entry
// outside this list would still just be sent through as a filter value.
const ACTIONS: AuditLogAction[] = [
  'user.approved',
  'user.rejected',
  'sharepoint_site.approved',
  'sharepoint_site.revoked',
  'scan.triggered',
  'scan_schedule.created',
  'scan_schedule.updated',
  'microsoft_tenant.connected',
];

const TARGET_TYPES: AuditLogTargetType[] = ['User', 'SharePointSite', 'ScanJob', 'ScanSchedule', 'MicrosoftTenant'];

interface AuditLogFiltersProps {
  values: AuditLogFilterValues;
  onChange: (values: AuditLogFilterValues) => void;
}

// Structured filters only (action, targetType, date range) — matches what
// the backend already supports (AuditLogListQuery). No free-text search:
// it doesn't exist server-side, and client-side filtering would silently
// only search the current page, not the whole history — misleading rather
// than useful at this data volume.
export function AuditLogFilters({ values, onChange }: AuditLogFiltersProps): JSX.Element {
  return (
    <CommandBar>
      <Field label="Action">
        <Select
          value={values.action ?? ''}
          onChange={(newValue) => onChange({ ...values, action: newValue || undefined })}
          options={[{ value: '', label: 'All' }, ...ACTIONS.map((action) => ({ value: action, label: action }))]}
        />
      </Field>

      <Field label="Target type">
        <Select
          value={values.targetType ?? ''}
          onChange={(newValue) => onChange({ ...values, targetType: newValue || undefined })}
          options={[{ value: '', label: 'All' }, ...TARGET_TYPES.map((type) => ({ value: type, label: type }))]}
        />
      </Field>

      <Field label="Since">
        <Input
          type="date"
          value={values.since ?? ''}
          onChange={(event) => onChange({ ...values, since: event.target.value || undefined })}
        />
      </Field>

      <Field label="Until">
        <Input
          type="date"
          value={values.until ?? ''}
          onChange={(event) => onChange({ ...values, until: event.target.value || undefined })}
        />
      </Field>
    </CommandBar>
  );
}
