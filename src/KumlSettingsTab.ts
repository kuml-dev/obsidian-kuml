import { App, PluginSettingTab, Setting } from "obsidian";
import type KumlPlugin from "../main";
import type { RenderMode } from "./KumlSettings";

export class KumlSettingsTab extends PluginSettingTab {
  plugin: KumlPlugin;

  constructor(app: App, plugin: KumlPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "kUML Diagrams" });

    containerEl.createEl("p", {
      text: "Renders ```kuml code blocks as inline SVG diagrams. " +
            "Diagrams are evaluated by kuml-web (server) or the kuml CLI binary.",
      cls: "setting-item-description",
    });

    // ── Render mode ────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Render mode")
      .setDesc(
        "'Auto' tries the kuml-web server first, then falls back to the CLI. " +
        "Use 'Server only' if you always run kuml serve. " +
        "Use 'CLI only' for fully offline rendering (desktop only)."
      )
      .addDropdown((drop) =>
        drop
          .addOption("auto", "Auto (server → CLI fallback)")
          .addOption("server", "Server only (kuml serve)")
          .addOption("cli", "CLI only (kuml binary)")
          .setValue(this.plugin.settings.renderMode)
          .onChange(async (value) => {
            this.plugin.settings.renderMode = value as RenderMode;
            await this.plugin.saveSettings();
          })
      );

    // ── Server URL ─────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Server URL")
      .setDesc(
        "Base URL of the running kuml-web server. Start it with: kuml serve"
      )
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:4242")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            // Strip trailing slash for clean URL concatenation
            this.plugin.settings.serverUrl = value.trim().replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    // ── CLI path ───────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("CLI path")
      .setDesc(
        "Path to the kuml binary. Use 'kuml' if it is on your PATH, " +
        "or an absolute path like /usr/local/bin/kuml. Desktop only."
      )
      .addText((text) =>
        text
          .setPlaceholder("kuml")
          .setValue(this.plugin.settings.cliPath)
          .onChange(async (value) => {
            this.plugin.settings.cliPath = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
