import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tables } from '../server/features/crud/contracts.ts';
import { InvalidInput, listOptions, recordBody } from '../server/features/crud/validation.ts';

test('rejects unbounded pagination and unknown record fields', () => {
  assert.throws(() => listOptions({ limit: '1000' }), InvalidInput);
  for (const table of tables) assert.throws(() => recordBody(table, { '$unknown': true }, false), InvalidInput);
});
