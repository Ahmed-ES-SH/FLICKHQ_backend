/**
 * @RequiresFeature decorator
 *
 * Marks a controller method (or class) as requiring one or more
 * billing feature keys. Consumed by `FeatureAccessGuard` via
 * `Reflector`. The guard throws `ForbiddenException` when the
 * authenticated user lacks any of the listed feature keys.
 *
 * Usage:
 *
 *   @Get('reports')
 *   @UseGuards(FeatureAccessGuard)
 *   @RequiresFeature('premium_reports')
 *   getReports() { ... }
 *
 *   @Get('team/export')
 *   @UseGuards(FeatureAccessGuard)
 *   @RequiresFeature('premium_reports', 'team_export')
 *   exportTeamData() { ... }
 *
 * The metadata key is exported as `REQUIRES_FEATURE_METADATA` so
 * the guard and tests can read the same constant.
 *
 * The decorator is a thin `SetMetadata` wrapper, modeled on
 * `Roles` (`src/auth/decorators/Roles.decorator.ts`).
 */

import { SetMetadata } from '@nestjs/common';
import { REQUIRES_FEATURE_METADATA } from '../common/billing.constants';

export const RequiresFeature = (...featureKeys: string[]) =>
  SetMetadata(REQUIRES_FEATURE_METADATA, featureKeys);
