import {
  DELIVERY_CHANNEL, isDeliveryInspection, isNullableRelease, isPackageRequest, isShareExport, isShareExportResult,
  isSharedLibrary, isShareImport, isShareImportResult,
} from '@factory/contracts';
import {
  DEVELOPER_CHANNEL, DESIGN_CHANNEL, isDesignSnapshot, isFlag, isHandoff, isPlaygroundRequest, isPlaygroundResponse,
  isRuntimeControl, isRuntimeCopy, isRuntimeEnvironment, isRuntimeInspection, isRuntimeLogs, isRuntimePreview, isRuntimeProcess, isRuntimeScope, isRuntimeSelection,
} from '@factory/contracts';
import { GIT_ADVANCED_CHANNEL, isGitAdvancedOutcome, isGitApproved, isGitReview, isGitReviewInput, isGitScope,
  isGitWorkspaceDetails } from '@factory/contracts';
import { contextBridge, ipcRenderer } from 'electron';
import {
  LIBRARY_CHANNEL, isLibraryAsset, isLibraryAssets,
  INCREMENTAL_CHANNEL, isIncrementalApproval, isIncrementalInspection, isIncrementalPreview, isIncrementalSelection,
  isNullableIncrementalInspection,
  SCHEMA_CHANNEL, isMigrationPreview, isNullableSchemaSnapshot, isSchemaConnection, isSchemaEdit,
  isSchemaLayout, isSchemaPhysical, isSchemaPoints, isSchemaProposal, isSchemaPublish, isSchemaSnapshot, isSqlImport,
  CHANNEL, failure, isAppInfo, isToolchain, isPreferences, isPreferenceSnapshot, isPreferenceWrite,
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
  delivery: {
    inspect: (id) => invokeProject(DELIVERY_CHANNEL.inspect, isDeliveryInspection, id),
    package: (input) => checkedInvoke(DELIVERY_CHANNEL.package, input, isPackageRequest, isNullableRelease),
    shares: (id) => invokeProject(DELIVERY_CHANNEL.shares, isSharedLibrary, id),
    export: (input) => checkedInvoke(DELIVERY_CHANNEL.export, input, isShareExport, isShareExportResult),
    import: (input) => checkedInvoke(DELIVERY_CHANNEL.import, input, isShareImport, isShareImportResult),
  },
  developer: {
    inspect: (id) => invokeProject(DEVELOPER_CHANNEL.inspect, isRuntimeInspection, id),
    handoff: (input) => checkedInvoke(DEVELOPER_CHANNEL.handoff, input, isHandoff, isFlag),
    preview: (input) => checkedInvoke(DEVELOPER_CHANNEL.preview, input, isRuntimeSelection, isRuntimePreview),
    start: (scope) => checkedInvoke(DEVELOPER_CHANNEL.start, scope, isRuntimeScope, isRuntimeProcess),
    control: (scope) => checkedInvoke(DEVELOPER_CHANNEL.control, scope, isRuntimeControl, isFlag),
    copy: (input) => checkedInvoke(DEVELOPER_CHANNEL.copy, input, isRuntimeCopy, isFlag),
    environment: (input) => checkedInvoke(DEVELOPER_CHANNEL.environment, input, isRuntimeEnvironment, isFlag),
    logs: (id) => invokeProject(DEVELOPER_CHANNEL.logs, isRuntimeLogs, id),
    request: (input) => checkedInvoke(DEVELOPER_CHANNEL.request, input, isPlaygroundRequest, isPlaygroundResponse),
  },
  design: {
    inspect: (id) => invokeProject(DESIGN_CHANNEL.inspect, isDesignSnapshot, id),
    export: (id) => invokeProject(DESIGN_CHANNEL.export, isFlag, id),
  },
  library: {
    list: () => invoke(LIBRARY_CHANNEL.list, isLibraryAssets),
    publish: (asset) => checkedInvoke(LIBRARY_CHANNEL.publish, asset, isLibraryAsset, isLibraryAsset),
  },
  incremental: {
    inspect: (id) => invokeProject(INCREMENTAL_CHANNEL.inspect, isIncrementalInspection, id),
    preview: (input) => checkedInvoke(INCREMENTAL_CHANNEL.preview, input, isIncrementalSelection, isIncrementalPreview),
    apply: (input) => checkedInvoke(INCREMENTAL_CHANNEL.apply, input, isIncrementalApproval, isNullableIncrementalInspection),
    resume: (input) => checkedInvoke(INCREMENTAL_CHANNEL.resume, input, isIncrementalApproval, isNullableIncrementalInspection),
    handoff: (input) => checkedInvoke(INCREMENTAL_CHANNEL.handoff, input, isIncrementalApproval, isNullableIncrementalInspection),
  },
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
    advanced: {
      details: (scope) => checkedInvoke(GIT_ADVANCED_CHANNEL.details, scope, isGitScope, isGitWorkspaceDetails),
      review: (input) => checkedInvoke(GIT_ADVANCED_CHANNEL.review, input, isGitReviewInput, isGitReview),
      apply: (approval) => checkedInvoke(GIT_ADVANCED_CHANNEL.apply, approval, isGitApproved, isGitAdvancedOutcome),
    },
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
  inspectToolchain: () => invoke(CHANNEL.toolchain, isToolchain),
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
