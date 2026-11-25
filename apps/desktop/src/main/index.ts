import { app, BrowserWindow, ipcMain, nativeTheme, protocol, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  CHANNEL, failure, isAppInfo, isPreferences, isPreferenceSnapshot, isPreferenceWrite, success,
  validateReply,
} from '@factory/contracts';
import type { Result, SystemTheme, Validator } from '@factory/contracts';
import { APP_URL, DEV_URL, PRODUCTION_CSP, isAuthorizedFrame, isRendererDocument, rendererRestrictions, resolveBundledRoute } from './security';
import { PreferenceStore } from './services/preferences';

const development = !app.isPackaged && process.env.FACTORY_DESKTOP_DEV === '1';
let window: BrowserWindow | undefined;

protocol.registerSchemesAsPrivileged([
  { scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function systemTheme(): SystemTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function handle<T>(channel: string, validator: Validator<T>, operation: (...args: unknown[]) => Result<T> | Promise<Result<T>>) {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const contents = window && !window.isDestroyed() ? window.webContents : undefined;
    if (!isAuthorizedFrame(event.sender.id, contents?.id, event.senderFrame, contents?.mainFrame, development)) {
      return failure('ACCESS_DENIED');
    }
    try {
      return validateReply(await operation(...args), validator);
    } catch {
      return failure('INVALID_REPLY');
    }
  });
}

function installBridge(store: PreferenceStore) {
  handle(CHANNEL.appInfo, isAppInfo, (...args) => {
    const info = { version: app.getVersion(), platform: process.platform };
    return args.length ? failure('INVALID_REQUEST') : isAppInfo(info) ? success(info) : failure('INVALID_REPLY');
  });
  handle(CHANNEL.readPreferences, isPreferenceSnapshot, async (...args) => {
    if (args.length) return failure('INVALID_REQUEST');
    const result = await store.read();
    return result.ok ? success({ ...result.value, systemTheme: systemTheme() }) : result;
  });
  handle(CHANNEL.writePreferences, isPreferences, (...args) => args.length === 1 && isPreferenceWrite(args[0])
    ? store.write(args[0]) : failure('INVALID_REQUEST'));
  nativeTheme.on('updated', () => {
    if (window && !window.isDestroyed()) window.webContents.send(CHANNEL.systemTheme, systemTheme());
  });
}

async function installProtocol() {
  const root = await realpath(join(__dirname, '../renderer'));
  protocol.handle('studio', async (request) => {
    const route = resolveBundledRoute(request.url);
    if (request.method !== 'GET' || !route) return new Response(null, { status: 404 });
    try {
      const path = join(root, route.relativePath);
      const canonical = await realpath(path);
      if (relative(root, canonical).split(sep).join('/') !== route.relativePath) {
        return new Response(null, { status: 404 });
      }
      const body = await readFile(canonical);
      return new Response(new Uint8Array(body), {
        headers: {
          'Content-Type': route.mediaType,
          'Content-Security-Policy': PRODUCTION_CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

async function openWindow() {
  const current = new BrowserWindow({
    title: 'Software Factory Studio',
    width: 1280,
    height: 800,
    minWidth: 660,
    minHeight: 480,
    backgroundColor: systemTheme() === 'dark' ? '#17191d' : '#f4f6f8',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      ...rendererRestrictions,
      devTools: development,
    },
  });
  window = current;
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  current.webContents.on('will-navigate', (event) => event.preventDefault());
  current.webContents.on('will-redirect', (event) => event.preventDefault());
  current.webContents.on('will-attach-webview', (event) => event.preventDefault());
  // Chromium can commit internal URLs, including about:blank, without a cancellable
  // request. Replace any unexpected document and keep its IPC sender unauthorized.
  function recoverDocument() {
    if (!current.isDestroyed() && !isRendererDocument(current.webContents.getURL(), development)) {
      void current.loadURL(development ? DEV_URL : APP_URL).catch(reportStartupError);
    }
  }
  current.webContents.on('did-finish-load', recoverDocument);
  current.webContents.on('did-fail-load', (_event, _code, _description, url, isMainFrame) => {
    if (isMainFrame && !isRendererDocument(url, development)) setImmediate(recoverDocument);
  });
  current.once('ready-to-show', () => current.show());
  current.on('closed', () => { if (window === current) window = undefined; });
  await current.loadURL(development ? DEV_URL : APP_URL);
}

function reportStartupError() {
  console.error('Studio could not load its renderer. Build the application or check the development server.');
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(async () => {
    const rendererSession = session.defaultSession;
    rendererSession.setPermissionCheckHandler(() => false);
    rendererSession.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    rendererSession.setDevicePermissionHandler(() => false);
    rendererSession.on('will-download', (event) => event.preventDefault());
    rendererSession.webRequest.onBeforeRequest((details, respond) => {
      const belongsToWindow = details.webContentsId === window?.webContents.id;
      const unexpectedNavigation = details.resourceType === 'subFrame'
        || (details.resourceType === 'mainFrame' && !isRendererDocument(details.url, development));
      respond({ cancel: belongsToWindow && unexpectedNavigation });
    });
    if (!development) await installProtocol();
    installBridge(new PreferenceStore(join(app.getPath('userData'), 'preferences.json')));
    await openWindow();
    app.on('activate', () => { if (!window) void openWindow().catch(reportStartupError); });
  }).catch(reportStartupError);
}
