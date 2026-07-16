import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the inner promise value when it settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('value'), 1000);
    expect(result).toBe('value');
  });

  it('rejects with the inner promise error when it rejects before the timeout', async () => {
    const innerError = new Error('inner failure');
    await expect(withTimeout(Promise.reject(innerError), 1000)).rejects.toBe(innerError);
  });

  it('rejects with a timeout error when the inner promise never settles by ms', async () => {
    jest.useFakeTimers();
    const neverSettles = new Promise(() => {});

    const promise = withTimeout(neverSettles, 1000, 'custom timeout message');
    const assertion = expect(promise).rejects.toThrow('custom timeout message');

    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('uses a generic default message when none is provided', async () => {
    jest.useFakeTimers();
    const neverSettles = new Promise(() => {});

    const promise = withTimeout(neverSettles, 500);
    const assertion = expect(promise).rejects.toThrow('Operation timed out');

    jest.advanceTimersByTime(500);
    await assertion;
  });

  it('clears the timer once the inner promise wins, so no dangling timeout remains', async () => {
    jest.useFakeTimers();
    await withTimeout(Promise.resolve('value'), 1000);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the timer once the timeout wins, so no dangling timeout remains', async () => {
    jest.useFakeTimers();
    const neverSettles = new Promise(() => {});

    const promise = withTimeout(neverSettles, 1000);
    jest.advanceTimersByTime(1000);
    await expect(promise).rejects.toThrow();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not produce an unhandled rejection when the losing promise rejects after the timeout has already fired', async () => {
    jest.useFakeTimers();
    let rejectLoser: (error: Error) => void = () => {};
    const eventuallyRejects = new Promise<never>((_, reject) => {
      rejectLoser = reject;
    });

    const promise = withTimeout(eventuallyRejects, 500);
    jest.advanceTimersByTime(500);
    await expect(promise).rejects.toThrow('Operation timed out');

    // The abandoned promise settling afterward must not crash the process —
    // Promise.race already subscribes to it internally, so this is safe.
    expect(() => rejectLoser(new Error('late rejection'))).not.toThrow();
  });
});
