import {
  App,
  FileSystemAdapter,
  Modal,
  Plugin,
  MarkdownPostProcessorContext,
  setIcon,
  setTooltip,
} from "obsidian";
import { KumlSettings, DEFAULT_SETTINGS } from "./src/KumlSettings";
import { KumlSettingsTab } from "./src/KumlSettingsTab";
import { renderKuml } from "./src/KumlRenderer";
import { AnimatedRenderOptions } from "./src/KumlCliRenderer";
import { kumlHighlightExtension } from "./src/KumlHighlight";

/**
 * Parse the optional `// trace: <vault-relative-path>` directive from the
 * first non-empty line of a kuml-animated source block.
 *
 * Returns `{ dslSource, tracePath }` where:
 *  - `dslSource` is the source with the directive line stripped (if present).
 *  - `tracePath` is the absolute filesystem path to the trace file, or
 *    `undefined` when no directive is found.
 *
 * The trace path is resolved relative to the vault root using the Obsidian
 * FileSystemAdapter. On mobile (no FileSystemAdapter), the directive is
 * silently ignored and `tracePath` is always `undefined`.
 */
function parseAnimatedSource(
  raw: string,
  vaultBasePath: string | undefined,
): { dslSource: string; tracePath: string | undefined } {
  const traceDirectiveRe = /^\/\/\s*trace:\s*(.+)$/m;
  const match = traceDirectiveRe.exec(raw);
  if (!match) {
    return { dslSource: raw, tracePath: undefined };
  }
  const relPath = match[1].trim();
  // Construct absolute path without a static Node.js `path` import — avoids
  // a module-load-time require() that would fail on mobile (Capacitor).
  // FileSystemAdapter.getBasePath() returns the vault root without a trailing
  // slash on macOS/Linux/Windows, so we add one when joining.
  const tracePath =
    vaultBasePath != null
      ? `${vaultBasePath}/${relPath}`.replace(/\/\//g, "/")
      : undefined;
  // Strip the directive line from the DSL source passed to the CLI
  const dslSource = raw.replace(match[0], "").trimStart();
  return { dslSource, tracePath };
}

/**
 * Inject a parsed SVG element into a container element.
 *
 * Uses the DOMParser pipeline (image/svg+xml) rather than innerHTML injection.
 * Strips `<script>` and `<foreignObject>` elements for defence-in-depth.
 * Removes static width/height attributes so the SVG scales to container width.
 *
 * Throws if the SVG string is unparseable.
 */
function injectSvg(svg: string, container: HTMLElement): void {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svg, "image/svg+xml");
  const parserError = svgDoc.querySelector("parsererror");
  if (parserError) {
    throw new Error(
      `Invalid SVG returned by renderer: ${parserError.textContent ?? "parse error"}`,
    );
  }
  svgDoc.querySelectorAll("script, foreignObject").forEach((n) => n.remove());
  const svgEl = svgDoc.documentElement;
  container.appendChild(svgEl);
  svgEl.removeAttribute("width");
  svgEl.removeAttribute("height");
  svgEl.classList.add("kuml-diagram-svg");
}

/**
 * Lightbox modal that displays a kUML diagram SVG at full width.
 *
 * Opens when the user clicks on any rendered diagram. Obsidian's Modal base
 * class handles Escape-to-close and click-on-backdrop-to-close automatically.
 *
 * V0.4.0
 */
class KumlZoomModal extends Modal {
  private readonly svgClone: SVGElement;

  // ── Zoom/pan state ────────────────────────────────────────────────────
  private scale = 1; // current absolute zoom factor (1 == SVG native pixel size)
  // The scale zoomFit() lands on — the "at rest" baseline. Not always 1: see
  // zoomFit()'s MIN_FIT_SCALE floor and its scale-up-small-diagrams behaviour.
  // canPan/reset comparisons are relative to this, not to a hardcoded 1.
  private fitScale = 1;
  private nativeWidth = 0; // SVG's own viewBox width in px, set once in onOpen()
  private nativeHeight = 0;
  private translateX = 0; // pan offset in px (post-scale, applied to stage)
  private translateY = 0;
  private isPanning = false;
  private panStartX = 0; // pointer clientX at drag start
  private panStartY = 0;
  private panOriginX = 0; // translateX at drag start
  private panOriginY = 0;

