/**
 * Renders a kUML script via the kuml-web REST API (kuml serve).
 *
 * API contract: POST /api/render
 * Body (form-encoded): source=<script>&format=svg&theme=default&layout=auto
 * Response: SVG string (Content-Type: image/svg+xml or text/plain)
 *
 * Verify the exact request format against:
 * /Users/irakli/IdeaProjects/kUML/kuml-web/src/main/kotlin/dev/kuml/web/ApiRoutes.kt
 */
export async function renderViaServer(source: string, serverUrl: string): Promise<string> {
  const body = new URLSearchParams({
    source,
    format: "svg",
    theme: "default",
    layout: "auto",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/render`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`kuml-web responded ${response.status}: ${text.slice(0, 300)}`);
  }

  const svg = await response.text();
  if (!svg.trimStart().startsWith("<svg") && !svg.includes("<svg")) {
    throw new Error(`kuml-web returned unexpected content (not SVG)`);
  }
  return svg;
}
