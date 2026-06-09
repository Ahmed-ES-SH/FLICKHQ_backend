import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { ListsModule } from '../src/modules/lists/lists.module';
import { UserList } from '../src/modules/lists/schema/user-list.entity';
import { UserListItem } from '../src/modules/lists/schema/user-list-item.entity';

/**
 * Minimal auth guard for e2e tests.
 * Reads JWT from cookie, verifies it, and sets req.user.
 * Skips blacklist check (no BlackList entity in test module).
 */
class TestAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = req.cookies?.['flick_auth_token'] as string | undefined;
    if (!token) return false;

    try {
      const payload = await this.jwtService.verifyAsync<{
        id: number;
        email: string;
        role: string;
      }>(token);
      req.user = payload;
      return true;
    } catch {
      return false;
    }
  }
}

describe('Lists (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let authToken: string;

  const testUserId = 9999;
  const testUserEmail = 'e2e-test@example.com';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USERNAME || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_NAME || 'flick_test',
          entities: [UserList, UserListItem],
          synchronize: false,
        }),
        JwtModule.register({
          secret: process.env.JWT_SECRET || 'test-secret',
          signOptions: { expiresIn: '1h' },
        }),
        HttpModule,
        ListsModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    jwtService = moduleFixture.get(JwtService);

    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    // Register test auth guard (reads JWT from cookie, skips blacklist check)
    app.useGlobalGuards(new TestAuthGuard(jwtService));

    await app.init();

    // Sign a real JWT for test requests
    authToken = jwtService.sign({
      id: testUserId,
      email: testUserEmail,
      role: 'user',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /lists', () => {
    it('should create a new custom list', () => {
      return request(app.getHttpServer())
        .post('/lists')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .send({ name: 'E2E Test List' })
        .expect(201)
        .expect((res) => {
          const body = res.body as Record<string, unknown>;
          expect(body).toHaveProperty('id');
          expect(body.name).toBe('E2E Test List');
          expect(body.isSystem).toBe(false);
          expect(body.slug).toBe('e2e-test-list');
          expect(body.listKey).toMatch(/^custom:/);
        });
    });

    it('should reject list with empty name', () => {
      return request(app.getHttpServer())
        .post('/lists')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .send({ name: '' })
        .expect(400);
    });

    it('should reject request without auth cookie', () => {
      return request(app.getHttpServer())
        .post('/lists')
        .send({ name: 'No Auth List' })
        .expect(401);
    });
  });

  describe('GET /lists', () => {
    it('should return paginated lists', () => {
      return request(app.getHttpServer())
        .get('/lists')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .expect(200)
        .expect((res) => {
          const body = res.body as Record<string, unknown>;
          expect(body).toHaveProperty('data');
          expect(body).toHaveProperty('total');
          expect(body).toHaveProperty('page');
          expect(body).toHaveProperty('perPage');
          expect(Array.isArray(body.data)).toBe(true);
        });
    });

    it('should support pagination params', () => {
      return request(app.getHttpServer())
        .get('/lists?page=1&perPage=5')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .expect(200)
        .expect((res) => {
          const body = res.body as Record<string, unknown>;
          expect(body.page).toBe(1);
          expect(body.perPage).toBe(5);
        });
    });
  });

  describe('GET /lists/:id', () => {
    it('should return 404 for nonexistent list', () => {
      return request(app.getHttpServer())
        .get('/lists/00000000-0000-0000-0000-000000000000')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .expect(404);
    });

    it('should reject invalid UUID format', () => {
      return request(app.getHttpServer())
        .get('/lists/not-a-uuid')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .expect(400);
    });
  });

  describe('POST /lists/:id/items', () => {
    it('should return 404 for nonexistent list', () => {
      return request(app.getHttpServer())
        .post('/lists/00000000-0000-0000-0000-000000000000/items')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .send({ mediaType: 'movie', tmdbId: 550 })
        .expect(404);
    });

    it('should reject invalid media type', () => {
      return request(app.getHttpServer())
        .post('/lists/00000000-0000-0000-0000-000000000000/items')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .send({ mediaType: 'invalid', tmdbId: 550 })
        .expect(400);
    });
  });

  describe('DELETE /lists/:id/items/:mediaType/:tmdbId', () => {
    it('should return 404 for nonexistent list', () => {
      return request(app.getHttpServer())
        .delete('/lists/00000000-0000-0000-0000-000000000000/items/movie/550')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .expect(404);
    });
  });

  describe('PATCH /lists/:id', () => {
    it('should return 404 for nonexistent list', () => {
      return request(app.getHttpServer())
        .patch('/lists/00000000-0000-0000-0000-000000000000')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .send({ name: 'Renamed' })
        .expect(404);
    });
  });

  describe('DELETE /lists/:id', () => {
    it('should return 404 for nonexistent list', () => {
      return request(app.getHttpServer())
        .delete('/lists/00000000-0000-0000-0000-000000000000')
        .set('Cookie', [`flick_auth_token=${authToken}`])
        .expect(404);
    });
  });
});