  private readonly MIN_SCALE = 0.25;
  private readonly MAX_SCALE = 4;
  private readonly ZOOM_STEP = 1.2; // multiplicative per button click / wheel notch
  // zoomFit() never auto-shrinks a diagram past this fraction of its native
  // size — a huge diagram would otherwise squeeze its text below legibility
  // just to fit the viewport. Below this floor the diagram overflows the
  // viewport instead (pan/scroll fallback already in place); small diagrams
  // still scale *up* to fill the viewport as before, unaffected by this floor.
  private readonly MIN_FIT_SCALE = 0.6;

  // ── DOM refs ──────────────────────────────────────────────────────────
  private viewportEl!: HTMLDivElement; // clips + is the pan surface (overflow:hidden)
  private stageEl!: HTMLDivElement; // transformed wrapper holding the SVG
  private toolbarEl!: HTMLDivElement;

  // ── Bound listener refs (needed so removeEventListener works) ──────────
  private onWheelBound = (e: WheelEvent) => this.handleWheel(e);
  private onPointerDownBound = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMoveBound = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUpBound = (e: PointerEvent) => this.handlePointerUp(e);

  // ── Download bookkeeping ─────────────────────────────────────────────
  private downloadCounter = 0; // increments per download to avoid filename collisions
  private readonly liveObjectUrls = new Set<string>(); // any not-yet-revoked URLs

  constructor(
    app: App,
    svgEl: SVGElement,
    private readonly fileBaseName: string,
  ) {
    super(app);
    this.svgClone = svgEl.cloneNode(true) as SVGElement;
  }

  onOpen(): void {
    this.modalEl.addClass("kuml-zoom-modal");
    this.contentEl.addClass("kuml-zoom-content");

    // Force the fixed 80% size via inline style too, not just the
    // .kuml-zoom-modal.modal stylesheet rule. Obsidian's own modal
    // positioning can set inline width/height/transform on modalEl, which
    // would silently beat a plain stylesheet rule — leaving the modal at
    // whatever size Obsidian picked, and every zoomFit() measurement (see
    // below and the "Fit" button) wrong as a result.
    this.modalEl.style.width = "80vw";
    this.modalEl.style.height = "80vh";
    this.modalEl.style.maxWidth = "80vw";
    this.modalEl.style.maxHeight = "80vh";

    // Toolbar (sticky top bar).
    this.toolbarEl = this.contentEl.createDiv({ cls: "kuml-zoom-toolbar" });
    this.buildToolbar();

    // Viewport clips; stage is the transform target.
    this.viewportEl = this.contentEl.createDiv({ cls: "kuml-zoom-viewport" });
    this.stageEl = this.viewportEl.createDiv({ cls: "kuml-zoom-stage" });

    // Strip inline sizing so our CSS/transform fully controls layout.
    this.svgClone.removeAttribute("width");
    this.svgClone.removeAttribute("height");
    this.svgClone.removeAttribute("style");
    this.svgClone.addClass("kuml-zoom-svg");
    this.stageEl.appendChild(this.svgClone);

    // Pin the SVG to its own native pixel size (from viewBox) so all zoom/pan
    // scaling happens via the stage's CSS transform rather than implicit SVG
    // auto-sizing — some Chromium builds size a <svg> with no explicit
    // width/height inconsistently (see downloadPng()'s pngSvg clone for the
    // same defensive pattern). This also lets zoomFit() compute an explicit
    // contain-fit scale with a legibility floor instead of an unconstrained
    // CSS width:100%.
    const native = this.intrinsicSize(this.svgClone);
    this.nativeWidth = native.width;
    this.nativeHeight = native.height;
    this.svgClone.setAttribute("width", String(this.nativeWidth));
    this.svgClone.setAttribute("height", String(this.nativeHeight));

    // Interaction listeners live on the viewport (pan/zoom surface).
    this.viewportEl.addEventListener("wheel", this.onWheelBound, { passive: false });
    this.viewportEl.addEventListener("pointerdown", this.onPointerDownBound);
    this.viewportEl.addEventListener("pointermove", this.onPointerMoveBound);
    this.viewportEl.addEventListener("pointerup", this.onPointerUpBound);
    this.viewportEl.addEventListener("pointercancel", this.onPointerUpBound);

    // Start at fit. Deferred one frame: right after opening, the modal may
    // not have settled into its final layout yet (Obsidian's own open/centre
    // positioning, or this plugin's own stylesheet not yet applied), so
    // viewportEl.getBoundingClientRect() inside zoomFit() isn't reliable in
    // this exact synchronous tick.
    requestAnimationFrame(() => this.zoomFit());
  }

