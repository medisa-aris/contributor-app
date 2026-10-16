import { shallowRef, ref } from 'vue';
import { ApiError, type PaginatedResult } from '@/api/http';

export type QueryValue = string | number | boolean | null | undefined;

export interface PagedQuery extends Record<string, QueryValue> {
  page: number;
  pageSize: number;
}

export function usePagedList<T>(
  fetcher: (query: PagedQuery) => Promise<PaginatedResult<T>>,
  options: { pageSize?: number } = {},
) {
  const items = shallowRef<T[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(options.pageSize ?? 25);
  const totalPages = ref(1);
  const loading = ref(false);
  const error = ref('');
  let filters: Record<string, QueryValue> = {};

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const result = await fetcher({ page: page.value, pageSize: pageSize.value, ...filters });
      items.value = result.items;
      total.value = result.total;
      page.value = result.page;
      totalPages.value = result.totalPages;
    } catch (caught) {
      items.value = [];
      total.value = 0;
      error.value = caught instanceof ApiError ? caught.message : 'Gagal memuat data.';
    } finally {
      loading.value = false;
    }
  }

  function setFilter(values: Record<string, QueryValue>): void {
    filters = { ...filters, ...values };
    page.value = 1;
    void load();
  }

  function goPage(next: number): void {
    page.value = next;
    void load();
  }

  return { items, total, page, pageSize, totalPages, loading, error, load, setFilter, goPage };
}
