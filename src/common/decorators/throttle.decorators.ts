import { SetMetadata } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export const THROTTLE_SKIP_KEY = 'throttle_skip';

export const SkipThrottle = () => SetMetadata(THROTTLE_SKIP_KEY, true);

// Custom throttle decorator for stricter limits on sensitive endpoints
export const StrictThrottle = (options?: { limit?: number; ttl?: number }) =>
  Throttle({
    short: {
      limit: options?.limit ?? 2,
      ttl: options?.ttl ?? 5000, // 5 seconds
    },
  });
