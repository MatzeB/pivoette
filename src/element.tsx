/**
 * `<pivoette-table>` — a custom element that renders a bundle — and
 * `<pivoette-editor>`, a panel that edits one.
 *
 * Importing this module registers both tags; nothing else is exported for a
 * host page to call. Registration is a side effect precisely so that markup
 * inserted *later* — a chat message, say — upgrades on its own, with no script
 * in the message itself.
 *
 * Styles are adopted into a shadow root rather than added to the document, so
 * the host page's CSS and the table's cannot reach each other. The CSS text is
 * inlined into this bundle at build time as `__PIVOETTE_CSS__`.
 *
 * The two elements connect the way `<label for>` does: the editor names its
 * table by id. The table owns the view — edits from its own headers and from
 * any editor land in the same place — and announces each change with a
 * `pivoette-change` event, which is also how a host page learns of one.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { DataTable } from './components/DataTable';
import type { DataTableDisplay } from './components/DataTable';
import { ViewEditor } from './editor/ViewEditor';
import { loadBundle, validateBundle } from './bundle';
import type { PivoetteBundle } from './bundle';
import type { DataFrame } from './data/types';
import type { ViewSpec } from './pivot/spec';

declare const __PIVOETTE_CSS__: string | undefined;

const TABLE_TAG = 'pivoette-table';
const EDITOR_TAG = 'pivoette-editor';

/** Fired by a table after every edit, and once its bundle has loaded. */
export const CHANGE_EVENT = 'pivoette-change';

export interface PivoetteChangeDetail {
  view: ViewSpec;
  display: DataTableDisplay | undefined;
}

type Theme = 'auto' | 'light' | 'dark';

let sheet: CSSStyleSheet | undefined;
function styles(): CSSStyleSheet | undefined {
  if (sheet || typeof __PIVOETTE_CSS__ !== 'string') return sheet;
  sheet = new CSSStyleSheet();
  sheet.replaceSync(__PIVOETTE_CSS__);
  return sheet;
}

/**
 * A React root in the element's shadow root, which carries the shared styles.
 * The shadow root outlives an unmount — it cannot be attached twice — so a
 * later reconnect mounts into it afresh.
 */
function mountRoot(host: HTMLElement): Root {
  let shadow = host.shadowRoot;
  if (!shadow) {
    shadow = host.attachShadow({ mode: 'open' });
    const adopted = styles();
    if (adopted) shadow.adoptedStyleSheets = [adopted];
  }
  const mount = document.createElement('div');
  shadow.replaceChildren(mount);
  return createRoot(mount);
}

function themeOf(value: string | null): Theme | undefined {
  return value === 'auto' || value === 'light' || value === 'dark'
    ? value
    : undefined;
}

/**
 * Readable failure in the page, since a generated bundle can be wrong.
 *
 * The fast-refresh rule below wants a module to export only components; this
 * one is an element registration, so the mix is the point.
 */
