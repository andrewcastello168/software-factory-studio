import { isQualityTask, qualityTasks } from './delivery';
import type { Result } from './index';
import { isProjectId, isProjectSegment } from './projects';
import { hasControlCharacters, hasExactKeys, isRecord } from './validation';

export const DEVELOPER_CHANNEL = {
  inspect: 'factory:developer-inspect', handoff: 'factory:developer-handoff',
  preview: 'factory:developer-preview', start: 'factory:developer-start', control: 'factory:developer-control',
  logs: 'factory:developer-logs', copy: 'factory:developer-copy', environment: 'factory:developer-environment', request: 'factory:developer-request',
} as const;
export const runtimeTasks = ['backend', 'frontend', ...qualityTasks] as const;
export type RuntimeTask = typeof runtimeTasks[number];
export const httpMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = typeof httpMethods[number];
export type Handoff = { projectId: string; action: 'editor' | 'reveal' | 'terminal' | 'choose-editor'; path: string | null; line: number | null; column: number | null };
export interface RuntimeSelection { projectId: string; task: RuntimeTask; frontendPort: number; quality?: true }
export interface RuntimeStep { executable: string; args: string[] }
export interface RuntimePreview { id: string; cwd: string; steps: RuntimeStep[]; port: number | null; environment: string[] }
export interface RuntimeScope { projectId: string; id: string }
export type RuntimeControl = RuntimeScope & { action: 'stop' | 'open' | 'clear' };
export type RuntimeCopy = RuntimeScope & { search: string; stream: 'all' | RuntimeLog['stream'] };
export interface RuntimeEnvironment { projectId: string; port: number }
export interface RuntimeLog { at: string; stream: 'stdout' | 'stderr' | 'studio'; text: string }
export interface RuntimeProcess {
  id: string; task: RuntimeTask; pid: number | null; state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'completed';
  port: number | null; ready: boolean; started: string; code: number | null;
}
export interface RuntimeTool { name: string; executable: string | null; version: string | null; required: string | null }
export interface RuntimeInspection {
  stack: string | null; tools: RuntimeTool[]; manifests: { name: string; present: boolean }[];
  environment: { name: string; configured: boolean; sensitive: boolean }[]; backendPort: number | null; diagnostic: string | null;
}
export type HttpPair = [string, string];
export interface PlaygroundRequest {
  projectId: string; backendId: string; method: HttpMethod; path: string; query: HttpPair[]; headers: HttpPair[]; body: string;
}
export interface PlaygroundResponse { status: number; headers: HttpPair[]; body: string; duration: number }

export interface DeveloperBridge {
  inspect(projectId: string): Promise<Result<RuntimeInspection>>;
  handoff(input: Handoff): Promise<Result<boolean>>;
  preview(input: RuntimeSelection): Promise<Result<RuntimePreview>>;
  start(input: RuntimeScope): Promise<Result<RuntimeProcess>>;
  control(input: RuntimeControl): Promise<Result<boolean>>;
  copy(input: RuntimeCopy): Promise<Result<boolean>>;
  environment(input: RuntimeEnvironment): Promise<Result<boolean>>;
  logs(projectId: string): Promise<Result<{ process: RuntimeProcess; lines: RuntimeLog[] }[]>>;
  request(input: PlaygroundRequest): Promise<Result<PlaygroundResponse>>;
}

const short = (value: unknown, limit = 300): value is string =>
  typeof value === 'string' && value.length <= limit && !value.includes('\0');
