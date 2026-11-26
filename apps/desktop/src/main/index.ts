import {
  DEVELOPER_CHANNEL, DESIGN_CHANNEL, formatOpenApi, isDesignSnapshot, isFlag, isHandoff, isPlaygroundRequest, isPlaygroundResponse,
  isRuntimeControl, isRuntimeCopy, isRuntimeEnvironment, isRuntimeInspection, isRuntimeLogs, isRuntimePreview, isRuntimeProcess, isRuntimeScope, isRuntimeSelection, isWorkspacePath,
} from '@factory/contracts';
import { randomUUID } from 'node:crypto';
import { sha256 } from '@factory/generator';
import { assertVacant, publish } from './services/generation/transaction';
import { admitRoot } from './services/projects/filesystem';
import { DeveloperStudio } from './services/developer/studio';
import { GIT_ADVANCED_CHANNEL, isGitAdvancedOutcome, isGitApproved, isGitReview, isGitReviewInput, isGitScope,
  isGitWorkspaceDetails } from '@factory/contracts';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, protocol, session, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
  LIBRARY_CHANNEL, isLibraryAsset, isLibraryAssets,
  INCREMENTAL_CHANNEL, isIncrementalApproval, isIncrementalInspection, isIncrementalPreview, isIncrementalSelection,
  isNullableIncrementalInspection,
  SCHEMA_CHANNEL, isMigrationPreview, isNullableSchemaSnapshot, isSchemaConnection, isSchemaEdit,
  isSchemaLayout, isSchemaPhysical, isSchemaPoints, isSchemaProposal, isSchemaPublish, isSchemaSnapshot, isSqlImport,
  CHANNEL, failure, isAppInfo, isPreferences, isPreferenceSnapshot, isPreferenceWrite, success,
  validateReply, PROJECT_CHANNEL, isProjectCatalog, isProjectId, isProjectSelection,
  GIT_CHANNEL, isGitAction, isGitCloneRequest, isGitCloneResult, isGitCompareRequest, isGitDiff, isGitDiffRequest,
  isGitOutcome, isGitState,
  GENERATOR_CHANNEL, isGeneratorParent, isGeneratorPending, isGeneratorPreview, isGeneratorReceipt, isGeneratorRequest,
} from '@factory/contracts';
import type { Result, SystemTheme, Validator } from '@factory/contracts';
import { APP_URL, DEV_URL, PRODUCTION_CSP, isAuthorizedFrame, isRendererDocument, rendererRestrictions, resolveBundledRoute } from './security';
import { PreferenceStore } from './services/preferences';
import { RecentStore } from './services/projects/recents';
import { ProjectWorkspace } from './services/projects/workspace';
import { GitStudio } from './services/git/studio';
import { GenerationJournal } from './services/generation/journal';
import { GeneratorStudio } from './services/generation/studio';
import { DatabaseStudio } from './services/schema/studio';
import { SchemaStore } from './services/schema/storage';
import { IncrementalStudio } from './services/incremental/studio';
import { LibraryStore } from './services/library';
import { IncrementalStore } from './services/incremental/storage';

const development = !app.isPackaged && process.env.FACTORY_DESKTOP_DEV === '1';
let window: BrowserWindow | undefined;
let projects: ProjectWorkspace | undefined;
let gitStudio: GitStudio | undefined;
let generatorStudio: GeneratorStudio | undefined;
let databaseStudio: DatabaseStudio | undefined;
let incrementalStudio: IncrementalStudio | undefined;
let developerStudio: DeveloperStudio | undefined;
let shutdown: Promise<void> | undefined;

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
  const library = new LibraryStore(app.getPath('userData'));
  handle(LIBRARY_CHANNEL.list, isLibraryAssets, (...args) => args.length ? failure('INVALID_REQUEST') : library.list());
  handle(LIBRARY_CHANNEL.publish, isLibraryAsset, (...args) => args.length === 1 && isLibraryAsset(args[0])
    ? library.publish(args[0]) : failure('INVALID_REQUEST'));
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

