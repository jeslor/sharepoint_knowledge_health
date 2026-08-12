import { render, screen } from '@testing-library/react';
import { IssueRemediation } from '../issue-remediation';

describe('IssueRemediation', () => {
  it('renders Ownership guidance and links to the document ownership control', () => {
    render(<IssueRemediation documentId="doc-1" issueType="Ownership" documentWebUrl={null} />);

    expect(screen.getByText(/does not have an identifiable owner/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /go to ownership/i });
    expect(link).toHaveAttribute('href', '/dashboard/documents/doc-1#ownership');
  });

  it('renders ReviewStatus guidance and links to the review-date control', () => {
    render(<IssueRemediation documentId="doc-1" issueType="ReviewStatus" documentWebUrl={null} />);

    expect(screen.getByText(/no scheduled review date/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /set review date/i });
    expect(link).toHaveAttribute('href', '/dashboard/documents/doc-1#review-date');
  });

  it.each(['Freshness', 'Age', 'Duplication', 'Metadata'] as const)(
    'renders %s guidance and an Open in SharePoint link when documentWebUrl is set',
    (issueType) => {
      render(<IssueRemediation documentId="doc-1" issueType={issueType} documentWebUrl="https://contoso.sharepoint.com/sites/finance/Handbook.docx" />);

      const link = screen.getByRole('link', { name: /open in sharepoint/i });
      expect(link).toHaveAttribute('href', 'https://contoso.sharepoint.com/sites/finance/Handbook.docx');
      expect(link).toHaveAttribute('target', '_blank');
    },
  );

  it('does not render a broken SharePoint link when documentWebUrl is null — shows an unavailable message instead', () => {
    render(<IssueRemediation documentId="doc-1" issueType="Freshness" documentWebUrl={null} />);

    expect(screen.queryByRole('link', { name: /open in sharepoint/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sharepoint link is not available yet/i)).toBeInTheDocument();
  });

  it('never invents a SharePoint URL from path/site names for external issue types', () => {
    render(<IssueRemediation documentId="doc-1" issueType="Duplication" documentWebUrl={null} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
