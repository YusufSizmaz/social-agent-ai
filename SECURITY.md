# Security Policy

## Supported versions

Security fixes are applied to the latest release on the `main` branch.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through [GitHub Security Advisories](https://github.com/YusufSizmaz/social-agent-ai/security/advisories/new). Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the version or commit you tested.

You can expect an initial response within a few days. Once a fix is released you'll be credited in the changelog unless you prefer to stay anonymous.

## Hardening your deployment

Social Agent AI stores social media credentials in its database, so treat the server accordingly:

- **Always set `DASHBOARD_PASSWORD`** before exposing the dashboard to any network, and put it behind HTTPS (e.g. a reverse proxy such as Caddy or Nginx).
- Use a strong, unique `POSTGRES_PASSWORD` and keep the database port closed to the internet (the provided `docker-compose.yml` binds it to `127.0.0.1`).
- Keep `.env` out of version control and restrict file permissions on the host.
- Rotate platform tokens if you suspect they were exposed.