  onClose(): void {
    // Remove interaction listeners (viewportEl may be undefined if open failed early — guard).
    if (this.viewportEl) {
      this.viewportEl.removeEventListener("wheel", this.onWheelBound);
      this.viewportEl.removeEventListener("pointerdown", this.onPointerDownBound);
      this.viewportEl.removeEventListener("pointermove", this.onPointerMoveBound);
      this.viewportEl.removeEventListener("pointerup", this.onPointerUpBound);
      this.viewportEl.removeEventListener("pointercancel", this.onPointerUpBound);
    }
    // Revoke any object URLs still outstanding (belt-and-suspenders; each download revokes its own).
    this.liveObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.liveObjectUrls.clear();

    this.isPanning = false;
    this.contentEl.empty();
  }

  // ── Toolbar ───────────────────────────────────────────────────────────

  private buildToolbar(): void {
    const mkBtn = (
      icon: string,
      tooltip: string,
      fallbackLabel: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const btn = this.toolbarEl.createEl("button", { cls: "kuml-zoom-btn" });
      setIcon(btn, icon);
      setTooltip(btn, tooltip, { placement: "bottom" });
      btn.setAttribute("aria-label", tooltip);
      if (btn.childElementCount === 0) {
        btn.setText(fallbackLabel);
      }
      btn.addEventListener("click", (e) => {
        e.stopPropagation(); // don't let clicks bubble to any backdrop handler
        onClick();
      });
      return btn;
    };

    mkBtn("zoom-in", "Zoom in", "+", () => this.zoomIn());
    mkBtn("zoom-out", "Zoom out", "−", () => this.zoomOut());
    mkBtn("maximize", "Fit to window", "Fit", () => this.zoomFit()); // "maximize" lucide icon == fit
    // Visual separator
    this.toolbarEl.createDiv({ cls: "kuml-zoom-toolbar-sep" });
    mkBtn("download", "Download SVG", "SVG", () => this.downloadSvg());
    mkBtn("image-down", "Download PNG", "PNG", () => this.downloadPng());
  }

  // ── Zoom + pan math ───────────────────────────────────────────────────

  private applyTransform(): void {
    // Cursor: grab only when panning is possible (zoomed past fit).
    const canPan = this.scale > this.fitScale * 1.0001;
    if (!canPan) {
      // Snap back to centered/no-offset at fit so we never leave a diagram parked
      // off-screen. Must happen *before* writing style.transform below, otherwise
      // the DOM keeps rendering the stale (pre-reset) offset while our internal
      // state already believes translateX/translateY are 0 — the next zoom/pan
      // action would then compute its pivot math from that wrong baseline.
      this.translateX = 0;
      this.translateY = 0;
    }
    this.stageEl.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    this.viewportEl.toggleClass("kuml-zoom-pannable", canPan);
  }

  private clampScale(s: number): number {
    return Math.min(this.MAX_SCALE, Math.max(this.MIN_SCALE, s));
  }

  private zoomTo(newScale: number, pivotClientX?: number, pivotClientY?: number): void {
    const prev = this.scale;
    const next = this.clampScale(newScale);
    if (next === prev) return;

    // Zoom around a pivot (pointer position) so wheel-zoom feels anchored.
    // If no pivot given (button click), pivot on viewport center.
    const rect = this.viewportEl.getBoundingClientRect();
    const px = (pivotClientX ?? rect.left + rect.width / 2) - rect.left;
    const py = (pivotClientY ?? rect.top + rect.height / 2) - rect.top;

    // Keep the point under the pivot fixed: solve for new translate.
    // stagePoint = (pivot - translate) / prevScale ; new translate = pivot - stagePoint*next
    const stageX = (px - this.translateX) / prev;
    const stageY = (py - this.translateY) / prev;
    this.scale = next;
    this.translateX = px - stageX * next;
    this.translateY = py - stageY * next;
    this.applyTransform();
  }

