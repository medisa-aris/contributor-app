import { Injectable } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache in-memory ber-TTL untuk hasil resolusi izin, dikunci oleh versi rbac_meta.
 * Bila kelak Redis diaktifkan, ganti implementasi ini tanpa mengubah pemanggil.
 */
@Injectable()
export class AuthzCacheService {
  private static readonly DEFAULT_TTL_MS = 60_000;
  private static readonly VERSION_TTL_MS = 3_000;
  private static readonly MAX_ENTRIES = 2_000;

  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private versionCache: CacheEntry<number> | null = null;

  get<T>(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = AuthzCacheService.DEFAULT_TTL_MS): void {
    if (this.entries.size >= AuthzCacheService.MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  getCachedVersion(): number | null {
    if (this.versionCache && this.versionCache.expiresAt > Date.now()) {
      return this.versionCache.value;
    }
    return null;
  }

  setVersion(version: number, ttlMs: number = AuthzCacheService.VERSION_TTL_MS): void {
    this.versionCache = { value: version, expiresAt: Date.now() + ttlMs };
  }

  invalidateAll(): void {
    this.entries.clear();
    this.versionCache = null;
  }

  invalidateUser(userId: string): void {
    this.entries.delete(`access:${userId}`);
  }
}
