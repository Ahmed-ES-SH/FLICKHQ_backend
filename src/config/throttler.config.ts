/**
 * Rate Limiting Configuration for Flick HQ Backend
 *
 * This file configures request rate limiting using @nestjs/throttler.
 * Helps prevent abuse and protects the API from DDoS attacks.
 *
 * The throttler uses in-memory storage (suitable for single instance).
 * For multi-instance部署, consider using Redis adapter.
 */

import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Throttler configuration with two tiers:
 * - short: Burst protection (5 requests per second)
 * - long: Sustained protection (100 requests per minute)
 */
export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      // Short-term throttle: prevents rapid-fire requests
      // TTL: 1000ms = 1 second
      name: 'short',
      ttl: 1000, // 1 second
      // Limit: 5 requests per second per IP
      limit: 5, // 5 requests per second
    },
    {
      // Long-term throttle: prevents sustained abuse
      // TTL: 60000ms = 1 minute
      name: 'long',
      ttl: 60000, // 1 minute
      // Limit: 100 requests per minute per IP
      limit: 100, // 100 requests per minute
    },
  ],
};
