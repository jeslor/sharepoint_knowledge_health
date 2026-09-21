import { render, screen, fireEvent } from '@testing-library/react';
import { Accordion } from '../accordion';

const ITEMS = [
  { id: 'a', question: 'What does this measure?', answer: 'Answer A' },
  { id: 'b', question: 'Why does this matter?', answer: 'Answer B' },
];

describe('Accordion', () => {
  it('renders every question, collapsed by default', () => {
    render(<Accordion items={ITEMS} />);

    expect(screen.getByRole('button', { name: 'What does this measure?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Why does this matter?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Answer A')).not.toBeInTheDocument();
  });

  it('expands an item on click and reveals its answer', () => {
    render(<Accordion items={ITEMS} />);

    fireEvent.click(screen.getByRole('button', { name: 'What does this measure?' }));

    expect(screen.getByRole('button', { name: 'What does this measure?' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Answer A')).toBeInTheDocument();
  });

  it('collapses an item on a second click', () => {
    render(<Accordion items={ITEMS} />);
    const button = screen.getByRole('button', { name: 'What does this measure?' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Answer A')).not.toBeInTheDocument();
  });

  it('allows multiple items open independently', () => {
    render(<Accordion items={ITEMS} />);

    fireEvent.click(screen.getByRole('button', { name: 'What does this measure?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Why does this matter?' }));

    expect(screen.getByText('Answer A')).toBeInTheDocument();
    expect(screen.getByText('Answer B')).toBeInTheDocument();
  });

  it('honors defaultOpenIds', () => {
    render(<Accordion items={ITEMS} defaultOpenIds={['b']} />);

    expect(screen.getByRole('button', { name: 'Why does this matter?' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'What does this measure?' })).toHaveAttribute('aria-expanded', 'false');
  });
});
