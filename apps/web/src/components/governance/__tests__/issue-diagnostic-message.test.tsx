import { render, screen } from '@testing-library/react';
import { IssueDiagnosticMessage } from '../issue-diagnostic-message';

describe('IssueDiagnosticMessage', () => {
  it('renders the diagnostic message prominently under "Problem" when present', () => {
    render(<IssueDiagnosticMessage message="Document has not been modified in 480 days." />);

    expect(screen.getByText('Problem')).toBeInTheDocument();
    expect(screen.getByText('Document has not been modified in 480 days.')).toBeInTheDocument();
  });

  it('renders nothing when message is null (legacy pre-migration issue)', () => {
    const { container } = render(<IssueDiagnosticMessage message={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
