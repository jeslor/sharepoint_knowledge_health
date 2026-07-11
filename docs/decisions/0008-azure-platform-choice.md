# ADR-0008: Azure Platform Choice

Date: 2026-07-11
Status: Accepted

---

## Problem

Choosing cloud infrastructure for SharePoint Knowledge Health. This ADR captures the platform-level decision (which cloud) and its rationale; the specific services and how they're wired together are in ADR-0006.

## Context

- The product's entire value proposition is Microsoft 365/SharePoint governance: it authenticates via Microsoft Entra ID, reads via Microsoft Graph API, and is sold primarily to enterprise IT/security teams already operating in the Microsoft ecosystem.
- The scan architecture (ADR-0004) is a queue-driven background worker — an async, bursty workload, not a steady request/response pattern.
- Nothing has been built yet, making this the cheapest possible point to choose a platform.

## Options Considered

**A. AWS**
Mature, extremely well-established for enterprise SaaS generally, deep managed-service catalog (ECS/Fargate, RDS, ElastiCache, Secrets Manager). No specific technical or narrative alignment with this product's Microsoft-365-centric identity — Graph API is accessed over public HTTPS regardless of host cloud, so there's no meaningful latency/integration coupling either way. Fargate autoscaling is CPU/memory-based, with no native queue-depth scaling primitive for the scan worker.

**B. Azure**
Native alignment with the product's actual dependencies: Entra ID (auth), Microsoft Graph (data source), SharePoint (data source). Azure Container Apps' KEDA-based autoscaling scales directly on queue depth (BullMQ/Redis), a native fit for the scan worker pattern in ADR-0004 with no AWS equivalent. Managed-service catalog (Container Apps, PostgreSQL Flexible Server, Cache for Redis, Key Vault) is equivalent in capability to AWS's for this workload's needs.

**C. GCP**
Strong data/AI tooling (BigQuery, Vertex AI) that has no bearing on this product's MVP scope (rule-based scoring engine, not ML). No Microsoft-ecosystem alignment — would introduce a third unfamiliar platform without a corresponding product-specific advantage. Ruled out early; not evaluated to the same depth as A and B since neither the workload nor the product identity gives it an edge over either alternative.

## Decision

**Azure.**

## Reasons

- **Microsoft 365 ecosystem alignment**: the product's data source (SharePoint), auth provider (Entra ID), and API surface (Microsoft Graph) are all Microsoft services — running on Azure keeps the entire stack within one vendor relationship rather than three.
- **Entra ID integration**: Entra ID is an Azure AD product; app registration, admin consent, and token validation are Azure-native concerns even though the app itself is multi-tenant and works regardless of host cloud (ADR-0003 addendum) — but operating alongside the identity provider's home platform simplifies the mental model and support surface.
- **Enterprise customer trust**: the buyer is IT/security teams already invested in Microsoft 365. "This vendor runs on Microsoft's cloud, secrets in Key Vault, auth via Entra ID" is a coherent, low-friction story in procurement and security review — a real, product-specific advantage, not a generic cloud-brand preference.
- **Container Apps autoscaling**: KEDA-based scale-to-zero and queue-depth-driven scaling is a genuine technical fit for the async, bursty scan worker (ADR-0004) that AWS Fargate does not natively provide.
- **Managed Azure services**: PostgreSQL Flexible Server, Cache for Redis, Key Vault, and Application Insights cover every infrastructure need in ADR-0006 with the same maturity level as their AWS equivalents — no capability gap forced this decision, but no capability gap blocks it either.

## Tradeoffs

- **Azure learning curve**: `tech-stack.md` originally named AWS; the team's prior operational experience, if any, may skew AWS. Container Apps' revision/KEDA model, Azure networking, and IAM (RBAC) concepts differ from their AWS counterparts and will cost ramp-up time.
- **Potential vendor lock-in**: leaning on Azure-specific primitives (Key Vault secret references, Container Apps KEDA scalers, Azure Monitor integration) makes a future multi-cloud or cloud-exit migration nontrivial. Mitigated somewhat by everything being containerized (Docker) and Postgres/Redis being standard, portable technologies underneath the managed layer — the app layer isn't Azure-locked, only the infrastructure wiring is.
- **Different operational model**: Azure's resource-group/subscription structure, RBAC, and billing model differ from AWS's account/IAM structure — runbooks, IaC patterns, and on-call knowledge all need to be built fresh rather than reused from any prior AWS experience.

## Future Considerations

- If a specific enterprise customer has a hard AWS-only or GCP-only compliance requirement, that would need to be handled as a customer-specific exception (e.g., a dedicated deployment), not a change to the default platform.
- Revisit if Azure-specific costs or service limitations become a real constraint at scale — the containerized, Postgres/Redis-based core keeps a future platform migration possible, if expensive.
- Concrete service selections, configuration, and CI/CD wiring for this decision are maintained in ADR-0006; keep the two in sync if either changes.
