import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { failure, GO_STACK, isDevPort, isHandoff, isPlaygroundRequest, isRecord, STACKS, success } from '@factory/contracts';
import type { ErrorCode, GitState, Handoff, PlaygroundRequest, Result, RuntimeControl, RuntimeInspection,
  RuntimeCopy, RuntimeEnvironment, RuntimeLog, RuntimePreview, RuntimeProcess, RuntimeScope, RuntimeSelection } from '@factory/contracts';
import { readIncrementalProject, sha256 } from '@factory/generator';
import { checkedDirectory, pathKey } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { inspectFile, hashFile, readDirectory } from '../incremental/files';
import { assertVacant, publish } from '../generation/transaction';
import { findGit } from '../git/process';
import { baseEnvironment, dependencyBin, openTool, pnpmScript, toolVersion, windows } from './tools';
import { prepareRequest, redact, requestSecrets, sendRequest, sensitiveKey } from './playground';

interface Grant {
  root(id: string): ProjectRoot | undefined;
  allows(path: string): boolean;
  git(id: string): Promise<Result<GitState>>;
}
export interface DeveloperDialogs {
  confirm(title: string, detail: string, action: string): Promise<boolean>;
  chooseEditor(): Promise<string | null>;
  reveal(path: string): void;
  copy(text: string): void;
  openURL(url: string): Promise<void>;
}

const pinnedFiles = ['.factory/project.json', '.factory/generation-manifest.json', '.factory/versions.lock.json',
  '.factory/modules.json', '.factory/engineering.json', '.env.example', 'package.json'];
const knownConfig = ['PORT', 'HOST', 'DATABASE_URL', 'AUTH_ORIGIN', 'AUTH_ALLOW_INSECURE_LOOPBACK'] as const;
const referenceFiles = ['server/server.ts', 'cmd/server/main.go', 'vite.config.ts', 'tsconfig.server.json', 'go.mod', 'go.sum', 'pnpm-lock.yaml'];
const maxLines = 200;
const liveProcess = (child: ChildProcess | undefined) => child?.exitCode === null && child.signalCode === null;
const isStopping = (job: Job) => job.process.state === 'stopping';
const escapeSequence = new RegExp(String.fromCharCode(27) + '\\[[0-?]*[ -/]*[@-~]', 'gu');
type Inspection = Awaited<ReturnType<DeveloperStudio['capture']>>;
type Launch = { preview: RuntimePreview; env: NodeJS.ProcessEnv; secrets: string[] };
type Ticket = { projectId: string; key: string; selection: RuntimeSelection; preview: RuntimePreview; at: number };
interface Job {
  projectId: string;
  root: ProjectRoot;
  process: RuntimeProcess;
  lines: RuntimeLog[];
  child?: ChildProcess | undefined;
  secrets: string[];
  stop?: (() => Promise<void>) | undefined;
  done: Promise<void>;
  finish(): void;
}

class Blocked extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

function parseConfig(text: string) {
  try { return parseEnv(text); }
  catch { throw new Blocked('DEVELOPER_ENVIRONMENT'); }
}

