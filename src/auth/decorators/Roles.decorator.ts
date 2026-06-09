import { SetMetadata } from '@nestjs/common';
import { UserRoleEnum } from '../types/UserRoleEnum';

export const Roles = (...roles: UserRoleEnum[]) => SetMetadata('roles', roles);
