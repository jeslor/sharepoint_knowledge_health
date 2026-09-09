import { render, screen } from '@testing-library/react';
import type { DocumentTaxonomyCoverage as DocumentTaxonomyCoverageData } from '@sph/types';
import { DocumentTaxonomyCoverage } from '../document-taxonomy-coverage';

function renderCoverage(coverage: DocumentTaxonomyCoverageData): void {
  render(<DocumentTaxonomyCoverage coverage={coverage} />);
}

describe('DocumentTaxonomyCoverage', () => {
  it('shows a not-yet-scored state distinct from measured coverage', () => {
    renderCoverage({ state: 'notYetScored', score: null, configuredFieldCount: 2 });
    expect(screen.getByText('Not yet scored')).toBeInTheDocument();
    expect(screen.queryByText(/coverage:/i)).not.toBeInTheDocument();
  });

  it('shows a not-configured state and never presents it as measured coverage', () => {
    renderCoverage({ state: 'notConfigured', score: null, configuredFieldCount: 0 });
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText(/no classification fields are configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/coverage: 100%/i)).not.toBeInTheDocument();
  });

  it('shows the measured coverage percentage when the library has classification fields', () => {
    renderCoverage({ state: 'measured', score: 50, configuredFieldCount: 2 });
    expect(screen.getByText('Classification coverage: 50%')).toBeInTheDocument();
    expect(screen.getByText(/2 designated classification fields/i)).toBeInTheDocument();
  });

  it('renders a genuine measured 100% distinctly from not-configured', () => {
    renderCoverage({ state: 'measured', score: 100, configuredFieldCount: 1 });
    expect(screen.getByText('Classification coverage: 100%')).toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    expect(screen.getByText(/1 designated classification field\.$/i)).toBeInTheDocument();
  });
});
