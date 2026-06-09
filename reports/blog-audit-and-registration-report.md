# Blog and Registration Audit Report

Scope: reviewed `src/blog` in detail, then checked the registration and email-verification flow because you asked for the registration fix to be included in the report. This review assumes the app will run on free serverless hosting, so DB round-trips, in-memory limits, and cold-start behavior matter more than they would on a single long-lived server.

## Highest Priority Findings

| Severity | Area | Issue | Why it matters | Recommended fix |
|---|---|---|---|---|
| High | `src/blog/blog.controller.ts` | Admin blog routes use `@Roles(UserRoleEnum.ADMIN)` but do not apply `RolesGuard`. `@Roles()` alone does nothing. | Any authenticated user can call `POST /admin/blog`, `PATCH /admin/blog/:id`, `PATCH /admin/blog/:id/publish`, and `DELETE /admin/blog/:id` if the guard is not attached. This is an authorization bypass. | Attach `RolesGuard` to the controller or the individual routes, and keep auth enforced through the existing global `AuthGuard`. Add an e2e test proving a non-admin gets `403`. |
| High | `src/user/user.service.ts`, `src/user/user.controller.ts`, `src/auth/auth.service.ts`, `src/mail/mail.service.ts` | The registration path saves the user but does not complete the email-verification workflow. `POST /user` creates the account, but no verification token is persisted or emailed from that path. | New accounts can be created without the verification email being sent immediately. Also, the current registration response returns the saved entity, which can expose the hashed password because `save()` returns the entity object. | After successful create, generate and persist `emailVerificationToken` + expiry, then send the verification email. Return a sanitized DTO, not the entity. If mail delivery fails, roll back or delete the newly created user so the account state stays consistent. |
| High | `src/config/throttler.config.ts`, `src/config/cache.config.ts` | Throttling and cache are both in-memory. That is not reliable for serverless or multi-instance deployments. | Every cold start or parallel instance gets its own counters and cache. Abuse can spread across instances, and cache hit rates will be poor. | Move throttling and cache to a shared store such as Redis or an equivalent managed cache. Keep the in-memory fallback only for local development. |

## Blog Performance and Abuse-Resistance

1. `src/blog/blog.service.ts` does extra work on article detail reads.

   `findBySlug()` reads the article, increments `viewsCount`, then reads it again to return the updated value. That is three DB operations for one request. On serverless hosting this increases latency and DB pressure.

   Fix: use a single update-returning query if you need the updated counter, or accept eventual consistency and avoid the second read. If exact view counts are not critical for the response, return the original record and update the counter asynchronously.

2. `src/blog/blog.service.ts` relies on expensive list queries without a matching read strategy.

   `findPublished()` and `findAll()` both call `getManyAndCount()`, and `search` uses `ILIKE '%...%'` on `title`. That will become a table scan once content grows unless the title search is indexed.

   Fix: add a real search strategy for titles, such as trigram or full-text indexing, and keep list responses projected to only the fields needed by each view. For public blog lists, cache summary responses if the hosting platform allows it.

3. `src/blog/blog.service.ts` uses `generateUniqueSlug()` with a pre-insert existence loop.

   This is race-prone under concurrent creates: two requests can both observe the same free slug and then collide on the unique constraint. Serverless concurrency makes that more likely.

   Fix: keep the unique constraint, but add retry-on-conflict logic around insert/update or generate a collision-proof suffix strategy. Do not rely on the existence check alone.

4. `src/blog/dto/*` and `src/blog/blog.service.ts` do not put strong bounds on expensive public reads.

   `PaginationQueryDto` allows `limit` up to `1000`, and blog search terms are not capped. That is too permissive for a public content API on free hosting.

   Fix: cap public blog list limits much lower, and reject empty or one-character search terms. If the search endpoint is public, make it stricter than the admin list endpoint.

5. `src/blog/schema/article.schema.ts` stores and returns `content` without any sanitization.

   If article content is HTML and the frontend renders it directly, stored XSS becomes a realistic risk.

   Fix: decide on one content format and enforce it. If HTML is allowed, sanitize server-side before persistence or before rendering. If Markdown is expected, store Markdown and render safely on the client.

## Clean Code and API Shape

1. `src/blog/blog.controller.ts` and `src/blog/blog.service.ts` return persistence entities directly.

   That couples the API contract to the database model and makes accidental field leaks more likely when the schema changes.

   Fix: define response DTOs for list, detail, create, and admin operations. Keep entity objects inside the service layer.

2. `src/blog/blog.service.ts` is doing query building, publishing rules, counters, deletion, and slug generation all in one service.

   It works, but the file is becoming a mixed concern boundary. That makes future changes harder to reason about, especially if article search, analytics, or media handling grows.

   Fix: split read/query helpers from write workflows if the module keeps expanding. Keep the current layout only if the module stays small.

## Route-Level Throttling Notes

1. Blog routes currently rely on the global throttler only.

   That gives every route the same baseline limit, but it does not distinguish between expensive public reads, admin mutations, or registration attempts.

   Fix: add route-specific throttles. In practice, the public blog list/search routes, registration, login, verification resend, and password reset endpoints should have tighter, explicit limits than ordinary authenticated reads.

2. The registration route needs a dedicated anti-abuse policy.

   `POST /user` is public and currently has no visible route-level throttle. On free hosting, that is an easy target for bot signups.

   Fix: add a stricter throttling rule to registration and, if needed, require additional checks such as email-domain rules or CAPTCHA at the edge.

## Registration Fix Required

The registration flow should send a verification email immediately after a successful account creation. Right now, the account is created first, but the verification step is not completed in the same flow.

Recommended behavior:

1. Create the user with `isEmailVerified = false`.
2. Generate a verification token and expiry.
3. Persist the token on the user record.
4. Send the verification email.
5. Return a response that does not expose the hashed password or token.

That keeps the email-verification flow consistent with the existing `verify-email` endpoint and avoids leaving new users in an unverified state with no working verification link.

## Deployment Risk Summary

For serverless/free hosting, the main risks in this module are:

- in-memory throttling and caching,
- too many DB round-trips on public reads,
- no admin role enforcement on blog mutations,
- and a registration flow that does not fully complete email verification.

Those are the items I would fix first before shipping this module publicly.
