import { FileSystemAdapter, Plugin, MarkdownPostProcessorContext } from "obsidian";
import { KumlSettings, DEFAULT_SETTINGS } from "./src/KumlSettings";
import { KumlSettingsTab } from "./src/KumlSettingsTab";
import { renderKuml } from "./src/KumlRenderer";
import { AnimatedRenderOptions } from "./src/KumlCliRenderer";
import { kumlHighlightExtension } from "./src/KumlHighlight";

/**
 * Parse the optional `// trace: <vault-relative-path>` directive from the
 * first non-empty line of a kuml-animated source block.
 *
 * Returns `{ dslSource, tracePath }` where:
 *  - `dslSource` is the source with the directive line stripped (if present).
 *  - `tracePath` is the absolute filesystem path to the trace file, or
 *    `undefined` when no directive is found.
 *
 * The trace path is resolved relative to the vault root using the Obsidian
 * FileSystemAdapter. On mobile (no FileSystemAdapter), the directive is
 * silently ignored and `tracePath` is always `undefined`.
 */
function parseAnimatedSource(
  raw: string,
  vaultBasePath: string | undefined,
): { dslSource: string; tracePath: string | undefined } {
  const traceDirectiveRe = /^\/\/\s*trace:\s*(.+)$/m;
  const match = traceDirectiveRe.exec(raw);
  if (!match) {
    return { dslSource: raw, tracePath: undefined };
  }
  const relPath = match[1].trim();
  // Construct absolute path without a static Node.js `path` import — avoids
  // a module-load-time require() that would fail on mobile (Capacitor).
  // FileSystemAdapter.getBasePath() returns the vault root without a trailing
  // slash on macOS/Linux/Windows, so we add one when joining.
  const tracePath =
    vaultBasePath != null
      ? `${vaultBasePath}/${relPath}`.replace(/\/\//g, "/")
      : undefined;
  // Strip the directive line from the DSL source passed to the CLI
  const dslSource = raw.replace(match[0], "").trimStart();
  return { dslSource, tracePath };
}

/**
 * Inject a parsed SVG element into a container element.
 *
 * Uses the DOMParser pipeline (image/svg+xml) rather than innerHTML injection.
 * Strips `<script>` and `<foreignObject>` elements for defence-in-depth.
 * Removes static width/height attributes so the SVG scales to container width.
 *
 * Throws if the SVG string is unparseable.
 */
function injectSvg(svg: string, container: HTMLElement): void {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, "image/svg+xml");
  const parserError = svgDoc.querySelector("parsererror");
  if (parserError) {
    throw new Error(
      `Invalid SVG returned by renderer: ${parserError.textContent ?? "parse error"}`,
    );
  }
  svgDoc.querySelectorAll("script, foreignObject").forEach((n) => n.remove());
  const svgEl = svgDoc.documentElement;
  container.appendChild(svgEl);
  svgEl.removeAttribute("width");
  svgEl.removeAttribute("height");
  svgEl.classList.add("kuml-diagram-svg");
}

export default class KumlPlugin extends Plugin {
  settings!: KumlSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new KumlSettingsTab(this.app, this));

    // V0.2.0 — Syntax highlighting for ```kuml code fences in Source Mode
    // and Live Preview. Reading View SVG rendering continues to be handled
    // by the MarkdownPostProcessor registered below (unchanged from v0.1.0).
    this.registerEditorExtension(kumlHighlightExtension);

    // ── Static renderer: ```kuml ─────────────────────────────────────────
    // registerMarkdownCodeBlockProcessor covers both Reading View and Live Preview.
    this.registerMarkdownCodeBlockProcessor(
      "kuml",
      async (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        await this.renderBlock(source.trim(), el, undefined);
      },
    );

    // ── Animated renderer: ```kuml-animated ──────────────────────────────
    // V0.3.0 — renders with `kuml render --animated [--trace <path>]`.
    // The SVG is injected inline (DOMParser → appendChild) so Chromium's
    // SMIL engine executes the animations — unlike <img> which sandboxes them.
    //
    // Optional first-line directive in the source block:
    //   // trace: vault-relative/path/to/trace.json
    // When present, the trace file drives the animation (BPMN, STM, Activity).
    // When absent, a synthesised demo is produced for STM/Activity diagrams;
    // BPMN renders statically with a CLI warning.
    this.registerMarkdownCodeBlockProcessor(
      "kuml-animated",
      async (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        const vaultBasePath =
          this.app.vault.adapter instanceof FileSystemAdapter
            ? this.app.vault.adapter.getBasePath()
            : undefined;
        const { dslSource, tracePath } = parseAnimatedSource(source.trim(), vaultBasePath);
        const animatedOptions: AnimatedRenderOptions = {
          animated: true,
          ...(tracePath ? { tracePath } : {}),
        };
        await this.renderBlock(dslSource, el, animatedOptions);
      },
    );
  }

  /**
   * Shared render-and-inject pipeline for both static and animated blocks.
   *
   * Shows a loading spinner while the CLI/server runs, then replaces it with
   * the inline SVG. On error, shows the error message in place of the spinner.
   */
  private async renderBlock(
    source: string,
    el: HTMLElement,
    animatedOptions: AnimatedRenderOptions | undefined,
  ): Promise<void> {
    if (!source) return;

    const container = el.createDiv({ cls: "kuml-diagram" });

    // ── Loading placeholder ───────────────────────────────────────────────
    const loading = container.createDiv({ cls: "kuml-loading" });
    loading.createDiv({ cls: "kuml-spinner" });
    loading.createSpan({
      cls: "kuml-loading-text",
      text: animatedOptions?.animated ? "Rendering animated diagram…" : "Rendering diagram…",
    });

    try {
      const svg = await renderKuml(source, this.settings, animatedOptions);

      // V0.2.4 — DOMParser pipeline (inline SVG → SMIL animations work in
      // Chromium/Electron because the SVG lives in the HTML document's DOM,
      // not inside a sandboxed <img> or external resource reference).
      loading.remove();
      injectSvg(svg, container);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      loading.remove();
      container.addClass("kuml-error");
      container.createEl("strong", { text: "kUML render error" });
      container.createEl("pre", { text: msg });
    }
  }

  async loadSettings() {
    // V0.2.5 — `Plugin.loadData()` is declared `Promise<any>` in the Obsidian
    // types, so the previous `Object.assign({}, DEFAULTS, await loadData())`
    // spread propagated `any` into `this.settings`. We narrow the value to
    // `Partial<KumlSettings>` after the load and let Object.assign produce a
    // typed result. Unknown fields in the persisted JSON are ignored — only
    // keys we know about are picked up by Partial<KumlSettings>.
    const persisted = (await this.loadData()) as Partial<KumlSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, persisted ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
