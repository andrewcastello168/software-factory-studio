import { GIT_LIMIT } from '@factory/contracts';
import type { GitDiff } from '@factory/contracts';

export const patchArgs = ['--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all'];
export const patchOptions = { readOnly: true, limit: GIT_LIMIT.patch, patch: true };

export function patchResult({ bytes, truncated }: { bytes: Buffer; truncated: boolean }): GitDiff {
  const sanitized = bytes.toString('utf8').replace(/(?![\t\n])[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => character === '\r' ? '' : `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`);
  const lines = sanitized.split('\n', 3001);
  return {
    text: lines.slice(0, 3000).join('\n').slice(0, GIT_LIMIT.patch),
    truncated: truncated || sanitized.length > GIT_LIMIT.patch || lines.length > 3000,
  };
}
