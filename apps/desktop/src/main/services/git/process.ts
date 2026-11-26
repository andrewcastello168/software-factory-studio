import { spawn } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export type Transport = 'https' | 'file';
const windows = process.platform === 'win32';

export class GitFailure extends Error {}
export class GitCommandFailure extends GitFailure {
  constructor(operation: string, stderr: string) {
    super(commandMessage(operation, stderr));
  }
}

function commandMessage(operation: string, stderr: string): string {
  if (/author identity unknown|unable to auto-detect email address/iu.test(stderr)) {
    return 'Configure user.name and user.email in this repository before committing.';
  }
  if (/untracked working tree files|would be overwritten|not uptodate|local changes/iu.test(stderr)) {
    return 'Git protected local files that would be overwritten. Review them before retrying.';
  }
  if (/non-fast-forward|fetch first|not possible to fast-forward|needs force/iu.test(stderr)) {
    return 'Git rejected a non-fast-forward update. Fetch and compare the branch histories.';
  }
  if (/authentication|terminal prompts disabled|could not read username|403|401/iu.test(stderr)) {
    return 'The remote requires credentials or denied access. Phase 03 supports unauthenticated HTTPS only.';
  }
  if (/resolve host|failed to connect|SSL certificate|unable to access|redirect/i.test(stderr)) {
    return 'Git could not reach or verify the HTTPS endpoint. Check the address, network, and certificate.';
  }
  if (/cannot lock|another git process/iu.test(stderr)) {
    return 'Git could not acquire a repository lock. Wait for other Git operations and refresh.';
  }
  return `Git could not complete ${operation}. Refresh to review the current repository state.`;
}

