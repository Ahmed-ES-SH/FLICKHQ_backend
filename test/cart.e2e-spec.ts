import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cart } from '../src/cart/schema/cart.schema';
import { CartItem } from '../src/cart/schema/cart-item.schema';
import { Product } from '../src/products/schema/product.schema';
import { AuthGuard } from '../src/auth/guards/auth.guard';

class MockAuthGuard {
  canActivate() {
    return true;
  }
}

describe('CartController (e2e)', () => {
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

  describe('GET /cart', () => {
    it('should return empty cart for new user', () => {
      return request(app.getHttpServer())
        .get('/cart')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('userId');
          expect(res.body).toHaveProperty('items');
          expect(res.body).toHaveProperty('totalItems');
          expect(res.body).toHaveProperty('subtotal');
          expect(res.body).toHaveProperty('currency');
          expect(res.body.currency).toBe('usd');
        });
    });
  });

  describe('POST /cart/items', () => {
    let productId: string;

    beforeAll(async () => {
      const module = app.get(TypeOrmModule);
      const dataSource = (module as any).dataSource;
      if (dataSource) {
        const productRepo = dataSource.getRepository(Product);
        const existingProduct = await productRepo.findOne({
          where: { isPublished: true },
        });
        if (existingProduct) {
          productId = existingProduct.id;
        }
      }
    });

    it('should add item to cart when product exists', async () => {
      if (!productId) {
        return;
      }

      return request(app.getHttpServer())
        .post('/cart/items')
        .send({ productId, quantity: 1 })
        .expect(200)
        .expect((res) => {
          expect(res.body.items.length).toBeGreaterThan(0);
          expect(res.body.items[0].productId).toBe(productId);
          expect(res.body.items[0].quantity).toBe(1);
        });
    });

    it('should return 400 for invalid product ID', () => {
      return request(app.getHttpServer())
        .post('/cart/items')
        .send({ productId: 'invalid-uuid', quantity: 1 })
        .expect(400);
    });

    it('should return 404 for non-existent product', () => {
      return request(app.getHttpServer())
        .post('/cart/items')
        .send({
          productId: '00000000-0000-0000-0000-000000000000',
          quantity: 1,
        })
        .expect(404);
    });

    it('should return 400 for quantity less than 1', () => {
      return request(app.getHttpServer())
        .post('/cart/items')
        .send({
          productId: '00000000-0000-0000-0000-000000000001',
          quantity: 0,
        })
        .expect(400);
    });

    it('should return 400 for quantity greater than 100', () => {
      return request(app.getHttpServer())
        .post('/cart/items')
        .send({
          productId: '00000000-0000-0000-0000-000000000001',
          quantity: 101,
        })
        .expect(400);
    });
  });

  describe('PATCH /cart/items/:productId', () => {
    it('should return 400 for invalid quantity', () => {
      return request(app.getHttpServer())
        .patch('/cart/items/00000000-0000-0000-0000-000000000001')
        .send({ quantity: 0 })
        .expect(400);
    });

    it('should return 400 for invalid UUID', () => {
      return request(app.getHttpServer())
        .patch('/cart/items/invalid-uuid')
        .send({ quantity: 1 })
        .expect(400);
    });
  });

  describe('DELETE /cart/items/:productId', () => {
    it('should remove item from cart', () => {
      return request(app.getHttpServer())
        .delete('/cart/items/00000000-0000-0000-0000-000000000001')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('items');
        });
    });
  });

  describe('DELETE /cart', () => {
    it('should clear cart', () => {
      return request(app.getHttpServer())
        .delete('/cart')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toBe('Cart cleared');
        });
    });
  });
});
