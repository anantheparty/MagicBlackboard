# Security Policy

## Supported code

Security fixes target the latest commit on the default branch and any release explicitly marked as
supported. Development branches and old, unmaintained snapshots may not receive backports.

Magic Blackboard is currently an early local-first foundation. It has no hosted model integration,
account system, or collaboration service. Browser storage is not encrypted and must not be treated
as secure storage for secrets or highly sensitive records.

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request containing exploit details, credentials,
private board data, or personally identifying information.

Use GitHub's **Security → Report a vulnerability** flow for
[`anantheparty/MagicBlackboard`](https://github.com/anantheparty/MagicBlackboard/security/advisories/new)
when available. Include:

- affected commit/version and browser/OS;
- impact and prerequisites;
- minimal reproduction using synthetic data;
- suggested remediation, if known;
- whether any credential or personal data may already be exposed.

If private vulnerability reporting is unavailable, open a public issue that contains only a request
for a private maintainer contact channel. Do not include the vulnerability details there.

For a vulnerability that is demonstrably in unmodified Drawnix or Plait code, also follow the
upstream project's security/contact process after coordinating disclosure; do not publish a
zero-day merely because it may be upstream.

Maintainers should acknowledge a private report within 7 days when possible, establish severity and
scope, and coordinate a disclosure date after a fix or mitigation exists. This is a target, not a
service-level guarantee.

## Secrets and the public repository

The current phase requires no API keys. Never commit secrets, `.env` files, access tokens, cookies,
private keys, connection strings, production board exports, or real classroom data.

- `.env.example` contains public names/defaults only.
- Every `VITE_*` value is client-visible and must never contain a secret.
- Future model provider keys belong in a server-side secret manager and requests must pass through
  an authenticated backend proxy; never ship a provider key in a browser or mobile app.
- GitHub Actions secrets must use least privilege and must not be exposed to untrusted fork code.
- Use synthetic board fixtures and redact screenshots/logs before attaching them to public reports.

If a secret is exposed, revoke or rotate it immediately, review usage/audit logs, and only then
coordinate repository/history cleanup. Deleting a file or commit does not invalidate a credential.
See [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)
and [OpenAI API authentication guidance](https://developers.openai.com/api/reference/overview#authentication)
for representative controls.

## User content and model data

Board content can include educational records, names, handwriting, or material involving minors.
Current local persistence stays in the selected browser profile, but anyone with access to that
profile may be able to read it. Do not claim encryption, cloud backup, secure deletion, or regulatory
compliance unless separately implemented and verified.

Future model/telemetry features must be opt-in, data-minimized, provider-visible in the UI, and
document retention/deletion. Raw pointer streams and full boards are not default analytics. Treat
board text and imported files as untrusted input; they cannot override application policy or grant
tool permissions.

## Security testing boundaries

Good-faith testing should use accounts, devices, repositories, and synthetic data you own or are
authorized to test. Avoid privacy violations, service disruption, social engineering, persistence,
or accessing data beyond the minimum needed to demonstrate impact. Stop and report if real user data
or credentials are encountered.

This policy does not grant authorization to test Drawnix, Plait, GitHub, model providers, or deployed
third-party infrastructure outside the Magic Blackboard scope.
