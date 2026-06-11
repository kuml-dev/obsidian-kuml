import { KumlSettings } from "./KumlSettings";
import { renderViaServer } from "./KumlServerRenderer";
import { renderViaCli } from "./KumlCliRenderer";

/**
 * Dispatches to the appropriate render backend based on settings.
 *
 * - "server": POST to kuml-web (/api/render)
 * - "cli":    pipe to kuml binary via child_process (desktop only)
 * - "auto":   try server first, fall back to CLI on any error
 */
export async function renderKuml(source: string, settings: KumlSettings): Promise<string> {
  const { renderMode, serverUrl, cliPath } = settings;

  if (renderMode === "server") {
    return renderViaServer(source, serverUrl);
  }

  if (renderMode === "cli") {
    return renderViaCli(source, cliPath);
  }

  // auto: server first, CLI fallback
  try {
    return await renderViaServer(source, serverUrl);
  } catch (serverErr) {
    try {
      return await renderViaCli(source, cliPath);
    } catch (cliErr) {
      const serverMsg = serverErr instanceof Error ? serverErr.message : String(serverErr);
      const cliMsg = cliErr instanceof Error ? cliErr.message : String(cliErr);
      throw new Error(
        `Both render backends failed.\n\nServer (${serverUrl}):\n${serverMsg}\n\nCLI (${cliPath}):\n${cliMsg}`
      );
    }
  }
}
