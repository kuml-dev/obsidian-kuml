# kUML Diagrams — Obsidian Plugin

Render [kUML](https://kuml.dev) diagram scripts as inline SVG in your Obsidian notes.  
Supports UML class diagrams, C4 architecture diagrams, and SysML 2 diagrams — with syntax highlighting in the editor.

## What it looks like

Write a fenced code block tagged `kuml`:

~~~markdown
```kuml
import dev.kuml.core.dsl.*

classDiagram(name = "Order Domain") {
    classOf("Order") {
        attribute("id", "String")
        attribute("status", "OrderStatus")
    }
    classOf("Customer") {
        attribute("name", "String")
        attribute("email", "String")
    }
    association("Order", "Customer", label = "placedBy")
}
```
~~~

In Reading View the block renders as an inline SVG diagram.  
In Source Mode and Live Preview the DSL keywords, strings, and comments are syntax-highlighted.

## Installation

### Community Plugin Store (recommended)

1. Open **Settings → Community Plugins → Browse**
2. Search for **kUML Diagrams**
3. Click **Install**, then **Enable**

### Manual (BRAT / development)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add `kuml-dev/obsidian-kuml` as a beta plugin

Or download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/kuml-dev/obsidian-kuml/releases/latest) and place them in `.obsidian/plugins/obsidian-kuml/`.

## Prerequisites

The plugin renders via either:

| Mode | Requirement |
|---|---|
| **Server** (default, recommended) | kUML server running: `kuml serve` (or `kuml serve --port 4242`) |
| **CLI** (desktop fallback) | kUML CLI installed: `brew install kuml-dev/kuml/kuml` or download from [kuml.dev/install](https://kuml.dev/install) |

## Setup

After enabling the plugin, open **Settings → kUML Diagrams**:

| Setting | Default | Description |
|---|---|---|
| Render mode | Auto | Auto = try Server, fall back to CLI |
| Server URL | `http://localhost:4242` | URL of a running `kuml serve` instance |
| CLI path | `kuml` | Path to the `kuml` binary |

**Quick start with server mode:**

```bash
# Install kUML CLI
brew install kuml-dev/kuml/kuml   # macOS
sdk install kuml                  # SDKMAN!

# Start the server (keeps running in background)
kuml serve
```

Then open or refresh your vault — diagrams render automatically.

## Usage

Any fenced code block tagged `` ```kuml `` is processed:

- **Reading View**: rendered as inline SVG
- **Source Mode / Live Preview**: syntax-highlighted DSL

### Supported diagram types

| Tag | Example |
|---|---|
| UML Class | `classDiagram { classOf("User") { … } }` |
| UML State Machine | `stateMachine("Traffic Light") { … }` |
| UML Sequence | `sequenceDiagram { lifeline("Client") … }` |
| UML Use Case | `useCaseDiagram { actor("User") … }` |
| UML Activity | `activityDiagram { action("Start") … }` |
| C4 Landscape | `c4Model { person("Customer") … }` |
| C4 Container | `c4Model { container("API") … }` |
| SysML 2 BDD | `sysml2Model { partDef("Vehicle") … }` |
| SysML 2 + others | all 8 SysML 2 diagram types supported |

Full DSL reference: [kuml.dev/docs](https://kuml.dev/docs)

## Troubleshooting

**"kUML render error: fetch failed"**  
→ The server is not running. Start with `kuml serve`, or switch Render mode to **CLI** in Settings.

**"kUML render error: spawn kuml ENOENT"**  
→ CLI not found. Install kUML and check the CLI Path in Settings.

**Diagram shows but looks broken (missing nodes/edges)**  
→ Check the kUML version: `kuml --version`. This plugin requires kUML ≥ 0.8.0.

**Syntax highlighting not active**  
→ Reload Obsidian after enabling the plugin.

## License

Apache License 2.0 — see [LICENSE](LICENSE)
