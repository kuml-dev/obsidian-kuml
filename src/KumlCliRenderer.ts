import { Platform } from "obsidian";

/**
 * Renders a kUML script by invoking the kUML CLI binary.
 * Desktop only — child_process / fs are not available in Obsidian mobile.
 *
 * Strategy:
 *   1. Write source to a temp *.kuml.kts file  (CLI requires a file path, not stdin)
 *   2. Run: kuml render --format svg -o /dev/stdout <tempFile>
 *   3. Capture stdout as SVG string
 *   4. Delete the temp file (best-effort)
 *
 * Stderr (JNA warnings etc.) is intentionally discarded — only stdout matters.
 */
export async function renderViaCli(source: string, cliPath: string): Promise<string> {
  if (!Platform.isDesktopApp) {
    throw new Error("CLI rendering is only available on desktop. Use server mode for mobile.");
  }

  // child_process and fs are available via Electron in Obsidian desktop.
  // They are listed as externals in esbuild.config.mjs (via builtins),
  // so these require() calls resolve at runtime from the Electron context.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require("child_process") as typeof import("child_process");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("os") as typeof import("os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");

  // Write source to a uniquely-named temp file
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `kuml-obsidian-${Date.now()}.kuml.kts`);

  try {
    fs.writeFileSync(tmpFile, source, "utf-8");
  } catch (e) {
    throw new Error(`kuml CLI: could not write temp file: ${(e as Error).message}`);
  }

  return new Promise((resolve, reject) => {
    execFile(
      cliPath,
      ["render", "--format", "svg", "-o", "/dev/stdout", tmpFile],
      { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // Always clean up the temp file
        try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }

        if (error) {
          // stderr may contain useful info (e.g. DSL parse errors); strip JNA warnings
          const cleanErr = (stderr ?? "")
            .split("\n")
            .filter(l => !l.startsWith("WARNING:") && !l.startsWith("SLF4J"))
            .join("\n")
            .trim();
          reject(new Error(`kuml CLI error: ${cleanErr || error.message}`));
          return;
        }

        if (!stdout.includes("<svg")) {
          reject(new Error(`kuml CLI returned unexpected output (not SVG)`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
