import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactQueryDto } from './dto/contact-query.dto';
import { Roles } from '../auth/decorators/Roles.decorator';
import { UserRoleEnum } from '../auth/types/UserRoleEnum';
import { AuthGuard } from '../auth/guards/auth.guard';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';

@UseGuards(AuthGuard)
@Roles(UserRoleEnum.ADMIN)
@ApiTags('Contact (Admin)')
@ApiBearerAuth()
@Controller('admin/contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  @ApiOperation({
    summary: 'List all contact messages with pagination and filtering',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of contact messages',
  })
  async findAll(@Query() query: ContactQueryDto) {
    return this.contactService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single contact message by ID' })
  @ApiResponse({ status: 200, description: 'Contact message details' })
  @ApiResponse({ status: 404, description: 'Contact message not found' })
  @ApiParam({ name: 'id', description: 'Contact message UUID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.contactService.findOne(id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a contact message as read' })
  @ApiResponse({ status: 200, description: 'Message marked as read' })
  @ApiResponse({ status: 404, description: 'Contact message not found' })
  @ApiParam({ name: 'id', description: 'Contact message UUID' })
  async markAsRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.contactService.markAsRead(id);
  }

  @Patch(':id/reply')
  @ApiOperation({ summary: 'Mark a contact message as replied' })
  @ApiResponse({ status: 200, description: 'Message marked as replied' })
  @ApiResponse({ status: 404, description: 'Contact message not found' })
  @ApiParam({ name: 'id', description: 'Contact message UUID' })
  async markAsReplied(@Param('id', ParseUUIDPipe) id: string) {
    return this.contactService.markAsReplied(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a contact message permanently' })
  @ApiResponse({ status: 200, description: 'Message deleted successfully' })
  @ApiResponse({ status: 404, description: 'Contact message not found' })
  @ApiParam({ name: 'id', description: 'Contact message UUID' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.contactService.remove(id);
  }
}
