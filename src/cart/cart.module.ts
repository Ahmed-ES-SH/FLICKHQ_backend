import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cart } from './schema/cart.schema';
import { CartItem } from './schema/cart-item.schema';
import { Product } from '../products/schema/product.schema';
import { CartService } from './cart.service';
import { CartRepository } from './cart.repository';
import { CartController } from './cart.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Cart, CartItem, Product]), AuthModule],
  controllers: [CartController],
  providers: [CartService, CartRepository],
  exports: [CartService],
})
export class CartModule {}
