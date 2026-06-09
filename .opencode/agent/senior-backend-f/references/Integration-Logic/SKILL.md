# Skill: Integration Logic

## Trigger

Use when the request mentions **controllers, services, modules, dependency injection, external integrations, data flow, business logic wiring, background jobs, or request-to-response composition**.

---

## Scope

This skill owns the full request path from route entry to response, including:

- NestJS module wiring (`@Module`, imports/exports/providers)
- Controller → Service → Repository data flow
- Dependency Injection patterns and circular dependency resolution
- Service composition (calling one service from another)
- Transaction boundaries across services
- External API integration (HTTP clients, third-party SDKs)
- Background job triggering (BullMQ producers)
- Event emission and handling (`EventEmitter2`)
- Request lifecycle hooks (interceptors, middleware, guards)

---

## Module Structure (Standard)

```
/src
  /users
    users.module.ts
    users.controller.ts
    users.service.ts
    users.repository.ts       ← optional: wraps Prisma queries
    dto/
      create-user.dto.ts
      update-user.dto.ts
    index.ts                  ← barrel export
```

### Module File

```typescript
// users.module.ts
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService], // only export what other modules need
})
export class UsersModule {}
```

---

## Controller Pattern

Controllers handle HTTP only. No business logic. No DB calls.

```typescript
// users.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOneOrFail(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
```

---

## Service Pattern

Services own business logic, orchestration, and transaction boundaries.

```typescript
// users.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepo: UsersRepository) {}

  async create(dto: CreateUserDto): Promise<Omit<User, 'password'>> {
    const existing = await this.usersRepo.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.usersRepo.create({ ...dto, password: hashed });

    const { password, ...safe } = user;
    return safe;
  }

  async findOneOrFail(id: string): Promise<User> {
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    await this.findOneOrFail(id); // ensure exists
    return this.usersRepo.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findOneOrFail(id);
    await this.usersRepo.delete(id);
  }
}
```

---

## Repository Pattern (Prisma Wrapper)

```typescript
// users.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@prisma/client';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }
}
```

---

## External HTTP Integration

Use `@nestjs/axios` for outbound HTTP calls. Wrap in a dedicated service.

```typescript
// payment-gateway.service.ts
import { Injectable, BadGatewayException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PaymentGatewayService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.getOrThrow<string>('PAYMENT_GATEWAY_URL');
    this.apiKey = this.config.getOrThrow<string>('PAYMENT_GATEWAY_KEY');
  }

  async charge(
    amount: number,
    token: string,
  ): Promise<{ transactionId: string }> {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/charge`,
          { amount, token },
          { headers: { Authorization: `Bearer ${this.apiKey}` } },
        ),
      );
      return data;
    } catch (err) {
      throw new BadGatewayException('Payment gateway unavailable');
    }
  }
}
```

---

## Cross-Module Service Injection

```typescript
// orders.module.ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [UsersModule], // UsersModule exports UsersService
  providers: [OrdersService],
})
export class OrdersModule {}

// orders.service.ts — can now inject UsersService
constructor(
  private readonly ordersRepo: OrdersRepository,
  private readonly usersService: UsersService,
) {}
```

---

## Notes

- **Circular dependencies**: Use `forwardRef()` only as a last resort. Usually indicates a domain boundary problem — consider splitting or inverting the dependency.
- **Transaction boundaries**: Multi-step writes that must be atomic belong in the service layer, using `prisma.$transaction()`. Never split them across HTTP calls.
- **Do not use `@Inject()` token strings** unless building a plugin/library. Constructor injection with typed providers is always cleaner.
- **Global modules** (`@Global()`): Only for truly cross-cutting providers like `PrismaModule`, `ConfigModule`, `LoggerModule`. Not for domain services.
