# Native SCM identifier sample

This companion sample exercises the `scmHistoryItemIdentifier` proposal with
real jj and Mercurial repositories. It is deliberately separate from the
upstream core PR. It does not ship with VS Code or modify its Git extension.

## Run

Install `jj` and `hg` on PATH, then build from this branch:

```sh
npm run compile-client
npx tsc -p .vscode/extensions/scm-graph-poc
node --test .vscode/extensions/scm-graph-poc/out/backend.test.js
node .vscode/extensions/scm-graph-poc/out/demo.js
```

The last command prints a disposable workspace containing both repositories.
Open that workspace:

```sh
./scripts/code.sh \
  --extensionDevelopmentPath="$PWD/.vscode/extensions/scm-graph-poc" \
  --enable-proposed-api=vscode-samples.scm-graph-poc /path/to/demo.code-workspace
```

Select Jujutsu (PoC) or Mercurial (PoC) in the native Source Control Graph
repository picker. Run **SCM Graph PoC: Toggle Experimental Identifiers** to
enable or disable `scm.graph.experimental.showIdentifiers`. It is off by
default.

jj shows a change ID and commit ID with provider-selected unique-prefix colors.
Mercurial shows a numeric revision and changeset hash. Both retain native
subject labels, graph geometry, selection, workbench hovers, and revision-backed
diffs. Hover the subject for details, or an identifier to read its untruncated
text. Git stays unchanged with the setting both on and off.

## Review scope

The first core PR only adds optional identifier text runs and their gates. It
does not implement custom node markers, multiline rows, or graph projection. The
larger prototype demonstrated those as possible follow-ups, not features of this
patch.

Suggested independent follow-ups for
[the original issue](https://github.com/microsoft/vscode/issues/314007):

1. Provider-defined immutable and working-copy markers with accessible labels.
2. Structured descriptions and references in bounded multiline rows.
3. Explicit visible-ancestor edges for elided history, separate from direct
   parents and diff targets.

Each requires its own tests and API review. No automatic Git-to-jj detection is
proposed.

## Sample limitations

This is a read-only history sample, not a production SCM extension. Discovery is
limited to workspace roots; use **SCM Graph PoC: Refresh** after edits.
Reference discovery is bounded to 200 revisions. Pagination uses fresh offset
queries, and text filtering applies to the current page. Search, common-ancestor
resolution, rename-aware diff paths, binary previews, resource groups, and write
operations are not implemented. Merge diffs use the selected parent, or the
first parent by default.

The proposal must first land in VS Code before a corresponding Insiders build
can run this sample without building from sources. Proposed APIs are not
generally available to Marketplace extensions; testers can use a shared VSIX
with explicit proposal enablement in Insiders.
