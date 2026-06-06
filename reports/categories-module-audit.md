# Categories Module Audit Report

> **Project:** NestJS Boilerplate Backend  
> **Scope:** `src/categories/` plus the related blog integration points, throttling config, and bootstrap/runtime behavior that affect this module  
> **Date:** 2026-06-06  
> **Deployment Target:** Free hosting with serverless functions  
> **Primary Constraint:** Keep the module reusable across other projects. Keep the blog relation if needed, but avoid adding extra domain coupling.

## Executive Summary

The `src/categories` module is functional, but it is not yet a good fit for a free serverless deployment or for reuse in another project. The main problems are:

- throttling is only configured globally and uses in-memory state,
- the public category list is unbounded,
- the module is tightly coupled to the `products` domain even though the requirement is to keep only the blog relation,
- several operations do extra database work that is unnecessary for a small, read-heavy module,
- route-level abuse protection is missing for each categories endpoint.

The blog relationship is already present and is the only cross-module relation that should remain. The product coupling should be removed or isolated behind a separate integration layer.

---

## High Priority Findings

| Severity | Area | Issue | Why it matters | Recommended fix |
|---|---|---|---|---|
| High | `src/config/throttler.config.ts`, `src/main.ts` | Rate limiting uses in-memory storage only, which does not survive cold starts or scale across serverless instances. | Request counters reset per instance. On free hosting this makes throttling unreliable and easy to bypass. | Move throttling state to a shared store such as Redis/Upstash and keep the in-memory version only for local development. |
| High | `src/categories/categories.module.ts`, `src/categories/categories.service.ts`, `src/categories/schema/category.schema.ts` | The module is coupled to `products` and `articles`, even though the requirement is to keep only the blog relation. | This makes the module harder to reuse in another project and adds unnecessary cross-domain dependency. | Keep the blog relation only. Remove product repository injection and the product relation from the core module, or move product-specific counts into a separate optional adapter. |
| High | `src/categories/categories.public.controller.ts`, `src/categories/categories.service.ts` | `GET /categories` returns every category with no pagination or hard cap. | A growing category table can turn a simple public request into a large payload and slow response, which is especially bad on serverless/free hosting. | Add pagination or a strict maximum response size. Cache the list if possible. |
| High | `src/categories/categories.controller.ts` | No route-level throttles are defined per endpoint. | The module relies only on the global throttler, which does not distinguish between cheap reads and expensive writes. | Add explicit per-route throttles for each endpoint, with stricter limits on mutation routes and bulk reorder. |

---

## Serverless Deployment Risks

### [CAT-SRV-01] In-Memory Throttling Is Not Safe on Serverless

**Files:** `src/config/throttler.config.ts`, `src/main.ts`  
**Severity:** High

The throttler is configured with two limits, but there is no shared storage backend. That means every cold start or new function instance gets a fresh request counter.

Why this is a problem:

- abuse can spread across instances,
- rate limits can be bypassed by hitting a different cold start,
- burst traffic is not coordinated across the deployment,
- the behavior is inconsistent under load.

**Recommended fix**

- Use a shared throttling store, preferably Redis or a Redis-compatible managed cache.
- Keep the current in-memory setup only as a local fallback.
- If a shared store is not available yet, reduce public exposure by adding stronger route-level throttles in the controller layer.

---

### [CAT-SRV-02] Public List Endpoint Has No Bounded Response Size

**File:** `src/categories/categories.public.controller.ts`, `src/categories/categories.service.ts`  
**Severity:** High

`GET /categories` calls `getAllPublic()`, which loads all categories with one query and returns the full list. That is acceptable only when the table is tiny and stable.

On serverless/free hosting, this is risky because:

- larger result sets increase latency and response size,
- the endpoint becomes more expensive to serve repeatedly,
- the response gets slower as content grows,
- there is no way for clients to request only what they need.

**Recommended fix**

- Add pagination to the public list, or at least a strict maximum row count.
- If the design intentionally needs a full list, add edge caching or application-level cache.
- Prefer a small projected response, not the full entity shape.

---

## Security and Abuse Resistance

### [CAT-SEC-01] Missing Route-Level Abuse Limits Per Endpoint

