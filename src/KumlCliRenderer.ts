import { Platform } from "obsidian";

/**
 * Monotonically increasing counter to guarantee unique temp-file names even
 * when multiple kuml blocks in the same note are rendered concurrently.
 *
 * Problem: Date.now() has only millisecond resolution. When a note is opened
 * with N kuml blocks, Obsidian schedules all N render calls in the same event-
 * loop tick → all N calls get the *same* timestamp → same filenames → race:
 *   - Call A writes inFile, Call B overwrites inFile
 *   - Both CLIs finish, last writer wins for outFile
 *   - The "losing" call's finally{} deletes outFile before the winner reads it
 *   → ENOENT: "kuml CLI: could not read output file"
 *
 * Fix: combine Date.now() (for human-readable debugging) with an atomic
 * per-module sequence number so concurrent calls always get distinct paths.
 */
let _renderSeq = 0;

/** Options for animated SVG rendering. */
export interface AnimatedRenderOptions {
  /** Emit SMIL-animated SVG (kuml render --animated). */
  animated: true;
  /**
   * Absolute path to a kuml.trace.v1 JSON file for trace-driven animation.
   * When omitted, a synthesised demo animation is produced (STM/Activity only;
   * BPMN renders static with a CLI warning when no trace is supplied).
   */
  tracePath?: string;
}

/**
 * Renders a kUML script by invoking the kUML CLI binary.
 *
 * Desktop-only — relies on Node.js builtins (child_process / fs / os / path)
 * that do not exist in the mobile (Capacitor) runtime. Every call site is
 * guarded by `Platform.isDesktopApp`; the built-in modules are loaded lazily
 * via require() so the mobile bundle never attempts to resolve them.
 *
 * Strategy (avoids /dev/stdout which Electron child processes cannot open):
 *   1. Write source to  /tmp/kuml-obsidian-<ts>-<seq>-in.kuml.kts
 *   2. Run: kuml render --format svg [--animated [--trace <path>]]
 *           -o /tmp/kuml-obsidian-<ts>-<seq>-out.svg <inFile>
 *   3. Read the output file → return SVG string
 *   4. Delete both temp files (best-effort)
 *
 * Stderr (JNA / Unsafe warnings) is filtered before showing errors to the user.
 *
 * V0.3.0 — added `animatedOptions` for kuml-animated code fence support.
 * V0.2.5 — reverted dynamic import() back to require()-based loading.
 */
export async function renderViaCli(
  source: string,
  cliPath: string,
  animatedOptions?: AnimatedRenderOptions,
): Promise<string> {
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
  const seq = _renderSeq++;
  const tmpDir = os.tmpdir();
  const inFile = path.join(tmpDir, `kuml-obsidian-${ts}-${seq}-in.kuml.kts`);
  const outFile = path.join(tmpDir, `kuml-obsidian-${ts}-${seq}-out.svg`);

  // Write source to temp input file
  try {
    fs.writeFileSync(inFile, source, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`kuml CLI: could not write temp file: ${msg}`);
  }

  // Build CLI argument list — base args + optional animated flags
  const cliArgs = ["render", "--format", "svg"];
  if (animatedOptions?.animated) {
    cliArgs.push("--animated");
    if (animatedOptions.tracePath) {
      cliArgs.push(`--trace=${animatedOptions.tracePath}`);
    }
  }
  cliArgs.push("-o", outFile, inFile);

  return new Promise<string>((resolve, reject) => {
    childProcess.execFile(
      cliPath,
      cliArgs,
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
