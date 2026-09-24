/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';

export type Kind = 'jj' | 'hg';

export interface Revision {
	id: string;
	parents: string[];
	primary: string;
	prefix: string;
	commitPrefix: string;
	message: string;
	author: string;
	email: string;
	timestamp: number;
	current: boolean;
	immutable: boolean;
	labels: string[];
	states: string[];
}

interface JjCommit {
	commit_id: string;
	change_id: string;
	parents: string[];
	description: string;
	author: { name: string; email: string; timestamp: string };
}

type JjRow = [JjCommit, string, string, boolean, boolean, boolean, boolean, boolean, string[]];

interface HgCommit {
	node: string;
	rev: number;
	parents: string[];
	desc: string;
	user: string;
	date: [number, number];
	phase: string;
	branch: string;
	bookmarks: string[];
	tags: string[];
}

const jjTemplate = '\'[\' ++ json(self) ++ "," ++ json(change_id.shortest().prefix()) ++ "," ++ json(commit_id.shortest().prefix()) ++ "," ++ json(current_working_copy) ++ "," ++ json(immutable) ++ "," ++ json(empty) ++ "," ++ json(conflict) ++ "," ++ json(divergent) ++ "," ++ json(bookmarks.map(|b| b.name())) ++ "]\\n"';

export function run(kind: Kind, root: string, args: string[], signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(kind, kind === 'jj' ? ['--color=never', '--no-pager', ...args] : ['--noninteractive', ...args], {
			cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000, signal,
			env: { ...process.env, HGPLAIN: '1' }
		}, (error, stdout, stderr) => error ? reject(new Error(`${kind}: ${stderr || error.message}`)) : resolve(stdout));
	});
}

export function parseJj(output: string): Revision[] {
	return output.split('\n').filter(Boolean).map(line => {
		const [commit, prefix, commitPrefix, current, immutable, empty, conflict, divergent, labels] = JSON.parse(line) as JjRow;
		return {
			id: commit.commit_id, parents: commit.parents, primary: commit.change_id,
			prefix, commitPrefix, message: commit.description || (empty ? '(empty) (no description set)' : '(no description set)'),
			author: commit.author.name, email: commit.author.email, timestamp: Date.parse(commit.author.timestamp),
			current, immutable, labels,
			states: [empty ? 'empty' : '', conflict ? 'conflict' : '', divergent ? 'divergent' : ''].filter(Boolean)
		};
	});
}

export function parseHg(output: string, current: string): Revision[] {
	return (JSON.parse(output) as HgCommit[]).map(commit => {
		const author = /^(.*?)\s*<([^>]+)>$/.exec(commit.user);
		return {
			id: commit.node, parents: commit.parents.filter(id => !/^0+$/.test(id)),
			primary: String(commit.rev), prefix: String(commit.rev), commitPrefix: '', message: commit.desc,
			author: author?.[1] ?? commit.user, email: author?.[2] ?? '', timestamp: commit.date[0] * 1000,
			current: commit.node === current, immutable: commit.phase === 'public',
			labels: [commit.branch, ...commit.bookmarks, ...commit.tags.filter(tag => tag !== 'tip')],
			states: [commit.phase]
		};
	});
}

export async function history(kind: Kind, root: string, count: number, refs: readonly string[] = [], signal?: AbortSignal): Promise<Revision[]> {
	// Only opaque revision IDs cross from the UI into revision expressions.
	if (refs.some(ref => !/^[a-f0-9]{40,64}$/.test(ref))) {
		throw new Error('Expected full revision IDs');
	}
	if (kind === 'jj') {
		const revisions = refs.length ? `ancestors(${refs.join('|')})` : 'all()';
		return parseJj(await run(kind, root, ['log', '-r', revisions, '--no-graph', '-n', String(count), '-T', jjTemplate], signal));
	}
	const current = await run(kind, root, ['log', '-r', '.', '-T', '{node}'], signal);
	const revisions = refs.length ? `ancestors(${refs.map(ref => `id('${ref}')`).join(' or ')})` : 'all()';
	return parseHg(await run(kind, root, ['log', '-r', `sort(${revisions}, topo)`, '-l', String(count), '-T', 'json'], signal), current.trim());
}

export async function changes(kind: Kind, root: string, id: string, parent?: string, signal?: AbortSignal): Promise<{ path: string; before: boolean; after: boolean }[]> {
	if (kind === 'jj') {
		const args = parent ? ['--from', parent, '--to', id] : ['-r', id];
		const output = await run(kind, root, ['diff', ...args, '-T', '\'[\' ++ json(target.path()) ++ "," ++ json(status) ++ "]\\n"'], signal);
		return output.split('\n').filter(Boolean).map(line => {
			const [path, status] = JSON.parse(line) as [string, string];
			return { path, before: status !== 'added', after: status !== 'removed' };
		});
	}
	const args = parent ? ['--rev', parent, '--rev', id] : ['--change', id];
	const output = await run(kind, root, ['status', ...args, '-T', 'json'], signal);
	return (JSON.parse(output) as { path: string; status: string }[]).map(entry => ({ path: entry.path, before: entry.status !== 'A', after: entry.status !== 'R' }));
}

export function file(kind: Kind, root: string, id: string, path: string, signal?: AbortSignal): Promise<string> {
	return run(kind, root, kind === 'jj' ? ['file', 'show', '-r', id, '--', `root-file:${path}`] : ['cat', '-r', id, '--', path], signal);
}
