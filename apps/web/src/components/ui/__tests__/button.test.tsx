import { render, screen } from '@testing-library/react';
import { SignOutRegular } from '@fluentui/react-icons';
import { Button, buttonClassName } from '../button';

describe('Button', () => {
  it('defaults to a primary brand-blue, non-submitting button', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('bg-brand-600');
  });

  it('applies secondary variant styling', () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('border-slate-300');
  });

  it('tints the secondary variant hover state toward brand (not plain gray)', () => {
    render(<Button variant="secondary">Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.className).toContain('hover:border-brand-300');
    expect(button.className).toContain('hover:bg-brand-50');
    expect(button.className).toContain('hover:text-brand-700');
  });

  it('uses rounded-lg, font-medium, and the ease-premium curve for every variant', () => {
    render(<Button variant="primary">Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain('rounded-lg');
    expect(button.className).toContain('font-medium');
    expect(button.className).toContain('ease-premium');
  });

  it('applies ghost variant styling (transparent, hover tint, no visible border)', () => {
    render(<Button variant="ghost">Dismiss</Button>);
    const button = screen.getByRole('button', { name: 'Dismiss' });
    expect(button.className).toContain('hover:bg-slate-100');
    expect(button.className).not.toContain('bg-brand-600');
    // Checks for an actual border utility class (e.g. "border-slate-300"),
    // not the shared `border-color` token inside the base transition list.
    expect(button.className).not.toMatch(/\bborder-slate/);
  });

  it('applies danger variant styling', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('text-red-700');
  });

  it('has a consistent, fixed height per size (not padding-derived) so it aligns with Input/Select', () => {
    render(<Button size="md">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('h-10');
  });

  it('lets a caller override type (e.g. for a form submit button)', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit');
  });

  it('passes through disabled state', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('has a visible focus-visible ring class for keyboard accessibility', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('focus-visible:ring-2');
  });

  it('renders an optional leading icon for the "important action" use case', () => {
    render(<Button icon={SignOutRegular}>Sign out</Button>);
    const button = screen.getByRole('button', { name: 'Sign out' });
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('renders no icon by default', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).querySelector('svg')).not.toBeInTheDocument();
  });

  it('has a pressed-state scale transform for tactile feedback', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('active:scale-[0.98]');
  });

  it('exposes buttonClassName so a non-<button> element (e.g. a Link) can look identical to a real Button', () => {
    const linkClass = buttonClassName('primary', 'md');
    render(<Button variant="primary" size="md" />);
    expect(screen.getByRole('button').className).toBe(linkClass);
  });
});
