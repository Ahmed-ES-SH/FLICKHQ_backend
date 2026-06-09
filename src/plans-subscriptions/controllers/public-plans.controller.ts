import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { PlanDisplayService } from '../services/plan-display.service';
import { PlanResponseDto } from '../dto/plan-response.dto';

@ApiTags('Plans & Subscriptions - Public')
@Controller('plans')
export class PublicPlansController {
  constructor(private readonly planDisplay: PlanDisplayService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active plans with prices for pricing page.' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active plans sorted by display order.',
    type: [PlanResponseDto],
  })
  async listPlans(): Promise<PlanResponseDto[]> {
    return this.planDisplay.listPublicPlans();
  }
}
