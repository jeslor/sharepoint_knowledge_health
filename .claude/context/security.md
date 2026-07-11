# Security Rules

Always:

Validate input.

Sanitize user content.

Use environment variables.

Apply least privilege.

Never:

hardcode secrets

log credentials

trust client input

expose tokens

Authentication:

Use Microsoft Entra ID.

Validate tokens server-side.

External APIs:

Handle token expiration.

Handle rate limits.

Handle retries.
