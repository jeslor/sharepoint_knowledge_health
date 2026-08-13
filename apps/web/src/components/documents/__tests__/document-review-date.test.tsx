import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentReviewDate } from '../document-review-date';

describe('DocumentReviewDate', () => {
  it('shows the current review date when set', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt="2026-12-01T00:00:00.000Z"
        reviewDateSource="Manual"
        reviewDateColumnDisplayName={null}
        canManage={false}
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(screen.getByText(/next review due/i)).toBeInTheDocument();
  });

  it('shows "no review date scheduled" when unset', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage={false}
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(screen.getByText('No review date scheduled.')).toBeInTheDocument();
  });

  it('hides the date input and save controls when canManage is false (ADR-0021 §3.6 — self-service never extends here)', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage={false}
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(screen.queryByLabelText(/scheduled review date/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('shows the explanatory permission message instead when canManage is false — closes the self-service dead end', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage={false}
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(
      screen.getByText('Setting the review date requires Admin or Governance Manager permissions. Please contact your administrator.'),
    ).toBeInTheDocument();
  });

  it('does not show the explanatory permission message when canManage is true', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(screen.queryByText(/requires admin or governance manager permissions/i)).not.toBeInTheDocument();
  });

  it('keeps the read-only current-value summary visible even when canManage is false', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt="2026-12-01T00:00:00.000Z"
        reviewDateSource="Manual"
        reviewDateColumnDisplayName={null}
        canManage={false}
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(screen.getByText(/next review due/i)).toBeInTheDocument();
  });

  it('calls onSave with an ISO date string through the existing PATCH review endpoint wrapper', () => {
    const onSave = jest.fn();
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage
        onSave={onSave}
        saving={false}
        saveError={undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText(/scheduled review date/i), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledWith(new Date('2026-12-01').toISOString());
  });

  it('calls onSave with null when Clear is clicked', () => {
    const onSave = jest.fn();
    render(
      <DocumentReviewDate
        nextReviewDueAt="2026-12-01T00:00:00.000Z"
        reviewDateSource="Manual"
        reviewDateColumnDisplayName={null}
        canManage
        onSave={onSave}
        saving={false}
        saveError={undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('does not render a Clear button when there is no review date to clear', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('shows a saving state and disables Save', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage
        onSave={jest.fn()}
        saving
        saveError={undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  it('never claims immediate resolution — copy explains the next scan must verify the fix', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage
        onSave={jest.fn()}
        saving={false}
        saveError={undefined}
      />,
    );
    expect(screen.getByText(/does not immediately resolve the governance issue/i)).toBeInTheDocument();
  });

  it('renders an error state when saving fails', () => {
    render(
      <DocumentReviewDate
        nextReviewDueAt={null}
        reviewDateSource={null}
        reviewDateColumnDisplayName={null}
        canManage
        onSave={jest.fn()}
        saving={false}
        saveError={new Error('Network error')}
      />,
    );
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  describe('Manual vs SharePoint source indicator (Phase 2)', () => {
    it('shows "Source: SharePoint · {column}" when the date came from a confirmed SharePoint mapping', () => {
      render(
        <DocumentReviewDate
          nextReviewDueAt="2026-09-30T00:00:00.000Z"
          reviewDateSource="GraphMetadata"
          reviewDateColumnDisplayName="Review Date"
          canManage={false}
          onSave={jest.fn()}
          saving={false}
          saveError={undefined}
        />,
      );
      expect(screen.getByText('Source: SharePoint · Review Date')).toBeInTheDocument();
    });

    it('falls back to plain "Source: SharePoint" when the column name cannot be resolved', () => {
      render(
        <DocumentReviewDate
          nextReviewDueAt="2026-09-30T00:00:00.000Z"
          reviewDateSource="GraphMetadata"
          reviewDateColumnDisplayName={null}
          canManage={false}
          onSave={jest.fn()}
          saving={false}
          saveError={undefined}
        />,
      );
      expect(screen.getByText('Source: SharePoint')).toBeInTheDocument();
    });

    it('shows "Source: Manually managed" for a Manual date', () => {
      render(
        <DocumentReviewDate
          nextReviewDueAt="2026-09-30T00:00:00.000Z"
          reviewDateSource="Manual"
          reviewDateColumnDisplayName={null}
          canManage={false}
          onSave={jest.fn()}
          saving={false}
          saveError={undefined}
        />,
      );
      expect(screen.getByText('Source: Manually managed')).toBeInTheDocument();
    });

    it('shows "Source: Manually managed" when no review date has ever been set (source is null)', () => {
      render(
        <DocumentReviewDate
          nextReviewDueAt={null}
          reviewDateSource={null}
          reviewDateColumnDisplayName={null}
          canManage={false}
          onSave={jest.fn()}
          saving={false}
          saveError={undefined}
        />,
      );
      expect(screen.getByText('Source: Manually managed')).toBeInTheDocument();
    });

    it('never renders the raw "GraphMetadata" enum value', () => {
      render(
        <DocumentReviewDate
          nextReviewDueAt="2026-09-30T00:00:00.000Z"
          reviewDateSource="GraphMetadata"
          reviewDateColumnDisplayName="Review Date"
          canManage={false}
          onSave={jest.fn()}
          saving={false}
          saveError={undefined}
        />,
      );
      expect(screen.queryByText(/GraphMetadata/)).not.toBeInTheDocument();
    });
  });
});
