# PocketLedger

PocketLedger is a privacy-conscious personal-finance mobile application. Its first
release lets an authenticated user organize categories, manually record income and
expenses, review a dashboard, and import a CSV statement after previewing it.

The project is intentionally being designed before implementation. The current
decisions and product boundaries are documented here:

- [Architecture and API conventions](docs/architecture.md)
- [MVP scope and product boundaries](docs/mvp-scope.md)
- [Lightweight threat model](docs/threat-model.md)

The initial stack is React Native with Expo and TypeScript for mobile; Node.js,
Fastify, PostgreSQL, Prisma, Zod, and REST/OpenAPI for the API; and Docker,
automated tests, and GitHub Actions for delivery.
