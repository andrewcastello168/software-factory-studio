import { execFile } from 'node:child_process';
import { access, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { checkedDirectory, pathKey } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { readDirectory } from '../incremental/files';
import { findGit } from '../git/process';

export const windows = process.platform === 'win32';
export const system = process.env.SystemRoot ?? 'C:\\Windows';
const systemPaths = windows ? [join(system, 'System32'), system] : ['/usr/bin', '/bin'];
const programFiles = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
  .filter((path): path is string => Boolean(path && isAbsolute(path)));

export function baseEnvironment(paths: string[] = []): NodeJS.ProcessEnv {
  const keys = ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TMP', 'TEMP', 'TMPDIR', 'SystemDrive', 'NUMBER_OF_PROCESSORS'];
  return {
    ...Object.fromEntries(keys.filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
    ...(windows ? { SystemRoot: system, WINDIR: system, ComSpec: join(system, 'System32', 'cmd.exe'), PATHEXT: '.EXE;.COM' } : {}),
    PATH: [...new Set([...paths, ...systemPaths])].join(delimiter), LANG: 'C', LC_ALL: 'C',
  };
}

async function executable(path: string, allowed: (path: string) => boolean) {
  try {
    if (!isAbsolute(path) || !allowed(path)) return null;
    const canonical = await realpath(path);
    if (!allowed(canonical) || !(await lstat(canonical)).isFile()) return null;
    if (!windows) await access(canonical, constants.X_OK);
    return canonical;
  } catch { return null; }
}

export async function openTool(name: 'node' | 'go' | 'gofmt' | 'govulncheck' | 'code' | 'terminal' | 'taskkill', allowed: (path: string) => boolean, selected?: string) {
  const filename = name + (windows ? '.exe' : '');
  const candidates = name === 'gofmt' && selected ? [selected] : name === 'terminal'
    ? windows ? [join(system, 'System32', 'cmd.exe')] : ['/usr/bin/gnome-terminal', '/usr/bin/konsole', '/usr/bin/xfce4-terminal', '/usr/bin/xterm']
    : name === 'taskkill' ? [join(system, 'System32', 'taskkill.exe')]
      : name === 'code' ? selected ? [selected]
        : windows ? [...programFiles.map((path) => join(path, 'Microsoft VS Code', 'Code.exe')),
          ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')] : [])]
          : ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
        : [...(process.env.PATH ?? '').split(delimiter).filter((path) => isAbsolute(path)).map((path) => join(path, filename)),
          ...programFiles.map((path) => name === 'node' ? join(path, 'nodejs', filename) : join(path, 'Go', 'bin', filename)),
          ...(name === 'go' || name === 'gofmt' ? ['/usr/local/go/bin/' + name] : [])];
  for (const path of new Set(candidates)) {
    const target = await executable(path, allowed);
    if (target) return { target, launcher: path };
  }
  return null;
}

export async function toolVersion(tool: string, args: string[], allowed: (path: string) => boolean, paths: string[] = []) {
  try {
    const cwd = await realpath(tmpdir());
    if (!allowed(cwd) || !allowed(tool) || args.some((arg) => isAbsolute(arg) && !allowed(arg))) return null;
    const { stdout } = await promisify(execFile)(tool, args, {
      cwd, env: { ...baseEnvironment(paths), GOTOOLCHAIN: 'local', GOENV: 'off' }, timeout: 3500, maxBuffer: 4096, windowsHide: true,
    });
    return /(?:^|\s)(?:v|go)?(\d+\.\d+\.\d+)(?:[-.\s]|$)/u.exec(stdout)?.[1] ?? null;
  } catch { return null; }
}

export async function pnpmScript(node: { target: string; launcher: string } | null, allowed: (path: string) => boolean) {
  if (!node) return null;
  const paths = [dirname(node.launcher), ...(process.env.PATH ?? '').split(delimiter).filter((path) => isAbsolute(path)),
    join(homedir(), 'AppData', 'Roaming', 'npm')];
  for (const path of new Set(paths)) {
    for (const candidate of [join(path, 'pnpm'), join(path, '..', 'pnpm', 'bin', 'pnpm.cjs'), join(path, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')]) {
      try {
        if (!allowed(candidate)) continue;
        const script = await realpath(candidate);
        if (allowed(script) && script.endsWith('pnpm.cjs') && (await lstat(script)).isFile()) return script;
      } catch { /* Absent from this installation. */ }
    }
  }
  return null;
}

export async function dependencyBin(root: ProjectRoot, name: 'vite' | 'typescript' | 'eslint') {
  const modules = await readDirectory(root, 'node_modules');
  if (!modules) return null;
  const script = await realpath(join(modules.path, name, 'bin', { vite: 'vite.js', typescript: 'tsc', eslint: 'eslint.js' }[name]));
  const within = relative(pathKey(modules.path), pathKey(script));
  if (!within || within.startsWith('..') || isAbsolute(within) || !(await lstat(script)).isFile()) return null;
  await checkedDirectory(modules.path, modules.identity);
  return script;
}

export async function inspectToolchain(
  allowed: (path: string) => boolean,
  requirements: { node?: string | null; pnpm?: string | null; go?: string | null } = {},
  probe = true,
) {
  const [node, go, gitCandidate] = await Promise.all([openTool('node', allowed), openTool('go', allowed), findGit()]);
  const git = gitCandidate && allowed(gitCandidate) ? gitCandidate : null;
  const pnpm = await pnpmScript(node, allowed);
  const targets = [
    { name: 'Git', executable: git, args: ['--version'], required: '2.39 or newer' },
    { name: 'Node.js', executable: node?.target ?? null, args: ['--version'], required: requirements.node ?? null },
    { name: 'pnpm', executable: node?.target ?? null, args: pnpm ? [pnpm, '--version'] : [], required: requirements.pnpm ?? null },
    { name: 'Go', executable: go?.target ?? null, args: ['version'], required: requirements.go ?? null },
  ] as const;
  const tools = await Promise.all(targets.map(async ({ name, executable, args, required }) => ({
    name, executable: name === 'pnpm' ? pnpm : executable, required,
    version: probe && executable && args.length ? await toolVersion(executable, [...args], allowed, [dirname(executable)]) : null,
  })));
  return { tools, node, go, pnpm };
}
