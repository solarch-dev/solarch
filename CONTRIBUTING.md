# Contributing to Solarch

Thanks for the interest. This repository is the **OSS self-host monorepo** — backend, canvas UI,
and Docker bundle. The API surface, node families, and edge semantics still move week to week, but
feedback and focused PRs are very welcome.

## Ways to help

- **File an issue.** Bugs, regressions, surprising UX, accessibility gaps. Reproduction steps +
  screenshot/gif when possible.
- **Open a discussion.** Feature requests, design feedback, architecture questions.
- **Improve the docs.** Small, focused PRs to `README.md` and `docs/` are easy to review.

## Local development

```bash
git clone https://github.com/solarch-dev/solarch.git
cd solarch
pnpm install
cp .env.example .env   # Neo4j password + LLM provider + API key

# Terminal 1
pnpm dev:server        # http://localhost:4000/api/v1

# Terminal 2
pnpm dev:web           # http://localhost:5173
```

Neo4j for dev: `pnpm --filter @solarch/server neo4j:up && pnpm --filter @solarch/server neo4j:migrate`

Full details: [docs/development.md](docs/development.md).

## Self-host smoke test

```bash
./install.sh
docker compose up --build
```

See [docs/getting-started.md](docs/getting-started.md).

## Commit style

Conventional commits with short, focused subjects:

```
feat(canvas): add elbow edge mode
fix(codegen): regen when graph revision conflicts
docs: clarify self-hosting basic auth
```

No emojis in commit messages.

## License

By contributing, you agree your contributions are licensed under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). For commercial licensing inquiries, contact
[info@solidea.tech](mailto:info@solidea.tech).