export async function findGit(): Promise<string | null> {
  const folders = windows
    ? [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter((part): part is string => Boolean(part && /^[a-z]:\\/iu.test(part)))
      .map((part) => join(part, 'Git', 'cmd', 'git.exe'))
    : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
  for (const candidate of new Set(folders)) {
    try {
      const executable = await realpath(candidate);
      if ((await lstat(executable)).isFile()) return executable;
    } catch {
      // A conventional system location may be absent on this host.
    }
  }
  return null;
}

interface RunOptions {
  transport?: Transport;
  readOnly?: boolean;
  input?: string;
  limit?: number;
  patch?: boolean;
  accept?: number[];
}

type Output = { bytes: Buffer; truncated: boolean; code: number };

export class NativeGit {
  private constructor(readonly executable: string, readonly scratch: string) {}

  static async open(canUse: (path: string) => boolean): Promise<NativeGit | null> {
    const executable = await findGit();
    if (!executable) return null;
    const temporary = await realpath(tmpdir());
    if (!canUse(executable) || !canUse(temporary)) {
      throw new GitFailure('An open project contains the Git executable or temporary storage. Open a narrower project folder.');
    }
    const scratch = await mkdtemp(join(temporary, 'factory-git-policy-'));
    try {
      await writeFile(join(scratch, 'empty'), '', { flag: 'wx', mode: 0o600 });
      const git = new NativeGit(executable, scratch);
      const version = (await git.run(scratch, ['--version'], { readOnly: true, limit: 256 })).bytes.toString('ascii');
      const parts = /^git version (\d+)\.(\d+)\./u.exec(version);
      if (!parts || Number(parts[1]) < 2 || (Number(parts[1]) === 2 && Number(parts[2]) < 39)) {
        throw new GitFailure('Install Git 2.39 or newer in the supported system location.');
      }
      return git;
    } catch (error) {
      await rm(scratch, { recursive: true, force: true });
      if (error instanceof GitFailure) throw error;
      throw new GitFailure('Studio could not prepare its Git execution policy.');
    }
  }

  async dispose() {
    await rm(this.scratch, { recursive: true, force: true });
  }

  run(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<Output> {
    const empty = join(this.scratch, 'empty');
    const system = windows ? process.env.SystemRoot ?? 'C:\\Windows' : '';
    const env: NodeJS.ProcessEnv = {
      PATH: [dirname(this.executable), ...(windows ? [join(system, 'System32'), system] : ['/usr/bin', '/bin'])].join(delimiter),
      ...(windows ? { SystemRoot: system, WINDIR: system, ComSpec: join(system, 'System32', 'cmd.exe'), PATHEXT: '.EXE;.COM' } : {}),
      HOME: this.scratch,
      USERPROFILE: this.scratch,
      TMP: this.scratch,
      TEMP: this.scratch,
      TMPDIR: this.scratch,
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CEILING_DIRECTORIES: dirname(this.scratch),
      GIT_CONFIG_GLOBAL: empty,
      GIT_CONFIG_SYSTEM: empty,
      GIT_ATTR_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_NO_LAZY_FETCH: '1',
      GIT_OPTIONAL_LOCKS: options.readOnly ? '0' : '1',
      GIT_ALLOW_PROTOCOL: options.transport ?? '',
    };
    // These settings also reach Git's own transport subprocesses.
    const config: [string, string][] = [
      ['core.hooksPath', empty], ['core.fsmonitor', 'false'], ['core.attributesFile', empty],
      ['core.protectNTFS', 'true'], ['core.protectHFS', 'true'], ['core.quotePath', 'true'],
      ['init.templateDir', this.scratch], ['credential.helper', ''], ['http.followRedirects', 'false'],
      ['http.sslVerify', 'true'], ['submodule.recurse', 'false'], ['commit.gpgSign', 'false'],
      ['push.gpgSign', 'false'], ['gc.auto', '0'], ['maintenance.auto', 'false'], ['fetch.writeCommitGraph', 'false'],
      ['merge.autoStash', 'false'], ['push.followTags', 'false'], ['fetch.prune', 'false'],
      ['receive.autogc', 'false'], ['transfer.fsckObjects', 'true'],
    ];
    // Supplying an empty template via --template= avoids copying the scratch files.
    env.GIT_CONFIG_COUNT = String(config.length);
    for (const [index, [key, value]] of config.entries()) {
      env[`GIT_CONFIG_KEY_${index}`] = key;
      env[`GIT_CONFIG_VALUE_${index}`] = value;
    }
    const limit = options.limit ?? 2_000_000;
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['--literal-pathspecs', '--no-pager', ...args], {
        cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let errorSize = 0;
      let truncated = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.transport ? 25_000 : 10_000);
      // The timeout must not leave the request waiting for a transport descendant's pipes.
      const deadline = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        reject(new GitFailure('Git timed out. Refresh before retrying an operation that may have partially completed.'));
      }, (options.transport ? 25_000 : 10_000) + 1500);
      child.stdout.on('data', (bytes: Buffer) => {
        if (size + bytes.length > limit) {
          if (!truncated) stdout.push(bytes.subarray(0, limit - size));
          truncated = true;
          child.kill('SIGKILL');
        } else if (!truncated) {
          stdout.push(bytes);
          size += bytes.length;
        }
      });
      child.stderr.on('data', (bytes: Buffer) => {
        if (errorSize >= 8192) return;
        const kept = bytes.subarray(0, 8192 - errorSize);
        stderr.push(kept);
        errorSize += kept.length;
      });
      child.stdin.on('error', () => undefined);
      child.once('error', () => {
        clearTimeout(timer);
        clearTimeout(deadline);
        reject(new GitFailure('Studio could not start the approved Git executable.'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        clearTimeout(deadline);
        if (timedOut) return reject(new GitFailure('Git timed out. Refresh to review the outcome before retrying.'));
        if (truncated) return options.patch ? resolve({ bytes: Buffer.concat(stdout), truncated: true, code: code ?? -1 })
          : reject(new GitFailure('Git output exceeded the safety limit for this repository.'));
        if (code === null || !(options.accept ?? [0]).includes(code)) {
          const operation = args.find((arg) => !arg.startsWith('--')) ?? 'the operation';
          return reject(new GitCommandFailure(operation, Buffer.concat(stderr).toString('utf8')));
        }
        resolve({ bytes: Buffer.concat(stdout), truncated: false, code });
      });
      child.stdin.end(options.input);
    });
  }

  repo(root: string, args: readonly string[], options: RunOptions = {}) {
    return this.run(root, [`--git-dir=${join(root, '.git')}`, `--work-tree=${root}`, ...args], options);
  }
}
