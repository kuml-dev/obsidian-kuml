import { Platform } from "obsidian";
import { KumlSettings } from "./KumlSettings";
import { renderViaServer } from "./KumlServerRenderer";
import { renderViaCli, AnimatedRenderOptions } from "./KumlCliRenderer";

/**
 * Dispatches to the appropriate render backend based on settings.
 *
 * - "server": POST to kuml-web (/api/render)
 * - "cli":    pipe to kuml binary via child_process (desktop only)
 * - "auto":   try server first, fall back to CLI on any error
 *
 * When `animatedOptions` is supplied (kuml-animated code fence), animated
 * rendering is CLI-only: the kuml-web server API does not support the
 * `--animated` flag. In "server" mode a clear error is thrown; in "auto"
 * mode the server attempt is skipped and CLI is used directly.
 *
 * V0.6.0 — threads `settings.showWatermark` through to both backends.
 * V0.3.0 — animated rendering support.
 */
export async function renderKuml(
  source: string,
  settings: KumlSettings,
  animatedOptions?: AnimatedRenderOptions,
): Promise<string> {
  const { renderMode, serverUrl, cliPath, showWatermark } = settings;

  // Animated rendering requires the CLI (server does not support --animated).
  if (animatedOptions?.animated) {
    if (!Platform.isDesktopApp) {
      throw new Error(
        "Animated kUML rendering requires the CLI and is only available on desktop.",
      );
    }
    return renderViaCli(source, cliPath, animatedOptions, showWatermark);
  }

  if (renderMode === "server") {
    return renderViaServer(source, serverUrl, showWatermark);
  }

  if (renderMode === "cli") {
    return renderViaCli(source, cliPath, undefined, showWatermark);
  }

  // auto: server first, CLI fallback
  try {
    return await renderViaServer(source, serverUrl, showWatermark);
  } catch (serverErr) {
    try {
      return await renderViaCli(source, cliPath, undefined, showWatermark);
    } catch (cliErr) {
      const serverMsg = serverErr instanceof Error ? serverErr.message : String(serverErr);
      const cliMsg = cliErr instanceof Error ? cliErr.message : String(cliErr);
      throw new Error(
        `Both render backends failed.\n\nServer (${serverUrl}):\n${serverMsg}\n\nCLI (${cliPath}):\n${cliMsg}`
      );
    }
  }
}
