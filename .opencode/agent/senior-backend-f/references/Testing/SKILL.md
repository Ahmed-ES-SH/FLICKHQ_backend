# Skill: Testing

## Trigger

Use when the request mentions **unit tests, integration tests, e2e tests, mocks, fixtures, test setup, or regression coverage**.

---

## Scope

- Unit tests for services and guards
- Integration tests with real database
- E2E tests for HTTP endpoints
- Mocking with Jest
- Test database setup and teardown
- Factory functions for test data
- Test coverage requirements

---

## Unit Test — Service

```typescript
// users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockRepo = {
  findByEmail: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('throws ConflictException if email already exists', async () => {
      mockRepo.findByEmail.mockResolvedValue({ id: '1', email: 'test@test.com' });

      await expect(
        service.create({ email: 'test@test.com', password: 'Pass1234!', name: 'Test' }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns user without password on success', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({
        id: 'uuid-1',
        email: 'new@test.com',
        name: 'Test',
        password: 'hashed',
        role: 'USER',
        createdAt: new Date(),
      });

      const result = await service.create({
        email: 'new@test.com',
        password: 'Pass1234!',
        name: 'Test',
      });

      expect(result).not.toHaveProperty('password');
      expect(result.email).toBe('new@test.com');
    });
  });

  describe('findOneOrFail', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(service.findOneOrFail('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
```

---

## Unit Test — Guard

```typescript
// common/guards/roles.guard.spec.ts
import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

const mockReflector = { getAllAndOverride: jest.fn() };

const createContext = (role: string): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { role } }),
    }),
  } as unknown as ExecutionContext);

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(mockReflector as unknown as Reflector);
    jest.clearAllMocks();
  });

  it('allows access when no roles required', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(createContext('USER'))).toBe(true);
  });

  it('allows access when user has required role', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    expect(guard.canActivate(createContext('ADMIN'))).toBe(true);
  });

  it('throws ForbiddenException when role is insufficient', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(createContext('USER'))).toThrow(ForbiddenException);
  });
});
```

---

## Integration Test — Service + Real DB

```typescript
// users/users.service.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';

describe('UsersService (integration)', () => {
  let service: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [UsersService, UsersRepository],
    }).compile();

    service = module.get(UsersService);
    prisma  = module.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany(); // clean test data
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates and retrieves a user', async () => {
    const created = await service.create({
      email: 'int@test.com',
      password: 'Pass1234!',
      name: 'Integration User',
    });

    const found = await service.findOneOrFail(created.id);
    expect(found.email).toBe('int@test.com');
  });
});
```

Use a separate `TEST_DATABASE_URL` in `.env.test`.

---

## E2E Test

```typescript
// test/auth.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/login — rejects invalid credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'wrong@test.com', password: 'wrong' })
      .expect(401);
  });

  it('GET /users/me — rejects unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .expect(401);
  });
});
```

---

## Test Data Factories

```typescript
// test/factories/user.factory.ts
import { CreateUserDto } from '../../src/users/dto/create-user.dto';

let counter = 0;

export function buildUserDto(overrides: Partial<CreateUserDto> = {}): CreateUserDto {
  counter++;
  return {
    email: `user${counter}@test.com`,
    password: 'Test1234!',
    name: `Test User ${counter}`,
    ...overrides,
  };
}
```

---

## Jest Configuration

```json
// package.json
{
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node",
    "coverageThreshold": {
      "global": { "lines": 80, "functions": 80, "branches": 70 }
    }
  }
}
```

E2E config in `test/jest-e2e.json`:

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

---

## Notes

- **Unit test rule**: Mock every external dependency (DB, HTTP clients, other services). Test logic only.
- **Integration test rule**: Use a real test database (`TEST_DATABASE_URL`). Run migrations before tests.
- **E2E test rule**: Boot the full app. Cover the critical happy paths and key error cases. Don't try to cover every edge case — that's what unit tests are for.
- **Coverage gates**: 80% line/function coverage is a reasonable floor. Don't chase 100% — focus on risk-weighted coverage (auth, payments, data mutations).
- **Test isolation**: Every test must leave the database in the same state it found it. Use `afterEach` cleanup or transactions that roll back.
