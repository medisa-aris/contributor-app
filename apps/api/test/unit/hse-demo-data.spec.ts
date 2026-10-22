import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface HseDemo {
  users: { key: string; role: string; departmentCode: string; jobTitle: string }[];
  conversations: {
    owner: string;
    title: string;
    mode: string;
    messages: { role: string; content: string }[];
  }[];
}

const data = JSON.parse(
  readFileSync(join(__dirname, '../../src/database/seeds/data/hse-demo.json'), 'utf8'),
) as HseDemo;

describe('data demo HSE K3L', () => {
  it('memuat 7 pengguna dengan kunci unik', () => {
    expect(data.users).toHaveLength(7);
    expect(new Set(data.users.map((u) => u.key)).size).toBe(7);
  });

  it('memuat 35 percakapan, 5 per pengguna, masing-masing 20 pesan bergantian', () => {
    expect(data.conversations).toHaveLength(35);
    for (const user of data.users) {
      expect(data.conversations.filter((c) => c.owner === user.key)).toHaveLength(5);
    }
    for (const conv of data.conversations) {
      expect(conv.messages).toHaveLength(20);
      conv.messages.forEach((m, i) => {
        expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
        expect(m.content.length).toBeGreaterThan(0);
      });
      expect(['second_brain', 'counterpart']).toContain(conv.mode);
      expect(conv.title.length).toBeLessThanOrEqual(200);
    }
  });

  it('judul percakapan unik per pengguna (kunci idempotensi seed)', () => {
    const keys = data.conversations.map((c) => `${c.owner}::${c.title}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

interface HendraExtra {
  conversations: { owner: string; title: string; mode: string; messages: { role: string }[] }[];
  tasks: { owner: string; title: string; instruction: string; result: string; steps: string[] }[];
}

const extra = JSON.parse(
  readFileSync(join(__dirname, '../../src/database/seeds/data/hse-demo-hendra.json'), 'utf8'),
) as HendraExtra;

describe('data tambahan GM Safety', () => {
  it('memuat 10 percakapan Multi Brain berisi 20-30 pesan bergantian', () => {
    expect(extra.conversations).toHaveLength(10);
    for (const conv of extra.conversations) {
      expect(conv.owner).toBe('hendra');
      expect(conv.mode).toBe('second_brain');
      expect(conv.messages.length).toBeGreaterThanOrEqual(20);
      expect(conv.messages.length).toBeLessThanOrEqual(30);
      conv.messages.forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant'));
    }
  });

  it('memuat 10 tugas Subordinate dengan 20-30 jejak eksekusi (3 + 2 per langkah + 1)', () => {
    expect(extra.tasks).toHaveLength(10);
    for (const task of extra.tasks) {
      const events = 3 + task.steps.length * 2 + 1;
      expect(events).toBeGreaterThanOrEqual(20);
      expect(events).toBeLessThanOrEqual(30);
      expect(task.instruction.length).toBeGreaterThan(0);
      expect(task.result.length).toBeGreaterThan(0);
    }
  });

  it('judul unik dan tidak bentrok dengan data HSE utama', () => {
    const titles = [...extra.conversations, ...extra.tasks].map((x) => x.title);
    expect(new Set(titles).size).toBe(titles.length);
    const main = new Set(data.conversations.map((c) => c.title));
    expect(extra.conversations.some((c) => main.has(c.title))).toBe(false);
  });
});

interface BulkItem {
  user: string;
  kind: 'conversation' | 'task';
  mode: string;
  hoursAgo: number;
  title: string;
  style?: string | null;
}

const bulk = (
  JSON.parse(
    readFileSync(join(__dirname, '../../src/database/seeds/data/hse-demo-bulk.json'), 'utf8'),
  ) as { items: BulkItem[] }
).items;

describe('aktivitas contoh (200 item)', () => {
  it('berjumlah 200, 20 per akun, dan judul unik per akun', () => {
    expect(bulk).toHaveLength(200);
    const perUser = new Map<string, Set<string>>();
    for (const item of bulk) {
      const titles = perUser.get(item.user) ?? new Set<string>();
      expect(titles.has(item.title)).toBe(false);
      titles.add(item.title);
      perUser.set(item.user, titles);
    }
    expect(perUser.size).toBe(10);
    for (const titles of perUser.values()) expect(titles.size).toBe(20);
  });

  it('tersebar ke tiga mode berpikir secara seimbang (66-67 per mode)', () => {
    for (const mode of ['second_brain', 'counterpart', 'subordinate']) {
      const n = bulk.filter((i) => i.mode === mode).length;
      expect(n).toBeGreaterThanOrEqual(66);
      expect(n).toBeLessThanOrEqual(67);
    }
    expect(bulk.filter((i) => i.kind === 'task').every((i) => i.mode === 'subordinate')).toBe(true);
  });

  it('tersebar ke rentang 30, 50, dan 90 hari terakhir', () => {
    const days = bulk.map((i) => i.hoursAgo / 24);
    expect(Math.max(...days)).toBeLessThanOrEqual(90);
    expect(days.filter((d) => d <= 30).length).toBeGreaterThanOrEqual(60);
    expect(days.filter((d) => d > 30 && d <= 50).length).toBeGreaterThanOrEqual(60);
    expect(days.filter((d) => d > 50 && d <= 90).length).toBeGreaterThanOrEqual(60);
  });

  it('percakapan Partner tersebar ke empat gaya', () => {
    const styles = new Set(bulk.filter((i) => i.mode === 'counterpart').map((i) => i.style));
    expect(styles).toEqual(new Set(['supportive', 'challenger', 'analyst', 'pragmatist']));
  });
});
