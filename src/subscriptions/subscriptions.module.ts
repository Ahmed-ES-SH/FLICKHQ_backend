import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../user/user.module';

import { Plan } from './entities/plan.entity';
import { Price } from './entities/price.entity';

import { PlanService } from './services/plan.service';

import { PublicPlansController } from './controllers/public-plans.controller';
import { AdminPlansController } from './controllers/admin-plans.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Plan, Price]),
    UserModule,
  ],
  providers: [PlanService],
  controllers: [PublicPlansController, AdminPlansController],
})
export class SubscriptionsModule {}
