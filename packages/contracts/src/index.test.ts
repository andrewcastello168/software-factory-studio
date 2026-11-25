import { describe, expect, it } from 'vitest';
import { failure, isPreferenceWrite, isPreferences, validateReply } from './index';

describe('desktop contract validation', () => {
  it.each([
    { action: 'update', changes: { sidebarWidth: 179 } },
    { action: 'update', changes: { sidebarWidth: 320.5 } },
    { action: 'update', changes: { sidebarWidth: NaN } },
    { action: 'update', changes: { theme: 'Dark' } },
    { action: 'update', changes: { theme: 'dark', directory: 'anything' } },
    { action: 'update', changes: {} },
    { action: 'restoreDefaults', path: 'anything' },
    { action: 'arbitrary' },
  ])('rejects an invalid request %#', (request) => {
    expect(isPreferenceWrite(request)).toBe(false);
  });

  it.each([
    { action: 'update', changes: { sidebarWidth: 180 } },
    { action: 'update', changes: { theme: 'dark', sidebarWidth: 320 } },
    { action: 'restoreDefaults' },
  ])('accepts a supported request %#', (request) => {
    expect(isPreferenceWrite(request)).toBe(true);
  });

  it('returns only bounded known errors and validated replies', () => {
    const value = { theme: 'dark', sidebarWidth: 240 };
    expect(validateReply({ ok: true, value }, isPreferences)).toEqual({ ok: true, value });
    expect(validateReply({ ok: false, error: 'ACCESS_DENIED' }, isPreferences)).toEqual(failure('ACCESS_DENIED'));
    expect(validateReply({ ok: false, error: 'raw process output' }, isPreferences)).toEqual(failure('INVALID_REPLY'));
    expect(validateReply({ ok: true, value: { ...value, extra: 'private' } }, isPreferences)).toEqual(failure('INVALID_REPLY'));
  });
});
