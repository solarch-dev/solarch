<div align="center">
<h2 align="center">
  <img src="assets/logo-1779724213346.svg" alt="Solarch Logo" width="40" align="center" />
  &nbsp;&nbsp;Solarch&nbsp;&nbsp;
</h2>
  <p>Bridging diagrams and code via a strict rules engine to stop AI errors.</p>
<br/>

*Your entire workspace, on one canvas. | AI that ships. No more hallucinations.*

<br />

[![Try it](https://img.shields.io/badge/Try%20it-app.solarch.dev-ff6b1a?style=flat-square)](https://app.solarch.dev)
[![Website](https://img.shields.io/badge/Website-solarch.dev-0f0f0e?style=flat-square)](https://solarch.dev)
[![Self-Host](https://img.shields.io/badge/Self--Host-docker%20compose-666?style=flat-square)](docs/getting-started.md)
[![License](https://img.shields.io/badge/License-PolyForm%20NC%201.0-orange.svg?style=flat-square)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/solarch-dev/solarch?style=flat-square)](https://github.com/solarch-dev/solarch/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/solarch-dev/solarch?style=flat-square)](https://github.com/solarch-dev/solarch/commits/main)

<br />

### ▶ &nbsp; Try it live — **[app.solarch.dev](https://app.solarch.dev)** &nbsp; · &nbsp; Learn more at **[solarch.dev](https://solarch.dev)** &nbsp; · &nbsp; Or [**self-host**](#-self-hosting) this repo

<br />

*No install, no Docker — open the app and start drawing. Self-host below if you want your own box.*

<br />

<img src="./assets/1.gif" width="100%" alt="Solarch — AI builds rule-validated architecture from a single prompt" />

<br />

[**Why Solarch?**](#-why-solarch) &nbsp; • &nbsp; [**Gallery**](#-gallery) &nbsp; • &nbsp; [**Features**](#-features) &nbsp; • &nbsp; [**Philosophy**](#-the-philosophy) &nbsp; • &nbsp; [**Try it**](#-try-it) &nbsp; • &nbsp; [**Self-Hosting**](#-self-hosting) &nbsp; • &nbsp; [**Docs**](#-documentation) &nbsp; • &nbsp; [**Get Involved**](#-get-involved)

</div>

<br />

---

## ✦ Why Solarch?

Most AI tools generate code and hope the architecture catches up. **Solarch flips that.**

It generates **architecture first** — grounded in a library of canonical patterns, validated by a strict Rules Engine, refined through a self-correcting loop. The AI proposes; the rules verify; only correct graphs ever land on the canvas.

*   **One canvas for the whole system:** 21 node families — controllers, services, repositories, tables, DTOs, queues — and the 16 semantic edges between them.
*   **AI Architect grounded in GraphRAG:** an agentic LLM pipeline pulls from a vector-indexed pattern library. It never starts from a blank context, never invents an API surface.
*   **Rules Engine that refuses to lie:** 32 whitelist rules, 7 anti-patterns, 3 conditional checks. Frontends can't talk to tables. Controllers can't reach repositories. Period.
*   **Self-correcting loop:** Rules rejection feeds back into the agent; the AI revises and tries again until the graph is clean — or never commits.
*   **Diagram → NestJS code:** deterministic codegen scaffold from the graph, plus optional Surgical AI for method bodies.
*   **Four surfaces, one project:** Canvas, Code, API, and Docs — switch from the top bar without losing context.
*   **Live Instruct Mode:** Switch modes and chat with your design. Every answer cites the exact nodes; chips focus the canvas in real time.
*   **Single-home + reference tabs:** Each node lives in one tab. Other tabs *import* it as a reference, not a copy. One source of truth, multiple views.
*   **Type-safe from DB to button:** Zod schemas at the backend, OpenAPI in the middle, `openapi-fetch` on the frontend. The API contract is a compile-time check.

---

## ✦ Gallery

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <b>1. Start with a prompt</b><br/>
      Type what you want to build. The AI Architect kicks in: pulls canonical patterns, plans the graph, and applies it through the Rules Engine.<br/><br/>
      <img src="./assets/AIInputTyping.gif" width="100%" alt="AI input typing" />
    </td>
    <td width="50%" valign="top">
      <b>2. Sketch → architecture <i>(preview)</i></b><br/>
      Freeform sketch becomes a structured graph on <b>Refine</b>. Native sketch surface on the roadmap; the AI-driven refine path runs today.<br/><br/>
      <img src="./assets/SketchToArchitecture.gif" width="100%" alt="Sketch to architecture" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <b>3. Watch it build itself</b><br/>
      Nodes pop in with zen animations, edges flow with the right semantics — every relationship rule-validated before it commits.<br/><br/>
      <img src="./assets/AICanvasBuilding.gif" width="100%" alt="AI canvas building" />
    </td>
    <td width="50%" valign="top">
      <b>4. Pattern library <i>(preview)</i></b><br/>
      A standalone constructor library is on the roadmap. The same canonical patterns already power GraphRAG behind the scenes today.<br/><br/>
      <img src="./assets/TemplateLibrary.gif" width="100%" alt="Pattern library" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <b>5. Connect anything — legally</b><br/>
      Hover a port, drag, snap. The Rules Engine rejects illegal connections instantly. Semantic edges carry meaning, not generic arrows.<br/><br/>
      <img src="./assets/EdgeConnecting.gif" width="100%" alt="Edge connecting" />
    </td>
    <td width="50%" valign="top">
      <b>6. Every node, purpose-built editor</b><br/>
      Double-click any node. Column grids for tables, method tables for services, endpoint rows for controllers — no generic JSON forms.<br/><br/>
      <img src="./assets/InspectorReveal.gif" width="100%" alt="Inspector reveal" />
    </td>
  </tr>
</table>

<div align="center">
  <b>Ask your architecture anything</b><br/>
  Switch to Instruct mode and chat with your design. Every citation is a live chip that focuses the canvas with a soft halo.<br/><br/>
  <img src="./assets/InstructQuestion.gif" width="80%" alt="Instruct mode" />
</div>

---

## ✦ Features

<table>
  <tr>
    <td width="50%" valign="top">
      <b>AI &amp; Rules</b>
      <ul>
        <li><b>AI Architect:</b> agentic LLM loop with atomic tool calling</li>
        <li><b>Rules Engine:</b> 32 whitelist · 7 blacklist (ERR_001..007) · 3 conditional</li>
        <li><b>GraphRAG:</b> vector search over a canonical pattern library</li>
        <li><b>Self-correction loop:</b> rejection feeds back into agent state, AI revises</li>
        <li><b>Vector-native Neo4j:</b> embeddings + graph in one DB, no extra Pinecone</li>
        <li><b>Local embeddings:</b> compact multilingual sentence-transformer, on-box, 384-d</li>
        <li><b>21 node families:</b> Table, DTO, Model, Service, Worker, Controller, Repository, Cache, Middleware, and more</li>
        <li><b>16 semantic edges:</b> <code>CALLS</code>, <code>QUERIES</code>, <code>WRITES</code>, <code>PUBLISHES</code>, <code>SUBSCRIBES</code>, <code>THROWS</code>...</li>
        <li><b>NestJS codegen:</b> deterministic scaffold + optional Surgical AI fill</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <b>Workspace &amp; UI</b>
      <ul>
        <li><b>Custom Canvas 2D:</b> 60fps, dual-canvas, viewport culling, devicePixelRatio</li>
        <li><b>AI Omni-Bar:</b> Agent (build) + Instruct (Q&amp;A) modes, SSE streaming</li>
        <li><b>Live node chips:</b> citations focus the canvas with a soft halo</li>
        <li><b>Purpose-built inspectors:</b> per-type editors (4 today, the rest on roadmap)</li>
        <li><b>Multi-tab workspace:</b> single-home model + cross-tab references, not copies</li>
        <li><b>Edge bundling &amp; routing:</b> obstacle-aware bezier and elbow paths</li>
        <li><b>Type-safe API client:</b> Zod → OpenAPI → <code>openapi-fetch</code> + <code>openapi-typescript</code></li>
        <li><b>Light Blueprint design:</b> warm paper, semantic family colors, hairline grid, Satoshi + JetBrains Mono</li>
        <li><b>Bring-your-own-key:</b> OpenAI, Anthropic, Ollama, DeepSeek, … — your server, your quota</li>
      </ul>
    </td>
  </tr>
</table>

---

## ✦ The Philosophy

> **Solarch doesn't fight AI hallucination — it makes hallucination structurally impossible.**
>
> The industry has spent two years asking LLMs to write code. The result: confident hallucinations, ghost APIs, codebases that compile but lie. Hallucination isn't a tuning problem — it's a category error.
>
> Architecture is the level where structure is **provable**. A controller calls a service. A service queries a repository. A repository writes a table. These relationships are either present or not. They can't be hallucinated.

Solarch stacks three layers that, together, leave no room for an AI to invent something that doesn't exist:

1. **GraphRAG.** The agent starts every request by retrieving canonical patterns from a vector-indexed library. No blank context, no improvisation from zero.
2. **Rules Engine.** Every mutation passes a deterministic gate — 32 whitelist rules, 7 anti-patterns, 3 conditional checks. Illegal edges never land. The schema can't be coerced.
3. **Self-correction loop.** When the Rules Engine rejects a draft, the violation message feeds back into the agent state. The AI revises until the graph is clean, or the request terminates without a commit.

The output isn't *trustworthy* code. It's *provably correct* structure.

**Provable structure. Targeted intelligence. Zero hallucinated APIs.**

---

## ✦ Try it

Don't want to clone, configure, or run Docker? Use the hosted product:

| | Link | What you get |
|---|------|----------------|
| **App** | **[app.solarch.dev](https://app.solarch.dev)** | Full canvas — sign up and build in the browser. Always up to date. |
| **Website** | **[solarch.dev](https://solarch.dev)** | Product overview, demos, updates. |

Zero local setup. If that fits you, stop reading here and open the app.

---

## ✦ Self-Hosting

Want the stack on **your machine** — your LLM key, your data, no vendor? This repository is the full OSS bundle: NestJS backend, canvas UI, vector-native Neo4j, local embeddings.

```bash
git clone https://github.com/solarch-dev/solarch.git
cd solarch
./install.sh          # Linux/macOS — Neo4j password + AI provider wizard
docker compose up --build
# → http://localhost:3000
```

No login screen. Bring your own LLM API key. By default Docker binds to **127.0.0.1** only.

Windows: `./install.ps1`, then the same `docker compose` command.

| Need | Details |
|------|---------|
| Docker + Compose v2 | Required |
| LLM provider | Tool-calling model — see [AI providers](docs/ai-providers.md) |
| LAN / VPS | Enable HTTP Basic Auth — [Self-hosting guide](docs/self-hosting.md) |

Hosted alternative: **[app.solarch.dev](https://app.solarch.dev)** · **[solarch.dev](https://solarch.dev)**

---

## ✦ Documentation

Full guides live in [`docs/`](docs/README.md):

| Guide | Topics |
|-------|--------|
| [Getting started](docs/getting-started.md) | First run, four surfaces, API keys |
| [Canvas & Rules Engine](docs/canvas-and-rules.md) | Nodes, edges, error codes |
| [AI Architect](docs/ai-architect.md) | Agent, Instruct, GraphRAG |
| [Codegen](docs/codegen.md) | NestJS scaffold, Surgical AI |
| [CLI & API keys](docs/cli-and-api-keys.md) | `solarch login`, MCP |
| [Self-hosting](docs/self-hosting.md) | Env, security, rate limits |
| [Development](docs/development.md) | pnpm dev, tests |
| [Deployment](docs/deployment.md) | Caddy, systemd, production |

CLI / MCP / VS Code extension: [**solarch-tools**](https://github.com/solarch-dev/solarch-tools).

---

## ✦ Get Involved

We welcome feedback, discussions, and contributions.

- 💬 [**GitHub Discussions**](https://github.com/solarch-dev/solarch/discussions) — Feature requests, design feedback, questions.
- 🐛 [**Issues**](https://github.com/solarch-dev/solarch/issues) — Bug reports, regressions.
- 🛠️ [**Contributing Guide**](./CONTRIBUTING.md) — Local setup, conventions, commit style.

<br/>

## ✦ License

[PolyForm Noncommercial License 1.0.0](./LICENSE) — © 2026 Ugur Akdogan.

**Free** for personal use, research, education, and non-profit organizations. Source is open: fork, learn, modify, share — go for it. <br/>
**Commercial use requires a separate license** — reach out at [info@solidea.tech](mailto:info@solidea.tech).

<br/>
<div align="center">
  <b>See. Understand. Plan.</b><br/>
  In one shot.<br/><br/>
  <a href="https://app.solarch.dev"><img src="assets/logo-1779724213346.svg" width="30" style="opacity: 0.5;" /></a><br/>
  <b><a href="https://app.solarch.dev">Solarch.</a></b>
</div>
