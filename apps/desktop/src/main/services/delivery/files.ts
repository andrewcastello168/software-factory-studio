import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { isProjectSegment } from '@factory/contracts';
import { sha256 } from '@factory/generator';
import { checkedDirectory, pathKey, readBoundedFile, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { scanProject } from '../projects/scan';
import { readDirectory } from '../incremental/files';

export const archiveLimit = 96 * 1024 * 1024;
export const shaBytes = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export async function safeBytes(root: ProjectRoot, path: string, limit: number) {
  if (!path.split('/').every(isProjectSegment)) throw new Error('Unsafe delivery input.');
  const parent = await readDirectory(root, dirname(path).split(sep).join('/'));
  if (!parent) throw new Error('Missing delivery input.');
  const name = basename(path);
  return withDirectory(parent.path, parent.identity, async (opened) => {
    const file = join(opened, name);
    const stat = await lstat(file, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || pathKey(await realpath(file)) !== pathKey(join(parent.path, name))) {
      throw new Error('Unsafe delivery input.');
    }
    return readBoundedFile(file, stat, limit, (bytes) => bytes);
  });
}

export async function sourceSnapshot(root: ProjectRoot) {
  const scan = await scanProject(root, ['dist']);
  if (scan.partial || scan.entries.length > 1800 || scan.entries.some(({ kind }) => kind === 'link')) {
    throw new Error('The source inventory is incomplete or contains links.');
  }
  const paths = scan.entries.filter(({ kind }) => kind === 'file').map(({ path }) => path).sort();
  let total = 0;
  const hashes: [string, string][] = [];
  for (const path of paths) {
    const bytes = await safeBytes(root, path, 12 * 1024 * 1024);
    total += bytes.length;
    if (total > 48 * 1024 * 1024) throw new Error('The source inventory exceeds the verification limit.');
    hashes.push([path, shaBytes(bytes)]);
  }
  await checkedDirectory(root.path, root.identity);
  return { digest: sha256(JSON.stringify(hashes)), paths };
}

export interface Payload { path: string; bytes: Buffer; executable?: true }
function beneath(root: ProjectRoot, path: string) { return relative(root.path, path).split(sep).join('/'); }
const textSecret = /(?:-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_|github_pat_|AKIA)[a-z0-9_]{16,}|(?:postgres(?:ql)?|https?):\/\/[^\s:@/]+:[^\s@/]{5,}@)/iu;

export async function builtFiles(root: ProjectRoot, go: boolean): Promise<Payload[]> {
  const output = await readDirectory(root, 'dist');
  if (!output) throw new Error('Build output is missing.');
  const scan = await scanProject(output);
  if (scan.partial || scan.entries.some(({ kind }) => kind === 'link') || scan.entries.length > 480) {
    throw new Error('Build output has an incomplete or unsafe inventory.');
  }
  const extension = process.platform === 'win32' ? '.exe' : '';
  const binaries = new Set(['factory-server', 'factory-migrate'].map((name) => name + extension));
  const all = scan.entries.filter(({ kind }) => kind === 'file').map(({ path }) => path).sort();
  const javascript = /^server\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.js$/u;
  const web = /^web\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:html|css|js|mjs|svg|png|ico|webp|woff2)$/u;
  if (!all.includes('web/index.html') || (!go && !all.includes('server/server.js'))
    || (go && [...binaries].some((name) => !all.includes(name)))) throw new Error('Expected production outputs are missing.');
  const files: Payload[] = [];
  let total = 0;
  for (const path of all) {
    const binary = go && binaries.has(path);
    if (!(binary || web.test(path) || (!go && javascript.test(path)))) throw new Error('Build output contains an unexpected file.');
    const bytes = await safeBytes(output, path, binary ? 38 * 1024 * 1024 : 12 * 1024 * 1024);
    total += bytes.length;
    if (total > archiveLimit - 1024 * 1024 || (!binary && textSecret.test(bytes.toString('utf8')))) {
      throw new Error('Build output is oversized or matches a credential pattern.');
    }
    files.push({ path: beneath(root, join(output.path, path)), bytes, ...(binary ? { executable: true as const } : {}) });
  }
  return files;
}

export function payloadDigest(files: Payload[]) {
  return sha256(JSON.stringify(files.map(({ path, bytes, executable }) => [path, shaBytes(bytes), Boolean(executable)])));
}

export function safePackText(bytes: Buffer) {
  if (textSecret.test(bytes.toString('utf8'))) throw new Error('Packaged text matches a credential pattern.');
  return bytes;
}

export function tar(files: Payload[]): Buffer {
  const blocks: Buffer[] = [];
  for (const { path, bytes, executable } of files) {
    if (!/^[a-zA-Z0-9._/-]{1,100}$/u.test(path) || !path.split('/').every(isProjectSegment)) {
      throw new Error('Release contains an unsupported archive path.');
    }
    const header = Buffer.alloc(512);
    header.write(path, 0, 100, 'ascii');
    header.write(executable ? '0000755\0' : '0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.fill(32, 148, 156);
    header.write('0', 156, 'ascii');
    header.write('ustar\0' + '00', 257, 'ascii');
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    blocks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const size = blocks.reduce((total, block) => total + block.length, 0);
  if (size > archiveLimit) throw new Error('Release exceeds the archive limit.');
  return Buffer.concat(blocks, size);
}

export async function revisionSnapshot(root: ProjectRoot, git: import('@factory/contracts').GitState) {
  if (git.state !== 'repository' && git.state !== 'not-repository') throw new Error('Git context is unavailable.');
  const inventory = await sourceSnapshot(root);
  const branch = git.state === 'repository' ? git.branch : null;
  const head = git.state === 'repository' ? git.head : null;
  const identity = git.state === 'repository' ? [git.repositoryId, git.worktreeId, branch, head, git.operation, git.revision] : ['unversioned'];
  return { ...inventory, source: sha256(JSON.stringify([root, identity, inventory.digest])), head };
}
