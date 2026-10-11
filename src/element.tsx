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
 *
 * The editor is a disclosure, closed until the reader opens it, and an open
 * editor is also what puts its table into edit mode. Reading a table and
 * rearranging it are different activities; the `+` buttons and drag handles
 * belong to the second, so they appear with the panel and leave with it.
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
import type { RemovalRef } from './editor/ops';
import styles from './element.module.css';

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
function shadowStyles(): CSSStyleSheet | undefined {
  if (sheet) return sheet;
  // Constructable sheets are missing from jsdom, where there is nothing to
  // see anyway.
  if (
    typeof CSSStyleSheet === 'undefined' ||
    typeof CSSStyleSheet.prototype.replaceSync !== 'function'
  ) {
    return;
  }
  sheet = new CSSStyleSheet();
  if (typeof __PIVOETTE_CSS__ === 'string') sheet.replaceSync(__PIVOETTE_CSS__);
  else mirrorDocumentStyles(sheet);
  return sheet;
}

/**
 * Run from source rather than from the element build — as the React demo
 * does — there is no inlined CSS: the bundler put the component styles in the
 * document, where a shadow root cannot see them. Copy them in, and copy again
 * whenever the head changes or a stylesheet finishes loading, so a
 * hot-reloaded style reaches the shadow root too.
 */
function mirrorDocumentStyles(target: CSSStyleSheet) {
  const sync = () =>
    target.replaceSync(
      [...document.styleSheets]
        .map((s) => {
          try {
            return [...s.cssRules].map((r) => r.cssText).join('\n');
          } catch {
            return ''; // Cross-origin: its rules are not readable.
          }
        })
        .join('\n'),
    );
  sync();
  new MutationObserver(sync).observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  document.addEventListener('load', sync, true);
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
    const adopted = shadowStyles();
    if (adopted) shadow.adoptedStyleSheets = [adopted];
  }
  const mount = document.createElement('div');
  shadow.replaceChildren(mount);
  return createRoot(mount);
}

/**
 * A bare number is pixels, as in `height="320"`; anything else is CSS. An
 * attribute is always a string, and React would hand `"320"` to the style
 * as-is — a length with no unit, which the browser drops.
 */
function heightOf(value: string | null): number | string | undefined {
  if (value === null) return undefined;
  return /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value;
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
  /**
   * Which frame this is. The table is remounted when it changes, so a sort or
   * scroll position on one dataset does not carry over to the next.
   */
  generation: number;
  view: ViewSpec;
  display: DataTableDisplay | undefined;
}

/**
 * How an editor tells its table that it is attached, and whether it is open
 * (`true` / `false`), or that it has let go (`null`). Assigned by the table
 * class, which keeps its editors private.
 */
let holdEditing: (
  table: PivoetteTableElement,
  editor: PivoetteEditorElement,
  open: boolean | null,
) => void;

/** How an editor shows, in its table, what a hovered remove button would take. */
let previewRemoval: (
  table: PivoetteTableElement,
  ref: RemovalRef | null,
) => void;

export class PivoetteTableElement extends HTMLElement {
  static observedAttributes = ['src', 'height', 'theme', 'editable'];

  #root?: Root;
  /** Bumped on every (re)load so a slow fetch cannot overwrite a newer one. */
  #token = 0;
  #generation = 0;
  #loaded?: Loaded;
  /** A bundle handed over through the `bundle` property, which beats `src`. */
  #given?: PivoetteBundle;
  /** The editors attached to this table, and whether each is open. */
  #editors = new Map<PivoetteEditorElement, boolean>();
  /** What an editor's hovered remove button points at, shown in red. */
  #removing: RemovalRef | null = null;

