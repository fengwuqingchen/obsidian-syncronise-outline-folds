import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

// Refuse arbitrary vaults: this check changes folds/modes, creates Other.md,
// adds/removes a test Outline pane, and reloads the fork in a disposable vault.
const vault = 'synchronise-outline-folds-test';
const executable = process.env.OBSIDIAN_CLI ?? 'obsidian';
const cli = (...args) => {
  // Never let the CLI start another Obsidian process implicitly.
  execFileSync('pgrep', ['-x', 'Obsidian'], { stdio: 'ignore', timeout: 5000 });
  return execFileSync(executable, [`vault=${vault}`, ...args], { encoding: 'utf8', timeout: 30000 });
};
const path = cli('vault', 'info=path').trim();
if (!/^\/(?:private\/)?tmp\/synchronise-outline-folds-test$/.test(path)) throw new Error('Open the dedicated /tmp test vault first.');
const fixture = await readFile(new URL('../tests/Folds.md', import.meta.url), 'utf8');
if (cli('read', 'path=Folds.md').trim() !== fixture.trim()) throw new Error('Folds.md does not match the test fixture.');

const code = `(async () => {
  if (!/^\\/(?:private\\/)?tmp\\/synchronise-outline-folds-test$/.test(app.vault.adapter.basePath)) throw new Error('Unexpected vault path');
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 200));
  const id = 'synchronise-outline-folds';
  const file = app.vault.getFileByPath('Folds.md');
  const original = await app.vault.read(file);
  const leaf = app.workspace.getMostRecentLeaf();
  assert(leaf, 'Open a Markdown pane in the test vault');
  await leaf.openFile(file);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await app.plugins.enablePlugin(id);
  assert(app.plugins.plugins[id]?.manifest.name === 'Remember Outline Folds', 'Install this fork, not upstream');
  let extra = null;
  const outline = () => app.workspace.getLeavesOfType('outline')[0]?.view;
  const folds = () => JSON.stringify(leaf.view.currentMode.getFoldInfo());
  const states = () => outline().cachedHeadingDom.map(item => item.collapsed);
  const expand = async () => {
    for (const item of outline().cachedHeadingDom) if (item.collapsible) item.setCollapsed(false, false);
    await settle();
  };
  try {
    assert(outline(), 'Enable the core Outline and open its pane');
    for (const state of [{ mode: 'source', source: false }, { mode: 'source', source: true }, { mode: 'preview' }]) {
      await leaf.setViewState({ type: 'markdown', state: { file: 'Folds.md', ...state } });
      await settle();
      await expand();
      const originalFolds = folds();
      const items = outline().cachedHeadingDom;
      assert(items[0].collapsible && items[1].collapsible, 'Nested test headings missing');
      items[1].setCollapsed(true, false);
      await settle();
      items[0].setCollapsed(true, false);
      await settle();
      assert(folds() === originalFolds, 'Outline toggle changed document folds');
      items[0].setCollapsed(false, false);
      await settle();
      assert(items[1].collapsed, 'Parent toggle lost independent nested Outline state');
      const remembered = JSON.stringify(states());
      const info = leaf.view.currentMode.getFoldInfo();
      leaf.view.currentMode.applyFoldInfo({ lines: info.lines, folds: [{ from: 0, to: 18 }] });
      await settle();
      assert(JSON.stringify(states()) === remembered, 'Document fold changed Outline state');
      leaf.view.currentMode.applyFoldInfo({ lines: info.lines, folds: [] });
      await settle();
      results.push((state.mode === 'preview' ? 'Reading' : state.source ? 'Source' : 'Live Preview') + ': independent Outline/document folds and nested state');
    }

    const other = app.vault.getFileByPath('Other.md') ?? await app.vault.create('Other.md', '# Other\\n\\n## Child\\n\\nBody.\\n');
    await expand();
    outline().cachedHeadingDom[1].setCollapsed(true, false);
    await settle();
    await leaf.openFile(other);
    await settle();
    await leaf.openFile(file);
    await settle();
    assert(outline().cachedHeadingDom[1].collapsed, 'Per-note Outline state lost after file switch');
    await expand();
    await leaf.openFile(other);
    await settle();
    await leaf.openFile(file);
    await settle();
    assert(outline().cachedHeadingDom.every(item => !item.collapsible || !item.collapsed), 'All-expanded state was not restored');
    results.push('File switching restores collapsed and all-expanded states');

    extra = app.workspace.getRightLeaf(true);
    await extra.setViewState({ type: 'outline' });
    await settle();
    const outlines = app.workspace.getLeavesOfType('outline');
    assert(outlines.length >= 2, 'Second Outline missing');
    outlines[1].view.cachedHeadingDom[0].setCollapsed(true, false);
    await settle();
    assert(outlines.every(pane => pane.view.cachedHeadingDom[0].collapsed), 'Two Outlines did not converge');
    extra.detach(); extra = null;
    results.push('Multiple Outlines share the active note state');

    const beforeReload = JSON.stringify(states());
    const documentBeforeReload = folds();
    await app.plugins.disablePlugin(id);
    await settle();
    const dataPath = app.vault.configDir + '/plugins/' + id + '/data.json';
    const diskBefore = await app.vault.adapter.read(dataPath);
    for (const item of outline().cachedHeadingDom) if (item.collapsible) item.setCollapsed(!item.collapsed, false);
    assert(JSON.stringify(states()) !== beforeReload, 'Disabled-state test did not change the Outline');
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert(await app.vault.adapter.read(dataPath) === diskBefore, 'Disabled plugin persisted an Outline toggle');
    await app.plugins.enablePlugin(id);
    await settle();
    assert(JSON.stringify(states()) === beforeReload, 'Plugin reload did not restore the saved disk state');
    assert(folds() === documentBeforeReload, 'Plugin reload changed document folds');
    results.push('Disabled plugin does not save toggles; re-enable restores the previous saved state');

    assert(await app.vault.read(file) === original, 'Markdown fixture was changed');
    results.push('Markdown fixture remains byte-for-byte unchanged');
    return JSON.stringify({ passed: results.length, results });
  } finally {
    if (extra) extra.detach();
    await app.plugins.enablePlugin(id);
  }
})()`;
// Literal newlines are command separators in the CLI transport.
const output = cli('eval', `code=${code.replace(/\n/g, ' ')}`);
if (!output.startsWith('=> ')) throw new Error(output);
const result = JSON.parse(output.slice(3));
console.info(JSON.stringify(result, null, 2));
