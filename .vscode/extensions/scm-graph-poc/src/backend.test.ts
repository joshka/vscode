/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { changes, file, history, run } from './backend';

test('jj: working copy, immutable parent, escaped description and revision contents', async () => {
	const root = await mkdtemp(join(tmpdir(), 'scm-graph-jj-'));
	try {
		await run('jj', root, ['git', 'init']);
		await run('jj', root, ['config', 'set', '--repo', 'signing.behavior', 'drop']);
		await writeFile(join(root, 'example.txt'), 'first\n');
		await run('jj', root, ['describe', '-m', 'Description with\ttab and "quotes"\n\nBody']);
		const initial = (await history('jj', root, 10)).find(row => row.current)!;
		await run('jj', root, ['new', '-m', 'Second']);
		await writeFile(join(root, 'example.txt'), 'second\n');
		const rows = await history('jj', root, 10);
		assert.deepEqual({ parent: rows[0].parents[0], message: rows[1].message.trimEnd(), content: await file('jj', root, initial.id, 'example.txt') }, {
			parent: initial.id, message: 'Description with\ttab and "quotes"\n\nBody', content: 'first\n'
		});
		assert.deepEqual(await changes('jj', root, rows[0].id, initial.id), [{ path: 'example.txt', before: true, after: true }]);
		assert.equal(rows.at(-1)?.immutable, true);
		assert.deepEqual((await history('jj', root, 1)).map(row => row.id), [rows[0].id]);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Mercurial: numeric revisions, hashes, phases and revision contents', async () => {
	const root = await mkdtemp(join(tmpdir(), 'scm-graph-hg-'));
	try {
		await run('hg', root, ['init']);
		await writeFile(join(root, 'example.txt'), 'first\n');
		await run('hg', root, ['add', 'example.txt']);
		await run('hg', root, ['commit', '-u', 'Example <example@example.com>', '-m', 'First\n\nBody']);
		await run('hg', root, ['phase', '--public', '-r', '.']);
		await writeFile(join(root, 'example.txt'), 'second\n');
		await run('hg', root, ['commit', '-u', 'Example <example@example.com>', '-m', 'Second']);
		const rows = await history('hg', root, 10);
		assert.deepEqual(rows.map(row => ({ primary: row.primary, current: row.current, states: row.states, immutable: row.immutable })), [
			{ primary: '1', current: true, states: ['draft'], immutable: false },
			{ primary: '0', current: false, states: ['public'], immutable: true }
		]);
		assert.deepEqual(await changes('hg', root, rows[0].id, rows[1].id), [{ path: 'example.txt', before: true, after: true }]);
		assert.equal(await file('hg', root, rows[1].id, 'example.txt'), 'first\n');
		assert.deepEqual((await history('hg', root, 10, [rows[1].id])).map(row => row.primary), ['0']);
	} finally { await rm(root, { recursive: true, force: true }); }
});
