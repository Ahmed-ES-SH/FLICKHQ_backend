import { Controller, Post, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { Public } from '../auth/decorators/public.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';

/**
 * Extract the real client IP, accounting for reverse proxies.
 * Returns null if no usable IP is found.
 */
function extractClientIp(request: Request): string | null {
  // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return request.ip ?? null;
}

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
    const ipAddress = extractClientIp(request);
    return this.contactService.create(dto, ipAddress ?? 'unknown');
  }
}
