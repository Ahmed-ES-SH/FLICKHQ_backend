import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { PlanService } from '../services/plan.service';
import { PlanResponseDto } from '../dto/plan.dto';

@ApiTags('Plans')
@Controller('plans')
export class PublicPlansController {
  constructor(private readonly planService: PlanService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active plans with prices.' })
  @ApiResponse({ status: HttpStatus.OK, type: [PlanResponseDto] })
  async listPlans(): Promise<PlanResponseDto[]> {
    return this.planService.listPublicPlans();
  }
}
