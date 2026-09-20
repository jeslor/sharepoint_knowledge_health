import { render, screen, fireEvent } from '@testing-library/react';
import DocumentHealthGuidePage from '../page';

// jsdom doesn't implement scrollIntoView — GuideNav's jump-to-section
// handler calls it directly on the target element.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe('DocumentHealthGuidePage', () => {
  it('renders every real scoring criterion with its actual weight', () => {
    render(<DocumentHealthGuidePage />);

    expect(screen.getByRole('heading', { name: 'Freshness' })).toBeInTheDocument();
    expect(screen.getByText('25% of score')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ownership' })).toBeInTheDocument();
    expect(screen.getByText('20% of score')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review Status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Duplication' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Age' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Taxonomy' })).toBeInTheDocument();
  });

  it('renders the real health bands with their actual thresholds', () => {
    render(<DocumentHealthGuidePage />);

    expect(screen.getByText(/Healthy — 90 to 100/)).toBeInTheDocument();
    expect(screen.getByText(/Needs Attention — 70 to 89/)).toBeInTheDocument();
    expect(screen.getByText(/Requires Review — below 70/)).toBeInTheDocument();
  });

  it('renders all guide sections in the section nav and supports jump navigation', () => {
    render(<DocumentHealthGuidePage />);

    const nav = screen.getByRole('navigation', { name: 'Guide sections' });
    expect(nav).toBeInTheDocument();
    const jumpButton = screen.getAllByRole('button', { name: 'Fixing issues' })[0]!;

    fireEvent.click(jumpButton);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('links every "next step" action to a real in-app route', () => {
    render(<DocumentHealthGuidePage />);

    expect(screen.getByRole('link', { name: /discover sharepoint sites/i })).toHaveAttribute('href', '/dashboard/sharepoint');
    expect(screen.getByRole('link', { name: /^start a scan$/i })).toHaveAttribute('href', '/dashboard/scans');
    expect(screen.getByRole('link', { name: /view unhealthy documents/i })).toHaveAttribute('href', '/dashboard/documents');
  });
});
