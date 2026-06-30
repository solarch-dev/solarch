# Contributing to Solarch

Thanks for the interest. Solarch is in active early-stage development — the API surface, node families, and edge semantics still move week to week — but feedback is very welcome.

## Ways to help

- **File an issue.** Bugs, regressions, surprising UX, accessibility gaps. Reproduction steps + screenshot/gif when possible. Try it at [app.solarch.dev](https://app.solarch.dev).
- **Open a discussion.** Feature requests, design feedback, architecture questions, philosophical disagreement with the *Surgical AI* thesis — all fair game.
- **Improve the docs.** Small, focused PRs to this repository's README and docs are easy to review and always appreciated.

## Local development

This is a pnpm + Turborepo monorepo: `apps/web` (Vite + React) and `apps/server` (NestJS + Neo4j).

```bash
pnpm install
pnpm db:up                                      # start just Neo4j in Docker
cp apps/server/.env.example apps/server/.env    # fill in keys
cp apps/web/.env.example apps/web/.env
pnpm dev                                         # web + server together (Turborepo)
```

- `pnpm build` builds both apps (this is the smoke check — the web app has no separate test runner).
- `pnpm --filter @solarch/server test:unit` runs the server unit suite (no database needed; dummy Neo4j env is injected).
- For the full containerized stack, see **[docs/self-hosting.md](./docs/self-hosting.md)**; for how it fits together, **[docs/architecture.md](./docs/architecture.md)**.

Prefer the hosted app at [app.solarch.dev](https://app.solarch.dev) if you just want to try Solarch.

## Commit style

Conventional commits with short, focused subjects:

```
feat(canvas): add elbow edge mode
fix(refine): orphan DTO repair edge inference
docs: clarify self-hosting steps
```

No emojis in commit messages or docs.

## License

By contributing, you agree your contributions are licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE) — same as the rest of the project. For commercial licensing inquiries, contact [info@solidea.tech](mailto:info@solidea.tech).
