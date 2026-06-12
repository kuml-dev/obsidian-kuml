import { Platform } from "obsidian";

/**
 * Renders a kUML script by invoking the kUML CLI binary.
 *
 * Desktop-only — relies on Node.js builtins (child_process / fs / os / path)
 * that do not exist in the mobile (Capacitor) runtime. Every call site is
 * guarded by `Platform.isDesktopApp`; the imports themselves are dynamic so
 * the mobile bundle does not even try to resolve the Node modules.
 *
 * Strategy (avoids /dev/stdout which Electron child processes cannot open):
 *   1. Write source to  /tmp/kuml-obsidian-<ts>-in.kuml.kts
 *   2. Run: kuml render --format svg -o /tmp/kuml-obsidian-<ts>-out.svg <inFile>
 *   3. Read the output file → return SVG string
 *   4. Delete both temp files (best-effort)
 *
 * Stderr (JNA / Unsafe warnings) is filtered before showing errors to the user.
 *
 * V0.2.4 — switched from CommonJS-style imports to ES dynamic imports
 * (`await import(...)`), dropping the disable comments flagged by the
 * Obsidian plugin reviewer. The Node builtins remain external to the
 * esbuild bundle.
 */
export async function renderViaCli(source: string, cliPath: string): Promise<string> {
  if (!Platform.isDesktopApp) {
    throw new Error("CLI rendering is only available on desktop. Use server mode for mobile.");
  }

  // Lazy ESM imports of Node built-ins. esbuild leaves these external (see
  // `external` list in esbuild.config.mjs); they resolve at runtime via
  // Electron's Node integration. Imports are dynamic so the mobile bundle
  // never attempts to load them — the function above bails on non-desktop
  // before this point is reached.
  const childProcess = await import("child_process");
  const fs = await import("fs");
  const os = await import("os");
  const path = await import("path");

  const ts = Date.now();
  const tmpDir = os.tmpdir();
  const inFile = path.join(tmpDir, `kuml-obsidian-${ts}-in.kuml.kts`);
  const outFile = path.join(tmpDir, `kuml-obsidian-${ts}-out.svg`);

  // Write source to temp input file
  try {
    fs.writeFileSync(inFile, source, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`kuml CLI: could not write temp file: ${msg}`);
  }

  return new Promise<string>((resolve, reject) => {
    childProcess.execFile(
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
            .filter((l: string) =>
              l.trim().length > 0 &&
              !l.startsWith("WARNING:") &&
              !l.startsWith("SLF4J") &&
              !l.startsWith("Wrote "),
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
          const msg = e instanceof Error ? e.message : String(e);
          reject(new Error(`kuml CLI: could not read output file: ${msg}`));
          return;
        } finally {
          try { fs.unlinkSync(outFile); } catch { /* ignore */ }
        }

        if (!svg.includes("<svg")) {
          reject(new Error("kuml CLI: output file does not contain SVG"));
          return;
        }

        resolve(svg);
      },
    );
  });
}
