import { Platform } from "obsidian";

/**
 * Renders a kUML script by invoking the kUML CLI binary.
 * Desktop only — child_process / fs are not available in Obsidian mobile.
 *
 * Strategy (avoids /dev/stdout which Electron child processes cannot open):
 *   1. Write source to  /tmp/kuml-obsidian-<ts>-in.kuml.kts
 *   2. Run: kuml render --format svg -o /tmp/kuml-obsidian-<ts>-out.svg <inFile>
 *   3. Read the output file → return SVG string
 *   4. Delete both temp files (best-effort)
 *
 * Stderr (JNA / Unsafe warnings) is filtered before showing errors to the user.
 */
export async function renderViaCli(source: string, cliPath: string): Promise<string> {
  if (!Platform.isDesktopApp) {
    throw new Error("CLI rendering is only available on desktop. Use server mode for mobile.");
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFile } = require("child_process") as typeof import("child_process");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("os") as typeof import("os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");

  const ts = Date.now();
  const tmpDir = os.tmpdir();
  const inFile  = path.join(tmpDir, `kuml-obsidian-${ts}-in.kuml.kts`);
  const outFile = path.join(tmpDir, `kuml-obsidian-${ts}-out.svg`);

  // Write source to temp input file
  try {
    fs.writeFileSync(inFile, source, "utf-8");
  } catch (e) {
    throw new Error(`kuml CLI: could not write temp file: ${(e as Error).message}`);
  }

  return new Promise((resolve, reject) => {
    execFile(
      cliPath,
      ["render", "--format", "svg", "-o", outFile, inFile],
      { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        // Clean up input file (best-effort)
        try { fs.unlinkSync(inFile); } catch { /* ignore */ }

        if (error) {
          // Clean up output file if it exists
          try { fs.unlinkSync(outFile); } catch { /* ignore */ }

          // Filter JVM housekeeping noise from stderr before displaying
          const cleanErr = (stderr ?? "")
            .split("\n")
            .filter(l =>
              l.trim().length > 0 &&
              !l.startsWith("WARNING:") &&
              !l.startsWith("SLF4J") &&
              !l.startsWith("Wrote ")
            )
            .join("\n")
            .trim();
          reject(new Error(`kuml CLI error:\n${cleanErr || error.message}`));
          return;
        }

        // Read the rendered SVG from the output file
        let svg: string;
        try {
          svg = fs.readFileSync(outFile, "utf-8");
        } catch (e) {
          reject(new Error(`kuml CLI: could not read output file: ${(e as Error).message}`));
          return;
        } finally {
          try { fs.unlinkSync(outFile); } catch { /* ignore */ }
        }

        if (!svg.includes("<svg")) {
          reject(new Error("kuml CLI: output file does not contain SVG"));
          return;
        }

        resolve(svg);
      }
    );
  });
}
