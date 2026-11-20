import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

const bundle = buildSync({ entryPoints: ['src/main.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0]!.text;
const headings = () => [
  { heading: 'Parent', level: 1, position: { start: { line: 0 }, end: { line: 0 } } },
  { heading: 'Child', level: 2, position: { start: { line: 3 }, end: { line: 3 } } },
  { heading: 'Detail', level: 3, position: { start: { line: 6 }, end: { line: 6 } } },
  { heading: 'Parent', level: 1, position: { start: { line: 9 }, end: { line: 9 } } },
  { heading: 'Detail', level: 2, position: { start: { line: 12 }, end: { line: 12 } } },
];
type Cache = ReturnType<typeof headings>;
type File = { path: string };
function outline(file: File, cache: Cache = headings()) {
  const items = cache.map((heading, index) => ({
    heading, collapsed: false, collapsible: (cache[index + 1]?.level ?? 0) > heading.level,
    vChildren: { children: [] as unknown[] },
    setCollapsed(value: boolean) { this.collapsed = value; },
    setCollapsible(value: boolean) { this.collapsible = value; },
  }));
  return { file, containerEl: { win: { MutationObserver: class { observe() {} disconnect() {} } } }, cachedHeadingDom: items };
}

async function harness(data: unknown = null) {
  const cleanup: (() => void)[] = [];
  const events = new Map<string, (...args: unknown[]) => void>();
  const pending = new Map<number, () => void>();
  const writes: unknown[] = [];
  const notices: string[] = [];
  let sequence = 0;
  class MarkdownView { file: File = { path: 'a.md' }; documentFolds = [99]; }
  const document = new MarkdownView();
  const files = new Map<string, File>([['a.md', document.file], ['b.md', { path: 'b.md' }]]);
  const caches = new Map<string, Cache>([...files.keys()].map(path => [path, headings()]));
  const first = outline(document.file, caches.get('a.md'));
  const leaves = [{ view: first }];
  const app = {
    workspace: {
      activeEditor: document,
      getMostRecentLeaf: () => ({ view: document }),
      getActiveViewOfType: () => document,
      getLeavesOfType: () => leaves,
      on: (name: string, callback: (...args: unknown[]) => void) => events.set(name, callback),
      onLayoutReady: (callback: () => void) => callback(),
    },
    metadataCache: { getFileCache: (file: File) => ({ headings: caches.get(file.path) }), on: () => {} },
    vault: {
      getFileByPath: (path: string) => files.get(path),
      on: (name: string, callback: (...args: unknown[]) => void) => events.set(name, callback),
    },
  };
  class Plugin {
    app = app;
    async loadData() { return data; }
    async saveData(value: unknown) { writes.push(JSON.parse(JSON.stringify(value))); }
    registerEvent() {}
    register(callback: () => void) { cleanup.push(callback); }
    addCommand() {}
  }
  const module = { exports: {} };
  runInNewContext(bundle, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.equal(name, 'obsidian', 'Runtime must not load document-fold dependencies');
      return { Plugin, MarkdownView, TFile: class {}, Notice: class { constructor(message: string) { notices.push(message); } },
        debounce: (callback: () => void) => Object.assign(() => {}, { run: callback }) };
    },
    window: { setTimeout: (callback: () => void) => { pending.set(++sequence, callback); return sequence; }, clearTimeout: (id: number) => pending.delete(id) },
    console,
  });
  const Constructor = (module.exports as { default: new () => { onload(): Promise<void>; synchronise(): void } }).default;
  const plugin = new Constructor();
  await plugin.onload();
  const run = () => plugin.synchronise();
  const switchFile = (path: string) => {
    document.file = files.get(path)!;
    Object.assign(first, outline(document.file, caches.get(path)));
    run();
  };
  return { run, switchFile, first, leaves, document, files, caches, events, pending, notices,
    stop: () => cleanup.forEach(callback => callback()), writes };
}

void test('Outline folds are independent of document folds, including nested and duplicate headings', async () => {
  const h = await harness();
  h.run();
  assert.equal(h.first.cachedHeadingDom[0]!.collapsed, false);
  h.first.cachedHeadingDom[0]!.collapsed = true;
  h.first.cachedHeadingDom[1]!.collapsed = true;
  h.run();
  assert.deepEqual(h.document.documentFolds, [99]);
  h.document.documentFolds = [0, 3, 9];
  h.run();
  assert.equal(h.first.cachedHeadingDom[3]!.collapsed, false);
  h.switchFile('b.md');
  assert.ok(h.first.cachedHeadingDom.every(item => !item.collapsed));
  h.switchFile('a.md');
  assert.equal(h.first.cachedHeadingDom[0]!.collapsed, true);
  assert.equal(h.first.cachedHeadingDom[1]!.collapsed, true);
  assert.equal(h.first.cachedHeadingDom[3]!.collapsed, false);
  h.stop();
});

void test('saved empty states override native collapse defaults and survive reload', async () => {
  const h = await harness({ folds: { 'a.md': [] } });
  h.first.cachedHeadingDom[0]!.collapsed = true;
  h.run();
  assert.equal(h.first.cachedHeadingDom[0]!.collapsed, false);
  h.stop();
  assert.deepEqual(h.writes.at(-1), { folds: { 'a.md': [] } });
  const reloaded = await harness(h.writes.at(-1));
  reloaded.first.cachedHeadingDom[0]!.collapsed = true;
  reloaded.run();
  assert.equal(reloaded.first.cachedHeadingDom[0]!.collapsed, false);
  reloaded.stop();
});

void test('tree rebuild and preceding line insertions restore saved keys instead of overwriting them', async () => {
  const h = await harness();
  h.run();
  h.first.cachedHeadingDom[3]!.collapsed = true;
  h.run();
  const moved = headings().map(item => ({ ...item, position: { start: { line: item.position.start.line + 2 }, end: { line: item.position.end.line + 2 } } }));
  h.caches.set('a.md', moved);
  Object.assign(h.first, outline(h.document.file, moved));
  h.run();
  assert.equal(h.first.cachedHeadingDom[3]!.collapsed, true);
  assert.equal(h.first.cachedHeadingDom[0]!.collapsed, false);
  h.stop();
});

void test('two Outlines converge without a stale pane overwriting a toggle', async () => {
  const h = await harness();
  const second = outline(h.document.file);
  h.leaves.push({ view: second });
  h.run();
  second.cachedHeadingDom[0]!.collapsed = true;
  h.run();
  assert.equal(h.first.cachedHeadingDom[0]!.collapsed, true);
  h.first.cachedHeadingDom[0]!.collapsed = false;
  h.run();
  assert.equal(second.cachedHeadingDom[0]!.collapsed, false);
  h.stop();
});

void test('a mismatched or rebuilding Outline cannot overwrite saved state', async () => {
  const h = await harness();
  h.run();
  h.first.cachedHeadingDom[0]!.collapsed = true;
  h.run();
  h.document.file = h.files.get('b.md')!;
  h.run(); // Outline is still showing a.md.
  h.document.file = h.files.get('a.md')!;
  h.first.cachedHeadingDom = [];
  h.run(); // Tree is being rebuilt.
  Object.assign(h.first, outline(h.document.file));
  h.run();
  assert.equal(h.first.cachedHeadingDom[0]!.collapsed, true);
  h.stop();
});

void test('folder renames/deletes move or remove stored Outline state and unload cancels work', async () => {
  const h = await harness();
  h.files.set('folder/a.md', { path: 'folder/a.md' });
  h.caches.set('folder/a.md', headings());
  h.switchFile('folder/a.md');
  h.first.cachedHeadingDom[0]!.collapsed = true;
  h.run();
  h.events.get('rename')!({ path: 'renamed' }, 'folder');
  h.stop();
  assert.deepEqual(h.writes.at(-1), { folds: { 'renamed/a.md': ['[1,"Parent"]#0'] } });
  assert.equal(h.pending.size, 0);
  h.events.get('layout-change')!();
  assert.equal(h.pending.size, 0);
  const deleted = await harness({ folds: { 'b.md': ['[1,"Parent"]#0'] } });
  deleted.events.get('delete')!({ path: 'b.md' });
  deleted.stop();
  assert.deepEqual(deleted.writes.at(-1), { folds: {} });
});
