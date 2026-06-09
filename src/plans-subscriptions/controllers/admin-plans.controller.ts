import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../../auth/types/UserRoleEnum';
import { BillingPlanStatus } from '../../billing/common/billing.enums';

import { PlanManagementService } from '../services/plan-management.service';
import { PriceManagementService } from '../services/price-management.service';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { CreatePriceDto } from '../dto/create-price.dto';
import {
  PlanResponseDto,
  PlanMutationResultDto,
} from '../dto/plan-response.dto';
import { PriceResponseDto } from '../dto/price-response.dto';

@ApiTags('Plans & Subscriptions - Admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRoleEnum.ADMIN)
@Controller('admin/plans')
export class AdminPlansController {
  constructor(
    private readonly planManagement: PlanManagementService,
    private readonly priceManagement: PriceManagementService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a plan with display fields (admin).' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Plan created.',
    type: PlanMutationResultDto,
  })
  async createPlan(@Body() dto: CreatePlanDto): Promise<PlanMutationResultDto> {
    const plan = await this.planManagement.createPlan(dto);
    return { plan };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all plans with optional status filter (admin).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of plans.',
    type: [PlanResponseDto],
  })
  async listPlans(
    @Query('status', new ParseEnumPipe(BillingPlanStatus, { optional: true }))
    status?: BillingPlanStatus,
  ): Promise<PlanResponseDto[]> {
    return this.planManagement.listPlans(status);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get plan detail with prices (admin).' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PlanResponseDto,
  })
  async getPlan(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanResponseDto> {
    return this.planManagement.getPlan(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update plan (admin).' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PlanMutationResultDto,
  })
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<PlanMutationResultDto> {
    const plan = await this.planManagement.updatePlan(id, dto);
    return { plan };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a plan (admin).' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PlanMutationResultDto,
  })
  async archivePlan(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanMutationResultDto> {
    const plan = await this.planManagement.archivePlan(id);
    return { plan };
  }

  @Post(':id/prices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a price to a plan (admin).' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Price added.',
    type: PriceResponseDto,
  })
  async addPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePriceDto,
  ): Promise<PriceResponseDto> {
    return this.priceManagement.addPrice(id, dto);
  }

  @Get(':id/prices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List prices for a plan (admin).' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: [PriceResponseDto],
  })
  async listPrices(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceResponseDto[]> {
    return this.priceManagement.listPricesForPlan(id);
  }

  @Patch('prices/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update price (deactivate).' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: PriceResponseDto,
  })
  async deactivatePrice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceResponseDto> {
    return this.priceManagement.deactivatePrice(id);
  }
}
