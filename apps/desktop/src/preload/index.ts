import { contextBridge, ipcRenderer } from 'electron';
import {
  SCHEMA_CHANNEL, isMigrationPreview, isNullableSchemaSnapshot, isSchemaConnection, isSchemaEdit,
  isSchemaLayout, isSchemaPhysical, isSchemaPoints, isSchemaProposal, isSchemaPublish, isSchemaSnapshot, isSqlImport,
  CHANNEL, failure, isAppInfo, isPreferences, isPreferenceSnapshot, isPreferenceWrite,
  isSystemTheme, validateReply, PROJECT_CHANNEL, isProjectCatalog, isProjectId, isProjectSelection,
  GIT_CHANNEL, isGitAction, isGitCloneRequest, isGitCloneResult, isGitCompareRequest, isGitDiff, isGitDiffRequest,
  isGitOutcome, isGitState,
  GENERATOR_CHANNEL, isGeneratorParent, isGeneratorPending, isGeneratorPreview, isGeneratorReceipt, isGeneratorRequest,
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

function invokeProject<T>(channel: string, validate: Validator<T>, id: unknown): Promise<Result<T>> {
  return isProjectId(id) ? invoke(channel, validate, id) : Promise.resolve(failure('INVALID_REQUEST'));
}

function checkedInvoke<T>(
  channel: string, input: unknown, validInput: (value: unknown) => boolean, validReply: Validator<T>,
): Promise<Result<T>> {
  return validInput(input) ? invoke(channel, validReply, input) : Promise.resolve(failure('INVALID_REQUEST'));
}

const studio: StudioBridge = {
  schema: {
    inspect: (id) => invokeProject(SCHEMA_CHANNEL.inspect, isSchemaSnapshot, id),
    parse: (input) => checkedInvoke(SCHEMA_CHANNEL.parse, input, isSqlImport, isSchemaProposal),
    preview: (input) => checkedInvoke(SCHEMA_CHANNEL.preview, input, isSchemaEdit, isMigrationPreview),
    publish: (input) => checkedInvoke(SCHEMA_CHANNEL.publish, input, isSchemaPublish, isNullableSchemaSnapshot),
    release: (input) => checkedInvoke(SCHEMA_CHANNEL.release, input, isSchemaPublish, isNullableSchemaSnapshot),
    layout: (input) => checkedInvoke(SCHEMA_CHANNEL.layout, input, isSchemaLayout, isSchemaPoints),
    physical: (input) => checkedInvoke(SCHEMA_CHANNEL.physical, input, isSchemaConnection, isSchemaPhysical),
    apply: (input) => checkedInvoke(SCHEMA_CHANNEL.apply, input, isSchemaConnection, isSchemaPhysical),
  },
  projects: {
    list: () => invoke(PROJECT_CHANNEL.list, isProjectCatalog),
    openFolder: () => invoke(PROJECT_CHANNEL.openFolder, isProjectSelection),
    openRecent: (id) => invokeProject(PROJECT_CHANNEL.openRecent, isProjectSelection, id),
    locateRecent: (id) => invokeProject(PROJECT_CHANNEL.locateRecent, isProjectSelection, id),
    removeRecent: (id) => invokeProject(PROJECT_CHANNEL.removeRecent, isProjectCatalog, id),
    rescan: (id) => invokeProject(PROJECT_CHANNEL.rescan, isProjectCatalog, id),
    close: (id) => invokeProject(PROJECT_CHANNEL.close, isProjectCatalog, id),
    onChange(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const receive = (_event: unknown, value: unknown) => {
        if (isProjectCatalog(value)) listener(value);
      };
      ipcRenderer.on(PROJECT_CHANNEL.changed, receive);
      return () => ipcRenderer.removeListener(PROJECT_CHANNEL.changed, receive);
    },
  },
  git: {
    status: (id) => invokeProject(GIT_CHANNEL.status, isGitState, id),
    diff: (request) => isGitDiffRequest(request) ? invoke(GIT_CHANNEL.diff, isGitDiff, request) : Promise.resolve(failure('INVALID_REQUEST')),
    compare: (request) => isGitCompareRequest(request) ? invoke(GIT_CHANNEL.compare, isGitDiff, request) : Promise.resolve(failure('INVALID_REQUEST')),
    action: (request) => isGitAction(request) ? invoke(GIT_CHANNEL.action, isGitOutcome, request) : Promise.resolve(failure('INVALID_REQUEST')),
    clone: (request) => isGitCloneRequest(request) ? invoke(GIT_CHANNEL.clone, isGitCloneResult, request) : Promise.resolve(failure('INVALID_REQUEST')),
  },
  generator: {
    chooseParent: () => invoke(GENERATOR_CHANNEL.choose, isGeneratorParent),
    preview: (input) => isGeneratorRequest(input) ? invoke(GENERATOR_CHANNEL.preview, isGeneratorPreview, input)
      : Promise.resolve(failure('INVALID_REQUEST')),
    apply: (id) => invokeProject(GENERATOR_CHANNEL.apply, isGeneratorReceipt, id),
    pending: () => invoke(GENERATOR_CHANNEL.pending, isGeneratorPending),
    resume: (id) => invokeProject(GENERATOR_CHANNEL.resume, isGeneratorReceipt, id),
    release: (id) => invokeProject(GENERATOR_CHANNEL.release, isGeneratorPending, id),
  },
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
