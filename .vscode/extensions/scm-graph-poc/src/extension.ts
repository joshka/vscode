/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';
import * as vscode from 'vscode';
import { changes, file, history, Kind, Revision } from './backend';

class HistoryProvider implements vscode.SourceControlHistoryProvider, vscode.Disposable {
	private readonly currentChanged = new vscode.EventEmitter<void>();
	private readonly refsChanged = new vscode.EventEmitter<vscode.SourceControlHistoryItemRefsChangeEvent>();
	readonly onDidChangeCurrentHistoryItemRefs = this.currentChanged.event;
	readonly onDidChangeHistoryItemRefs = this.refsChanged.event;
	currentHistoryItemRef: vscode.SourceControlHistoryItemRef | undefined;
	readonly currentHistoryItemRemoteRef = undefined;
	readonly currentHistoryItemBaseRef = undefined;
	private refs: vscode.SourceControlHistoryItemRef[] = [];
	private readonly revisions = new Map<string, Revision>();
	private readonly scm: vscode.SourceControl;

	constructor(readonly kind: Kind, readonly root: vscode.Uri) {
		this.scm = vscode.scm.createSourceControl(`poc-${kind}`, kind === 'jj' ? 'Jujutsu (PoC)' : 'Mercurial (PoC)', root);
		this.scm.inputBox.visible = false;
		this.scm.historyProvider = this;
	}

	async refresh(): Promise<void> {
		const revisions = await history(this.kind, this.root.fsPath, 200);
		this.revisions.clear();
		for (const revision of revisions) { this.revisions.set(revision.id, revision); }
		const current = revisions.find(revision => revision.current);
		const parents = new Set(revisions.flatMap(revision => revision.parents));
		const previous = this.refs;
		this.refs = revisions.filter(revision => !parents.has(revision.id) || revision.current || revision.labels.length > 0).map(revision => ({
			id: revision.id, revision: revision.id, name: revision.labels.join(', ') || (revision.current ? '@' : revision.primary.slice(0, 8)),
			category: revision.current ? 'Working copy' : 'Heads and bookmarks', icon: new vscode.ThemeIcon(revision.current ? 'target' : 'git-branch')
		}));
		this.currentHistoryItemRef = current ? this.refs.find(ref => ref.id === current.id) : this.refs[0];
		this.currentChanged.fire();
		this.refsChanged.fire({ added: this.refs, removed: previous, modified: [], silent: false });
	}

	provideHistoryItemRefs(ids: string[] | undefined): vscode.SourceControlHistoryItemRef[] {
		return ids ? this.refs.filter(ref => ids.includes(ref.id)) : this.refs;
	}

	async provideHistoryItems(options: vscode.SourceControlHistoryOptions, token: vscode.CancellationToken): Promise<vscode.SourceControlHistoryItem[]> {
		const skip = options.skip ?? 0;
		const limit = typeof options.limit === 'number' ? options.limit : 50;
		const rows = await this.withCancellation(token, signal => history(this.kind, this.root.fsPath, skip + limit, options.historyItemRefs, signal));
		for (const row of rows) { this.revisions.set(row.id, row); }
		return rows.slice(skip).filter(row => !options.filterText || `${row.message} ${row.author} ${row.primary}`.toLowerCase().includes(options.filterText.toLowerCase())).map(row => this.item(row));
	}

	resolveHistoryItem(id: string): vscode.SourceControlHistoryItem | undefined {
		const revision = this.revisions.get(id);
		return revision ? this.item(revision) : undefined;
	}

	async provideHistoryItemChanges(id: string, parent: string | undefined, token: vscode.CancellationToken): Promise<vscode.SourceControlHistoryItemChange[]> {
		const revision = this.revisions.get(id);
		const base = parent ?? revision?.parents[0];
		const entries = await this.withCancellation(token, signal => changes(this.kind, this.root.fsPath, id, base, signal));
		return entries.map(entry => ({
			uri: vscode.Uri.joinPath(this.root, entry.path),
			originalUri: entry.before && base ? this.contentUri(base, entry.path) : undefined,
			modifiedUri: entry.after ? this.contentUri(id, entry.path) : undefined
		}));
	}