const array = <T>(value: unknown, max: number, accepts: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.length <= max && value.every(accepts);
const nullable = (value: unknown, accepts: (item: unknown) => boolean) => value === null || accepts(value);
const keyset = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  isRecord(value) && hasExactKeys(value, keys);
const oneOf = (values: readonly unknown[], value: unknown) => values.includes(value);
export const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';
export const isDevPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
export const isWorkspacePath = (value: unknown): value is string =>
  short(value, 1000) && value.length > 0 && !hasControlCharacters(value)
  && value.split('/').every((part) => isProjectSegment(part) && !['.git', '.factory'].includes(part.toLowerCase()));
const coordinate = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1_000_000;
export const isHandoff = (x: unknown): x is Handoff =>
  keyset(x, ['projectId', 'action', 'path', 'line', 'column']) && isProjectId(x.projectId)
  && oneOf(['editor', 'reveal', 'terminal', 'choose-editor'], x.action) && nullable(x.path, isWorkspacePath)
  && nullable(x.line, coordinate) && nullable(x.column, coordinate) && (x.column === null || x.line !== null)
  && (x.line === null || (x.action === 'editor' && x.path !== null))
  && (x.action !== 'choose-editor' || x.path === null);
export const isRuntimeSelection = (x: unknown): x is RuntimeSelection =>
  isRecord(x) && hasExactKeys(x, ['projectId', 'task', 'frontendPort', ...(Object.hasOwn(x, 'quality') ? ['quality'] : [])])
  && isProjectId(x.projectId) && oneOf(runtimeTasks, x.task) && isDevPort(x.frontendPort)
  && (Object.hasOwn(x, 'quality') ? x.quality === true && isQualityTask(x.task) : ['backend', 'frontend', 'test', 'build'].includes(String(x.task)));
export const isRuntimeScope = (x: unknown): x is RuntimeScope =>
  keyset(x, ['projectId', 'id']) && isProjectId(x.projectId) && isProjectId(x.id);
export const isRuntimeControl = (x: unknown): x is RuntimeControl =>
  keyset(x, ['projectId', 'id', 'action']) && isProjectId(x.projectId) && isProjectId(x.id) && oneOf(['stop', 'open', 'clear'], x.action);

export const isRuntimeCopy = (x: unknown): x is RuntimeCopy =>
  keyset(x, ['projectId', 'id', 'search', 'stream']) && isProjectId(x.projectId) && isProjectId(x.id) && short(x.search, 256)
  && oneOf(['all', 'stdout', 'stderr', 'studio'], x.stream);
export const isRuntimeEnvironment = (x: unknown): x is RuntimeEnvironment =>
  keyset(x, ['projectId', 'port']) && isProjectId(x.projectId) && isDevPort(x.port);
const string300 = (x: unknown): x is string => short(x);
const strings = (x: unknown): x is string[] => array(x, 64, string300);
const step = (x: unknown): x is RuntimeStep =>
  keyset(x, ['executable', 'args']) && short(x.executable, 4096) && array(x.args, 64, (a): a is string => short(a, 4096));
export const isRuntimePreview = (x: unknown): x is RuntimePreview =>
  keyset(x, ['id', 'cwd', 'steps', 'port', 'environment']) && isProjectId(x.id) && short(x.cwd, 4096)
  && array(x.steps, 5, step) && nullable(x.port, isDevPort) && strings(x.environment);
const tool = (x: unknown): x is RuntimeTool =>
  keyset(x, ['name', 'executable', 'version', 'required']) && short(x.name) && nullable(x.executable, (a) => short(a, 4096))
  && nullable(x.version, string300) && nullable(x.required, string300);
const manifest = (x: unknown): x is RuntimeInspection['manifests'][number] =>
  keyset(x, ['name', 'present']) && short(x.name) && isFlag(x.present);
const envEntry = (x: unknown): x is RuntimeInspection['environment'][number] =>
  keyset(x, ['name', 'configured', 'sensitive']) && short(x.name) && isFlag(x.configured) && isFlag(x.sensitive);
export const isRuntimeInspection = (x: unknown): x is RuntimeInspection =>
  keyset(x, ['stack', 'tools', 'manifests', 'environment', 'backendPort', 'diagnostic'])
  && nullable(x.stack, string300) && array(x.tools, 5, tool) && array(x.manifests, 6, manifest) && array(x.environment, 64, envEntry)
  && nullable(x.backendPort, isDevPort) && nullable(x.diagnostic, string300);
export const isRuntimeProcess = (x: unknown): x is RuntimeProcess =>
  keyset(x, ['id', 'task', 'pid', 'state', 'port', 'ready', 'started', 'code'])
  && isProjectId(x.id) && oneOf(runtimeTasks, x.task)
  && oneOf(['starting', 'running', 'stopping', 'stopped', 'failed', 'completed'], x.state)
  && nullable(x.pid, Number.isInteger) && nullable(x.port, isDevPort) && isFlag(x.ready)
  && short(x.started) && nullable(x.code, Number.isInteger);
const log = (x: unknown): x is RuntimeLog => keyset(x, ['at', 'stream', 'text']) && short(x.at)
  && oneOf(['stdout', 'stderr', 'studio'], x.stream) && short(x.text, 2048);
const processLogs = (x: unknown): x is { process: RuntimeProcess; lines: RuntimeLog[] } =>
  keyset(x, ['process', 'lines']) && isRuntimeProcess(x.process) && array(x.lines, 250, log);
export const isRuntimeLogs = (x: unknown): x is { process: RuntimeProcess; lines: RuntimeLog[] }[] =>
  array(x, runtimeTasks.length, processLogs);

export const isApiPath = (x: unknown): x is string =>
  short(x, 200) && /^\/api(?:\/[A-Za-z0-9_-]+){1,10}$/u.test(x);
const pair = (x: unknown): x is HttpPair => Array.isArray(x) && x.length === 2
  && short(x[0], 128) && x[0].length > 0 && short(x[1], 4096) && !hasControlCharacters(x[0]) && !hasControlCharacters(x[1]);
export const isPlaygroundRequest = (x: unknown): x is PlaygroundRequest =>
  keyset(x, ['projectId', 'backendId', 'method', 'path', 'query', 'headers', 'body'])
  && isProjectId(x.projectId) && isProjectId(x.backendId) && oneOf(httpMethods, x.method) && isApiPath(x.path)
  && array(x.query, 20, pair) && array(x.headers, 20, pair) && short(x.body, 32768);
export const isPlaygroundResponse = (x: unknown): x is PlaygroundResponse =>
  keyset(x, ['status', 'headers', 'body', 'duration']) && typeof x.status === 'number' && Number.isInteger(x.status)
  && x.status >= 100 && x.status <= 599 && array(x.headers, 60, pair) && short(x.body, 131072)
  && typeof x.duration === 'number' && Number.isFinite(x.duration) && x.duration >= 0;
