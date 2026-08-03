/**
 * `<pivoette-table>` — a custom element that renders a bundle.
 *
 * Importing this module registers the tag; nothing else is exported for a host
 * page to call. Registration is a side effect precisely so that markup
 * inserted *later* — a chat message, say — upgrades on its own, with no script
 * in the message itself.
 *
 * Styles are adopted into a shadow root rather than added to the document, so
 * the host page's CSS and the table's cannot reach each other. The CSS text is
 * inlined into this bundle at build time as `__PIVOETTE_CSS__`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { DataTable } from './components/DataTable';
import { loadBundle, validateBundle } from './bundle';
import type { PivoetteBundle } from './bundle';

declare const __PIVOETTE_CSS__: string | undefined;

const TAG = 'pivoette-table';

let sheet: CSSStyleSheet | undefined;
function styles(): CSSStyleSheet | undefined {
  if (sheet || typeof __PIVOETTE_CSS__ !== 'string') return sheet;
  sheet = new CSSStyleSheet();
  sheet.replaceSync(__PIVOETTE_CSS__);
  return sheet;
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

export class PivoetteTableElement extends HTMLElement {
  static observedAttributes = ['src', 'height', 'theme'];

  #root?: Root;
  #mount?: HTMLDivElement;
  /** Bumped on every (re)load so a slow fetch cannot overwrite a newer one. */
  #token = 0;

  connectedCallback() {
    if (!this.#root) {
      const shadow = this.attachShadow({ mode: 'open' });
      const adopted = styles();
      if (adopted) shadow.adoptedStyleSheets = [adopted];
      this.#mount = document.createElement('div');
      shadow.appendChild(this.#mount);
      this.#root = createRoot(this.#mount);
    }
    void this.#load();
  }

  attributeChangedCallback() {
    if (this.#root) void this.#load();
  }

  disconnectedCallback() {
    // Defer: React warns if a root is unmounted while it is rendering, and a
    // move within the DOM disconnects then reconnects.
    const root = this.#root;
    this.#root = undefined;
    this.#mount = undefined;
    queueMicrotask(() => {
      if (!this.isConnected) root?.unmount();
    });
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
    const show = (node: React.ReactNode) => {
      if (token === this.#token && this.#root) {
        this.#root.render(<StrictMode>{node}</StrictMode>);
      }
    };

    try {
      const { bundle, baseUrl } = await this.#bundle();
      const frame = await loadBundle(bundle, baseUrl);
      const { ok, problems } = validateBundle(bundle, frame);
      if (!ok) {
        show(
          <Problem title="This table's spec has problems:" lines={problems} />,
        );
        return;
      }
      show(
        <DataTable
          data={frame}
          view={bundle.view}
          display={bundle.display}
          height={this.getAttribute('height') ?? bundle.height ?? 420}
          theme={
            (this.getAttribute('theme') as 'auto' | 'light' | 'dark' | null) ??
            bundle.theme ??
            'auto'
          }
        />,
      );
    } catch (error) {
      show(
        <Problem
          title="This table could not be loaded:"
          lines={[error instanceof Error ? error.message : String(error)]}
        />,
      );
    }
  }
}

// Defining a tag twice throws, which HMR and double-imports would otherwise hit.
if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
  customElements.define(TAG, PivoetteTableElement);
}
