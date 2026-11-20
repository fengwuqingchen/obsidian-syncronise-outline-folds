import { debounce, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { getOutline, type OutlineItem } from './compat';
import { changedFolds, headingKeys, readSaved, type SavedFolds } from './folds';

interface Baseline {
  context: string;
  items: OutlineItem[];
  outline: Map<number, boolean>;
}

export default class SynchroniseOutlineFolds extends Plugin {
  private timer: number | null = null;
  private stopped = false;
  private warned = false;
  private baselines = new WeakMap<object, Baseline>();
  private observers = new Map<HTMLElement, MutationObserver>();
  private saved: SavedFolds = {};
  private save = debounce(() => void this.saveData({ folds: this.saved }), 1000, true);

  async onload(): Promise<void> {
    this.saved = readSaved(await this.loadData());
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.schedule()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.schedule()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.schedule()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.schedule()));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.move(oldPath, file instanceof TFile ? file.path : null, file.path)));
    this.registerEvent(this.app.vault.on('delete', file => this.move(file.path, null, null)));
    this.addCommand({ id: 'synchronise-now', name: 'Restore saved outline folds', callback: () => {
      this.baselines = new WeakMap();
      this.schedule();
    } });
    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      // Forget notes deleted or renamed while the plugin was not running.
      for (const path of Object.keys(this.saved)) if (!(this.app.vault.getFileByPath(path))) this.forget(path);
      this.schedule();
    });
    this.register(() => {
      this.stopped = true;
      if (this.timer !== null) window.clearTimeout(this.timer);
      for (const observer of this.observers.values()) observer.disconnect();
      this.observers.clear();
      this.baselines = new WeakMap();
      this.save.run();
    });
  }

  /** Follow renamed notes and folders; a null target forgets the saved folds. */
  private move(oldPath: string, filePath: string | null, folderPath: string | null): void {
    for (const path of Object.keys(this.saved)) {
      const target = path === oldPath ? filePath
        : folderPath !== null && path.startsWith(`${oldPath}/`) ? folderPath + path.slice(oldPath.length)
        : path.startsWith(`${oldPath}/`) ? null : undefined;
      if (target === undefined) continue;
      const keys = this.saved[path]!;
      this.forget(path);
      if (target !== null) this.saved[target] = keys;
    }
  }

  private forget(path: string): void {
    if (!(path in this.saved)) return;
    delete this.saved[path];
    this.save();
  }

  private remember(path: string, keys: string[]): void {
    const previous = this.saved[path];
    if (previous && previous.length === keys.length && previous.every((key, index) => key === keys[index])) return;
    this.saved[path] = keys; // An empty list explicitly remembers "all expanded".
    this.save();
  }

  private schedule(): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      try { this.synchronise(); } catch (error) {
        if (!this.warned) console.error('Remember Outline Folds: incompatible core outline interface', error);
        this.warn();
      }
    }, 0);
  }

  private warn(): void {
    if (this.warned) return;
    this.warned = true;
    new Notice('Remember outline folds: the core outline interface is unavailable in this Obsidian version.');
  }

  private synchronise(): void {
    const workspace = this.app.workspace;
    const recent = workspace.getMostRecentLeaf()?.view;
    const active = workspace.activeEditor;
    const document = active instanceof MarkdownView ? active : workspace.getActiveViewOfType(MarkdownView)
      ?? (recent instanceof MarkdownView ? recent : null);
    const leaves = workspace.getLeavesOfType('outline');
    const elements = new Set(leaves.map(leaf => leaf.view.containerEl));
    this.observe(elements);
    if (!document?.file) return;
    const cache = this.app.metadataCache.getFileCache(document.file)?.headings;
    if (!cache) return;
    const keys = headingKeys(cache.map(heading => ({ line: heading.position.start.line, endLine: heading.position.end.line,
      level: heading.level, text: heading.heading })));
    const path = document.file.path;
    const context = JSON.stringify([path, [...keys]]);
    const ready: { outline: object; items: OutlineItem[] }[] = [];

    // Read changes before restoring any pane, so another Outline cannot overwrite a user toggle.
    for (const leaf of leaves) {
      const outline = getOutline(leaf.view);
      if (!outline) { this.warn(); continue; }
      if (outline.file?.path !== path) continue;
      const items = outline.cachedHeadingDom;
      if (items.length !== cache.length || items.some((item, index) => item.heading.position.start.line !== cache[index]?.position.start.line
        || item.heading.level !== cache[index]?.level)) continue;
      const states = new Map(items.filter(item => item.collapsible)
        .map(item => [item.heading.position.start.line, item.collapsed]));
      const previous = this.baselines.get(outline);
      if (previous?.context === context && previous.items.every((item, index) => item === items[index])) {
        const changes = changedFolds(previous.outline, states);
        if (changes.size) {
          const wanted = new Set(this.saved[path] ?? []);
          for (const [line, collapsed] of changes) {
            const key = keys.get(line)!;
            if (collapsed) wanted.add(key);
            else wanted.delete(key);
          }
          this.remember(path, [...keys.values()].filter(key => wanted.has(key)));
        }
      } else if (!(path in this.saved)) {
        // Adopt native defaults only on the first visit; never replace saved state during a rebuild.
        this.remember(path, [...states].filter(([, collapsed]) => collapsed).map(([line]) => keys.get(line)!));
      }
      ready.push({ outline, items });
    }

    const wanted = new Set(this.saved[path] ?? []);
    for (const { outline, items } of ready) {
      const states = new Map<number, boolean>();
      for (const item of items) {
        if (!item.collapsible) continue;
        const line = item.heading.position.start.line;
        const collapsed = wanted.has(keys.get(line)!);
        if (item.collapsed !== collapsed) void item.setCollapsed(collapsed, false);
        states.set(line, collapsed);
      }
      this.baselines.set(outline, { context, items: [...items], outline: states });
    }
  }

  private observe(elements: Set<HTMLElement>): void {
    for (const [element, observer] of this.observers) {
      if (!elements.has(element)) { observer.disconnect(); this.observers.delete(element); }
    }
    for (const element of elements) {
      if (this.observers.has(element)) continue;
      // Use each pane's owner window to support desktop pop-out windows.
      const Observer = (element.win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
      const observer = new Observer(() => this.schedule());
      observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      this.observers.set(element, observer);
    }
  }
}
