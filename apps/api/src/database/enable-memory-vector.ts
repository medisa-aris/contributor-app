import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { enableMemoryVector } from './memory-vector';

/** Aktifkan pencarian semantik memori setelah image PostgreSQL memuat pgvector. */
async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const enabled = await enableMemoryVector(AppDataSource);
    console.log(
      enabled
        ? 'pgvector aktif untuk memori. Embedding catatan lama diisi bertahap oleh API.'
        : 'Ekstensi pgvector tidak tersedia di server PostgreSQL ini; memori tetap memakai teks penuh.',
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: Error) => {
  console.error(`Gagal mengaktifkan pgvector: ${err.message}`);
  process.exit(1);
});
