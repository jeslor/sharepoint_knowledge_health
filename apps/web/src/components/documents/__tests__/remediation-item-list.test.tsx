import { render, screen, within } from '@testing-library/react';
import type { RemediationItemResult } from '@sph/types';
import { RemediationItemList } from '../remediation-item-list';

function item(overrides: Partial<RemediationItemResult> = {}): RemediationItemResult {
  return {
    documentId: 'doc-1',
    documentName: null,
    status: 'Succeeded',
    errorType: null,
    errorMessage: null,
    attemptCount: 1,
    ...overrides,
  };
}

describe('RemediationItemList (P0-7)', () => {
  it('renders the empty state when there are no items', () => {
    render(<RemediationItemList items={[]} />);
    expect(screen.getByText('No items in this job.')).toBeInTheDocument();
  });

  it.each(['Pending', 'Succeeded', 'Failed', 'Skipped'])('renders the real %s status value as a badge', (status) => {
    render(<RemediationItemList items={[item({ status: status as RemediationItemResult['status'] })]} />);
    const [row] = screen.getAllByRole('row').slice(1);
    expect(row).toBeDefined();
    expect(row && within(row).getByText(status)).toBeInTheDocument();
  });

  it('links each row to the document detail page using its documentId', () => {
    render(<RemediationItemList items={[item({ documentId: 'doc-42' })]} />);

    expect(screen.getByRole('link', { name: 'doc-42' })).toHaveAttribute('href', '/dashboard/documents/doc-42');
  });

  it('shows the document name as the row label when available, falling back to the id when not', () => {
    render(
      <RemediationItemList
        items={[item({ documentId: 'doc-42', documentName: 'Expense Policy FINAL.docx' }), item({ documentId: 'doc-99', documentName: null })]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Expense Policy FINAL.docx' })).toHaveAttribute('href', '/dashboard/documents/doc-42');
    expect(screen.getByRole('link', { name: 'doc-99' })).toHaveAttribute('href', '/dashboard/documents/doc-99');
  });

  it('shows an em dash for the error column when there is no error', () => {
    render(<RemediationItemList items={[item({ status: 'Succeeded', errorType: null, errorMessage: null })]} />);

    const [row] = screen.getAllByRole('row').slice(1);
    expect(row).toBeDefined();
    expect(row && within(row).getByText('—')).toBeInTheDocument();
  });

  it('shows the errorType and errorMessage for a Failed item', () => {
    render(
      <RemediationItemList
        items={[item({ status: 'Failed', errorType: 'GraphNotFoundError', errorMessage: 'The item was not found' })]}
      />,
    );

    expect(screen.getByText(/GraphNotFoundError/)).toBeInTheDocument();
    expect(screen.getByText(/The item was not found/)).toBeInTheDocument();
  });

  it('shows the errorType for a Skipped item (e.g. EnqueueFailed, DocumentNotFound)', () => {
    render(<RemediationItemList items={[item({ status: 'Skipped', errorType: 'DocumentNotFound', errorMessage: 'Document doc-1 no longer exists' })]} />);

    expect(screen.getByText(/DocumentNotFound/)).toBeInTheDocument();
  });

  it('shows the attempt count', () => {
    render(<RemediationItemList items={[item({ attemptCount: 3 })]} />);

    const [row] = screen.getAllByRole('row').slice(1);
    expect(row).toBeDefined();
    expect(row && within(row).getByText('3')).toBeInTheDocument();
  });
});
