export type DocHub = 'start' | 'workspace' | 'knowledge' | 'agents' | 'integrations' | 'admin';

export interface DocStep {
  title: string;
  body: string[];
  /** Path di bawah `public/`, mis. `/docs/02-multi-brain/01-percakapan-baru.jpg`. */
  image?: string;
  imageAlt?: string;
  result: string;
  tip?: string;
  /** Izin tambahan yang dibutuhkan langkah ini, di luar izin bab. */
  permission?: string;
}

export interface DocChapter {
  id: string;
  hub: DocHub;
  title: string;
  summary: string;
  audience: string;
  /** Bab tampil bila pengguna punya salah satu izin ini; kosong = semua pengguna. */
  permissions: string[];
  steps: DocStep[];
}
