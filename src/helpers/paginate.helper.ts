// common/utils/pagination.util.ts
import { ObjectLiteral, Repository, FindManyOptions } from 'typeorm';

// common/interfaces/paginated-result.interface.ts
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

export async function paginate<T extends ObjectLiteral>(
  repo: Repository<T>,
  page = 1,
  limit = 10,
  options: FindManyOptions<T> = {},
): Promise<PaginatedResult<T>> {
  const [data, total] = await repo.findAndCount({
    skip: (page - 1) * limit,
    take: limit,
    ...options,
  });

  return {
    data,
    total,
    page,
    perPage: limit,
    lastPage: Math.ceil(total / limit),
  };
}