  private zoomIn(): void {
    this.zoomTo(this.scale * this.ZOOM_STEP);
  }

  private zoomOut(): void {
    this.zoomTo(this.scale / this.ZOOM_STEP);
  }

  private zoomFit(): void {
    // Contain-fit the SVG's native pixel size (viewBox) within the viewport's
    // actual pixel box — the viewport itself is now a fixed ~80% of the
    // Obsidian window (see styles.css), not content-driven, so this is a
    // real "does it fit" computation rather than an implicit CSS width:100%.
    const rect = this.viewportEl.getBoundingClientRect();
    const containScale =
      rect.width > 0 && rect.height > 0 && this.nativeWidth > 0 && this.nativeHeight > 0
        ? Math.min(rect.width / this.nativeWidth, rect.height / this.nativeHeight)
        : 1;
    // Never auto-shrink past MIN_FIT_SCALE: a huge diagram would otherwise be
    // squeezed down until its text is illegible. Small diagrams still scale
    // *up* to fill the viewport, unaffected by this floor.
    this.fitScale = this.clampScale(Math.max(containScale, this.MIN_FIT_SCALE));
    this.scale = this.fitScale;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  private handleWheel(e: WheelEvent): void {
    // At/under fit level (not pannable) the viewport may still genuinely
    // overflow — e.g. a diagram whose MIN_FIT_SCALE floor kept it larger than
    // the viewport. styles.css falls back to native `overflow: auto`
    // scrolling for exactly that case
    // (`.kuml-zoom-viewport:not(.kuml-zoom-pannable)`), but that fallback is
    // unreachable if we unconditionally hijack every wheel notch for zoom.
    // So: when not zoomed past fit AND there's real overflow to scroll,
    // let the wheel event scroll natively instead of zooming — unless the
    // user is explicitly asking to zoom (Ctrl/Cmd+wheel, the standard
    // trackpad-pinch-to-zoom signal in Chromium).
    const canPan = this.scale > this.fitScale * 1.0001;
    if (!canPan && !e.ctrlKey && !e.metaKey) {
      const hasOverflow =
        this.viewportEl.scrollHeight > this.viewportEl.clientHeight + 1 ||
        this.viewportEl.scrollWidth > this.viewportEl.clientWidth + 1;
      if (hasOverflow) {
        return; // don't preventDefault — allow native scroll
      }
    }
    e.preventDefault(); // stop the modal/page from scrolling
    const dir = e.deltaY < 0 ? this.ZOOM_STEP : 1 / this.ZOOM_STEP;
    this.zoomTo(this.scale * dir, e.clientX, e.clientY);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.scale <= this.fitScale * 1.0001) return; // no pan at/under fit
    if (e.button !== 0) return; // left button / primary only
    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
    this.panOriginX = this.translateX;
    this.panOriginY = this.translateY;
    this.viewportEl.setPointerCapture(e.pointerId); // keep receiving moves outside the modal
    this.viewportEl.addClass("kuml-zoom-panning"); // cursor: grabbing
    e.preventDefault();
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isPanning) return;
    this.translateX = this.panOriginX + (e.clientX - this.panStartX);
    this.translateY = this.panOriginY + (e.clientY - this.panStartY);
    this.applyTransform();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.viewportEl.removeClass("kuml-zoom-panning");
    try {
      this.viewportEl.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  // ── Downloads ─────────────────────────────────────────────────────────

  private nextFileName(ext: string): string {
    this.downloadCounter += 1;
    const base = this.fileBaseName && this.fileBaseName.length ? this.fileBaseName : "kuml-diagram";
    const suffix = this.downloadCounter > 1 ? `-${this.downloadCounter}` : "";
    return `${base}${suffix}.${ext}`;
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    this.liveObjectUrls.add(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on next tick so the download has a chance to start (Chromium quirk).
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      this.liveObjectUrls.delete(url);
    }, 1000);
  }

