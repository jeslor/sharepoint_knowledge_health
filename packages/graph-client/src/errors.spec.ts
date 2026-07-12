import {
  mapGraphError,
  GraphAuthenticationError,
  GraphPermissionError,
  GraphNotFoundError,
  GraphThrottledError,
  GraphTransientError,
  GraphUnexpectedError,
} from './errors';

describe('mapGraphError', () => {
  it.each([
    [401, GraphAuthenticationError],
    [403, GraphPermissionError],
    [404, GraphNotFoundError],
    [429, GraphThrottledError],
    [503, GraphThrottledError],
    [504, GraphTransientError],
    [500, GraphTransientError],
  ])('maps HTTP status %d to the correct error class', (statusCode, ErrorClass) => {
    const result = mapGraphError({ statusCode, code: 'SomeCode', message: 'Something failed' });
    expect(result).toBeInstanceOf(ErrorClass);
    expect(result.graphErrorCode).toBe('SomeCode');
  });

  it('maps an unrecognized error shape to GraphUnexpectedError', () => {
    const result = mapGraphError(new Error('plain error'));
    expect(result).toBeInstanceOf(GraphUnexpectedError);
  });

  it('passes an already-mapped GraphClientError through unchanged', () => {
    const original = new GraphNotFoundError('not found');
    expect(mapGraphError(original)).toBe(original);
  });

  it('carries the correlationId through into the mapped error', () => {
    const result = mapGraphError({ statusCode: 404 }, 'scan-123');
    expect(result.correlationId).toBe('scan-123');
  });
});
