import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG } from '@bara/shared';
import { DOC_CHAPTERS } from './chapters';

const publicDir = resolve(__dirname, '../../public');
const knownPermissions = new Set<string>(PERMISSION_CATALOG.map((p) => p.id));

describe('DOC_CHAPTERS', () => {
  it('has unique chapter ids and step titles', () => {
    const ids = DOC_CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const chapter of DOC_CHAPTERS) {
      const titles = chapter.steps.map((s) => s.title);
      expect(new Set(titles).size, chapter.id).toBe(titles.length);
    }
  });

  it('every chapter has steps with body and result', () => {
    for (const chapter of DOC_CHAPTERS) {
      expect(chapter.steps.length, chapter.id).toBeGreaterThan(0);
      for (const step of chapter.steps) {
        expect(step.body.length, `${chapter.id}: ${step.title}`).toBeGreaterThan(0);
        expect(step.result.trim(), `${chapter.id}: ${step.title}`).not.toBe('');
      }
    }
  });

  it('every screenshot exists under public/', () => {
    for (const chapter of DOC_CHAPTERS) {
      for (const step of chapter.steps) {
        if (!step.image) continue;
        expect(existsSync(resolve(publicDir, `.${step.image}`)), step.image).toBe(true);
      }
    }
  });

  it('only references known permissions', () => {
    for (const chapter of DOC_CHAPTERS) {
      for (const permission of chapter.permissions) expect(knownPermissions.has(permission), permission).toBe(true);
      for (const step of chapter.steps) {
        if (step.permission) expect(knownPermissions.has(step.permission), step.permission).toBe(true);
      }
    }
  });

  it('keeps the getting-started chapter visible to everyone', () => {
    expect(DOC_CHAPTERS[0]?.permissions).toEqual([]);
  });
});