function installProjectBridge() {
  function forWorkspace<T>(operation: (workspace: ProjectWorkspace, id: string) => Promise<Result<T>>) {
    return (...args: unknown[]): Result<T> | Promise<Result<T>> => {
      if (!projects) return failure('ACCESS_DENIED');
      return args.length === 1 && isProjectId(args[0]) ? operation(projects, args[0]) : failure('INVALID_REQUEST');
    };
  }

  handle(PROJECT_CHANNEL.list, isProjectCatalog, (...args) =>
    args.length ? failure('INVALID_REQUEST') : projects?.list() ?? failure('ACCESS_DENIED'));
  handle(PROJECT_CHANNEL.openFolder, isProjectSelection, (...args) =>
    args.length ? failure('INVALID_REQUEST') : projects?.openFolder() ?? failure('ACCESS_DENIED'));
  handle(PROJECT_CHANNEL.openRecent, isProjectSelection, forWorkspace((workspace, id) => workspace.openRecent(id)));
  handle(PROJECT_CHANNEL.locateRecent, isProjectSelection, forWorkspace((workspace, id) => workspace.locateRecent(id)));
  handle(PROJECT_CHANNEL.removeRecent, isProjectCatalog, forWorkspace((workspace, id) => workspace.removeRecent(id)));
  handle(PROJECT_CHANNEL.rescan, isProjectCatalog, forWorkspace((workspace, id) => workspace.rescan(id)));
  handle(PROJECT_CHANNEL.close, isProjectCatalog, forWorkspace((workspace, id) => workspace.close(id)));
}

