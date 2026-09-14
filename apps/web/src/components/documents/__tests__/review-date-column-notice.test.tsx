import { render, screen } from '@testing-library/react';
import { ReviewDateColumnNotice } from '../review-date-column-notice';

describe('ReviewDateColumnNotice', () => {
  it('renders nothing when the library is configured (sharePointManaged = true)', () => {
    const { container } = render(<ReviewDateColumnNotice siteId="site-1" sharePointManaged />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the "Review date column not configured" signpost when the library is not configured', () => {
    render(<ReviewDateColumnNotice siteId="site-1" sharePointManaged={false} />);
    expect(screen.getByText('Review date column not configured')).toBeInTheDocument();
    expect(screen.getByText(/needs a date column before Review Status remediation can update review dates/i)).toBeInTheDocument();
  });

  it("links directly to the site's Review Dates configuration page", () => {
    render(<ReviewDateColumnNotice siteId="site-42" sharePointManaged={false} />);
    expect(screen.getByRole('link', { name: /configure review dates/i })).toHaveAttribute(
      'href',
      '/dashboard/sharepoint/site-42/review-dates',
    );
  });

  it('reuses the existing setup guidance/steps and does not force the literal name "Review Date"', () => {
    render(<ReviewDateColumnNotice siteId="site-1" sharePointManaged={false} />);
    // A step from the shared NO_ELIGIBLE_COLUMN_STEPS — proves reuse, not a second instruction set.
    expect(screen.getByText(/choose "Date and Time" as the column type/i)).toBeInTheDocument();
    // The name is presented as an example/recommendation, never a hard requirement.
    expect(screen.getByText(/for example "Review Date", "Review Due Date", or "Next Review Date"/i)).toBeInTheDocument();
  });
});