async function vacant(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export class DeveloperStudio {
  #disposed = false;
  #editor?: string;
  #busy = new Set<string>();
  #tickets = new Map<string, Ticket>();
  #jobs = new Map<string, Job>();

  constructor(private readonly grant: Grant, private readonly dialogs: DeveloperDialogs) {}

  #root(id: string) {
    const root = !this.#disposed && this.grant.root(id);
    if (!root) throw new Blocked('ACCESS_DENIED');
    return root;
  }

  async #guard(id: string, root: ProjectRoot) {
    await checkedDirectory(root.path, root.identity);
    if (this.#root(id) !== root) throw new Blocked('DEVELOPER_STALE');
  }

  async #result<T>(operation: () => Promise<T>): Promise<Result<T>> {
    try { return success(await operation()); }
    catch (error) { return failure(error instanceof Blocked ? error.code : 'DEVELOPER_PROCESS'); }
  }

  async #context(id: string, root: ProjectRoot) {
    const git = await this.grant.git(id);
    await this.#guard(id, root);
    if (!git.ok) return ['unavailable'];
    const state = git.value;
    return state.state === 'repository'
      ? [state.state, state.repositoryId, state.worktreeId, state.branch, state.head, state.operation] : [state.state];
  }

  async capture(id: string, probe = true) {
    const root = this.#root(id);
    const files = new Map(await Promise.all([...pinnedFiles, '.env', ...referenceFiles].map(async (path) =>
      [path, await inspectFile(root, path)] as const)));
    const config = files.get('.env');
    const sample = files.get('.env.example');
    let project: ReturnType<typeof readIncrementalProject> | null = null;
    try { project = readIncrementalProject(files); } catch { /* Unmanaged projects support editor and terminal handoff. */ }
    const stack = project && STACKS[project.config.stack];
    const local = parseConfig(config?.state === 'text' ? config.content : '');
    const expected = parseConfig(sample?.state === 'text' ? sample.content : '');
    const port = Number(local.PORT ?? expected.PORT ?? project?.config.port);
    const context = await this.#context(id, root);
    const targets = await Promise.all([openTool('node', this.grant.allows), openTool('go', this.grant.allows), findGit()]);
    const [node, go, gitCandidate] = targets;
    const git = gitCandidate && this.grant.allows(gitCandidate) ? gitCandidate : null;
    const pnpm = await pnpmScript(node, this.grant.allows);
    const toolTargets = [
      { name: 'Git', executable: git, args: ['--version'], required: '2.39 or newer' },
      { name: 'Node.js', executable: node?.target ?? null, args: ['--version'], required: stack?.execution.node ?? null },
      { name: 'pnpm', executable: node?.target ?? null, args: pnpm ? [pnpm, '--version'] : [], required: stack?.execution.pnpm ?? null },
      { name: 'Go', executable: go?.target ?? null, args: ['version'], required: stack?.execution.go ?? null },
    ];
    const tools = await Promise.all(toolTargets.map(async ({ name, executable, args, required }) => ({
      name, executable: name === 'pnpm' ? pnpm : executable, required,
      version: probe && executable && args.length ? await toolVersion(executable, args, this.grant.allows, [dirname(executable)]) : null,
    })));
    await this.#guard(id, root);
    const info: RuntimeInspection = {
      stack: stack?.label ?? null, tools, backendPort: isDevPort(port) ? port : null,
      manifests: (stack?.manifests ?? ['package.json', 'pnpm-lock.yaml', 'go.mod', 'go.sum']).map((name) => ({
        name, present: files.get(name)?.state === 'text',
      })),
      environment: Object.keys(expected).slice(0, 64).map((name) => ({
        name, configured: Boolean(local[name]), sensitive: sensitiveKey(name),
      })),
      diagnostic: !stack ? 'Runtime commands need a supported Studio-generated project with intact version locks.'
        : config?.state === 'unsafe' ? 'The .env path is unsafe. Use a regular, UTF-8 file in this worktree.'
          : !isDevPort(port) ? 'Set PORT to a number between 1024 and 65535 in the local .env file.' : null,
    };
    return { info, project, stack, root, files, local, context, node, go };
  }

  inspect(id: string) { return this.#result(async () => (await this.capture(id)).info); }

  handoff(input: Handoff) {
    return this.#result(async () => {
      if (!isHandoff(input)) throw new Blocked('INVALID_REQUEST');
      const { projectId, action, line, column } = input;
      const root = this.#root(projectId);
      if (action === 'choose-editor') {
        const chosen = await this.dialogs.chooseEditor();
        if (!chosen) return false;
        if (!/^(?:code(?:-insiders)?(?:\.exe)?)$/iu.test(basename(chosen))) throw new Blocked('DEVELOPER_EDITOR');
        const editor = await openTool('code', this.grant.allows, chosen);
        if (!editor) throw new Blocked('DEVELOPER_EDITOR');
        if (!await this.dialogs.confirm('Approve VS Code executable?', editor.target, 'Approve Editor')) return false;
        await this.#guard(projectId, root);
        this.#editor = chosen;
        return true;
      }
      const resolveTarget = async () => {
        await this.#guard(projectId, root);
        if (!input.path) return { path: root.path, file: false };
        const parent = await readDirectory(root, dirname(input.path).replaceAll('\\', '/'));
        if (!parent) throw new Blocked('ACCESS_DENIED');
        const path = join(parent.path, basename(input.path));
        const stat = await lstat(path, { bigint: true });
        if ((!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1n)
          || pathKey(await realpath(path)) !== pathKey(path)) throw new Blocked('ACCESS_DENIED');
        await checkedDirectory(parent.path, parent.identity);
        return { path, file: stat.isFile() };
      };
      const checkedTarget = async () => {
        try { return await resolveTarget(); }
        catch (error) {
          if (error instanceof Blocked) throw error;
          throw new Blocked('DEVELOPER_PATH');
        }
      };
      const target = await checkedTarget();
      if ((line !== null && !target.file) || (action === 'terminal' && target.file)) throw new Blocked('INVALID_REQUEST');
      if (action === 'reveal') {
        this.dialogs.reveal(target.path);
        return true;
      }
      const tool = await openTool(action === 'editor' ? 'code' : 'terminal', this.grant.allows, this.#editor);
      if (!tool) throw new Blocked(action === 'editor' ? 'DEVELOPER_EDITOR' : 'DEVELOPER_TERMINAL');
      const args = action === 'editor'
        ? ['--new-window', ...(line !== null ? ['--goto', target.path + ':' + line + ':' + (column ?? 1)] : [target.path])]
        : windows ? ['/D'] : [];
      if (!await this.dialogs.confirm(action === 'editor' ? 'Open in VS Code?' : 'Open a native terminal?',
        tool.target + '\n\n' + target.path + (line === null ? '' : ':' + line + ':' + (column ?? 1)), 'Open')) return false;
      await checkedTarget();
      await this.#guard(projectId, root);
      const dir = target.file ? dirname(target.path) : target.path;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(tool.target, args, { cwd: dir, detached: true, shell: false, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      return true;
    });
  }

  async #makePlan(input: RuntimeSelection, snapshot: Inspection, id: string) {
    const { info, stack, project, node, go, root, files, local, context } = snapshot;
    if (!stack || !project || info.diagnostic) throw new Blocked(stack ? 'DEVELOPER_ENVIRONMENT' : 'DEVELOPER_UNSUPPORTED');
    if (context[0] !== 'repository' && context[0] !== 'not-repository') throw new Blocked('DEVELOPER_UNSUPPORTED');
    if (context[5]) throw new Blocked('PROJECT_BUSY');
    const goBackend = project.config.stack === GO_STACK;
    const needGo = goBackend && input.task !== 'frontend';
    const needNode = input.task === 'frontend' || input.task === 'build' || !goBackend;
    const tool = (name: string) => info.tools.find((row) => row.name === name)?.version;
    if ((needNode && tool('Node.js') !== stack.execution.node) || (needGo && tool('Go') !== stack.execution.go)) {
      throw new Blocked('DEVELOPER_TOOL');
    }
    const port = input.task === 'backend' ? info.backendPort : input.task === 'frontend' ? input.frontendPort : null;
    if (input.task === 'frontend' && port === info.backendPort) throw new Blocked('DEVELOPER_PORT');
    const steps: RuntimePreview['steps'] = [];
    const add = (executable: string | undefined, ...args: string[]) => {
      if (!executable) throw new Blocked('DEVELOPER_TOOL');
      steps.push({ executable, args });
    };
    if (input.task === 'backend') {
      if (files.get(goBackend ? 'cmd/server/main.go' : 'server/server.ts')?.state !== 'text') throw new Blocked('DEVELOPER_UNSUPPORTED');
      add(goBackend ? go?.target : node?.target, ...stack.execution.backend);
    }
    if (input.task === 'frontend' || input.task === 'build') {
      const vite = await dependencyBin(root, 'vite').catch(() => null);
      if (!vite || files.get('vite.config.ts')?.state !== 'text') throw new Blocked('DEVELOPER_TOOL');
      if (input.task === 'frontend') add(node?.target, vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort');
      else {
        if (!goBackend) {
          const tsc = await dependencyBin(root, 'typescript').catch(() => null);
          if (!tsc || files.get('tsconfig.server.json')?.state !== 'text') throw new Blocked('DEVELOPER_TOOL');
          add(node?.target, tsc, '-p', 'tsconfig.server.json');
        }
        add(node?.target, vite, 'build');
        if (goBackend) add(go?.target, 'build', '-mod=readonly', '-buildvcs=false', './cmd/...');
      }
    }
    if (input.task === 'test') {
      if (goBackend) add(go?.target, 'test', '-mod=readonly', '-buildvcs=false', './...');
      else {
        const tests = project.files.map(({ path }) => path).filter((path) => /^test\/[a-z]+\.test\.ts$/u.test(path)).sort();
        if (!tests.length) throw new Blocked('DEVELOPER_UNSUPPORTED');
        for (const path of tests) {
          const observed = await inspectFile(root, path);
          if (observed.state !== 'text') throw new Blocked('DEVELOPER_UNSUPPORTED');
          files.set(path, observed);
        }
        add(node?.target, '--experimental-strip-types', '--test', ...tests);
      }
    }
    const selected = Object.fromEntries(knownConfig.flatMap((key) => local[key] ? [[key, local[key]]] : []));
    if (selected.DATABASE_URL) {
      try {
        const url = new URL(selected.DATABASE_URL);
        if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
          || !url.pathname || url.pathname === '/' || (url.search && (url.searchParams.size !== 1
            || !/^-csearch_path=[a-z_][a-z0-9_]{0,62}$/u.test(url.searchParams.get('options') ?? '')))) throw new Error('Nonlocal database');
      } catch { throw new Blocked('DEVELOPER_ENVIRONMENT'); }
    }
    const goCache: Record<string, string> = {};
    if (needGo) for (const key of ['GOPATH', 'GOCACHE', 'GOMODCACHE']) {
      const candidate = process.env[key];
      if (!candidate || !isAbsolute(candidate) || !this.grant.allows(candidate)) continue;
      const canonical = await realpath(candidate).catch(() => null);
      if (canonical && this.grant.allows(canonical)) goCache[key] = canonical;
    }
    const env = {
      ...baseEnvironment([node?.target, go?.target].flatMap((path) => path ? [dirname(path)] : [])),
      ...(needGo ? { ...goCache, GOTOOLCHAIN: 'local', GOENV: 'off', GOWORK: 'off', GOFLAGS: '', CGO_ENABLED: '0' } : {}),
      ...selected, HOST: '127.0.0.1', PORT: String(info.backendPort),
    };
    const preview: RuntimePreview = { id, cwd: root.path, steps, port,
      environment: ['HOST=127.0.0.1', 'PORT=' + info.backendPort, ...Object.keys(selected).filter((key) => !['HOST', 'PORT'].includes(key))
        .map((key) => key + ' (configured in .env)'), ...(needGo ? ['GOTOOLCHAIN=local', 'GOWORK=off', 'CGO_ENABLED=0', ...Object.keys(goCache).map((key) => key + ' (host cache)')] : [])] };
    const binaries = await Promise.all([...new Set(steps.flatMap(({ executable, args }) =>
      [executable, ...args.filter((arg) => arg === args[0] && (arg.endsWith('/vite.js') || arg.endsWith('\\vite.js') || basename(arg) === 'tsc'))]))]
      .map(async (path) => {
        const stat = await lstat(path, { bigint: true });
        return [path, String(stat.ino), String(stat.size), String(stat.mtimeNs)];
      }));
    const key = sha256(JSON.stringify([root, preview, context, binaries, goCache, [...files].map(([path, file]) => [path, hashFile(file)])]));
    return { key, preview, env, secrets: knownConfig.filter(sensitiveKey).flatMap((name) => {
      const value = selected[name];
      if (!value) return [];
      if (name !== 'DATABASE_URL') return [value];
      const url = new URL(value);
      return [value, url.password, decodeURIComponent(url.password)].filter(Boolean);
    }) };
  }

  preview(input: RuntimeSelection) {
    return this.#result(async () => {
      const id = randomUUID();
      const plan = await this.#makePlan(input, await this.capture(input.projectId), id);
      const now = Date.now();
      for (const [key, ticket] of this.#tickets) if (now - ticket.at > 120_000 || ticket.projectId === input.projectId) this.#tickets.delete(key);
      if (this.#tickets.size >= 24) throw new Blocked('PROJECT_BUSY');
      this.#tickets.set(id, { projectId: input.projectId, key: plan.key, selection: input, preview: plan.preview, at: now });
      return plan.preview;
    });
  }

  start(scope: RuntimeScope) {
    return this.#result(async () => {
      const { projectId, id } = scope;
      const root = this.#root(projectId);
      const ticket = this.#tickets.get(id);
      if (!ticket || ticket.projectId !== projectId || Date.now() - ticket.at > 120_000) throw new Blocked('DEVELOPER_STALE');
      if (this.#busy.has(projectId)) throw new Blocked('PROJECT_BUSY');
      this.#busy.add(projectId);
      this.#tickets.delete(id);
      try {
        const key = projectId + ':' + ticket.selection.task;
        if (['starting', 'running', 'stopping'].includes(this.#jobs.get(key)?.process.state ?? '')) throw new Blocked('PROJECT_BUSY');
        const review = async () => {
          const snapshot = await this.capture(projectId);
          const plan = await this.#makePlan(ticket.selection, snapshot, id);
          if (snapshot.root !== root || plan.key !== ticket.key) throw new Blocked('DEVELOPER_STALE');
          if (plan.preview.port !== null && !await vacant(plan.preview.port)) throw new Blocked('DEVELOPER_PORT');
          await this.#guard(projectId, root);
          return plan;
        };
        await review();
        const detail = [
          ticket.preview.cwd, ...ticket.preview.steps.map(({ executable, args }) => JSON.stringify([executable, ...args])),
          ...ticket.preview.environment,
          'Only continue if you trust this project. Its code runs with your operating system account permissions.',
        ].join('\n\n');
        if (!await this.dialogs.confirm('Trust and run project code?', detail, 'Trust and Run')) throw new Blocked('ACCESS_DENIED');
        const plan = await review();
        const stopTool = windows && await openTool('taskkill', this.grant.allows);
        if (windows && !stopTool) throw new Blocked('DEVELOPER_TOOL');
        let finish!: () => void;
        const done = new Promise<void>((resolve) => { finish = resolve; });
        const job: Job = { projectId, root, lines: [], secrets: plan.secrets, done, finish,
          process: { id, task: ticket.selection.task, pid: null, state: 'starting', port: plan.preview.port,
            ready: false, started: new Date().toISOString(), code: null } };
        await this.#guard(projectId, root);
        if (job.process.port !== null && [...this.#jobs.values()].some(({ process: active }) =>
          active.port === job.process.port && ['starting', 'running', 'stopping'].includes(active.state))) throw new Blocked('DEVELOPER_PORT');
        this.#jobs.set(key, job);
        void this.#run(job, plan, stopTool ? stopTool.target : undefined);
        return { ...job.process };
      } finally { this.#busy.delete(projectId); }
    });
  }

  #record(job: Job, stream: RuntimeLog['stream'], line: string) {
    const text = redact(line.replace(escapeSequence, ''), job.secrets).replaceAll('\0', '�').slice(0, 2048);
    job.lines.push({ at: new Date().toISOString(), stream, text });
    if (job.lines.length > maxLines) job.lines.shift();
    if (job.process.state === 'running' && job.process.port !== null) {
      if (job.process.task === 'frontend' && line.includes('http://127.0.0.1:' + job.process.port + '/')) job.process.ready = true;
      if (job.process.task === 'backend') {
        try {
          const event: unknown = JSON.parse(line);
          if (isRecord(event) && ((event.event === 'listening' && event.port === job.process.port)
            || (event.msg === 'listening' && event.address === '127.0.0.1:' + job.process.port))) job.process.ready = true;
        } catch { /* Ordinary runtime text. */ }
      }
    }
  }

  async #run(job: Job, plan: Launch, stopTool?: string) {
    try {
      for (const { executable, args } of plan.preview.steps) {
        if (isStopping(job)) break;
        await this.#guard(job.projectId, job.root);
        if (isStopping(job)) break;
        const child = spawn(executable, args, { cwd: job.root.path, env: plan.env, detached: !windows, shell: false,
          windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        job.child = child;
        job.process.pid = child.pid ?? null;
        job.process.state = 'running';
        job.stop = async () => {
          if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
          if (windows && stopTool) {
            await promisify(execFile)(stopTool, ['/PID', String(child.pid), '/T', '/F'], { env: baseEnvironment(), windowsHide: true, timeout: 5000 });
          } else {
            process.kill(-child.pid, 'SIGTERM');
            const escalator = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) {
                try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Already closed. */ }
              }
            }, 2500);
            escalator.unref();
          }
        };
        const flush: (() => void)[] = [];
        for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']] as const) {
          let line = '';
          let long = false;
          const end = () => {
            if (long) this.#record(job, name, '[Overlong output line omitted]');
            else if (line) this.#record(job, name, line);
            line = '';
            long = false;
          };
          flush.push(end);
          stream.setEncoding('utf8').on('data', (chunk: string) => {
            const parts = chunk.split(/\r?\n/u);
            for (const [index, part] of parts.entries()) {
              if (index) end();
              if (!long && line.length + part.length <= 8192) line += part;
              else long = true;
            }
          });
        }
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        flush.forEach((end) => end());
        job.child = undefined;
        job.stop = undefined;
        job.process.code = code;
        if (isStopping(job)) break;
        if (code !== 0) throw new Error('Failed step');
      }
      job.process.state = job.process.state === 'stopping' ? 'stopped' : 'completed';
    } catch {
      job.process.state = 'failed';
      this.#record(job, 'studio', 'The approved command did not complete. Check its diagnostics and prerequisites.');
    } finally {
      job.child = undefined;
      job.stop = undefined;
      job.process.ready = false;
      job.finish();
    }
  }

  async #stop(job: Job) {
    const previous = job.process.state;
    job.process.state = 'stopping';
    try { await job.stop?.(); }
    catch (error) {
      if (job.child?.exitCode === null && job.child?.signalCode === null) {
        job.process.state = previous;
        throw error;
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([job.done, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Blocked('DEVELOPER_PROCESS')), 8000);
      })]);
    } finally { clearTimeout(timer); }
  }

  control(scope: RuntimeControl) {
    return this.#result(async () => {
      const root = this.#root(scope.projectId);
      const job = this.#find(scope, root);
      await this.#guard(scope.projectId, root);
      if (scope.action === 'clear') { job.lines.length = 0; return true; }
      if (scope.action === 'stop') {
        if (!['starting', 'running'].includes(job.process.state)) throw new Blocked('DEVELOPER_PROCESS');
        await this.#stop(job);
        return true;
      }
      const port = job.process.port;
      if (!job.process.ready || !liveProcess(job.child) || port === null) throw new Blocked('DEVELOPER_PROCESS');
      const url = 'http://127.0.0.1:' + port + '/';
      if (!await this.dialogs.confirm('Open local application?', url + '\n' + root.path, 'Open in Browser')) return false;
      await this.#guard(scope.projectId, root);
      if (!job.process.ready || !liveProcess(job.child)) throw new Blocked('DEVELOPER_STALE');
      await this.dialogs.openURL(url);
      return true;
    });
  }

  #find(scope: RuntimeScope, root: ProjectRoot) {
    const job = [...this.#jobs.values()].find((item) => item.process.id === scope.id);
    if (!job || job.projectId !== scope.projectId || job.root !== root) throw new Blocked('ACCESS_DENIED');
    return job;
  }

  logs(projectId: string) {
    return this.#result(async () => {
      const root = this.#root(projectId);
      await this.#guard(projectId, root);
      return [...this.#jobs.values()].filter((job) => job.projectId === projectId && job.root === root)
        .map(({ process: row, lines }) => ({ process: { ...row }, lines: [...lines] }));
    });
  }

  request(input: PlaygroundRequest) {
    return this.#result(async () => {
      if (!isPlaygroundRequest(input)) throw new Blocked('INVALID_REQUEST');
      const root = this.#root(input.projectId);
      const job = this.#find({ projectId: input.projectId, id: input.backendId }, root);
      const port = job.process.port;
      if (job.process.task !== 'backend' || !job.process.ready || !liveProcess(job.child) || port === null) throw new Blocked('DEVELOPER_NETWORK');
      const prepared = (() => {
        try { return prepareRequest(input); } catch { throw new Blocked('INVALID_REQUEST'); }
      })();
      if (!await this.dialogs.confirm('Send local HTTP request?', input.method + ' http://127.0.0.1:' + port + input.path
        + '\n\n' + root.path + '\n\n' + input.query.length + ' query parameters, ' + input.headers.length + ' headers, '
        + Buffer.byteLength(input.body) + ' body bytes.', 'Send Request')) throw new Blocked('ACCESS_DENIED');
      await this.#guard(input.projectId, root);
      if (!job.process.ready || !liveProcess(job.child) || job.process.state !== 'running') throw new Blocked('DEVELOPER_STALE');
      const secrets = [...job.secrets, ...requestSecrets(input)];
      try { return await sendRequest(input, port, prepared, secrets); }
      catch { throw new Blocked('DEVELOPER_NETWORK'); }
    });
  }

  copy(input: RuntimeCopy) {
    return this.#result(async () => {
      const root = this.#root(input.projectId);
      const job = this.#find(input, root);
      await this.#guard(input.projectId, root);
      const selected = job.lines.filter(({ stream, text }) => (input.stream === 'all' || stream === input.stream)
        && text.toLowerCase().includes(input.search.toLowerCase()));
      if (!selected.length) return false;
      this.dialogs.copy(selected.map(({ at, stream, text }) => at + ' ' + stream + ' ' + text).join('\n'));
      return true;
    });
  }

  environment(input: RuntimeEnvironment) {
    return this.#result(async () => {
      const captured = await this.capture(input.projectId, false);
      const { root } = captured;
      if (!captured.project || captured.files.get('.env')?.state !== 'absent') throw new Blocked('DEVELOPER_ENVIRONMENT');
      const content = 'PORT=' + input.port + '\n';
      await assertVacant(root, '.env');
      if (!await this.dialogs.confirm('Create local environment file?', root.path + '\n\n.env\n' + content
        + '\nAdd development credentials separately in your editor.', 'Create .env')) return false;
      await this.#guard(input.projectId, root);
      if (JSON.stringify(await this.#context(input.projectId, root)) !== JSON.stringify(captured.context)) throw new Blocked('DEVELOPER_STALE');
      await assertVacant(root, '.env');
      await publish(root, '.env', '.factory-dev-env-' + randomUUID(), content, sha256(content), () => this.#guard(input.projectId, root));
      return true;
    });
  }

  async reconcile() {
    await Promise.allSettled([...this.#jobs].map(async ([key, job]) => {
      try { await this.#guard(job.projectId, job.root); }
      catch {
        if (['starting', 'running'].includes(job.process.state)) await this.#stop(job);
        this.#jobs.delete(key);
      }
    }));
  }

  async dispose() {
    this.#disposed = true;
    this.#tickets.clear();
    await this.reconcile();
  }
}