**File:** `src/categories/categories.controller.ts`  
**Severity:** High

The controller has authentication and role guards, but it does not define endpoint-specific rate limits.

Current endpoints that should have explicit limits:

| Endpoint | Current behavior | Recommended policy |
|---|---|---|
| `GET /categories` | public, unbounded list fetch | moderate throttle plus caching |
| `GET /categories/:slug` | public detail lookup | moderate throttle |
| `GET /admin/categories` | admin list fetch | standard throttle |
| `GET /admin/categories/:id` | admin lookup | standard throttle |
| `POST /admin/categories` | admin create | strict write throttle |
| `PATCH /admin/categories/:id` | admin update | strict write throttle |
| `DELETE /admin/categories/:id` | admin delete | strict write throttle |
| `POST /admin/categories/reorder` | bulk write | strongest throttle in the module |

**Recommended fix**

- Add explicit `@Throttle()` values to each endpoint.
- Keep the write endpoints tighter than the read endpoints.
- Make reorder the strictest endpoint because it performs multiple writes in one call.

Suggested baseline:

- public reads: moderate limit, e.g. 30 to 60 requests per minute,
- admin reads: moderate limit, e.g. 60 requests per minute,
- create/update/delete: low limit, e.g. 5 to 10 requests per 15 minutes,
- reorder: very low limit, e.g. 3 requests per 15 minutes.

---

### [CAT-SEC-02] Public Slug Lookup Has No Input Normalization

**File:** `src/categories/categories.public.controller.ts`  
**Severity:** Medium

`GET /categories/:slug` accepts the raw slug string and passes it directly to the service. The database lookup is parameterized, so this is not an injection issue, but the API is still loose:

- empty or whitespace-only values are not rejected early,
- uppercase or malformed slugs are not normalized,
- the controller does not document a concrete slug format.

**Recommended fix**

- Add a query/param validation pipe or a slug-specific DTO.
- Reject invalid slug shapes before hitting the database.
- Normalize slug input consistently if your API expects lowercase hyphenated slugs.

---

## Performance Findings

### [CAT-PERF-01] Search Uses `ILIKE '%term%'` Without a Dedicated Search Strategy

**File:** `src/categories/categories.service.ts`  
**Severity:** Medium

`getAll()` applies:

```ts
category.name ILIKE :search
```

with a `%...%` pattern. That is fine for a small table, but it becomes a table scan as the dataset grows. On a free serverless deployment, that means slower reads and more database load for every search request.

**Recommended fix**

- Cap search input length.
- Add a proper search strategy if the table is expected to grow, such as trigram indexing or a full-text strategy.
- For small admin-only lists, keep the search, but limit the result set and avoid expensive public search behavior.

---

### [CAT-PERF-02] Delete and Count Paths Perform Extra Queries

**File:** `src/categories/categories.service.ts`  
**Severity:** Medium

`delete()` and `getByIdWithCounts()` each count related articles and products separately. That means multiple DB round-trips just to remove or inspect one category.

Current behavior:

- `getById()`
- `articleRepository.count(...)`
- `productRepository.count(...)`

That is expensive for a path that is often triggered in admin workflows.

**Recommended fix**

- Keep only the blog/article count if it is actually needed for the blog integration.
- Remove product counting from the categories core.
- If counts are only used for logging, consider making them optional or asynchronous.
- If counts are required in the UI, expose them via a dedicated read model instead of computing them on every request.

---

### [CAT-PERF-03] Bulk Reorder Uses One Update Per Row

**File:** `src/categories/categories.service.ts`  
**Severity:** Medium

`reorder()` loads all categories, then runs one `UPDATE` per category inside a transaction. That is correct, but it is not efficient if the reorder payload grows.

**Recommended fix**

- Use a single bulk update statement if the ORM and query builder support it cleanly.
- If you keep the current approach, enforce a small maximum batch size.
- Validate the payload so duplicate IDs or duplicate order values are rejected before the transaction starts.

---

### [CAT-PERF-04] Public List Returns Full Entity Rows Instead of a Minimal Projection

**Files:** `src/categories/categories.public.controller.ts`, `src/categories/categories.service.ts`  
**Severity:** Low-Medium

