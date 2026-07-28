import { render, screen } from '@testing-library/react';
import type { ScanComparisonResponse } from '@sph/types';
import { ScanComparisonCard } from '../scan-comparison-card';

describe('ScanComparisonCard', () => {
  it('renders an empty state when there is no previous scan to compare against', () => {
    const comparison: ScanComparisonResponse = {
      scanId: 'scan-1',
      previousScanId: null,
      scoreChange: null,
      criticalIssuesChange: null,
      warningIssuesChange: null,
      documentCountChange: null,
      newIssues: [],
      resolvedIssues: [],
      removedIssues: [],
    };
    render(<ScanComparisonCard comparison={comparison} />);

    expect(screen.getByText('No previous scan to compare against yet.')).toBeInTheDocument();
  });

  it('shows a green up-arrow for an improving score change and a red up-arrow for worsening critical issues', () => {
    const comparison: ScanComparisonResponse = {
      scanId: 'scan-2',
      previousScanId: 'scan-1',
      scoreChange: 12,
      criticalIssuesChange: 3,
      warningIssuesChange: -2,
      documentCountChange: 10,
      newIssues: [],
      resolvedIssues: [],
      removedIssues: [],
    };
    render(<ScanComparisonCard comparison={comparison} />);

    const scoreChange = screen.getByText('▲ +12');
    expect(scoreChange).toHaveClass('text-green-600');

    const criticalChange = screen.getByText('▲ +3');
    expect(criticalChange).toHaveClass('text-red-600');

    const warningChange = screen.getByText('▼ -2');
    expect(warningChange).toHaveClass('text-green-600');
  });

  it('renders newly introduced, resolved, and removed issues with document names and severities', () => {
    const comparison: ScanComparisonResponse = {
      scanId: 'scan-2',
      previousScanId: 'scan-1',
      scoreChange: 0,
      criticalIssuesChange: 0,
      warningIssuesChange: 0,
      documentCountChange: 0,
      newIssues: [
        { documentId: 'doc-1', documentName: 'Handbook.docx', criterion: 'Freshness', severity: 'RequiresReview', message: 'Stale content' },
      ],
      resolvedIssues: [
        { documentId: 'doc-3', documentName: 'Archive.docx', criterion: 'Duplication', severity: 'RequiresReview', message: 'Duplicate found' },
      ],
      // F4: a document no longer part of the evaluated dataset — distinct
      // from a genuine fix, must render in its own section.
      removedIssues: [
        { documentId: 'doc-4', documentName: 'Old Policy.docx', criterion: 'Ownership', severity: 'NeedsAttention', message: 'Owner missing' },
      ],
    };
    render(<ScanComparisonCard comparison={comparison} />);

    expect(screen.getByText('Newly introduced issues')).toBeInTheDocument();
    expect(screen.getByText('Handbook.docx')).toBeInTheDocument();
    expect(screen.getByText('Stale content')).toBeInTheDocument();

    expect(screen.getByText('Resolved issues')).toBeInTheDocument();
    expect(screen.getByText('Archive.docx')).toBeInTheDocument();
    expect(screen.getByText('Duplicate found')).toBeInTheDocument();

    expect(screen.getByText('Removed documents')).toBeInTheDocument();
    expect(screen.getByText('Old Policy.docx')).toBeInTheDocument();
    expect(screen.getByText('Owner missing')).toBeInTheDocument();
  });

  it('shows empty-list messages when nothing changed since the previous scan', () => {
    const comparison: ScanComparisonResponse = {
      scanId: 'scan-2',
      previousScanId: 'scan-1',
      scoreChange: 0,
      criticalIssuesChange: 0,
      warningIssuesChange: 0,
      documentCountChange: 0,
      newIssues: [],
      resolvedIssues: [],
      removedIssues: [],
    };
    render(<ScanComparisonCard comparison={comparison} />);

    expect(screen.getByText('No new issues since the previous scan.')).toBeInTheDocument();
    expect(screen.getByText('No issues resolved since the previous scan.')).toBeInTheDocument();
    expect(screen.getByText('No documents removed since the previous scan.')).toBeInTheDocument();
  });
});
