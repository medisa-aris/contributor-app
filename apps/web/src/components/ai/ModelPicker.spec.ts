import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ModelPicker from './ModelPicker.vue';

const myModels = vi.hoisted(() => vi.fn());
vi.mock('@/api/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/models')>()),
  myModels,
  setPreferredModel: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'id',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    id: {
      models: {
        picker: {
          label: 'Model',
          default: 'Bawaan · tanpa batas',
          remaining: 'Sisa {tokens} token {period}',
          periodDay: 'hari ini',
          periodWeek: 'minggu ini',
          exhausted: 'Kuota habis · reset {when}',
          noTools: 'Tidak mendukung dokumen & konektor',
          noVision: 'Tidak mendukung gambar',
          makePreferred: 'Jadikan pilihan bawaan saya',
          costTier: { 1: 'Hemat', 2: 'Standar', 3: 'Premium' },
        },
      },
    },
  },
});

function model(partial: Record<string, unknown>) {
  return {
    id: 'm',
    provider: 'openrouter',
    displayName: 'Model',
    description: null,
    costTier: null,
    supportsTools: true,
    supportsVision: true,
    isDefault: false,
    unlimited: false,
    quotas: [],
    requestsPerMinute: null,
    exhausted: false,
    ...partial,
  };
}

async function mountPicker(models: unknown[], props: Record<string, unknown> = {}) {
  myModels.mockResolvedValue({ models, preferredModelId: null });
  const wrapper = mount(ModelPicker, { props, global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
}

describe('ModelPicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    myModels.mockReset();
  });

  it('tersembunyi bila hanya ada model bawaan', async () => {
    const wrapper = await mountPicker([model({ id: 'd', isDefault: true, unlimited: true })]);
    expect(wrapper.find('select').exists()).toBe(false);
  });

  it('model bawaan dipilih awal dan bertanda tanpa batas', async () => {
    const wrapper = await mountPicker([
      model({ id: 'd', displayName: 'Bawaan', isDefault: true, unlimited: true }),
      model({ id: 's', displayName: 'Sonnet', quotas: [{ period: 'day', limit: 1000, used: 400, remaining: 600, resetsAt: '', sourceGrantId: 'g', sourceLabel: '' }] }),
    ]);
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('d');
    expect(wrapper.text()).toContain('Bawaan · tanpa batas');
  });

  it('menonaktifkan model tanpa tools, model habis kuota, dan model tanpa gambar saat ada gambar', async () => {
    const wrapper = await mountPicker(
      [
        model({ id: 'd', isDefault: true, unlimited: true }),
        model({ id: 'nt', displayName: 'Tanpa tools', supportsTools: false }),
        model({ id: 'ex', displayName: 'Habis', exhausted: true, quotas: [{ period: 'day', limit: 10, used: 10, remaining: 0, resetsAt: new Date().toISOString(), sourceGrantId: 'g', sourceLabel: '' }] }),
        model({ id: 'nv', displayName: 'Tanpa gambar', supportsVision: false }),
      ],
      { needsTools: true, hasImages: true },
    );
    const options = wrapper.findAll('option');
    const disabled = Object.fromEntries(options.map((o) => [o.attributes('value'), (o.element as HTMLOptionElement).disabled]));
    expect(disabled).toEqual({ d: false, nt: true, ex: true, nv: true });
  });

  it('memancarkan pilihan pengguna', async () => {
    const wrapper = await mountPicker([model({ id: 'd', isDefault: true }), model({ id: 's' })]);
    await wrapper.find('select').setValue('s');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['s']);
  });
});
