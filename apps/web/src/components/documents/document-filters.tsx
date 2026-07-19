import type { SharePointSiteOption } from '@/lib/api/endpoints';
import { CommandBar } from '@/components/ui/command-bar';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

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
    <CommandBar>
      <Field label="Severity">
        <Select
          value={values.severity ?? ''}
          onChange={(newValue) => onChange({ ...values, severity: newValue || undefined })}
          options={[
            { value: '', label: 'All' },
            { value: 'RequiresReview', label: 'Critical' },
            { value: 'NeedsAttention', label: 'Warning' },
          ]}
        />
      </Field>

      <Field label="Site">
        <Select
          value={values.siteId ?? ''}
          onChange={(newValue) => onChange({ ...values, siteId: newValue || undefined })}
          options={[{ value: '', label: 'All sites' }, ...sites.map((site) => ({ value: site.id, label: site.displayName }))]}
        />
      </Field>

      <Field label="Min score">
        <Input
          type="number"
          min={0}
          max={100}
          className="w-24"
          value={values.minScore ?? ''}
          onChange={(event) => onChange({ ...values, minScore: event.target.value ? Number(event.target.value) : undefined })}
        />
      </Field>

      <Field label="Max score">
        <Input
          type="number"
          min={0}
          max={100}
          className="w-24"
          value={values.maxScore ?? ''}
          onChange={(event) => onChange({ ...values, maxScore: event.target.value ? Number(event.target.value) : undefined })}
        />
      </Field>
    </CommandBar>
  );
}
