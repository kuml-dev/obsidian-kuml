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

export async function renderViaServer(source: string, serverUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: source,   // field name is "script", not "source"
        format: "svg",
        theme: "plain",   // valid values: plain | kuml | elegant | playful
        layout: "auto",
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`kuml-web responded ${response.status}: ${text.slice(0, 300)}`);
  }

  const data: RenderResponse = await response.json();

  if (!data.ok || !data.svg) {
    throw new Error(`kuml-web render failed: ${data.error ?? "unknown error"}`);
  }

  return data.svg;
}
