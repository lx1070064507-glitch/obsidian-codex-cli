import {
  isWritableVaultPath,
  toVaultHighlightRule,
  type WritableHighlightRule
} from "../services/writable-path-highlight.js";
import { NodePathInspector } from "../services/workspace-policy.js";

const FILE_TREE_PATH_SELECTOR =
  ".nav-file-title[data-path], .nav-folder-title[data-path]";
const WRITABLE_CLASS = "codex-writable-path";

export class WritablePathHighlighter {
  private observer: MutationObserver | null = null;
  private refreshQueued = false;
  private active = false;
  private refreshVersion = 0;
  private readonly inspector = new NodePathInspector();

  constructor(
    private readonly document: Document,
    private readonly vaultRoot: string,
    private readonly writablePaths: () => string[]
  ) {}

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.observer = new MutationObserver(() => this.scheduleRefresh());
    this.observer.observe(this.document.body, { childList: true, subtree: true });
    this.scheduleRefresh();
  }

  stop(): void {
    this.active = false;
    this.refreshVersion += 1;
    this.observer?.disconnect();
    this.observer = null;
    for (const node of this.document.querySelectorAll(`.${WRITABLE_CLASS}`)) {
      node.classList.remove(WRITABLE_CLASS);
    }
  }

  refresh(): void {
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (!this.active || this.refreshQueued) {
      return;
    }
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      void this.applyRules();
    });
  }

  private async applyRules(): Promise<void> {
    const version = ++this.refreshVersion;
    const rules: WritableHighlightRule[] = [];
    for (const path of this.writablePaths()) {
      try {
        const rule = toVaultHighlightRule(this.vaultRoot, await this.inspector.inspect(path));
        if (rule !== null) {
          rules.push(rule);
        }
      } catch {
        // A validated path may be removed from disk before the next tree refresh.
      }
    }
    if (!this.active || version !== this.refreshVersion) {
      return;
    }
    for (const node of this.document.querySelectorAll<HTMLElement>(FILE_TREE_PATH_SELECTOR)) {
      const path = node.dataset.path;
      node.classList.toggle(
        WRITABLE_CLASS,
        path !== undefined && isWritableVaultPath(path, rules)
      );
    }
  }
}
