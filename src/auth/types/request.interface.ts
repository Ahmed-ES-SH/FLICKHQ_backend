import { Request } from 'express';
import { User } from '../../user/schema/user.entity';

/**
 * Request with authenticated user attached by AuthGuard.
 * The user object is the decoded JWT payload (id, email, role).
 * For full user data, inject via GetUser decorator or fetch from UserService.
 */
export interface RequestWithUser extends Request {
  user: Pick<User, 'id' | 'email' | 'role'> & Partial<User>;
}
