import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { KumlSettings, DEFAULT_SETTINGS } from "./src/KumlSettings";
import { KumlSettingsTab } from "./src/KumlSettingsTab";
import { renderKuml } from "./src/KumlRenderer";
import { kumlHighlightExtension } from "./src/KumlHighlight";

export default class KumlPlugin extends Plugin {
  settings!: KumlSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new KumlSettingsTab(this.app, this));

    // V0.2.0 — Syntax highlighting for ```kuml code fences in Source Mode
    // and Live Preview. Reading View SVG rendering continues to be handled
    // by the MarkdownPostProcessor registered below (unchanged from v0.1.0).
    this.registerEditorExtension(kumlHighlightExtension);

    // registerMarkdownCodeBlockProcessor covers both Reading View and Live Preview.
    this.registerMarkdownCodeBlockProcessor(
      "kuml",
      async (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        const trimmed = source.trim();
        if (!trimmed) return;

        const container = el.createDiv({ cls: "kuml-diagram" });

        // ── Loading placeholder ───────────────────────────────────────────
        const loading = container.createDiv({ cls: "kuml-loading" });
        loading.createDiv({ cls: "kuml-spinner" });
        loading.createSpan({ cls: "kuml-loading-text", text: "Rendering diagram…" });

        try {
          const svg = await renderKuml(trimmed, this.settings);

          // V0.2.4 — DOMParser pipeline: parses as image/svg+xml (detached XML
          // document — never invokes the HTML parser), strips active content,
          // then appendChild the root. Reviewer rejected raw HTML-string
          // injection in 0.2.3; this is the portable safe equivalent.
          loading.remove();

          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svg, "image/svg+xml");
          const parserError = svgDoc.querySelector("parsererror");
          if (parserError) {
            throw new Error(`Invalid SVG returned by renderer: ${parserError.textContent ?? "parse error"}`);
          }
          // Defence-in-depth: drop active content. The kUML renderer never
          // emits these, but a compromised CLI / server in the user's setup
          // could.
          svgDoc.querySelectorAll("script, foreignObject").forEach((n) => n.remove());

          const svgEl = svgDoc.documentElement;
          container.appendChild(svgEl);

          // Make the SVG scale to container width via a CSS class — per
          // reviewer "obsidianmd/no-static-styles-assignment", styling lives
          // in styles.css under `.kuml-diagram-svg`.
          svgEl.removeAttribute("width");
          svgEl.removeAttribute("height");
          svgEl.classList.add("kuml-diagram-svg");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);

          // Replace loading placeholder with error
          loading.remove();
          container.addClass("kuml-error");
          container.createEl("strong", { text: "kUML render error" });
          container.createEl("pre", { text: msg });
        }
      }
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
