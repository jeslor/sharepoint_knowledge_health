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
    <div role="group" aria-label="Filter sites" className="flex gap-2 text-sm">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={
            value === option.value
              ? 'rounded-md bg-slate-900 px-3 py-1 font-medium text-white'
              : 'rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-50'
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
