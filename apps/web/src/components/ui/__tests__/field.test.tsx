import { render, screen } from '@testing-library/react';
import { Field } from '../field';
import { Input } from '../input';

describe('Field', () => {
  it('associates the label with its control so getByLabelText finds it', () => {
    render(
      <Field label="Name">
        <Input value="" onChange={() => {}} />
      </Field>,
    );
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});
