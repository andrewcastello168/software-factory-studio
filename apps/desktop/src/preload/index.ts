import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANNEL, failure, isAppInfo, isPreferences, isPreferenceSnapshot, isPreferenceWrite,
  isSystemTheme, validateReply,
} from '@factory/contracts';
import type { Result, StudioBridge, Validator } from '@factory/contracts';

async function invoke<T>(channel: string, validate: Validator<T>, ...args: unknown[]): Promise<Result<T>> {
  try {
    const result: unknown = await ipcRenderer.invoke(channel, ...args);
    return validateReply(result, validate);
  } catch {
    return failure('BRIDGE_UNAVAILABLE');
  }
}

const studio: StudioBridge = {
  getAppInfo: () => invoke(CHANNEL.appInfo, isAppInfo),
  readPreferences: () => invoke(CHANNEL.readPreferences, isPreferenceSnapshot),
  writePreferences: (request) => isPreferenceWrite(request)
    ? invoke(CHANNEL.writePreferences, isPreferences, request)
    : Promise.resolve(failure('INVALID_REQUEST')),
  onSystemThemeChange(listener) {
    if (typeof listener !== 'function') return () => undefined;
    const receive = (_event: unknown, value: unknown) => {
      if (isSystemTheme(value)) listener(value);
    };
    ipcRenderer.on(CHANNEL.systemTheme, receive);
    return () => ipcRenderer.removeListener(CHANNEL.systemTheme, receive);
  },
};

contextBridge.exposeInMainWorld('studio', studio);
