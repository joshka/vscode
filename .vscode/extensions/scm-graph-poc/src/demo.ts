/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { run } from './backend';

async function main(): Promise<void> {
	const build = resolve('.build');
	await mkdir(build, { recursive: true });
	const root = await mkdtemp(join(build, 'scm-graph-demo-'));
	const jj = join(root, 'jujutsu');
	const hg = join(root, 'mercurial');
	await mkdir(jj);
	await mkdir(hg);
	await run('jj', jj, ['git', 'init', '--colocate']);
	await run('jj', jj, ['config', 'set', '--repo', 'signing.behavior', 'drop']);
	await writeFile(join(jj, 'example.txt'), 'Shared base\n');
	await run('jj', jj, ['describe', '-m', 'Create shared base']);
	await run('jj', jj, ['bookmark', 'create', 'main']);
	await run('jj', jj, ['new', '-m', 'Add a native graph provider']);
	await writeFile(join(jj, 'example.txt'), 'Shared base\nNative graph provider\n');
	await run('jj', jj, ['bookmark', 'create', 'native-graph']);
	await run('jj', jj, ['new', 'main', '-m', 'Explore alternative graph projection']);
	await writeFile(join(jj, 'projection.txt'), 'Visible ancestors are not necessarily parents.\n');
	await run('jj', jj, ['bookmark', 'create', 'graph-projection']);
	await run('jj', jj, ['new']);
	await run('hg', hg, ['init']);
	await writeFile(join(hg, 'example.txt'), 'Shared base\n');
	await run('hg', hg, ['add', 'example.txt']);
	await run('hg', hg, ['commit', '-u', 'Example <example@example.com>', '-m', 'Create shared base']);
	await run('hg', hg, ['phase', '--public', '-r', '.']);
	await run('hg', hg, ['branch', 'native-graph']);
	await writeFile(join(hg, 'example.txt'), 'Shared base\nNative graph provider\n');
	await run('hg', hg, ['commit', '-u', 'Example <example@example.com>', '-m', 'Show draft changes and numeric revision IDs']);
	await run('hg', hg, ['bookmark', 'review']);
	const workspace = join(root, 'demo.code-workspace');
	await writeFile(workspace, JSON.stringify({ folders: [{ path: jj }, { path: hg }], settings: { 'scm.defaultViewMode': 'tree' } }, null, 2));
	console.log(workspace);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
