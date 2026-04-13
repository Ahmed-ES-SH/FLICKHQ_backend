/**
 * Cache Configuration for Flick HQ Backend
 *
 * This file configures the caching layer using @nestjs/cache-manager.
 * Cache helps reduce database load and improves response times.
 *
 * Note: This uses in-memory cache, suitable for single-instance deployment.
 * For multi-instance deployment, consider using Redis adapter.
 */

import { CacheModuleOptions } from '@nestjs/cache-manager';

/**
 * Cache configuration options
 * - ttl: Time-to-live for cached items in seconds
 * - max: Maximum number of items in cache
 */
export const CACHE_OPTIONS: CacheModuleOptions = {
  // Time-to-live: 600 seconds = 10 minutes
  // Cached data will be automatically invalidated after this time
  ttl: 600,

  // Maximum items: 100
  // Maximum number of items to store in cache
  // Oldest items are evicted when limit is reached
  max: 100,

  // Make cache available globally across all modules
  isGlobal: true,
};
