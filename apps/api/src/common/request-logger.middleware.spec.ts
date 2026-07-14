import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestLoggerMiddleware } from './request-logger.middleware';

function mockRequest(headers: Record<string, string> = {}): Request {
  return { method: 'GET', originalUrl: '/health', headers } as unknown as Request;
}

function mockResponse(): Response {
  const listeners: Record<string, () => void> = {};
  return {
    setHeader: jest.fn(),
    statusCode: 200,
    on: jest.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
    }),
    // Test-only helper to simulate the response actually finishing.
    __triggerFinish: () => listeners.finish?.(),
  } as unknown as Response;
}

describe('requestLoggerMiddleware', () => {
  it('generates a request ID when none is supplied, attaches it to the request, and echoes it on the response', () => {
    const req = mockRequest();
    const res = mockResponse();
    const next = jest.fn();

    requestLoggerMiddleware(req, res, next);

    expect(req.requestId).toEqual(expect.any(String));
    expect(req.requestId).not.toBe('');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('reuses an upstream-supplied x-request-id instead of generating a new one', () => {
    const req = mockRequest({ 'x-request-id': 'upstream-correlation-id' });
    const res = mockResponse();

    requestLoggerMiddleware(req, res, jest.fn());

    expect(req.requestId).toBe('upstream-correlation-id');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'upstream-correlation-id');
  });

  it('never logs headers or a request body — only method/path/status/duration/requestId', () => {
    const req = mockRequest({ authorization: 'Bearer super-secret-token' });
    const res = mockResponse();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    requestLoggerMiddleware(req, res, jest.fn());
    (res as unknown as { __triggerFinish: () => void }).__triggerFinish();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('GET /health 200'));
    expect(logSpy.mock.calls[0]?.[0]).not.toEqual(expect.stringContaining('super-secret-token'));
    logSpy.mockRestore();
  });
});
