export type RenderMode = "auto" | "server" | "cli";

export interface KumlSettings {
  renderMode: RenderMode;
  serverUrl: string;
  cliPath: string;
}

export const DEFAULT_SETTINGS: KumlSettings = {
  renderMode: "auto",
  serverUrl: "http://localhost:4242",
  cliPath: "kuml",
};
