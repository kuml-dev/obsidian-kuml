import { requestUrl, RequestUrlResponse } from "obsidian";

/**
 * Renders a kUML script via the kuml-web REST API (kuml serve).
 *
 * API contract (verified against kuml-web/src/main/resources/web/static/app.js):
 *   POST /api/render
 *   Content-Type: application/json
 *   Body: { script: string, format: "svg"|"png"|"latex", theme: string, layout: string }
 *
 * Response (JSON):
 *   { ok: boolean, format: string, svg: string|null, pngBase64: string|null,
 *     latex: string|null, durationMs: number, error: string|null }
 *
 * Valid themes: "plain" | "kuml" | "elegant" | "playful"  (NOT "default")
 *
 * V0.2.4 — Migrated from browser `fetch` to Obsidian's `requestUrl` per
 * reviewer guidance: `requestUrl` bypasses Electron's CORS layer and works
 * uniformly across desktop and mobile builds. Also switched the abort
 * timeout to `window.setTimeout` / `window.clearTimeout` for popout window
 * compatibility, and tightened the response typing so no `any` survives.
 */

interface RenderResponse {
  ok: boolean;
  format: string;
  svg: string | null;
  pngBase64: string | null;
  latex: string | null;
  durationMs: number;
  error: string | null;
}

/** Narrow JSON value type — anything we'd see from kuml-web's structured response. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function isRenderResponse(v: JsonValue): v is RenderResponse & JsonValue {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, JsonValue>;
  return (
    typeof o.ok === "boolean" &&
    typeof o.format === "string" &&
    (typeof o.svg === "string" || o.svg === null) &&
    (typeof o.pngBase64 === "string" || o.pngBase64 === null) &&
    (typeof o.latex === "string" || o.latex === null) &&
    typeof o.durationMs === "number" &&
    (typeof o.error === "string" || o.error === null)
  );
}

export async function renderViaServer(source: string, serverUrl: string): Promise<string> {
  // Build a manual abort timer using `window.setTimeout` (popout-safe). Obsidian's
  // requestUrl doesn't support AbortSignal, so we race it against a timeout.
  let timeoutHandle: number | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = window.setTimeout(
      () => reject(new Error("kuml-web request timed out after 10s")),
      10_000,
    );
  });

  let response: RequestUrlResponse;
  try {
    response = await Promise.race([
      requestUrl({
        url: `${serverUrl}/api/render`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: source,
          format: "svg",
          theme: "plain",
          layout: "auto",
        }),
        // We handle non-2xx ourselves so the error includes the body text.
        throw: false,
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
  }

  if (response.status < 200 || response.status >= 300) {
    const snippet = (response.text ?? "").slice(0, 300);
    throw new Error(`kuml-web responded ${response.status}: ${snippet}`);
  }

  const json: JsonValue = response.json as JsonValue;
  if (!isRenderResponse(json)) {
    throw new Error("kuml-web response did not match the expected schema");
  }

  if (!json.ok || !json.svg) {
    throw new Error(`kuml-web render failed: ${json.error ?? "unknown error"}`);
  }

  return json.svg;
}
