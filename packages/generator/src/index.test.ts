import { describe, expect, it } from 'vitest';
import { isGeneratorPath, isStarterConfig, STARTER } from '@factory/contracts';
import type { StarterConfig } from '@factory/contracts';
import { planProject, sha256 } from './index';

const id = 'c9003316-9dd8-4750-a358-0949873a010e';
const config: StarterConfig = {
  name: 'Client café', slug: 'client-cafe', port: 4108,
  appType: STARTER.appType, stack: STARTER.stack, architecture: STARTER.architecture, engineering: STARTER.engineering,
};

describe('built-in starter plans', () => {
  it('renders reproducible bytes, metadata, toolchain locks, and file fingerprints', () => {
    const one = planProject(config, id);
    const two = planProject({ ...config, port: 4108 }, id);
    expect(one).toEqual(two);
    const paths = Object.fromEntries(one.files.map((file) => [file.path, file]));
    expect(paths['AGENTS.md']?.content).toContain('# Client café');
    expect(paths['web/main.tsx']?.content).toContain('{"Client café"}');
    expect(paths['.env.example']?.content).toContain('PORT=4108');
    expect(paths['pnpm-lock.yaml']?.content).toContain('lockfileVersion:');
    expect(JSON.parse(paths['.factory/project.json']!.content)).toMatchObject({ id, name: config.name, stackId: STARTER.stack });
    const manifest = JSON.parse(paths['.factory/generation-manifest.json']!.content) as {
      files: { path: string; sha256: string }[];
    };
    expect(manifest.files).toHaveLength(one.files.length - 1);
    for (const file of manifest.files) expect(file.sha256).toBe(sha256(paths[file.path]!.content));
    expect(planProject({ ...config, port: 4109 }, id).digest).not.toBe(one.digest);
  });

  it('rejects unsupported profiles, unsafe names, reserved folders, and ambiguous paths', () => {
    for (const changes of [{ slug: '../outside' }, { slug: 'nul' }, { slug: 'A-Path' }, { name: '<script>' },
      { port: 22 }, { stack: 'future' }, { extra: 'field' }]) {
      expect(isStarterConfig({ ...config, ...changes })).toBe(false);
    }
    for (const path of ['../outside', 'x/../outside', 'x/CON.log', '/etc', '.git/config', 'x:a', 'web\\outside']) {
      expect(isGeneratorPath(path)).toBe(false);
    }
  });
});
