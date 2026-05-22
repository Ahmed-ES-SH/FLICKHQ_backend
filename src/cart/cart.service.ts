import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CartRepository } from './cart.repository';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartItemResponseDto, CartResponseDto } from './dto/cart-response.dto';
import { Product } from '../products/schema/product.schema';

const MAX_CART_QUANTITY = 50;

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private cartRepository: CartRepository,
    @InjectRepository(Product)
    private productRepo: Repository<Product>,
  ) {}

  async addToCart(userId: string, dto: AddToCartDto): Promise<CartResponseDto> {
    const product = await this.productRepo.findOne({
      where: { id: dto.productId },
      withDeleted: true,
    });

    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    if (!product.isPublished) {
      throw new BadRequestException('Product is not available');
    }

    if (product.stock < dto.quantity) {
      throw new BadRequestException('Insufficient stock');
    }

    const currentItemCount = await this.cartRepository.getCartItemCount(userId);
    if (currentItemCount + dto.quantity > MAX_CART_QUANTITY) {
      throw new BadRequestException(
        `Cart limit exceeded. Maximum ${MAX_CART_QUANTITY} items allowed`,
      );
    }

    const cart = await this.cartRepository.findOrCreate(userId);
    await this.cartRepository.addItem(cart.id, dto.productId, dto.quantity);

    this.logger.log(
      `Added ${dto.quantity} of product ${dto.productId} to cart for user ${userId}`,
    );

    return this.getCart(userId);
  }

  async updateCartItem(
    userId: string,
    productId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    const cart = await this.cartRepository.findByUserIdWithItems(userId);
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    const product = await this.productRepo.findOne({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.stock < dto.quantity) {
      throw new BadRequestException('Insufficient stock');
    }

    const updatedItem = await this.cartRepository.updateItemQuantity(
      cart.id,
      productId,
      dto.quantity,
    );
    if (!updatedItem) {
      throw new NotFoundException('Cart item not found');
    }

    this.logger.log(
      `Updated cart item ${productId} to quantity ${dto.quantity} for user ${userId}`,
    );

    return this.getCart(userId);
  }

  async removeFromCart(
    userId: string,
    productId: string,
  ): Promise<CartResponseDto> {
    const cart = await this.cartRepository.findByUserIdWithItems(userId);
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    await this.cartRepository.removeItem(cart.id, productId);

    this.logger.log(
      `Removed product ${productId} from cart for user ${userId}`,
    );

    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<void> {
    const cart = await this.cartRepository.findByUserIdWithItems(userId);
    if (!cart) return; // idempotent — already empty/missing

    await this.cartRepository.clearCart(cart.id);

    this.logger.log(`Cleared cart for user ${userId}`);
  }

  async getCart(userId: string): Promise<CartResponseDto> {
    const cart = await this.cartRepository.findByUserIdWithItems(userId);
    if (!cart) {
      const newCart = await this.cartRepository.findOrCreate(userId);
      return {
        id: newCart.id,
        userId: newCart.userId,
        items: [],
        totalItems: 0,
        subtotal: 0,
        currency: 'usd',
      };
    }

    const items: CartItemResponseDto[] = cart.items.map((item) => {
      const unitPrice = Math.round(Number(item.product.price) * 100);
      const subtotal = unitPrice * item.quantity;
      const availableStock = item.product.stock;

      return {
        id: item.id,
        productId: item.productId,
        productTitle: item.product.title,
        productThumbnail: item.product.thumbnail,
        unitPrice,
        quantity: item.quantity,
        subtotal,
        availableStock,
      };
    });

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

    return {
      id: cart.id,
      userId: cart.userId,
      items,
      totalItems,
      subtotal,
      currency: 'usd',
    };
  }

  async validateCartForCheckout(userId: string): Promise<{
    isValid: boolean;
    cart: CartResponseDto | null;
    errors: string[];
  }> {
    const errors: string[] = [];
    const cart = await this.cartRepository.findByUserIdWithItems(userId);

    if (!cart || !cart.items || cart.items.length === 0) {
      return { isValid: false, cart: null, errors: ['Cart is empty'] };
    }

    const productIds = cart.items.map((item) => item.productId);
    const products = await this.productRepo.find({
      where: { id: In(productIds) },
    });

    const productMap = new Map<string, Product>();
    products.forEach((p) => productMap.set(p.id, p));

    for (const item of cart.items) {
      const product = productMap.get(item.productId);

      if (!product) {
        errors.push(`Product ${item.productId} no longer exists`);
        continue;
      }

      if (!product.isPublished) {
        errors.push(`Product ${product.title} is no longer available`);
      }

      if (product.deletedAt) {
        errors.push(`Product ${product.title} has been removed`);
      }

      if (product.stock < item.quantity) {
        errors.push(`Insufficient stock for ${product.title}`);
      }
    }

    const cartResponse =
      errors.length === 0 ? await this.getCart(userId) : null;

    return {
      isValid: errors.length === 0,
      cart: cartResponse,
      errors,
    };
  }
}
