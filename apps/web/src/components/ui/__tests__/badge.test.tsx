import { render, screen } from '@testing-library/react';
import { CheckmarkCircleFilled } from '@fluentui/react-icons';
import { Badge } from '../badge';

describe('Badge', () => {
  it('defaults to the neutral tone', () => {
    render(<Badge>Open</Badge>);
    expect(screen.getByText('Open').className).toContain('bg-slate-100');
  });

  it.each([
    ['info', 'bg-blue-100'],
    ['success', 'bg-green-100'],
    ['warning', 'bg-amber-100'],
    ['critical', 'bg-red-100'],
  ] as const)('applies the %s tone', (tone, expectedClass) => {
    render(<Badge tone={tone}>Label</Badge>);
    expect(screen.getByText('Label').className).toContain(expectedClass);
  });

  it('lets a caller override with an exact className, taking precedence over tone', () => {
    render(
      <Badge tone="critical" className="bg-slate-100 text-slate-500">
        Cancelled
      </Badge>,
    );
    const badge = screen.getByText('Cancelled');
    expect(badge.className).toContain('text-slate-500');
    expect(badge.className).not.toContain('bg-red-100');
  });

  it('renders an optional leading status icon', () => {
    render(
      <Badge tone="success" icon={CheckmarkCircleFilled}>
        Healthy
      </Badge>,
    );
    expect(screen.getByText('Healthy').querySelector('svg')).toBeInTheDocument();
  });

  it('renders no icon by default', () => {
    render(<Badge tone="success">Healthy</Badge>);
    expect(screen.getByText('Healthy').querySelector('svg')).not.toBeInTheDocument();
  });
});
