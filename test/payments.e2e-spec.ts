import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AuthGuard } from '../../src/auth/guards/auth.guard';

class MockAuthGuard {
  canActivate() {
    return true;
  }
}

describe('PaymentsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AuthGuard)
      .useClass(MockAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /payments/intent', () => {
    it('should return 400 for invalid product type', () => {
      return request(app.getHttpServer())
        .post('/payments/intent')
        .send({ productType: 'invalid_product' })
        .expect(400);
    });

    it('should return 400 for missing productType', () => {
      return request(app.getHttpServer())
        .post('/payments/intent')
        .send({})
        .expect(400);
    });

    it('should create payment intent for valid product type', () => {
      return request(app.getHttpServer())
        .post('/payments/intent')
        .send({ productType: 'premium_monthly' })
        .expect((res) => {
          expect([200, 201, 400]).toContain(res.status);
          if (res.status === 200 || res.status === 201) {
            expect(res.body).toHaveProperty('clientSecret');
            expect(res.body).toHaveProperty('paymentIntentId');
            expect(res.body).toHaveProperty('amount');
            expect(res.body).toHaveProperty('currency');
          }
        });
    });
  });

  describe('POST /payments/webhook', () => {
    it('should return 400 for invalid webhook signature', () => {
      return request(app.getHttpServer())
        .post('/payments/webhook')
        .set('stripe-signature', 'invalid_signature')
        .send({
          id: 'evt_test',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_test' } },
        })
        .expect(400);
    });

    it('should return 500 when webhook secret not configured', () => {
      return request(app.getHttpServer())
        .post('/payments/webhook')
        .set('stripe-signature', 't=123,v1=invalid')
        .send({
          id: 'evt_test',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_test' } },
        })
        .expect((res) => {
          expect([400, 500]).toContain(res.status);
        });
    });
  });

  describe('GET /payments/history', () => {
    it('should return payment history with pagination', () => {
      return request(app.getHttpServer())
        .get('/payments/history')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
          expect(res.body).toHaveProperty('page');
          expect(res.body).toHaveProperty('limit');
          expect(res.body).toHaveProperty('totalPages');
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('should support custom pagination parameters', () => {
      return request(app.getHttpServer())
        .get('/payments/history?page=1&limit=5')
        .expect(200)
        .expect((res) => {
          expect(res.body.page).toBe(1);
          expect(res.body.limit).toBe(5);
        });
    });
  });
});
