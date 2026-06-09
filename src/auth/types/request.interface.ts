import { Request } from 'express';
import { User } from '../../user/schema/user.entity';

export interface RequestWithUser extends Request {
  user: User;
}