  static {
    holdEditing = (table, editor, open) => {
      const before = table.#editing();
      if (open === null) table.#editors.delete(editor);
      else table.#editors.set(editor, open);
      if (table.#editing() !== before) table.#render();
    };
    previewRemoval = (table, ref) => {
      if (ref === table.#removing) return;
      table.#removing = ref;
      table.#render();
    };
  }

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
    if (name === 'src') {
      this.#given = undefined;
      void this.#load();
    } else this.#render();
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

  /** True once the view or display differs from the bundle's. */
  get edited(): boolean {
    const loaded = this.#loaded;
    return (
      !!loaded &&
      (loaded.view !== loaded.bundle.view ||
        loaded.display !== loaded.bundle.display)
    );
  }

  /** Back to the view and display the bundle was loaded with. */
  reset() {
    const loaded = this.#loaded;
    if (!loaded || !this.edited) return;
    this.#loaded = {
      ...loaded,
      view: loaded.bundle.view,
      display: loaded.bundle.display,
    };
    this.#changed();
  }

  /** The bundle with the edits folded in — what a host would save. */
  get bundle(): PivoetteBundle | undefined {
    if (!this.#loaded) return undefined;
    const { bundle, view, display } = this.#loaded;
    return { ...bundle, view, ...(display ? { display } : {}) };
  }

  /**
   * Show this bundle instead of the one from `src` or the inline script, for a
   * host that builds it in code. Edits are discarded: this is the new baseline
   * that `reset()` returns to.
   *
   * A bundle over the same `data` and `meta` objects as the current one takes
   * effect at once, keeping the frame — so a host can restyle a large table
   * without re-parsing its rows, and carry edits over by setting `view` right
   * after. New data loads asynchronously, like `src`.
   */
  set bundle(next: PivoetteBundle) {
    this.#given = next;
    const loaded = this.#loaded;
    if (
      loaded &&
      next.data === loaded.bundle.data &&
      next.meta === loaded.bundle.meta
    ) {
      // Supersede any load still in flight.
      ++this.#token;
      this.#accept(next, loaded.frame, loaded.generation);
    } else void this.#load();
  }

  /** The palette in effect: the attribute, else the bundle's, else `auto`. */
  get theme(): Theme {
    return (
      themeOf(this.getAttribute('theme')) ??
      this.#loaded?.bundle.theme ??
      'auto'
    );
  }

  /** Sets the attribute. React assigns a property when the element has one. */
  set theme(next: Theme) {
    this.setAttribute('theme', next);
  }

  /**
   * Whether to show the editing controls. An attached editor decides: they
   * show while one is open. `editable` is for a table with no editor, which
   * would otherwise have no way to turn them on — so a page that sets both,
   * as pages had to before the editor could open and close, still gets a
   * table that reads as a table until someone opens the panel.
   */
  #editing(): boolean {
    if (this.#editors.size === 0) return this.hasAttribute('editable');
    return [...this.#editors.values()].some(Boolean);
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
        key={loaded.generation}
        data={loaded.frame}
        view={loaded.view}
        display={loaded.display}
        editing={this.#editing()}
        onViewChange={(view) => (this.view = view)}
        onDisplayChange={(display) => (this.display = display)}
        removing={this.#removing}
        height={
          heightOf(this.getAttribute('height')) ?? loaded.bundle.height ?? 420
        }
        theme={this.theme}
      />,
    );
  }

  /**
   * The bundle: the one set as a property, else from `src`, else from a child
   * `<script type="application/json">`.
   */
  async #bundle(): Promise<{ bundle: PivoetteBundle; baseUrl?: string }> {
    if (this.#given) {
      return { bundle: this.#given, baseUrl: document.baseURI };
    }
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
      this.#accept(bundle, frame, ++this.#generation);
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

  /** Show a bundle whose frame is built, if it validates against it. */
  #accept(bundle: PivoetteBundle, frame: DataFrame, generation: number) {
    const { ok, problems } = validateBundle(bundle, frame);
    if (!ok) {
      this.#loaded = undefined;
      this.#show(
        <Problem title="This table's spec has problems:" lines={problems} />,
      );
      return;
    }
    this.#loaded = {
      bundle,
      frame,
      generation,
      view: bundle.view,
      display: bundle.display,
    };
    // Announced like an edit, so an editor that connected first catches up.
    this.#changed();
  }
}

/**
 * `<pivoette-editor for="table-id">`: a disclosure, closed by default, that
 * opens onto the field lists of a table's view — to reorder, remove, or
 * re-aggregate — and a Reset button to undo all of it. `no-reset` hides the
 * button.
 *
 * Opening it puts the table into edit mode, showing the `+` buttons and drag
 * handles on the table itself; closing it takes them away again, unless
 * another editor on it is still open. An attached editor overrides the
 * table's `editable`, which is for tables without one. Like
 * `<details>`, the `open` attribute (and property) starts it open, and is
 * kept in step as the reader toggles it. The summary reads "Edit"; the
 * element's children replace that text.
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
  static observedAttributes = ['for', 'theme', 'no-reset', 'open'];

  #root?: Root;
  #table?: PivoetteTableElement;
  /** Watches for the table while it has not appeared yet. */
  #waiting?: MutationObserver;
  /** The table this editor currently has in edit mode, if any. */
  #holding?: PivoetteTableElement;

  #onChange = () => this.#render();

  connectedCallback() {
    this.#root ??= mountRoot(this);
    this.#connect();
  }

  attributeChangedCallback(name: string) {
    if (!this.#root) return;
    if (name === 'for') this.#connect();
    else {
      if (name === 'open') this.#hold();
      this.#render();
    }
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

  get open(): boolean {
    return this.hasAttribute('open');
  }

  set open(next: boolean) {
    this.toggleAttribute('open', next);
  }

  /** Keep the table told whether this editor is attached, and open. */
  #hold() {
    const table = this.#table;
    if (this.#holding && this.#holding !== table) {
      previewRemoval(this.#holding, null);
      holdEditing(this.#holding, this, null);
    }
    this.#holding = table;
    if (!table) return;
    // A panel that closes under the pointer gets no mouseleave.
    if (!this.open) previewRemoval(table, null);
    holdEditing(table, this, this.open);
  }

  #disconnect() {
    this.#waiting?.disconnect();
    this.#waiting = undefined;
    this.#table?.removeEventListener(CHANGE_EVENT, this.#onChange);
    this.#table = undefined;
    this.#hold();
  }

  #connect() {
    this.#disconnect();
    const id = this.getAttribute('for');
    if (id) {
      const scope = this.getRootNode() as Document | ShadowRoot;
      const found = scope.getElementById(id);
      if (found instanceof PivoetteTableElement) {
        this.#table = found;
        found.addEventListener(CHANGE_EVENT, this.#onChange);
        this.#hold();
      } else {
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
    }
    this.#render();
  }

  /** What the panel holds once opened: the lists, or why there are none. */
  #body(): React.ReactNode {
    const id = this.getAttribute('for');
    if (!id) return <Note text="Set `for` to the id of a <pivoette-table>." />;
    const table = this.#table;
    if (!table)
      return <Note text={`Waiting for <pivoette-table id="${id}">…`} />;
    const view = table.view;
    if (!view) return null;
    return (
      <ViewEditor
        view={view}
        display={table.display}
        frame={table.frame}
        theme={this.#theme()}
        onViewChange={(next) => (table.view = next)}
        onDisplayChange={(next) => (table.display = next)}
        onReset={
          this.hasAttribute('no-reset') ? undefined : () => table.reset()
        }
        canReset={table.edited}
        onRemovePreview={(ref) => previewRemoval(table, ref)}
      />
    );
  }

  #theme(): Theme {
    return themeOf(this.getAttribute('theme')) ?? this.#table?.theme ?? 'auto';
  }

  #render() {
    const theme = this.#theme();
    const open = this.open;
    this.#root?.render(
      <StrictMode>
        <details
          className={styles.disclosure}
          data-theme={theme === 'auto' ? undefined : theme}
          open={open}
          onToggle={(e) => (this.open = e.currentTarget.open)}
        >
          <summary className={styles.summary}>
            <slot>Edit</slot>
          </summary>
          {/* Mounted only while open: a closed panel has nothing to keep. */}
          {open && <div className={styles.body}>{this.#body()}</div>}
        </details>
      </StrictMode>,
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
