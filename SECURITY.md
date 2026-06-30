# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately to **[info@solidea.tech](mailto:info@solidea.tech)** (or use GitHub's
[private vulnerability reporting](https://github.com/solarch-dev/solarch/security/advisories/new)).
Include a description, reproduction steps, and the impact you observed. We aim to acknowledge
within a few business days and will keep you updated on the fix.

## Scope

This repository is the Solarch application stack (`apps/web`, `apps/server`) and the
self-host bundle. The hosted service at [app.solarch.dev](https://app.solarch.dev) is also
in scope. Please report responsibly and give us reasonable time to remediate before any
public disclosure.

## Handling secrets

Never commit real credentials. All secrets are provided via environment variables — see
`.env.example`. The server actively redacts secret-shaped values, and the codegen pipeline
is tested to never emit secrets into generated output.
