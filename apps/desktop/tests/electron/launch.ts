import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { _electron } from '@playwright/test';

export async function launchStudio(profile?: string) {
  const installed = process.env.FACTORY_INSTALLED_EXECUTABLE;
  if (installed && !isAbsolute(installed)) throw new Error('Use an absolute installed executable path.');
  const application = await _electron.launch({
    executablePath: installed ?? (createRequire(import.meta.url)('electron') as string),
    args: [...(installed ? [] : [resolve('.')]), ...(profile ? ['--user-data-dir=' + profile] : [])],
    ...(installed ? { cwd: dirname(installed) } : {}),
    env: { ...process.env, FACTORY_DESKTOP_DEV: '0' },
    chromiumSandbox: true,
  });
  try {
    if (installed && !await application.evaluate(({ app }) => app.isPackaged)) {
      throw new Error('The installed test requires a packaged application.');
    }
    return application;
  } catch (error) {
    await application.close();
    throw error;
  }
}