	resolveHistoryItemChatContext(id: string): string | undefined { return this.revisions.get(id)?.message; }
	resolveHistoryItemChangeRangeChatContext(): undefined { return undefined; }
	resolveHistoryItemRefsCommonAncestor(): undefined { return undefined; }

	private contentUri(id: string, path: string): vscode.Uri {
		return vscode.Uri.joinPath(this.root, path).with({ scheme: 'scm-graph-poc', query: JSON.stringify({ root: this.root.fsPath, kind: this.kind, id, path }) });
	}

	private async withCancellation<T>(token: vscode.CancellationToken, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		const subscription = token.onCancellationRequested(() => controller.abort());
		try {
			if (token.isCancellationRequested) { controller.abort(); }
			return await task(controller.signal);
		} finally { subscription.dispose(); }
	}

	private item(revision: Revision): vscode.SourceControlHistoryItem {
		const primary = revision.primary.slice(0, Math.max(8, revision.prefix.length));
		const commit = revision.id.slice(0, Math.max(8, revision.commitPrefix.length));
		const runs = (text: string, prefix: string, color: string): vscode.SourceControlHistoryItemIdentifierPart[] => [
			{ text: text.slice(0, prefix.length), color: new vscode.ThemeColor(color) },
			{ text: text.slice(prefix.length), color: new vscode.ThemeColor('descriptionForeground') }
		];
		const description = revision.message.trimEnd();
		const hover = new vscode.MarkdownString('', true);
		hover.appendText(`${revision.author}${revision.email ? ` <${revision.email}>` : ''}\n${new Date(revision.timestamp).toLocaleString()}\n\n${description}`);
		const footer = new vscode.MarkdownString('', true);
		footer.isTrusted = { enabledCommands: ['scmGraphPoc.copy'] };
		footer.appendMarkdown(`[${primary}](command:scmGraphPoc.copy?${encodeURIComponent(JSON.stringify([revision.primary]))} "Copy primary identifier") $(git-commit) [${commit}](command:scmGraphPoc.copy?${encodeURIComponent(JSON.stringify([revision.id]))} "Copy commit identifier")`);
		return {
			id: revision.id, parentIds: revision.parents, subject: description.split('\n')[0], message: description,
			author: revision.author, authorEmail: revision.email, timestamp: revision.timestamp, displayId: primary,
			tooltip: [hover, footer],
			identifier: [
				...runs(primary, revision.prefix, 'terminal.ansiMagenta'),
				{ text: ' ' },
				...runs(commit, revision.commitPrefix, 'terminal.ansiBlue')
			]
		};
	}

	dispose(): void { this.scm.dispose(); this.currentChanged.dispose(); this.refsChanged.dispose(); }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const providers: HistoryProvider[] = [];
	const output = vscode.window.createOutputChannel('SCM Graph PoC', { log: true });
	context.subscriptions.push(output);
	const refresh = async () => {
		for (const provider of providers) {
			try { await provider.refresh(); } catch (error) { output.error(String(error)); }
		}
	};
	context.subscriptions.push(vscode.commands.registerCommand('scmGraphPoc.refresh', refresh));
	context.subscriptions.push(vscode.commands.registerCommand('scmGraphPoc.toggleIdentifiers', async () => {
		const config = vscode.workspace.getConfiguration('scm.graph.experimental');
		await config.update('showIdentifiers', !config.get<boolean>('showIdentifiers', false), vscode.ConfigurationTarget.Global);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('scmGraphPoc.copy', (value: string) => vscode.env.clipboard.writeText(value)));
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('scm-graph-poc', {
		provideTextDocumentContent: async (uri, token) => {
			const request = JSON.parse(uri.query) as { root: string; kind: Kind; id: string; path: string };
			if (!providers.some(provider => provider.root.fsPath === request.root && provider.kind === request.kind)) { throw new Error('Unknown SCM repository'); }
			if (token.isCancellationRequested) { return ''; }
			return file(request.kind, request.root, request.id, request.path);
		}
	}));
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const kind = existsSync(vscode.Uri.joinPath(folder.uri, '.jj').fsPath) ? 'jj' : existsSync(vscode.Uri.joinPath(folder.uri, '.hg').fsPath) ? 'hg' : undefined;
		if (kind) {
			const provider = new HistoryProvider(kind, folder.uri);
			context.subscriptions.push(provider);
			providers.push(provider);
		}
	}
	await refresh();
}
