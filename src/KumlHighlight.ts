import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { kumlLanguage } from "./KumlLanguage";

/**
 * Highlight style for kUML DSL — maps token types to CSS classes that
 * respect the active Obsidian theme.
 *
 * Uses Obsidian CSS variables (--code-keyword, --code-string, etc.) via
 * dedicated CSS classes defined in styles.css. This ensures correct
 * colours in both light and dark Obsidian themes without hardcoded hex.
 *
 * Token → CSS class mapping:
 *   keyword  → cm-kuml-keyword
 *   string   → cm-kuml-string
 *   comment  → cm-kuml-comment
 *   number   → cm-kuml-number
 *   builtin  → cm-kuml-builtin   (kUML DSL builder functions)
 *   meta     → cm-kuml-meta      (stereotypes, annotations)
 */
export const kumlHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, class: "cm-kuml-keyword" },
  { tag: t.string, class: "cm-kuml-string" },
  { tag: t.comment, class: "cm-kuml-comment" },
  { tag: t.number, class: "cm-kuml-number" },
  { tag: t.standard(t.name), class: "cm-kuml-builtin" },
  { tag: t.meta, class: "cm-kuml-meta" },
]);

/**
 * Combined CodeMirror 6 extension: language + highlight style.
 *
 * Register in plugin onload() via:
 *   this.registerEditorExtension(kumlHighlightExtension);
 *
 * This activates syntax highlighting in Source Mode and Live Preview for
 * code fences tagged with ```kuml. Reading View SVG rendering is handled
 * separately by the MarkdownPostProcessor (unchanged from v0.1.0).
 */
export const kumlHighlightExtension: Extension = [
  kumlLanguage,
  syntaxHighlighting(kumlHighlightStyle),
];
