import type { ErrorRequestHandler, RequestHandler } from 'express';

export type Log = (entry: Record<string, string | number>) => void;

export function requestLogger(log: Log): RequestHandler {
  return (request, response, next) => {
    const start = performance.now();
    response.once('finish', () => {
      log({ event: 'http_request', method: request.method, status: response.statusCode, durationMs: Math.round(performance.now() - start) });
    });
    next();
  };
}

export function errorHandler(log: Log): ErrorRequestHandler {
  return (_error, _request, response, next) => {
    if (response.headersSent) { next(); return; }
    log({ event: 'request_failed' });
    response.status(500).json({ error: { code: 'internal_error', message: 'The request could not be completed.' } });
  };
}