The public list currently returns full category entities. The entity is not huge today, but returning the full object makes the API harder to evolve and increases payload size if more columns are added later.

**Recommended fix**

- Return a dedicated response DTO or a minimal selected projection.
- Keep the API contract stable and independent from the persistence model.

---

## Clean Code and Reusability

### [CAT-CLEAN-01] The Module Is Too Tightly Coupled to Unrelated Domains

**Files:** `src/categories/categories.module.ts`, `src/categories/categories.service.ts`, `src/categories/schema/category.schema.ts`  
**Severity:** High

The categories module imports and uses:

- `Product` repository,
- `Article` repository,
- `Article` and `Product` relations on the `Category` entity,
- the application auth module.

That makes the module harder to move into another project. It also violates the requirement to keep only the blog relation.

**Recommended fix**

- Keep the blog relation only if it is intentionally part of the shared domain.
- Remove the product relation and product repository from the core categories module.
- If product counts or product linkage are needed elsewhere, implement them in the product module or in a separate integration adapter.
- Keep the categories module focused on category CRUD, sorting, and public lookup.

---

### [CAT-CLEAN-02] Controllers Return Entities Instead of Explicit Response Models

**Files:** `src/categories/categories.controller.ts`, `src/categories/categories.public.controller.ts`, `src/categories/categories.service.ts`  
**Severity:** Medium

The service returns `Category` entities directly, and the controller signatures advertise `CategoryResponseDto`, but the actual output is still shaped by entity serialization behavior.

Why this matters:

- the API contract is not explicit,
- accidental field exposure becomes easier if the entity changes,
- the module is harder to reuse in other applications with different response requirements.

**Recommended fix**

- Map entities to response DTOs in the service or controller.
- Keep persistence models and API models separate.
- Use the serializer only as a safeguard, not as the primary contract layer.

---

### [CAT-CLEAN-03] Unique Constraint Declarations Are Redundant

**File:** `src/categories/schema/category.schema.ts`  
**Severity:** Low

`slug` is marked unique twice:

- `@Index(['slug'], { unique: true })`
- `@Column({ ..., unique: true })`

`name` is also unique through an index. This is not a runtime bug, but it creates unnecessary schema duplication and can produce noisy migration diffs.

**Recommended fix**

- Use one mechanism per uniqueness rule.
- Keep either the unique column option or the unique index, not both, unless you have a specific reason.

---

### [CAT-CLEAN-04] Reorder Payload Validation Does Not Enforce Uniqueness

**File:** `src/categories/dto/reorder-categories.dto.ts`  
**Severity:** Low-Medium

The DTO validates shape and types, but it does not reject duplicate category IDs or duplicate order values. That can lead to ambiguous updates or repeated writes to the same row.

**Recommended fix**

- Add a custom validator to ensure IDs are unique.
- Add a custom validator to ensure order values are unique if the UI expects a strict sequence.
- Reject malformed reorder payloads before the transaction starts.

---

## Recommended Module Shape for Reuse

If this module is meant to be reused in other projects, the cleanest shape is:

1. Core categories module:
   - category CRUD,
   - category search and sort,
   - public list and public slug lookup,
   - blog relation only if that relation is required by the shared domain.

2. Optional external adapters:
   - product counts or product linkage,
   - admin-specific policy wiring,
   - host-app authorization and route guards if the consuming project uses a different auth stack.

That keeps the module portable without blocking the current project.

---

## Priority Fix Order

1. Replace in-memory throttling with a shared store.
2. Add explicit throttles per categories endpoint.
3. Remove product-domain coupling from the categories core and keep only the blog relation.
4. Add pagination or a hard cap to the public list.
5. Remove unnecessary count queries and reduce bulk reorder write cost.
6. Split persistence entities from response DTOs for a stable API contract.

---

## Deployment Risk Summary

For free serverless hosting, the categories module is currently exposed to:

- unreliable rate limiting,
- unbounded public list responses,
- unnecessary database round-trips,
- over-coupling to non-blog domains,
- and avoidable payload growth as the project expands.

Fixing the first three items should be treated as the release gate. The reusability and clean-code items should follow immediately after.
