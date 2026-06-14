import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../../auth/types/UserRoleEnum';
import { PlanService } from '../services/plan.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  CreatePriceDto,
  PlanResponseDto,
  PriceResponseDto,
} from '../dto/plan.dto';
import { PlanStatus } from '../common/subscription.enums';

@ApiTags('Admin - Plans')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRoleEnum.ADMIN)
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly planService: PlanService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a plan.' })
  async createPlan(@Body() dto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.planService.createPlan(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all plans.' })
  async listPlans(
    @Query('status') status?: PlanStatus,
  ): Promise<PlanResponseDto[]> {
    return this.planService.listPlans(status);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get plan with prices.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getPlan(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanResponseDto> {
    return this.planService.getPlan(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update plan.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<PlanResponseDto> {
    return this.planService.updatePlan(id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive plan.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async archivePlan(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlanResponseDto> {
    return this.planService.archivePlan(id);
  }

  @Post(':id/prices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add price to plan.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async addPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePriceDto,
  ): Promise<PriceResponseDto> {
    return this.planService.addPrice(id, dto);
  }

  @Get(':id/prices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List prices for plan.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async listPrices(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceResponseDto[]> {
    return this.planService.listPricesForPlan(id);
  }

  @Patch('prices/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate price.' })
  async deactivatePrice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceResponseDto> {
    return this.planService.deactivatePrice(id);
  }
}
