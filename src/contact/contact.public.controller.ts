import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { Public } from '../auth/decorators/public.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';

@Public()
@ApiTags('Contact (Public)')
@Controller('contact')
export class ContactPublicController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @ApiOperation({ summary: 'Submit a contact message' })
  @ApiResponse({ status: 201, description: 'Message submitted successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded — max 5 per hour',
  })
  async create(@Body() dto: CreateContactMessageDto, @Req() request: Request) {
    const ipAddress = request.ip ?? 'unknown';
    return this.contactService.create(dto, ipAddress);
  }
}
