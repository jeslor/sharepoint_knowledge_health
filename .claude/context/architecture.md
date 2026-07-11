# Architecture

## High Level

User

↓

Next.js Web Application

↓

NestJS API

↓

Application Services

↓

Prisma ORM

↓

PostgreSQL

External:

Microsoft Graph API

↓

SharePoint

---

## Architecture Rules

Controllers should be thin.

Business logic belongs in services.

Database access goes through Prisma.

External integrations must have isolated modules.

Do not create microservices unless required.
