import { UserRoleEnum } from './UserRoleEnum';

export interface UserType {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
  role?: UserRoleEnum;
  googleId?: string;
  password?: string;
  isEmailVerified: boolean;
}
