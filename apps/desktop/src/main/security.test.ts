import { describe, expect, it } from 'vitest';
import { APP_URL, DEV_URL, isAuthorizedFrame, isRendererDocument, rendererRestrictions, resolveBundledRoute } from './security';

describe('renderer admission', () => {
  it('uses the approved Electron web preferences', () => {
    expect(rendererRestrictions).toEqual({
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
      webviewTag: false, webSecurity: true,
    });
  });

  it('allows only the entry document in the selected runtime mode', () => {
    expect(isRendererDocument(APP_URL, false)).toBe(true);
    expect(isRendererDocument(DEV_URL, true)).toBe(true);
    expect(isRendererDocument(DEV_URL, false)).toBe(false);
    expect(isRendererDocument(APP_URL, true)).toBe(false);
    expect(isRendererDocument('http://localhost:4481/', true)).toBe(false);
    expect(isRendererDocument('studio://other/', false)).toBe(false);
    expect(isRendererDocument('studio://app/?other', false)).toBe(false);
    expect(isRendererDocument('studio://app/#other', false)).toBe(false);
    expect(isRendererDocument('studio://user@app/', false)).toBe(false);
  });

  it('requires the authorized window and exact top-level frame', () => {
    const frame = { processId: 1, routingId: 2, url: APP_URL };
    expect(isAuthorizedFrame(5, 5, frame, frame, false)).toBe(true);
    expect(isAuthorizedFrame(5, 6, frame, frame, false)).toBe(false);
    expect(isAuthorizedFrame(5, 5, { ...frame, routingId: 3 }, frame, false)).toBe(false);
    expect(isAuthorizedFrame(5, 5, { ...frame, processId: 3 }, frame, false)).toBe(false);
    expect(isAuthorizedFrame(5, 5, { ...frame, url: DEV_URL }, frame, false)).toBe(false);
    expect(isAuthorizedFrame(5, 5, null, frame, false)).toBe(false);
  });

  it('emits paths and media types only for bundled routes', () => {
    expect(resolveBundledRoute(APP_URL)).toEqual({ relativePath: 'index.html', mediaType: 'text/html; charset=utf-8' });
    expect(resolveBundledRoute('studio://app/assets/index-ABC.js')).toEqual({
      relativePath: 'assets/index-ABC.js', mediaType: 'text/javascript; charset=utf-8',
    });
    for (const path of [
      'assets/secret.json', 'assets/a/index.js', 'assets/%2findex.js',
      'assets/%2e%2e/index.js', 'assets/index.js?wrong', 'other.html',
    ]) expect(resolveBundledRoute(APP_URL + path)).toBeNull();
  });
});
