import { render, screen, fireEvent } from '@testing-library/react';
import type { ReviewDateEligibilityColumn } from '@sph/types';
import { ReviewDateCandidateSelector } from '../review-date-candidate-selector';

const candidates: ReviewDateEligibilityColumn[] = [
  { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' },
  { id: 'col-2', name: 'ExpiryDate', displayName: 'Expiry Date', confidence: 'medium' },
];

const ambiguousCandidates: ReviewDateEligibilityColumn[] = [
  { id: 'col-3', name: 'DocumentReview', displayName: 'Document Review', confidence: 'ambiguous' },
];

describe('ReviewDateCandidateSelector', () => {
  it('renders one radio option per candidate, none pre-selected', () => {
    render(<ReviewDateCandidateSelector candidates={candidates} selectedId={null} onSelect={jest.fn()} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).not.toBeChecked();
  });

  it('shows the display name, confidence, and internal name for each candidate', () => {
    render(<ReviewDateCandidateSelector candidates={candidates} selectedId={null} onSelect={jest.fn()} />);

    expect(screen.getByText('Review Date')).toBeInTheDocument();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('Internal name: ReviewDate')).toBeInTheDocument();
    expect(screen.getByText('Expiry Date')).toBeInTheDocument();
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
  });

  it('calls onSelect with the candidate id when a radio is chosen', () => {
    const onSelect = jest.fn();
    render(<ReviewDateCandidateSelector candidates={candidates} selectedId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Expiry Date'));

    expect(onSelect).toHaveBeenCalledWith('col-2');
  });

  it('reflects the currently selected candidate as checked', () => {
    render(<ReviewDateCandidateSelector candidates={candidates} selectedId="col-1" onSelect={jest.fn()} />);

    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it('has an accessible legend stating an explicit selection is required', () => {
    render(<ReviewDateCandidateSelector candidates={candidates} selectedId={null} onSelect={jest.fn()} />);

    expect(screen.getByText('Select the SharePoint column to use')).toBeInTheDocument();
  });

  it('shows an ambiguous candidate distinctly, not folded into "Low confidence" — still requires the same explicit selection', () => {
    render(<ReviewDateCandidateSelector candidates={ambiguousCandidates} selectedId={null} onSelect={jest.fn()} />);

    expect(screen.getByText('Uncertain — please verify')).toBeInTheDocument();
    expect(screen.queryByText('Low confidence')).not.toBeInTheDocument();
    expect(screen.getByRole('radio')).not.toBeChecked();
  });
});
