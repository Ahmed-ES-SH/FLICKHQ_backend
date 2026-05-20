# AGENTS.md

Role: Senior Backend NestJS Developer

Purpose

- Provide a concise, machine- and human-readable summary of the project for AI agents and new senior backend engineers.

Project Summary

- Framework: NestJS (v11.x)
- Language: TypeScript
- ORM: TypeORM (v0.3.x)
- Database: PostgreSQL (via `pg`)
- Auth: `@nestjs/jwt`, `passport`, `passport-jwt`, OAuth strategies
- Realtime: Socket.IO (`socket.io`, `@nestjs/platform-socket.io`)
- Realtime: Pusher (`pusher-js`)
- Payments: Stripe (`stripe`)
- Email: `@nestjs-modules/mailer` (EJS templates)
- Caching & Throttling: `@nestjs/cache-manager`, `@nestjs/throttler`, `cache-manager`
- Scheduling & Background jobs: `@nestjs/schedule`
- API docs: `@nestjs/swagger`
- Validation: `class-validator`, `class-transformer`, `joi` for env
- Security: `helmet`, CSRF helper and cookie parsing
- Testing: Jest + `ts-jest`, `supertest` for e2e
- Tooling: Prettier, ESLint

Repository Layout (high level)

- `src/` - application source
  - `auth/` - authentication controllers, guards, strategies, DTOs
  - `blog/` - blog module and public endpoints
  - `categories/`, `products/`, `user/`, etc. - domain modules with controllers, services, dto, schema
  - `common/` - shared decorators, DTOs, filters, interceptors, middleware, utils
  - `config/` - runtime configs: cache, database, env validation, mail, stripe, throttler, ws
  - `mail/` - mail service + templates
  - `modules/` - grouped business modules: jobs, lists, movies, payments
  - `notifications/` - gateway, controllers, client endpoints
  - `helpers/` - small helpers (e.g., pagination)
- `db/migrations/` - TypeORM migrations
- `test/` - e2e tests
- Root config files: `tsconfig.*`, `nest-cli.json`, `package.json`

Key Files & Conventions

- Configuration is centralized under `src/config` and uses Nest config patterns.
- Database config file used by TypeORM CLI: `src/config/database.config.ts` (built to `dist` for running migrations).
- Migrations live in `db/migrations` and are run via pnpm scripts.
- DTOs are used for validation and mapping; services encapsulate business logic and controllers expose HTTP routes.

Important pnpm scripts (usage)

- `pnpm run start:dev` — development server with watch
- `pnpm run build` — compile TypeScript with Nest build
- `pnpm run start:prod` — run compiled `dist/main`
- `pnpm run migration:run` — run TypeORM migrations (note: runs build first, uses compiled config)
- `pnpm run migration:generate -- --name NAME` — generate migration (via `pnpm_config_name` or pass extra args)
- `pnpm run test` / `pnpm run test:e2e` — run unit/e2e tests

Database & Migrations

- TypeORM v0.3.x with migrations present in `db/migrations/`.
- Use `pnpm run migration:run` and ensure `NODE_ENV` and `database.config` are correct for the target environment.

Testing & Local Development

- Tests: Jest configured in `package.json` (root) with `ts-jest`.
- Local dev server: `pnpm run start:dev`.
- Lint/format: `pnpm run lint`, `pnpm run format`.

Recommended Agent Responsibilities (Senior Backend NestJS Developer)

- Read and respect existing module boundaries in `src/`.
- Use Nest idioms: modules, controllers, providers, DTOs, pipes, guards.
- Prefer fixing root causes (config, schemas, migrations) over superficial patches.
- When modifying DB schema: add/migrate via TypeORM migrations in `db/migrations/`.
- When adding features, add tests (unit + e2e as appropriate) and update docs.
- Keep public vs internal controllers separated (project uses public controllers like `*.public.controller.ts`).

Onboarding Checklist for an Agent

- Ensure `.env` or runtime envs are set (project expects env validation under `src/config/env.validation.ts`).
- Install dependencies: `ppnpm install` or `pnpm install` depending on environment.
- Start dev server: `pnpm run start:dev`.
- Run migrations (if DB available): `pnpm run migration:run`.
- Run tests: `pnpm run test` and `pnpm run test:e2e`.

Notes & Gotchas

- TypeORM CLI scripts in `package.json` call `pnpm run build` first — migrations use compiled `dist` config.
- Real-time transport has been migrated to Pusher (`pusher-js`). The `socket.io` and `@nestjs/platform-socket.io` libraries were removed from the project — update configs and gateway code accordingly if inspecting older commits.
- Some modules expose separate `*.public.controller.ts` files for public endpoints.
- Be aware of `tsconfig-paths` & runtime path mapping used in some debug/test scripts.

Where to look first (suggested file entry points)

- `src/main.ts` — application bootstrap
- `src/app.module.ts` — root module wiring
- `src/config` — environment and platform configs
- `db/migrations` — DB change history

Contact / Next Steps

- If you want, I can: run the test suite, run lint, or open specific modules for a deeper summary.
