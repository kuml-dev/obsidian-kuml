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

          // Replace loading placeholder with rendered SVG
          loading.remove();
          container.innerHTML = svg;

          // Make the SVG scale to container width
          const svgEl = container.querySelector("svg");
          if (svgEl) {
            svgEl.removeAttribute("width");
            svgEl.removeAttribute("height");
            svgEl.setAttribute("style", "width: 100%; height: auto; display: block;");
          }
        } catch (err) {
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
