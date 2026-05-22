import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Cart } from './schema/cart.schema';
import { CartItem } from './schema/cart-item.schema';

@Injectable()
export class CartRepository {
  private readonly logger = new Logger(CartRepository.name);
  private cartRepo: Repository<Cart>;
  private cartItemRepo: Repository<CartItem>;

  constructor(private dataSource: DataSource) {
    this.cartRepo = this.dataSource.getRepository(Cart);
    this.cartItemRepo = this.dataSource.getRepository(CartItem);
  }

  async findByUserIdWithItems(userId: string): Promise<Cart | null> {
    return this.cartRepo.findOne({
      where: { userId },
      relations: ['items', 'items.product'],
    });
  }

  async findOrCreate(userId: string): Promise<Cart> {
    let cart = await this.findByUserIdWithItems(userId);
    if (!cart) {
      try {
        cart = this.cartRepo.create({ userId });
        cart = await this.cartRepo.save(cart);
      } catch (err) {
        // PostgreSQL unique violation (code 23505) — another concurrent request created the cart
        const typeormError = err as { code?: string };
        if (typeormError.code === '23505') {
          this.logger.debug('Concurrent cart creation detected, re-fetching', {
            userId,
          });
          cart = await this.findByUserIdWithItems(userId);
          if (!cart) throw err;
        } else {
          throw err;
        }
      }
    }
    return cart;
  }

  async addItem(
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem> {
    const existingItem = await this.cartItemRepo.findOne({
      where: { cartId, productId },
    });

    if (existingItem) {
      existingItem.quantity += quantity;
      return this.cartItemRepo.save(existingItem);
    }

    try {
      const newItem = this.cartItemRepo.create({ cartId, productId, quantity });
      return await this.cartItemRepo.save(newItem);
    } catch (err) {
      // Unique constraint violation — concurrent insert for same cartId+productId
      const typeormError = err as { code?: string };
      if (typeormError.code === '23505') {
        this.logger.debug('Concurrent cart item insert detected, merging', {
          cartId,
          productId,
        });
        const item = await this.cartItemRepo.findOneOrFail({
          where: { cartId, productId },
        });
        item.quantity += quantity;
        return this.cartItemRepo.save(item);
      }
      throw err;
    }
  }

  async updateItemQuantity(
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<CartItem | null> {
    const item = await this.cartItemRepo.findOne({
      where: { cartId, productId },
    });

    if (!item) return null;

    item.quantity = quantity;
    return this.cartItemRepo.save(item);
  }

  async removeItem(cartId: string, productId: string): Promise<void> {
    const result = await this.cartItemRepo.delete({ cartId, productId });
    if (result.affected === 0) {
      throw new NotFoundException('Cart item not found');
    }
  }

  async clearCart(cartId: string): Promise<void> {
    await this.cartItemRepo.delete({ cartId });
  }

  async getCartItemCount(userId: string): Promise<number> {
    const cart = await this.findByUserIdWithItems(userId);
    if (!cart || !cart.items) return 0;
    return cart.items.reduce((sum, item) => sum + item.quantity, 0);
  }
}
