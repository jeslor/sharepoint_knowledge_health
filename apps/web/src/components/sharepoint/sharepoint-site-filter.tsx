import { Button } from '@/components/ui/button';

export type SharePointSiteFilterValue = 'all' | 'approved' | 'pending';

const OPTIONS: { value: SharePointSiteFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
];

interface SharePointSiteFilterProps {
  value: SharePointSiteFilterValue;
  onChange: (value: SharePointSiteFilterValue) => void;
}

export function SharePointSiteFilter({ value, onChange }: SharePointSiteFilterProps): JSX.Element {
  return (
    <div role="group" aria-label="Filter sites" className="flex gap-2">
      {OPTIONS.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
