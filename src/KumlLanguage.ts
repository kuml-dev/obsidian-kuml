import { StreamLanguage, StreamParser } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror 6 StreamLanguage for kUML DSL (`.kuml.kts` syntax).
 *
 * Covers:
 * - Kotlin keywords and kUML DSL builder functions (coloured as keyword/function)
 * - Stereotypes «...» and <<...>>  (coloured as meta)
 * - Double-quoted strings (single and triple-quoted)
 * - Line comments `//` and block comments `/ * ... * /`
 * - Numbers (integers and decimals)
 * - Annotations @...
 *
 * Uses StreamLanguage (token-state machine) rather than a full Lezer grammar —
 * appropriate for Phase 1 (good colours, no AST). Lezer grammar can replace this
 * in a later wave.
 *
 * The @codemirror/* packages are marked `external` in esbuild.config.mjs, so
 * they are provided by Obsidian at runtime and are NOT bundled into main.js.
 */

interface KumlParserState {
  inBlockComment: boolean;
  inTripleString: boolean;
}

// kUML DSL builder functions (rendered as 'function' / builtin name)
const KUML_BUILDERS = new Set([
  "umlModel", "c4Model", "sysml2Model",
  "classDiagram", "classOf", "interfaceOf", "enumOf", "abstractClass",
  "component", "stateMachine", "useCaseDiagram", "actor", "useCase",
  "sequenceDiagram", "lifeline", "message",
  "activityDiagram", "action", "fork", "join", "decision", "merge",
  "bdd", "ibd", "uc", "req", "stm", "act", "seq", "par",
  "actDiagram", "stmDiagram",
  "partDef", "attributeDef", "portDef", "connectionDef",
  "part", "port", "attribute", "connect",
  "c4Person", "c4System", "c4Container", "c4Component", "c4Relation",
  "softwareSystem", "container", "person",
  "include", "extend", "associate", "generalize", "realize", "depend",
  "stereotype", "applyProfile", "autosarProfile",
  "note", "link", "flow",
  "umlStateMachine", "state", "transition", "initialState", "finalState",
]);

// Kotlin language keywords
const KOTLIN_KEYWORDS = new Set([
  "abstract", "actual", "annotation", "as", "break", "by",
  "catch", "class", "companion", "const", "constructor", "continue",
  "crossinline", "data", "delegate", "do", "dynamic", "else",
  "enum", "expect", "external", "false", "field", "file",
  "final", "finally", "for", "fun", "get", "if", "import",
  "in", "infix", "init", "inline", "inner", "interface", "internal",
  "is", "it", "lateinit", "noinline", "null", "object", "open",
  "operator", "out", "override", "package", "param", "private",
  "property", "protected", "public", "receiver", "reified", "return",
  "sealed", "set", "setparam", "super", "suspend", "tailrec",
  "this", "throw", "true", "try", "typealias", "typeof",
  "val", "value", "var", "vararg", "when", "where", "while",
]);

export const kumlStreamParser: StreamParser<KumlParserState> = {
  name: "kuml",

  startState(): KumlParserState {
    return { inBlockComment: false, inTripleString: false };
  },

  token(stream, state): string | null {
    // ── Block comment continuation ────────────────────────────────────────
    if (state.inBlockComment) {
      if (stream.match("*/")) {
        state.inBlockComment = false;
        return "comment";
      }
      stream.next();
      return "comment";
    }

    // ── Triple-quoted string continuation ─────────────────────────────────
    if (state.inTripleString) {
      if (stream.match('"""')) {
        state.inTripleString = false;
        return "string";
      }
      stream.next();
      return "string";
    }

    // ── Skip whitespace ───────────────────────────────────────────────────
    if (stream.eatSpace()) return null;

    // ── Line comment // ───────────────────────────────────────────────────
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    // ── Block comment start /* ────────────────────────────────────────────
    if (stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }

    // ── Triple-quoted string """ ──────────────────────────────────────────
    if (stream.match('"""')) {
      state.inTripleString = true;
      return "string";
    }

    // ── Regular double-quoted string ──────────────────────────────────────
    if (stream.peek() === '"') {
      stream.next(); // consume opening "
      while (!stream.eol()) {
        const ch = stream.peek();
        if (ch === "\\") {
          stream.next(); // escape char
          stream.next(); // escaped char
          continue;
        }
        if (ch === '"') {
          stream.next(); // consume closing "
          break;
        }
        stream.next();
      }
      return "string";
    }

    // ── Number ────────────────────────────────────────────────────────────
    if (stream.match(/^\d+(\.\d+)?([eE][+-]?\d+)?[fFlLdD]?/)) {
      return "number";
    }

    // ── Annotation @Identifier ────────────────────────────────────────────
    if (stream.peek() === "@") {
      stream.next();
      stream.match(/^[\w$]+/);
      return "meta";
    }

    // ── Stereotype «...» ──────────────────────────────────────────────────
    if (stream.peek() === "«") {
      stream.next();
      while (!stream.eol() && stream.peek() !== "»") stream.next();
      if (!stream.eol()) stream.next(); // consume »
      return "meta";
    }
    // Stereotype <<...>>
    if (stream.match("<<")) {
      while (!stream.eol() && !stream.match(">>", false)) stream.next();
      stream.match(">>");
      return "meta";
    }

    // ── Identifier: keyword / builder / plain ─────────────────────────────
    if (stream.match(/^[a-zA-Z_$][\w$]*/)) {
      const word = stream.current();
      if (KOTLIN_KEYWORDS.has(word)) return "keyword";
      if (KUML_BUILDERS.has(word)) return "builtin";
      return null; // plain identifier — no colour
    }

    // ── Everything else: consume one char ─────────────────────────────────
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
};

export const kumlLanguage = StreamLanguage.define(kumlStreamParser);
