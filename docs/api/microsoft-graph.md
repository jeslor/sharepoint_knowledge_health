Microsoft Graph

Authentication

OAuth, application (app-only) permissions via a multi-tenant Entra ID app registration. Each customer organization grants tenant admin consent independently (see ADR-0003).

Scopes

Files.Read.All

Sites.Read.All

The product is read-only. Sites.ReadWrite.All is not requested — there is no feature that writes back to SharePoint. If one is added in the future, the additional scope will be requested as a separate, explicitly-justified consent step (see ADR-0003).

Use pagination.

Respect throttling.

Retry using exponential backoff.

Handle expired tokens.
