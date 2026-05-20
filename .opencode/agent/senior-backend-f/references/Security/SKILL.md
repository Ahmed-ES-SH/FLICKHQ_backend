# Skill: Security

## Trigger

Use when the request mentions **secrets, env vars, unsafe input, injection, cookies, CSRF, XSS, auth hardening, or data protection**.

---

## Scope

- Helmet and security headers
- Environment variable safety
- Input sanitization
- SQL injection prevention
- CORS configuration
- CSRF protection
- Cookie security
- Rate limiting (auth endpoints)
- Secret management
- Least-privilege database access
- Sensitive data handling

---

## Baseline Security Setup (main.ts)

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Cookie parsing (required if using httpOnly cookies for refresh tokens)
  app.use(cookieParser());

  // CORS — explicit allowlist only
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

```bash
npm install helmet cookie-parser
npm install -D @types/cookie-parser
```

---

## Environment Variable Safety

```typescript
// config/app.config.ts
import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => {
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'REDIS_URL',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    dbUrl: process.env.DATABASE_URL!,
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET!,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  };
});
```

Use `ConfigService.getOrThrow()` everywhere — it throws at startup if the var is missing, not silently at runtime.

```typescript
const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
```

---

## SQL Injection Prevention

Prisma parameterizes all queries by default. Raw SQL must use tagged templates only:

```typescript
// ✅ Safe — parameterized
const users = await this.prisma.$queryRaw`
  SELECT * FROM users WHERE email = ${email}
`;

// ❌ NEVER DO THIS — SQL injection
const users = await this.prisma.$queryRawUnsafe(
  `SELECT * FROM users WHERE email = '${email}'`
);
```

---

## httpOnly Cookie for Refresh Token

```typescript
// auth/auth.controller.ts
@Post('login')
async login(
  @Body() dto: LoginDto,
  @Res({ passthrough: true }) res: Response,
) {
  const tokens = await this.authService.login(dto.email, dto.password);

  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/v1/auth/refresh',      // scope cookie to refresh endpoint only
  });

  return { accessToken: tokens.accessToken };
}

@Post('refresh')
async refresh(@Req() req: Request) {
  const token = req.cookies['refreshToken'];
  if (!token) throw new UnauthorizedException();
  return this.authService.refresh(token);
}

@Post('logout')
async logout(@Res({ passthrough: true }) res: Response) {
  res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
  return { message: 'Logged out' };
}
```

---

## Input Sanitization

```bash
npm install dompurify jsdom
npm install -D @types/dompurify @types/jsdom
```

For any field that might contain HTML (e.g., user-generated content):

```typescript
// common/utils/sanitize.ts
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

const window = new JSDOM('').window;
const purify = DOMPurify(window as unknown as Window);

export function sanitizeHtml(dirty: string): string {
  return purify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
```

Apply as a Transform in the DTO:

```typescript
@Transform(({ value }) => sanitizeHtml(value))
@IsString()
@MaxLength(5000)
bio: string;
```

---

## CSRF

For session-based auth, use `csurf`. For JWT + httpOnly cookie (stateless), CSRF is mitigated by:
- `sameSite: 'strict'` on the refresh cookie
- Short-lived access tokens in the Authorization header (browsers don't auto-send headers)
- Verifying `Origin` / `Referer` headers on sensitive mutations if extra paranoia is needed

---

## Sensitive Data in Responses

```typescript
// Always strip sensitive fields from responses
async findOne(id: string) {
  const user = await this.repo.findById(id);
  const { password, refreshTokenHash, ...safe } = user;
  return safe;
}
```

Or use `ClassSerializerInterceptor` + `@Exclude()` on the entity class for automatic stripping.

---

## Least-Privilege DB User

```sql
-- Create a restricted role for the app
CREATE ROLE app_user LOGIN PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE mydb TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- DO NOT grant DROP, CREATE TABLE, or ALTER TABLE to app_user
```

Use a separate admin user only for running migrations.

---

## Security Headers Reference

Helmet sets these by default — verify they're appropriate for your app:

| Header | Purpose |
|---|---|
| `Content-Security-Policy` | Restricts resource loading |
| `X-Frame-Options` | Prevents clickjacking |
| `X-Content-Type-Options` | Prevents MIME sniffing |
| `Strict-Transport-Security` | Forces HTTPS |
| `Referrer-Policy` | Controls referrer info |

---

## Notes

- **Secrets in source code = immediate breach**. Use `.env` locally, secrets manager (AWS Secrets Manager, Vault, etc.) in production.
- **Log sanitization**: Never log passwords, tokens, card numbers, or PII. Mask or omit them at the logger level.
- **Dependency scanning**: Run `npm audit` in CI. Block deploys on high-severity vulnerabilities.
- **bcrypt cost factor**: Use 12 rounds minimum. Increase as hardware gets faster. Never use MD5/SHA1/SHA256 for password hashing.
- **Token storage**: Refresh tokens in `httpOnly` cookies. Access tokens in memory (not `localStorage`). This is the only pattern that is both XSS and CSRF resistant.
