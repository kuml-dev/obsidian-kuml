import { Platform } from "obsidian";

/**
 * Renders a kUML script by piping it into the kUML CLI binary.
 * Desktop only — child_process is not available in Obsidian mobile.
 *
 * Equivalent to: echo "<source>" | kuml render --format svg -
 */
export async function renderViaCli(source: string, cliPath: string): Promise<string> {
  if (!Platform.isDesktopApp) {
    throw new Error("CLI rendering is only available on desktop. Use server mode for mobile.");
  }

  // child_process is available via Electron in Obsidian desktop.
  // It is listed as an external in esbuild.config.mjs (via builtins),
  // so this require() resolves at runtime from the Electron context.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require("child_process") as typeof import("child_process");

  return new Promise((resolve, reject) => {
    const proc = execFile(
      cliPath,
      ["render", "--format", "svg", "-"],
      { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.trim() || error.message;
          reject(new Error(`kuml CLI error: ${msg}`));
          return;
        }
        if (!stdout.includes("<svg")) {
          reject(new Error(`kuml CLI returned unexpected output (not SVG). stderr: ${stderr?.trim()}`));
          return;
        }
        resolve(stdout);
      }
    );

    // Write the kUML source to stdin
    proc.stdin?.write(source);
    proc.stdin?.end();
  });
}