  /**
   * Determine the intrinsic pixel size of the SVG for PNG canvas sizing.
   * Falls back through viewBox → getBBox() → getBoundingClientRect() → a
   * hardcoded default, so a PNG export always has a valid non-zero size.
   */
  private intrinsicSize(svg: SVGElement): { width: number; height: number } {
    // 1) viewBox (most reliable; renderer emits it).
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        return { width: parts[2], height: parts[3] };
      }
    }
    // 2) getBBox() — requires the element to be in the live DOM (it is: it's in stageEl).
    try {
      const bb = (svg as unknown as SVGGraphicsElement).getBBox();
      if (bb.width > 0 && bb.height > 0) {
        return { width: Math.ceil(bb.width), height: Math.ceil(bb.height) };
      }
    } catch {
      /* getBBox can throw if not rendered; fall through */
    }
    // 3) Rendered client rect of the SVG element.
    const r = svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
    }
    // 4) Last-resort default.
    return { width: 800, height: 600 };
  }

  /** Serialize `this.svgClone` (un-zoomed — transform lives on the ancestor stage, not the SVG). */
  private serializeSvg(): { xml: string; width: number; height: number } {
    const svg = this.svgClone;
    // Ensure namespaces for a valid standalone file.
    if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!svg.getAttribute("xmlns:xlink")) svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    const { width, height } = this.intrinsicSize(svg);
    const xml = new XMLSerializer().serializeToString(svg);
    return { xml, width, height };
  }

  private downloadSvg(): void {
    const { xml } = this.serializeSvg();
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${xml}`;
    const blob = new Blob([doc], { type: "image/svg+xml;charset=utf-8" });
    this.triggerDownload(blob, this.nextFileName("svg"));
  }

  private downloadPng(): void {
    // Determine intrinsic size from the on-screen clone, but rasterize from a
    // *separate* clone that carries explicit width/height attributes — some
    // Chromium builds rasterize an <img> at 0×0 if the SVG lacks them. The
    // on-screen svgClone (and the plain .svg export) stays untouched.
    const { width, height } = this.intrinsicSize(this.svgClone);
    const pngSvg = this.svgClone.cloneNode(true) as SVGElement;
    if (!pngSvg.getAttribute("xmlns")) pngSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!pngSvg.getAttribute("xmlns:xlink"))
      pngSvg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    pngSvg.setAttribute("width", String(width));
    pngSvg.setAttribute("height", String(height));
    const xml = new XMLSerializer().serializeToString(pngSvg);

    // Cap raster dimensions so a huge diagram × DPR can't blow past canvas limits.
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const MAX_CANVAS_PX = 8192; // conservative cross-platform max canvas edge
    let scale = dpr;
    if (width * scale > MAX_CANVAS_PX || height * scale > MAX_CANVAS_PX) {
      scale = Math.min(MAX_CANVAS_PX / width, MAX_CANVAS_PX / height);
    }
    const canvasW = Math.max(1, Math.round(width * scale));
    const canvasH = Math.max(1, Math.round(height * scale));

    // Blob URL keeps the canvas same-origin → toBlob() won't throw SecurityError.
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    this.liveObjectUrls.add(svgUrl);

    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvasW;
        canvas.height = canvasH;
        const cctx = canvas.getContext("2d");
        if (!cctx) throw new Error("2D canvas context unavailable");
        // White/theme background so transparent SVGs aren't black in some viewers.
        cctx.fillStyle =
          getComputedStyle(this.contentEl).getPropertyValue("--background-primary").trim() ||
          "#ffffff";
        cctx.fillRect(0, 0, canvasW, canvasH);
        cctx.drawImage(img, 0, 0, canvasW, canvasH);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) this.triggerDownload(pngBlob, this.nextFileName("png"));
          URL.revokeObjectURL(svgUrl);
          this.liveObjectUrls.delete(svgUrl);
        }, "image/png");
      } catch (err) {
        URL.revokeObjectURL(svgUrl);
        this.liveObjectUrls.delete(svgUrl);
        console.error("kUML PNG export failed:", err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      this.liveObjectUrls.delete(svgUrl);
      console.error("kUML PNG export: SVG failed to load into Image");
    };
    img.src = svgUrl;
  }
}

export default class KumlPlugin extends Plugin {
  settings!: KumlSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new KumlSettingsTab(this.app, this));

    // V0.2.0 — Syntax highlighting for ```kuml code fences in Source Mode
    // and Live Preview. Reading View SVG rendering continues to be handled
    // by the MarkdownPostProcessor registered below (unchanged from v0.1.0).
    this.registerEditorExtension(kumlHighlightExtension);

    // ── Static renderer: ```kuml ─────────────────────────────────────────
    // registerMarkdownCodeBlockProcessor covers both Reading View and Live Preview.
    this.registerMarkdownCodeBlockProcessor(
      "kuml",
      async (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        await this.renderBlock(source.trim(), el, undefined);
      },
    );

    // ── Animated renderer: ```kuml-animated ──────────────────────────────
    // V0.3.0 — renders with `kuml render --animated [--trace <path>]`.
    // The SVG is injected inline (DOMParser → appendChild) so Chromium's
    // SMIL engine executes the animations — unlike <img> which sandboxes them.
    //
    // Optional first-line directive in the source block:
    //   // trace: vault-relative/path/to/trace.json
    // When present, the trace file drives the animation (BPMN, STM, Activity).
    // When absent, a synthesised demo is produced for STM/Activity diagrams;
    // BPMN renders statically with a CLI warning.
    this.registerMarkdownCodeBlockProcessor(
      "kuml-animated",
      async (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
        const vaultBasePath =
          this.app.vault.adapter instanceof FileSystemAdapter
            ? this.app.vault.adapter.getBasePath()
            : undefined;
        const { dslSource, tracePath } = parseAnimatedSource(source.trim(), vaultBasePath);
        const animatedOptions: AnimatedRenderOptions = {
          animated: true,
          ...(tracePath ? { tracePath } : {}),
        };
        await this.renderBlock(dslSource, el, animatedOptions);
      },
    );
  }

  /**
   * Shared render-and-inject pipeline for both static and animated blocks.
   *
   * Shows a loading spinner while the CLI/server runs, then replaces it with
   * the inline SVG. On error, shows the error message in place of the spinner.
   */
  private async renderBlock(
    source: string,
    el: HTMLElement,
    animatedOptions: AnimatedRenderOptions | undefined,
  ): Promise<void> {
    if (!source) return;

    const container = el.createDiv({ cls: "kuml-diagram" });

    // ── Loading placeholder ───────────────────────────────────────────────
    const loading = container.createDiv({ cls: "kuml-loading" });
    loading.createDiv({ cls: "kuml-spinner" });
    loading.createSpan({
      cls: "kuml-loading-text",
      text: animatedOptions?.animated ? "Rendering animated diagram…" : "Rendering diagram…",
    });

    try {
      const svg = await renderKuml(source, this.settings, animatedOptions);

      // V0.2.4 — DOMParser pipeline (inline SVG → SMIL animations work in
      // Chromium/Electron because the SVG lives in the HTML document's DOM,
      // not inside a sandboxed <img> or external resource reference).
      loading.remove();
      injectSvg(svg, container);

      // V0.4.0 — Click-to-zoom: clicking the diagram opens it in a lightbox.
      const svgEl = container.querySelector<SVGElement>("svg");
      if (svgEl) {
        container.addClass("kuml-diagram--zoomable");
        container.addEventListener("click", () => {
          const raw = this.app.workspace.getActiveFile()?.basename ?? "kuml-diagram";
          const safe =
            raw
              .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
              .trim()
              .replace(/\s+/g, "-") || "kuml-diagram";
          new KumlZoomModal(this.app, svgEl, safe).open();
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      loading.remove();
      container.addClass("kuml-error");
      container.createEl("strong", { text: "kUML render error" });
      container.createEl("pre", { text: msg });
    }
  }

  async loadSettings() {
    // V0.2.5 — `Plugin.loadData()` is declared `Promise<any>` in the Obsidian
    // types, so the previous `Object.assign({}, DEFAULTS, await loadData())`
    // spread propagated `any` into `this.settings`. We narrow the value to
    // `Partial<KumlSettings>` after the load and let Object.assign produce a
    // typed result. Unknown fields in the persisted JSON are ignored — only
    // keys we know about are picked up by Partial<KumlSettings>.
    const persisted = (await this.loadData()) as Partial<KumlSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, persisted ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
