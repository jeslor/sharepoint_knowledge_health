import { render, screen } from '@testing-library/react';
import { VerificationGuidance } from '../verification-guidance';

describe('VerificationGuidance', () => {
  it('renders the shared verification explanation', () => {
    render(<VerificationGuidance />);
    expect(
      screen.getByText('Knowledge Health will confirm this automatically on the next scan. The issue may stay open until then.'),
    ).toBeInTheDocument();
  });

  it('renders exactly one copy of the guidance (not duplicated) when mounted once', () => {
    render(<VerificationGuidance />);
    expect(screen.getAllByText(/will confirm this automatically on the next scan/i)).toHaveLength(1);
  });
});
