export type RenderMode = "auto" | "server" | "cli";

export interface KumlSettings {
  renderMode: RenderMode;
  serverUrl: string;
  cliPath: string;
  /** Opt-in visible "Powered by kUML" watermark on rendered diagrams. Off by default. */
  showWatermark: boolean;
}

export const DEFAULT_SETTINGS: KumlSettings = {
  renderMode: "auto",
  serverUrl: "http://localhost:4242",
  cliPath: "kuml",
  showWatermark: false,
};
