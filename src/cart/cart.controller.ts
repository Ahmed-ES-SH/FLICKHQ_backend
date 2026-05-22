import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { GetUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get user cart' })
  @ApiResponse({ status: 200, type: CartResponseDto })
  getCart(@GetUser('id') userId: string): Promise<CartResponseDto> {
    return this.cartService.getCart(userId);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiResponse({ status: 200, type: CartResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or insufficient stock',
  })
  addToCart(
    @GetUser('id') userId: string,
    @Body() dto: AddToCartDto,
  ): Promise<CartResponseDto> {
    return this.cartService.addToCart(userId, dto);
  }

  @Patch('items/:productId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiResponse({ status: 200, type: CartResponseDto })
  @ApiResponse({ status: 404, description: 'Cart item not found' })
  updateCartItem(
    @GetUser('id') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cartService.updateCartItem(userId, productId, dto);
  }

  @Delete('items/:productId')
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiResponse({ status: 200, type: CartResponseDto })
  removeFromCart(
    @GetUser('id') userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CartResponseDto> {
    return this.cartService.removeFromCart(userId, productId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear cart' })
  @ApiResponse({ status: 200, description: 'Cart cleared' })
  clearCart(@GetUser('id') userId: string): Promise<{ message: string }> {
    return this.cartService
      .clearCart(userId)
      .then(() => ({ message: 'Cart cleared' }));
  }
}
