# FLICK-HQ Backend

> NestJS v11 backend for the FLICK-HQ media platform — handling authentication, billing, user lists, notifications, and content management.

## Stack

| Category | Technology |
|---|---|
| **Framework** | NestJS v11 (TypeScript) |
| **Database** | PostgreSQL via TypeORM v0.3 |
| **Auth** | JWT, Passport (JWT + Google OAuth), Argon2 |
| **Payments** | Stripe v22 (plans, subscriptions, invoices, webhooks) |
| **Real-time** | Pusher |
| **Email** | `@nestjs-modules/mailer` + EJS templates |
| **Caching** | `@nestjs/cache-manager` + `cache-manager` |
| **Throttling** | `@nestjs/throttler` |
| **Security** | Helmet, CSRF, Cookie-parser |
| **Validation** | `class-validator`, `class-transformer`, `Joi` |
| **API Docs** | `@nestjs/swagger` |
| **Scheduling** | `@nestjs/schedule` |
| **Testing** | Jest + `ts-jest` + Supertest |
| **Linting** | ESLint v9 + Prettier v3 |

## Project Structure

```
src/
├── auth/                      # JWT + Google OAuth, guards, strategies, DTOs
├── billing/                   # Stripe billing: plans, prices, subscriptions,
│   │                          #   invoices, payments, entitlements, webhooks
│   ├── common/                #   Constants, enums, errors, money utils, snapshots
│   ├── controllers/           #   Admin, user, public, webhook controllers
│   ├── dto/                   #   Request/response DTOs
│   ├── entities/              #   TypeORM entities (10 entities)
│   ├── guards/                #   Feature access guard
│   └── services/              #   Catalog, checkout, customer, entitlements,
│                               #   idempotency, portal, Stripe, webhook services
├── common/                    # Shared decorators, DTOs, filters, interceptors, middleware
├── config/                    # Cache, database, env validation, mail, pusher, Stripe, throttler
├── contact/                   # Contact form module
├── database/seeds/            # Plan seeding, Stripe product sync
├── helpers/                   # Pagination helper
├── mail/                      # Mail service + EJS templates
├── modules/lists/             # User lists (favorites, watchlist, watched) + TMDB integration
├── notifications/             # Notification system + Pusher gateway
├── plans-subscriptions/       # Plan/subscription admin + user billing history
└── user/                      # User CRUD
db/migrations/                 # TypeORM migrations
test/                          # E2E tests
```

## Prerequisites

- Node.js >= 20
- pnpm
- PostgreSQL
- Stripe account (for billing features)
- Pusher account (for real-time notifications)
- TMDB API key (for media metadata)

## Getting Started

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, Stripe keys, Pusher keys, etc.

# Run database migrations
pnpm run migration:run

# Seed plans (optional)
pnpm run seed:run

# Start development server
pnpm run start:dev
```

## Available Scripts

| Script | Purpose |
|---|---|
| `pnpm run build` | Compile TypeScript with NestJS builder |
| `pnpm run start:dev` | Dev server with watch mode |
| `pnpm run start:prod` | Production server (`node dist/main`) |
| `pnpm run start:debug` | Dev server with debug + watch |
| `pnpm run lint` | ESLint + Prettier fix |
| `pnpm run format` | Prettier format |
| `pnpm run test` | Unit tests (Jest) |
| `pnpm run test:e2e` | End-to-end tests |
| `pnpm run test:cov` | Test coverage report |
| `pnpm run migration:run` | Run pending TypeORM migrations |
| `pnpm run migration:generate -- --name NAME` | Generate a new migration |
| `pnpm run migration:revert` | Revert last migration |
| `pnpm run seed:run` | Seed database with plans |
| `pnpm run seed:sync-stripe` | Sync Stripe products/prices |

## API Documentation

Swagger docs are available at `/api` when the server is running (requires `@nestjs/swagger` setup).

## Testing

```bash
# Unit tests
pnpm run test

# E2E tests
pnpm run test:e2e

# Coverage
pnpm run test:cov
```

## Project Conventions

- **Module structure**: Each domain module has its own controllers, services, DTOs, entities, and tests.
- **Public vs internal**: Separate `*.public.controller.ts` files expose public endpoints.
- **DTOs**: Used for both validation and response serialization.
- **Configuration**: Centralized in `src/config/` with Joi runtime validation.
- **Migrations**: TypeORM migrations in `db/migrations/`, run via `pnpm run migration:run`.
- **Auth guards**: `JwtAuthGuard` for protected routes, `RolesGuard` for role-based access, `Public()` decorator for open routes.
