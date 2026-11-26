import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultPreferences } from '@factory/contracts';
import type {
  AppInfo, ErrorCode, Preferences, PreferenceSnapshot, PreferenceWrite, SystemTheme,
} from '@factory/contracts';

export const browserPreview = import.meta.env.MODE === 'web';
const bridge = window.studio;

const errors: Partial<Record<ErrorCode, string>> = {
  ACCESS_DENIED: 'This window is not authorized to access preferences.',
  BRIDGE_UNAVAILABLE: 'The desktop preferences service is unavailable.',
  INVALID_REPLY: 'The desktop preferences service returned an invalid response.',
  INVALID_REQUEST: 'This preference value is invalid.',
  PREFERENCES_READ_FAILED: 'Studio could not read local preferences.',
  PREFERENCES_WRITE_FAILED: 'Studio could not save preferences. Your last saved settings are still in effect.',
  PREFERENCES_REVIEW_REQUIRED: 'Preferences changed on disk. Reload them before editing.',
};

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>({ ...defaultPreferences });
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [systemTheme, setSystemTheme] = useState<SystemTheme>();
  const [storage, setStorage] = useState<PreferenceSnapshot['storage']>();
  const [loading, setLoading] = useState(!browserPreview);
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const themeRevision = useRef(0);

  const load = useCallback(() => {
    if (!bridge || browserPreview) {
      if (!browserPreview) setError(errors.BRIDGE_UNAVAILABLE);
      setLoading(false);
      return;
    }

    let active = true;
    const revision = themeRevision.current;
    setLoading(true);
    setSaved(false);
    setError(undefined);
    void bridge.readPreferences().then((result) => {
      if (!active) return;
      if (result.ok) {
        setPreferences(result.value.preferences);
        if (revision === themeRevision.current) setSystemTheme(result.value.systemTheme);
        setStorage(result.value.storage);
      } else {
        setStorage(undefined);
        setError(errors[result.error] ?? 'The desktop preferences service returned an unexpected error.');
      }
    }).catch(() => { if (active) setError(errors.BRIDGE_UNAVAILABLE); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!bridge || browserPreview) return;
    const unsubscribe = bridge.onSystemThemeChange((theme) => {
      themeRevision.current += 1;
      setSystemTheme(theme);
    });
    let active = true;
    void bridge.getAppInfo().then((result) => {
      if (active && result.ok) setAppInfo(result.value);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(load, [load]);

  const resolvedTheme = preferences.theme === 'system' ? systemTheme ?? 'system' : preferences.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  async function write(request: PreferenceWrite) {
    if (browserPreview) {
      if (request.action === 'update') setPreferences((current) => ({ ...current, ...request.changes }));
      return;
    }
    if (!bridge || loading) return;
    setSaving((count) => count + 1);
    setSaved(false);
    setError(undefined);
    try {
      const result = await bridge.writePreferences(request);
      if (result.ok) {
        setPreferences(result.value);
        setStorage('ready');
        setSaved(true);
      } else {
        setError(errors[result.error] ?? 'The desktop preferences service returned an unexpected error.');
      }
    } catch {
      setError(errors.BRIDGE_UNAVAILABLE);
    } finally {
      setSaving((count) => count - 1);
    }
  }

  const editable = browserPreview || (!loading && storage === 'ready');
  return { appInfo, preferences, storage, loading, saving: saving > 0, saved, error, editable, load, write };
}
