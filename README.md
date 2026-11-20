# Remember Outline Folds

Remember the expansion/collapse state of Obsidian's core **Outline** for each Markdown note, independently of document folds.

## Fork changes / 本 Fork 的修改

This is a focused fork of [ChrisDavison/obsidian-syncronise-outline-folds](https://github.com/ChrisDavison/obsidian-syncronise-outline-folds), based on upstream 0.2.0 (`c2db77f`).

- **Outline only:** collapsing or expanding the Outline never folds/unfolds the document. Document folds never drive the Outline.
- Restore each note's Outline state after switching notes, reopening the Outline, or restarting the plugin/app. An empty saved state explicitly means **all expanded**.
- Keep upstream's heading identities (level, original title, repeat count), JSON storage, rename/delete handling, event scheduling and checked core Outline adapter.
- Remove document fold restoration, document observers/editor effects, and the extra Outline arrows for headings without children. The command now restores the saved Outline state.
- Cursor, text selection and document scroll restoration remain the job of [Remember Cursor Position](https://github.com/dy-sh/obsidian-remember-cursor-position). Install that plugin separately; its code is not bundled here.

中文说明：本 Fork 只记忆原生大纲的展开/折叠状态，取消与正文折叠的双向同步。折叠大纲不会收起正文，折叠正文也不会改变大纲。保留上游的存储、标题标识及文件重命名处理；光标、选区和正文阅读位置请搭配原版 Remember Cursor Position。

The plugin ID and data format are unchanged to keep the fork small and allow existing saved folds to be reused. **This replaces the upstream plugin; do not run both versions.** Existing upstream data is interpreted as the initial Outline state and no longer applied to the document. Back up the plugin folder before replacing an installation. Community-plugin updates may replace this fork with upstream.

## Use

Enable the **Outline** core plugin, then enable **Remember Outline Folds**. Use the native Outline collapse arrows or its collapse/expand-all control. No replacement Outline, settings or changes to Markdown files are needed. Enabling document heading folding is not required.

The command **Remember Outline Folds: Restore saved outline folds** reapplies the saved state to the current note's Outline. No hotkeys are assigned by default. Multiple Outlines for the active file share state; conflicting changes processed together are resolved in pane order. Outlines for a different file are left alone.

Disabling the plugin removes its listeners and observers and flushes saved data; it does not change document folds.

## Remembered folds

State is saved in `data.json` inside the plugin folder. Heading identities use level, original title and repeat count, so inserting preceding text does not move the state to another heading. Renaming a heading forgets its state; inserting/reordering indistinguishable duplicate headings can change their identities. Nested headings retain their independent collapsed states.

Saved entries follow renamed notes and folders and are removed when notes are deleted. Native automatic changes to the Outline can also be remembered; this fork does not disable Obsidian's own Outline behavior. The Outline's scroll position is not persisted.

## Install manually

Build this fork using the commands below, or use a test build explicitly linked from the fork. Upstream release assets still contain the original two-way synchronisation behavior.

1. Back up your existing `synchronise-outline-folds` plugin folder if present.
2. Copy this fork's `main.js` and `manifest.json` into `<vault>/<config-folder>/plugins/synchronise-outline-folds/` (the default config folder is `.obsidian`).
3. Reload the plugin, then enable **Remember Outline Folds** under **Settings → Community plugins**.
4. Optionally install **Remember Cursor Position** separately for document cursor/scroll restoration.

To roll back, disable the fork and restore the backed-up plugin folder.

## Compatibility and privacy

Requires Obsidian **1.14.4 or newer** (the upstream minimum is retained). Mobile is permitted by the manifest; physical iOS and Android devices have not been tested.

**Compatibility boundary:** Obsidian does not publish a core Outline fold API. `src/compat.ts` checks the internal Outline interfaces before use; unsupported interfaces are skipped with one notice. No core methods or prototypes are patched. Custom Outline replacements, embedded notes and Canvas cards are outside the scope.

No network requests, telemetry or accounts are used. Only this plugin's own `data.json` is written, containing note paths and heading titles; Markdown content is not changed.

## Develop and verify

Use Node.js 22 or newer and npm (CI uses Node.js 24).

```sh
npm ci
npm run check      # ESLint, unit/integration tests, typecheck, build and asset checks
npm run dev        # watch source and rebuild main.js
```

`main.js` is generated and excluded from source control. Existing upstream fold utilities and their tests are retained to minimise unrelated changes; the fork's runtime does not import document-fold operations. Additional tests exercise the actual plugin lifecycle with mocked Obsidian views, including independent document/Outline states, per-note restoration, empty states, multiple Outlines, rebuilds, renames and cleanup.

**Fork verification (2026-11-20):** `npm run check` passed locally (14 tests, lint, typecheck, build and asset checks). Live Obsidian verification has not been completed; test this build in a disposable vault before daily use.

The optional live integration check (`node scripts/live-check.mjs`) requires the disposable vault `/tmp/synchronise-outline-folds-test` with `tests/Folds.md` copied to `Folds.md`, this fork installed, and the core Outline enabled. It refuses other vault paths. It changes test view states, creates `Other.md`, and reloads the plugin. Automated checks do not replace testing in your own Obsidian setup.

## License

[MIT](LICENSE), copyright Chris Davison. Upstream attribution is retained.
