import { render, screen } from '@testing-library/react';
import { ShieldRegular } from '@fluentui/react-icons';
import { Card, CardHeader } from '../card';

describe('Card', () => {
  it('renders children inside a soft-bordered, softly-elevated surface (10A.6: Layer 1 gets a soft shadow, not just a border)', () => {
    render(<Card>Content</Card>);
    const card = screen.getByText('Content');
    expect(card.className).toContain('rounded-xl');
    expect(card.className).toContain('border-slate-200/60');
    expect(card.className).toContain('shadow-card');
  });

  it('never uses Layer 2-strength shadow utilities (shadow-md/shadow-lg reserved for Menu/Callout/Dialog/Toast)', () => {
    render(<Card>Content</Card>);
    const card = screen.getByText('Content');
    expect(card.className).not.toContain('shadow-md');
    expect(card.className).not.toContain('shadow-lg');
  });

  it('merges an additional className', () => {
    render(<Card className="space-y-4">Content</Card>);
    expect(screen.getByText('Content').className).toContain('space-y-4');
  });

  it('has no hover treatment by default (static content, Layer 1)', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content').className).not.toContain('cursor-pointer');
  });

  it('gains a subtle lift (shadow intensifies + slight translate), never Layer-2-strength, when interactive', () => {
    render(<Card interactive>Content</Card>);
    const card = screen.getByText('Content');
    expect(card.className).toContain('cursor-pointer');
    expect(card.className).toContain('hover:shadow-card-hover');
    expect(card.className).toContain('hover:-translate-y-px');
    expect(card.className).not.toContain('shadow-md');
  });
});

describe('CardHeader', () => {
  it('renders the title and an optional recognition icon', () => {
    render(<CardHeader title="Governance" icon={ShieldRegular} />);
    expect(screen.getByText('Governance')).toBeInTheDocument();
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('renders an optional trailing action', () => {
    render(<CardHeader title="Governance" action={<button type="button">More</button>} />);
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });
});