// eslint-disable-next-line react-refresh/only-export-components
function Problem({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid light-dark(#f0c0be, #6b2b28)',
        background: 'light-dark(#fdf3f3, #2a1a1a)',
        color: 'light-dark(#8a2420, #ff9d97)',
        font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <strong>{title}</strong>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** What a table shows once its bundle has loaded and validated. */
interface Loaded {
  bundle: PivoetteBundle;
  frame: DataFrame;
  view: ViewSpec;
  display: DataTableDisplay | undefined;
}

export class PivoetteTableElement extends HTMLElement {
  static observedAttributes = ['src', 'height', 'theme', 'editable'];

  #root?: Root;
  /** Bumped on every (re)load so a slow fetch cannot overwrite a newer one. */
  #token = 0;
  #loaded?: Loaded;

  connectedCallback() {
    // A move within the DOM disconnects then reconnects; the root survives it.
    this.#root ??= mountRoot(this);
    if (this.#loaded) this.#render();
    else void this.#load();
  }

  attributeChangedCallback(name: string) {
    if (!this.#root) return;
    // Only a new source means new data. The rest is presentation, and
    // re-reading the bundle for it would throw away the reader's edits.
    if (name === 'src') void this.#load();
    else this.#render();
  }

  disconnectedCallback() {
    // Deferred: React warns if a root is unmounted while it is rendering, and
    // a move reconnects before the microtask runs.
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.#root?.unmount();
      this.#root = undefined;
    });
  }

  /** The data, once loaded. An editor reads display names from it. */
  get frame(): DataFrame | undefined {
    return this.#loaded?.frame;
  }

  /** The view as it stands, edits included. */
  get view(): ViewSpec | undefined {
    return this.#loaded?.view;
  }

  set view(next: ViewSpec) {
    if (!this.#loaded) return;
    this.#loaded = { ...this.#loaded, view: next };
    this.#changed();
  }

  get display(): DataTableDisplay | undefined {
    return this.#loaded?.display;
  }

  set display(next: DataTableDisplay | undefined) {
    if (!this.#loaded) return;
    this.#loaded = { ...this.#loaded, display: next };
    this.#changed();
  }

  /** The bundle with the edits folded in — what a host would save. */
  get bundle(): PivoetteBundle | undefined {
    if (!this.#loaded) return undefined;
    const { bundle, view, display } = this.#loaded;
    return { ...bundle, view, ...(display ? { display } : {}) };
  }

  get theme(): Theme {
    return (
      themeOf(this.getAttribute('theme')) ??
      this.#loaded?.bundle.theme ??
      'auto'
    );
  }

  #changed() {
    this.#render();
    const { view, display } = this.#loaded!;
    this.dispatchEvent(
      new CustomEvent<PivoetteChangeDetail>(CHANGE_EVENT, {
        detail: { view, display },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #show(node: React.ReactNode) {
    this.#root?.render(<StrictMode>{node}</StrictMode>);
  }

  #render() {
    const loaded = this.#loaded;
    if (!loaded) return;
    this.#show(
      <DataTable
        data={loaded.frame}
        view={loaded.view}
        display={loaded.display}
        editing={this.hasAttribute('editable')}
        onViewChange={(view) => (this.view = view)}
        onDisplayChange={(display) => (this.display = display)}
        height={this.getAttribute('height') ?? loaded.bundle.height ?? 420}
        theme={this.theme}
      />,
    );
  }

  /** The bundle, from `src` or from a child `<script type="application/json">`. */
  async #bundle(): Promise<{ bundle: PivoetteBundle; baseUrl?: string }> {
    const src = this.getAttribute('src');
    if (src) {
      const url = new URL(src, document.baseURI).href;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Could not fetch ${url}: ${response.status}`);
      }
      return {
        bundle: (await response.json()) as PivoetteBundle,
        baseUrl: url,
      };
    }
    const inline = this.querySelector('script[type="application/json"]');
    if (!inline?.textContent?.trim()) {
      throw new Error(
        'needs a `src` attribute or a <script type="application/json"> child',
      );
    }
    return {
      bundle: JSON.parse(inline.textContent) as PivoetteBundle,
      baseUrl: document.baseURI,
    };
  }

  async #load() {
    const token = ++this.#token;
    const current = () => token === this.#token;
    this.#loaded = undefined;

    try {
      const { bundle, baseUrl } = await this.#bundle();
      const frame = await loadBundle(bundle, baseUrl);
      if (!current()) return;
      const { ok, problems } = validateBundle(bundle, frame);
      if (!ok) {
        this.#show(
          <Problem title="This table's spec has problems:" lines={problems} />,
        );
        return;
      }
      this.#loaded = {
        bundle,
        frame,
        view: bundle.view,
        display: bundle.display,
      };
      // Announced like an edit, so an editor that connected first catches up.
      this.#changed();
    } catch (error) {
      if (!current()) return;
      this.#show(
        <Problem
          title="This table could not be loaded:"
          lines={[error instanceof Error ? error.message : String(error)]}
        />,
      );
    }
  }
}

/**
 * `<pivoette-editor for="table-id">`: the field lists of a table's view, to
 * reorder, remove, or re-aggregate.
 *
 * It holds no view of its own. It reads the table's, writes edits back
 * through the table's `view` / `display` setters, and redraws on the table's
 * `pivoette-change` — so the two stay in step whichever one was edited, and
 * any number of editors can share a table.
 *
 * The table is looked up in the editor's own tree (document or shadow root),
 * and may arrive later than the editor does.
 */
export class PivoetteEditorElement extends HTMLElement {
  static observedAttributes = ['for', 'theme'];

  #root?: Root;
  #table?: PivoetteTableElement;
  /** Watches for the table while it has not appeared yet. */
  #waiting?: MutationObserver;

  #onChange = () => this.#render();

  connectedCallback() {
    this.#root ??= mountRoot(this);
    this.#connect();
  }

  attributeChangedCallback(name: string) {
    if (!this.#root) return;
    if (name === 'for') this.#connect();
    else this.#render();
  }

  disconnectedCallback() {
    this.#disconnect();
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.#root?.unmount();
      this.#root = undefined;
    });
  }

  /** The table this editor edits, once found. */
  get table(): PivoetteTableElement | undefined {
    return this.#table;
  }

  #disconnect() {
    this.#waiting?.disconnect();
    this.#waiting = undefined;
    this.#table?.removeEventListener(CHANGE_EVENT, this.#onChange);
    this.#table = undefined;
  }

  #connect() {
    this.#disconnect();
    const id = this.getAttribute('for');
    if (!id) {
      this.#show(<Note text="Set `for` to the id of a <pivoette-table>." />);
      return;
    }
    const scope = this.getRootNode() as Document | ShadowRoot;
    const found = scope.getElementById(id);
    if (found instanceof PivoetteTableElement) {
      this.#table = found;
      found.addEventListener(CHANGE_EVENT, this.#onChange);
      this.#render();
      return;
    }
    this.#show(<Note text={`Waiting for <pivoette-table id="${id}">…`} />);
    this.#waiting = new MutationObserver(() => {
      if (scope.getElementById(id) instanceof PivoetteTableElement) {
        this.#connect();
      }
    });
    this.#waiting.observe(scope, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id'],
    });
  }

  #show(node: React.ReactNode) {
    this.#root?.render(<StrictMode>{node}</StrictMode>);
  }

  #render() {
    const table = this.#table;
    const view = table?.view;
    if (!table || !view) return;
    this.#show(
      <ViewEditor
        view={view}
        display={table.display}
        frame={table.frame}
        theme={themeOf(this.getAttribute('theme')) ?? table.theme}
        onViewChange={(next) => (table.view = next)}
        onDisplayChange={(next) => (table.display = next)}
      />,
    );
  }
}

// eslint-disable-next-line react-refresh/only-export-components
function Note({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: 0,
        color: 'light-dark(#666, #999)',
        font: '13px/1.5 system-ui, sans-serif',
      }}
    >
      {text}
    </p>
  );
}

// Defining a tag twice throws, which HMR and double-imports would otherwise hit.
if (typeof customElements !== 'undefined') {
  if (!customElements.get(TABLE_TAG)) {
    customElements.define(TABLE_TAG, PivoetteTableElement);
  }
  if (!customElements.get(EDITOR_TAG)) {
    customElements.define(EDITOR_TAG, PivoetteEditorElement);
  }
}
