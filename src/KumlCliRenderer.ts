import { Platform } from "obsidian";

/**
 * Renders a kUML script by invoking the kUML CLI binary.
 *
 * Desktop-only — relies on Node.js builtins (child_process / fs / os / path)
 * that do not exist in the mobile (Capacitor) runtime. Every call site is
 * guarded by `Platform.isDesktopApp`; the built-in modules are loaded lazily
 * via require() so the mobile bundle never attempts to resolve them.
 *
 * Strategy (avoids /dev/stdout which Electron child processes cannot open):
 *   1. Write source to  /tmp/kuml-obsidian-<ts>-in.kuml.kts
 *   2. Run: kuml render --format svg -o /tmp/kuml-obsidian-<ts>-out.svg <inFile>
 *   3. Read the output file → return SVG string
 *   4. Delete both temp files (best-effort)
 *
 * Stderr (JNA / Unsafe warnings) is filtered before showing errors to the user.
 *
 * V0.2.5 — reverted dynamic import() back to require()-based loading.
 * esbuild (format: "cjs") does NOT transform `await import("child_process")`
 * to require() for external modules — it leaves the call as a native ES
 * dynamic import, which Electron's browser-side ESM resolver intercepts and
 * fails with "Failed to resolve module specifier 'child_process'".
 * Solution: eval("require") bypasses both TypeScript's ESM type context and
 * esbuild's static analysis, while resolving correctly via Node/Electron's
 * CommonJS require() at runtime.
 */
export async function renderViaCli(source: string, cliPath: string): Promise<string> {
  if (!Platform.isDesktopApp) {
    throw new Error("CLI rendering is only available on desktop. Use server mode for mobile.");
  }

  // eval("require") is the canonical Obsidian-plugin pattern for accessing
  // Node built-ins from a CJS bundle without triggering Electron's browser-side
  // ESM resolver. `require` is in scope at runtime (esbuild CJS wrapper), but
  // TypeScript's ESNext module type-context doesn't know it — eval() bridges
  // that gap without disable comments or static imports that would run at
  // module-load time (and fail on mobile).
  // eslint-disable-next-line no-eval
  const req = eval("require") as NodeRequire;
  const childProcess = req("child_process") as typeof import("child_process");
  const fs = req("fs") as typeof import("fs");
  const os = req("os") as typeof import("os");
  const path = req("path") as typeof import("path");

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