function installDeveloperBridge() {
  function operation<I, O>(channel: string, input: Validator<I>, output: Validator<O>, run: (studio: DeveloperStudio, value: I) => Promise<Result<O>>) {
    handle(channel, output, (...args) => args.length === 1 && input(args[0])
      ? developerStudio ? run(developerStudio, args[0]) : failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  }
  operation(DEVELOPER_CHANNEL.inspect, isProjectId, isRuntimeInspection, (studio, id) => studio.inspect(id));
  operation(DEVELOPER_CHANNEL.handoff, isHandoff, isFlag, (studio, input) => studio.handoff(input));
  operation(DEVELOPER_CHANNEL.preview, isRuntimeSelection, isRuntimePreview, (studio, input) => studio.preview(input));
  operation(DEVELOPER_CHANNEL.start, isRuntimeScope, isRuntimeProcess, (studio, scope) => studio.start(scope));
  operation(DEVELOPER_CHANNEL.control, isRuntimeControl, isFlag, (studio, scope) => studio.control(scope));
  operation(DEVELOPER_CHANNEL.copy, isRuntimeCopy, isFlag, (studio, input) => studio.copy(input));
  operation(DEVELOPER_CHANNEL.environment, isRuntimeEnvironment, isFlag, (studio, input) => studio.environment(input));
  operation(DEVELOPER_CHANNEL.logs, isProjectId, isRuntimeLogs, (studio, id) => studio.logs(id));
  operation(DEVELOPER_CHANNEL.request, isPlaygroundRequest, isPlaygroundResponse, (studio, input) => studio.request(input));
  handle(DESIGN_CHANNEL.inspect, isDesignSnapshot, (...args) => args.length === 1 && isProjectId(args[0])
    ? incrementalStudio?.design(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(DESIGN_CHANNEL.export, isFlag, async (...args) => {
    if (args.length !== 1 || !isProjectId(args[0])) return failure('INVALID_REQUEST');
    const id = args[0];
    const current = window;
    const workspace = projects;
    const studio = incrementalStudio;
    const root = workspace?.root(id);
    if (!workspace || !root || !current || !studio) return failure('ACCESS_DENIED');
    const selected = await dialog.showSaveDialog(current, {
      title: 'Export OpenAPI to a new file', defaultPath: 'openapi.json', filters: [{ name: 'OpenAPI JSON', extensions: ['json'] }],
    });
    if (selected.canceled || !selected.filePath) return success(false);
    if (!selected.filePath.toLowerCase().endsWith('.json') || existsSync(selected.filePath)) return failure('DESIGN_CONFLICT');
    try {
      const destination = await admitRoot(dirname(selected.filePath));
      const name = basename(selected.filePath);
      if (!isWorkspacePath(name)) return failure('INVALID_REQUEST');
      const result = await studio.design(id);
      if (!result.ok) return result;
      const content = formatOpenApi(result.value.entries.flatMap(({ entry }) => entry.kind === 'api' ? [entry] : []));
      await assertVacant(destination, name);
      await publish(destination, name, '.factory-openapi-' + randomUUID(), content, sha256(content), async () => {
        if (workspace.root(id) !== root || current.isDestroyed()) throw new Error('Workspace grant changed.');
      });
      return success(true);
    } catch { return failure('DESIGN_CONFLICT'); }
  });
}

function installGitBridge() {
  handle(GIT_ADVANCED_CHANNEL.details, isGitWorkspaceDetails, (...args) => args.length === 1 && isGitScope(args[0])
    ? gitStudio?.advanced.details(args[0]) ?? failure('PROJECT_UNAVAILABLE') : failure('INVALID_REQUEST'));
  handle(GIT_ADVANCED_CHANNEL.review, isGitReview, (...args) => args.length === 1 && isGitReviewInput(args[0])
    ? gitStudio?.advanced.review(args[0]) ?? failure('PROJECT_UNAVAILABLE') : failure('INVALID_REQUEST'));
  handle(GIT_ADVANCED_CHANNEL.apply, isGitAdvancedOutcome, (...args) => args.length === 1 && isGitApproved(args[0])
    ? gitStudio?.advanced.apply(args[0]) ?? failure('PROJECT_UNAVAILABLE') : failure('INVALID_REQUEST'));
  handle(GIT_CHANNEL.status, isGitState, (...args) => args.length === 1 && isProjectId(args[0])
    ? gitStudio?.status(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GIT_CHANNEL.diff, isGitDiff, (...args) => args.length === 1 && isGitDiffRequest(args[0])
    ? gitStudio?.diff(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GIT_CHANNEL.compare, isGitDiff, (...args) => args.length === 1 && isGitCompareRequest(args[0])
    ? gitStudio?.compare(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GIT_CHANNEL.action, isGitOutcome, (...args) => args.length === 1 && isGitAction(args[0])
    ? gitStudio?.action(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GIT_CHANNEL.clone, isGitCloneResult, (...args) => args.length === 1 && isGitCloneRequest(args[0])
    ? gitStudio?.clone(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
}

function installGeneratorBridge() {
  handle(GENERATOR_CHANNEL.choose, isGeneratorParent, (...args) => !args.length
    ? generatorStudio?.chooseParent() ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GENERATOR_CHANNEL.pending, isGeneratorPending, (...args) => !args.length
    ? generatorStudio?.pending() ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GENERATOR_CHANNEL.preview, isGeneratorPreview, (...args) => args.length === 1 && isGeneratorRequest(args[0])
    ? generatorStudio?.preview(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GENERATOR_CHANNEL.apply, isGeneratorReceipt, (...args) => args.length === 1 && isProjectId(args[0])
    ? generatorStudio?.apply(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GENERATOR_CHANNEL.resume, isGeneratorReceipt, (...args) => args.length === 1 && isProjectId(args[0])
    ? generatorStudio?.resume(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(GENERATOR_CHANNEL.release, isGeneratorPending, (...args) => args.length === 1 && isProjectId(args[0])
    ? generatorStudio?.release(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
}

function installSchemaBridge() {
  handle(SCHEMA_CHANNEL.inspect, isSchemaSnapshot, (...args) => args.length === 1 && isProjectId(args[0])
    ? databaseStudio?.inspect(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(SCHEMA_CHANNEL.parse, isSchemaProposal, (...args) => args.length === 1 && isSqlImport(args[0])
    ? databaseStudio?.parse(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(SCHEMA_CHANNEL.preview, isMigrationPreview, (...args) => args.length === 1 && isSchemaEdit(args[0])
    ? databaseStudio?.preview(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(SCHEMA_CHANNEL.publish, isNullableSchemaSnapshot, (...args) => args.length === 1 && isSchemaPublish(args[0])
    ? databaseStudio?.publish(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(SCHEMA_CHANNEL.release, isNullableSchemaSnapshot, (...args) => args.length === 1 && isSchemaPublish(args[0])
    ? databaseStudio?.release(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(SCHEMA_CHANNEL.layout, isSchemaPoints, (...args) => args.length === 1 && isSchemaLayout(args[0])
    ? databaseStudio?.layout(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  for (const [channel, apply] of [[SCHEMA_CHANNEL.physical, false], [SCHEMA_CHANNEL.apply, true]] as const) {
    handle(channel, isSchemaPhysical, (...args) => args.length === 1 && isSchemaConnection(args[0])
      ? databaseStudio?.physical(args[0], apply) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  }
}

function installIncrementalBridge() {
  handle(INCREMENTAL_CHANNEL.inspect, isIncrementalInspection, (...args) => args.length === 1 && isProjectId(args[0])
    ? incrementalStudio?.inspect(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  handle(INCREMENTAL_CHANNEL.preview, isIncrementalPreview, (...args) => args.length === 1 && isIncrementalSelection(args[0])
    ? incrementalStudio?.preview(args[0]) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  for (const operation of ['apply', 'resume', 'handoff'] as const) {
    handle(INCREMENTAL_CHANNEL[operation], isNullableIncrementalInspection, (...args) => args.length === 1 && isIncrementalApproval(args[0])
      ? incrementalStudio?.action(args[0], operation) ?? failure('ACCESS_DENIED') : failure('INVALID_REQUEST'));
  }
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
  const workspace = new ProjectWorkspace(
    new RecentStore(join(app.getPath('userData'), 'recent-projects.json')),
    {
      async choose(previous) {
        const selected = await dialog.showOpenDialog(current, {
          title: previous ? 'Locate Project Folder' : 'Open Project Folder',
          properties: ['openDirectory'],
          ...(previous ? { defaultPath: previous } : {}),
        });
        return selected.canceled ? null : selected.filePaths[0] ?? null;
      },
      async confirmReplacement(previous, candidate) {
        const decision = await dialog.showMessageBox(current, {
          type: 'warning',
          title: 'Confirm project folder',
          message: `Use this folder for “${previous.name}”?`,
          detail: `The selected folder could not be matched to the saved project.\n\n${candidate.path}`,
          buttons: ['Cancel', 'Use This Folder'], defaultId: 0, cancelId: 0,
        });
        return decision.response === 1;
      },
    },
    (catalog) => {
      void developer?.reconcile();
      if (window === current && !current.isDestroyed()
        && isRendererDocument(current.webContents.getURL(), development) && isProjectCatalog(catalog)) {
        current.webContents.send(PROJECT_CHANNEL.changed, catalog);
      }
    },
  );
  projects = workspace;
  const projectDialogs = {
    async chooseDirectory(title: string, defaultPath?: string) {
      if (current.isDestroyed()) return null;
      const selected = await dialog.showOpenDialog(current, {
        title, properties: ['openDirectory'], ...(defaultPath ? { defaultPath } : {}),
      });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    },
    async confirm(title: string, detail: string, action: string) {
      if (current.isDestroyed()) return false;
      const decision = await dialog.showMessageBox(current, {
        title, message: title, detail, type: 'warning',
        buttons: ['Cancel', action], defaultId: 0, cancelId: 0,
      });
      return decision.response === 1;
    },
  };
  const generator = new GeneratorStudio(new GenerationJournal(app.getPath('userData')), {
    canOpen: () => workspace.canOpen(),
    adopt: (root) => workspace.adoptCreated(root),
  }, { choose: projectDialogs.chooseDirectory, confirm: projectDialogs.confirm });
  generatorStudio = generator;
  const git: GitStudio = new GitStudio({
    root: (id) => workspace.root(id),
    canOpen: () => workspace.canOpen(),
    allowsAuxiliaryPath: (path) => workspace.allowsAuxiliaryPath(path),
    adopt: (root) => workspace.adoptCreated(root),
    generationPending: async (path) => Boolean(await generator.protectsGit(path)) || await database.protectsGit(path) || incremental.protectsGit(path),
    refresh: (id) => workspace.rescan(id),
  }, { ...projectDialogs, reveal: (path) => shell.showItemInFolder(path) }, app.getPath('userData'));
  gitStudio = git;
  const database: DatabaseStudio = new DatabaseStudio(new SchemaStore(app.getPath('userData')), {
    root: (id) => workspace.root(id), git: (id) => git.status(id), gitWriting: () => git.isWriting(),
    refresh: (id) => workspace.rescan(id), incrementalPending: (path) => incremental.protectsGit(path),
  }, projectDialogs);
  databaseStudio = database;
  const incremental: IncrementalStudio = new IncrementalStudio(new IncrementalStore(app.getPath('userData')), {
    root: (id) => workspace.root(id),
    project: async (id) => {
      const catalog = await workspace.list();
      return catalog.ok ? catalog.value.projects.find((project) => project.id === id) : undefined;
    },
    git: (id) => git.status(id), gitWriting: () => git.isWriting(), schemaPending: (path) => database.protectsGit(path),
    refresh: (id) => workspace.rescan(id),
  }, projectDialogs);
  incrementalStudio = incremental;
  const developer = new DeveloperStudio({
    root: (id) => workspace.root(id), allows: (path) => workspace.allowsAuxiliaryPath(path), git: (id) => git.status(id),
  }, {
    confirm: projectDialogs.confirm,
    async chooseEditor() {
      if (current.isDestroyed()) return null;
      const selected = await dialog.showOpenDialog(current, { title: 'Select VS Code executable', properties: ['openFile'] });
      return selected.canceled ? null : selected.filePaths[0] ?? null;
    },
    reveal: (path) => shell.showItemInFolder(path),
    openURL: (url) => shell.openExternal(url),
    copy: (text) => clipboard.writeText(text),
  });
  developerStudio = developer;
  current.on('focus', () => { void workspace.reconcile(); });
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
  current.on('closed', () => {
    shutdown = developer?.dispose();
    workspace.dispose();
    generator.dispose();
    database.dispose();
    incremental.dispose();
    void git.dispose().catch(() => undefined);
    if (window === current) {
      projects = undefined;
      gitStudio = undefined;
      generatorStudio = undefined;
      databaseStudio = undefined;
      incrementalStudio = undefined;
      developerStudio = undefined;
      window = undefined;
    }
  });
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
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') void Promise.resolve(shutdown).finally(() => app.quit());
  });
  app.on('before-quit', (event) => {
    if (!developerStudio) return;
    event.preventDefault();
    const running = developerStudio;
    developerStudio = undefined;
    void running.dispose().finally(() => app.quit());
  });
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
    installProjectBridge();
    installGitBridge();
    installGeneratorBridge();
    installSchemaBridge();
    installIncrementalBridge();
    installDeveloperBridge();
    installBridge(new PreferenceStore(join(app.getPath('userData'), 'preferences.json')));
    await openWindow();
    app.on('activate', () => { if (!window) void openWindow().catch(reportStartupError); });
  }).catch(reportStartupError);
}
