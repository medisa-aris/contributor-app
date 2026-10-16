export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function parsePagination(query: Record<string, unknown>, defaultLimit = 25): PaginationParams {
  const rawPage = Number.parseInt(String(query.page ?? '1'), 10);
  const rawLimit = Number.parseInt(String(query.limit ?? String(defaultLimit)), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : defaultLimit;
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(rows: T[], params: PaginationParams, total: number) {
  return {
    data: rows,
    meta: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    } satisfies PageMeta,
  };
}
