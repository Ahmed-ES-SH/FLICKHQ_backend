import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithUser } from '../types/request.interface';
import { User } from '../../user/schema/user.schema';

type UserKey = keyof User;

export const GetUser = createParamDecorator(
  (data: UserKey | undefined, ctx: ExecutionContext): User | User[UserKey] => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      return undefined as User[UserKey];
    }

    return data ? user[data] : user;
  },
);
