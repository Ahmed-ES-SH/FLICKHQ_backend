# Skill: Auth & Access Control

## Trigger

Use when the request mentions **authentication, authorization, guards, roles, permissions, sessions, JWT, refresh tokens, or tenant access**.

---

## Scope

- JWT authentication (access + refresh token flow)
- Passport.js strategy integration (`@nestjs/passport`)
- Auth guards (global + per-route)
- Role-based access control (RBAC)
- Permission-based access control
- Decorators for current user and public routes
- Refresh token rotation
- Password hashing
- Multi-tenant access isolation

---

## Setup

```bash
npm install @nestjs/passport @nestjs/jwt passport passport-jwt passport-local bcrypt
npm install -D @types/passport-jwt @types/passport-local @types/bcrypt
```

---

## JWT Strategy

```typescript
// auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: string;      // userId
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findOneOrFail(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user; // attached to request.user
  }
}
```

---

## Auth Service

```typescript
// auth/auth.service.ts
import {
  Injectable, UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id, user.email, user.role);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });

      const user = await this.usersService.findOneOrFail(payload.sub);

      // Optionally: validate stored refresh token hash (rotation strategy)
      return this.issueTokens(user.id, user.email, user.role);
    } catch {
      throw new ForbiddenException('Invalid or expired refresh token');
    }
  }

  private issueTokens(userId: string, email: string, role: string) {
    const payload: JwtPayload = { sub: userId, email, role };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }
}
```

---

## Global JWT Guard + Public Route Decorator

```typescript
// common/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

```typescript
// common/guards/jwt-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

Register globally in `AppModule`:

```typescript
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
],
```

All routes are now protected by default. Use `@Public()` to opt out.

---

## RBAC — Roles Guard

```typescript
// common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

```typescript
// common/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
```

Register globally alongside JWT guard:

```typescript
{ provide: APP_GUARD, useClass: RolesGuard },
```

Usage:

```typescript
@Roles(Role.ADMIN)
@Delete(':id')
remove(@Param('id', ParseUUIDPipe) id: string) { ... }
```

---

## Current User Decorator

```typescript
// common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

Usage:

```typescript
@Get('me')
getProfile(@CurrentUser() user: User) {
  const { password, ...safe } = user;
  return safe;
}
```

---

## Refresh Token Rotation (Secure Pattern)

1. On login → issue `accessToken` (15 min) + `refreshToken` (7 days)
2. Store a **hashed** refresh token in the DB against the user
3. On `/auth/refresh` → verify token → compare hash → issue new pair → **invalidate old token**
4. On logout → delete stored token from DB

```typescript
// In AuthService
async storeRefreshToken(userId: string, token: string): Promise<void> {
  const hashed = await bcrypt.hash(token, 10);
  await this.prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: hashed },
  });
}

async validateRefreshToken(userId: string, token: string): Promise<boolean> {
  const user = await this.usersService.findOneOrFail(userId);
  if (!user.refreshTokenHash) return false;
  return bcrypt.compare(token, user.refreshTokenHash);
}
```

---

## Environment Variables

```env
JWT_ACCESS_SECRET=change-this-to-a-64-char-random-string
JWT_REFRESH_SECRET=different-64-char-random-string
```

Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

---

## Notes

- **Never return the same error message for "user not found" vs "wrong password"** — always return `"Invalid credentials"` to prevent user enumeration.
- **Short-lived access tokens** (15 min) + **long-lived refresh tokens** (7 days) is the standard. Do not use 1-hour access tokens without a reason.
- **Refresh token rotation**: invalidate the old token immediately after issuing a new one. Detect reuse as a breach signal.
- **HTTPS only** for all auth endpoints in production. Never send tokens over plain HTTP.
- **Never store tokens in `localStorage`** — advise the frontend team to use `httpOnly` cookies for the refresh token.
