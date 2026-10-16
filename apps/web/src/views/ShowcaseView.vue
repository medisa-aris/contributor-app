<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CaAvatar,
  CaBadge,
  CaBreadcrumb,
  CaButton,
  CaCard,
  CaCheckbox,
  CaDialog,
  CaEmptyState,
  CaField,
  CaIconButton,
  CaInput,
  CaMenu,
  CaPagination,
  CaRadioGroup,
  CaSelect,
  CaSkeleton,
  CaSpinner,
  CaSwitch,
  CaTable,
  CaTabs,
} from '@/components/ui';
import { useThemeStore, type ThemeMode } from '@/stores/theme.store';
import { useToastStore, type ToastVariant } from '@/stores/toast.store';

const { t } = useI18n();
const theme = useThemeStore();
const toasts = useToastStore();

const BRAND_RAMP = [
  '--ca-brand-10',
  '--ca-brand-20',
  '--ca-brand-30',
  '--ca-brand-40',
  '--ca-brand-50',
  '--ca-brand-60',
  '--ca-brand-70',
  '--ca-brand-80',
  '--ca-brand-90',
  '--ca-brand-100',
  '--ca-brand-110',
  '--ca-brand-120',
  '--ca-brand-130',
  '--ca-brand-140',
];

const NEUTRAL_SWATCHES = [
  { token: '--ca-bg-surface', label: 'Permukaan' },
  { token: '--ca-bg-canvas', label: 'Kanvas' },
  { token: '--ca-bg-surface-3', label: 'Permukaan 3' },
  { token: '--ca-stroke-1', label: 'Garis 1' },
  { token: '--ca-fg-3', label: 'Teks 3' },
  { token: '--ca-fg-1', label: 'Teks 1' },
];

const STATUS_SWATCHES = [
  { token: '--ca-danger-fg', label: 'Bahaya' },
  { token: '--ca-warning-fg', label: 'Peringatan' },
  { token: '--ca-success-fg', label: 'Sukses' },
  { token: '--ca-info-fg', label: 'Info' },
];

const TYPE_RAMP = [
  { name: 'Caption', size: '12/16', style: 'font-size: var(--ca-text-200); line-height: var(--ca-line-200)' },
  { name: 'Body', size: '14/20', style: 'font-size: var(--ca-text-300); line-height: var(--ca-line-300)' },
  { name: 'Subtitle 2', size: '16/22', style: 'font-size: var(--ca-text-400); line-height: var(--ca-line-400)' },
  { name: 'Subtitle 1', size: '20/26', style: 'font-size: var(--ca-text-500); line-height: var(--ca-line-500); font-weight: 600' },
  { name: 'Title 3', size: '24/32', style: 'font-size: var(--ca-text-600); line-height: var(--ca-line-600); font-weight: 600' },
  { name: 'Large Title', size: '40/52', style: 'font-size: var(--ca-text-900); line-height: var(--ca-line-900); font-weight: 600' },
];

const themeOptions = computed(() => [
  { value: 'light' satisfies ThemeMode, label: t('theme.light') },
  { value: 'dark' satisfies ThemeMode, label: t('theme.dark') },
  { value: 'system' satisfies ThemeMode, label: t('theme.system') },
]);

const selectOptions = [
  { value: 'global', label: 'Global - seluruh organisasi' },
  { value: 'department', label: 'Departemen - unit kerja' },
  { value: 'own', label: 'Sendiri - data pribadi' },
];

const inputValue = ref('');
const inputError = ref('');
const selectValue = ref('');
const checkboxValue = ref(true);
const switchValue = ref(false);
const radioValue = ref('global');
const dialogOpen = ref(false);
const activeTab = ref('ringkasan');
const page = ref(3);

const TOAST_DEMO: { variant: ToastVariant; title: string; message: string }[] = [
  { variant: 'info', title: 'Informasi', message: 'Sinkronisasi katalog permission sedang berjalan.' },
  { variant: 'success', title: 'Berhasil disimpan', message: 'Peran "Manajer" diperbarui.' },
  { variant: 'warning', title: 'Perhatian', message: 'Sesi Anda berakhir dalam 5 menit.' },
  { variant: 'danger', title: 'Akses ditolak', message: 'Anda tidak memiliki permission rbac.roles.manage.' },
];

function pushToast(demo: (typeof TOAST_DEMO)[number]): void {
  toasts.push(demo);
}

const menuItems = [
  { key: 'edit', label: 'Ubah pengguna' },
  { key: 'reset', label: 'Reset kata sandi' },
  { key: 'disable', label: 'Nonaktifkan', danger: true, divider: true },
];

function onMenuSelect(key: string): void {
  toasts.push({ variant: 'info', title: 'Menu dipilih', message: `Aksi: ${key}` });
}

const columns = [
  { key: 'name', label: 'Nama', width: '260px' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Peran', width: '180px' },
  { key: 'status', label: 'Status', width: '140px', align: 'center' as const },
];

const people = ref([
  { id: '1', name: 'Ayu Lestari', email: 'ayu.lestari@contoh.co.id', role: 'Administrator', status: 'active' },
  { id: '2', name: 'Budi Santoso', email: 'budi.santoso@contoh.co.id', role: 'Manajer', status: 'active' },
  { id: '3', name: 'Citra Dewi', email: 'citra.dewi@contoh.co.id', role: 'Staf', status: 'active' },
  { id: '4', name: 'Dedi Kurniawan', email: 'dedi.kurniawan@contoh.co.id', role: 'Manajer', status: 'disabled' },
]);

const tableLoading = ref(false);

function validateInput(): void {
  inputError.value = inputValue.value.trim().length < 3 ? 'Minimal 3 karakter untuk pencarian.' : '';
}

function submitDialog(): void {
  dialogOpen.value = false;
  toasts.push({ variant: 'success', title: 'Dialog dikonfirmasi', message: 'Aksi contoh berhasil dijalankan.' });
}
</script>

<template>
  <div class="showcase">
    <header class="showcase__hero">
      <div class="showcase__hero-content">
        <CaBreadcrumb :items="[{ label: 'Contributor AI' }, { label: t('showcase.title') }]" />
        <h1 class="showcase__title">{{ t('showcase.title') }}</h1>
        <p class="showcase__subtitle">{{ t('showcase.subtitle') }}</p>
      </div>
      <div class="showcase__hero-actions">
        <CaRadioGroup v-model="theme.mode" :options="themeOptions" />
      </div>
    </header>

    <div class="showcase__grid">
      <CaCard :title="t('showcase.sections.colors')" subtitle="Token warna Fluent 2 - brand, netral, dan status.">
        <p class="showcase__label">Brand ramp (10-140)</p>
        <div class="showcase__swatches">
          <span
            v-for="token in BRAND_RAMP"
            :key="token"
            class="showcase__swatch"
            :style="{ background: `var(${token})` }"
            :title="token"
          />
        </div>
        <p class="showcase__label">Surface &amp; teks</p>
        <div class="showcase__swatches">
          <span
            v-for="swatch in NEUTRAL_SWATCHES"
            :key="swatch.token"
            class="showcase__swatch showcase__swatch--outlined"
            :style="{ background: `var(${swatch.token})` }"
            :title="`${swatch.label} (${swatch.token})`"
          />
        </div>
        <p class="showcase__label">Status</p>
        <div class="showcase__swatches">
          <span
            v-for="swatch in STATUS_SWATCHES"
            :key="swatch.token"
            class="showcase__swatch"
            :style="{ background: `var(${swatch.token})` }"
            :title="`${swatch.label} (${swatch.token})`"
          />
        </div>
      </CaCard>

      <CaCard :title="t('showcase.sections.typography')" subtitle="Skala tipografi dari caption hingga large title.">
        <ul class="showcase__type-ramp">
          <li v-for="item in TYPE_RAMP" :key="item.name" class="showcase__type-row">
            <span class="showcase__type-meta">{{ item.name }}<br /><code>{{ item.size }}</code></span>
            <span :style="item.style">Menjadi kontributor yang diperkuat AI</span>
          </li>
        </ul>
      </CaCard>

      <CaCard :title="t('showcase.sections.buttons')" subtitle="Semua varian, ukuran, dan keadaan tombol.">
        <p class="showcase__label">Varian</p>
        <div class="showcase__row">
          <CaButton variant="primary">Simpan</CaButton>
          <CaButton variant="secondary">Batal</CaButton>
          <CaButton variant="outline">Ekspor</CaButton>
          <CaButton variant="subtle">Detail</CaButton>
          <CaButton variant="transparent">Pelajari lebih lanjut</CaButton>
          <CaButton variant="danger">Hapus</CaButton>
        </div>
        <p class="showcase__label">Ukuran</p>
        <div class="showcase__row showcase__row--center">
          <CaButton variant="primary" size="small">Kecil</CaButton>
          <CaButton variant="primary" size="medium">Sedang</CaButton>
          <CaButton variant="primary" size="large">Besar</CaButton>
        </div>
        <p class="showcase__label">Keadaan</p>
        <div class="showcase__row">
          <CaButton variant="primary" loading>Memproses</CaButton>
          <CaButton variant="secondary" disabled>Nonaktif</CaButton>
          <CaButton variant="primary">
            <template #icon-start>
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path d="M10 3a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-5.5v5.5a.75.75 0 0 1-1.5 0v-5.5h-5.5a.75.75 0 0 1 0-1.5h5.5v-5.5A.75.75 0 0 1 10 3Z" />
              </svg>
            </template>
            Tambah pengguna
          </CaButton>
          <CaButton variant="secondary">
            Menu
            <template #icon-end>
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path d="M15.85 7.65c.2.2.2.5 0 .7l-5.5 5.5a.5.5 0 0 1-.7 0l-5.5-5.5a.5.5 0 0 1 .7-.7L10 12.79l5.15-5.14c.2-.2.5-.2.7 0Z" />
              </svg>
            </template>
          </CaButton>
          <CaIconButton label="Pengaturan">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M8.7 2.5h2.6l.4 1.9c.5.2 1 .4 1.4.8l1.8-.7 1.3 2.2-1.4 1.3c.1.3.1.7.1 1s0 .7-.1 1l1.4 1.3-1.3 2.2-1.8-.7c-.4.3-.9.6-1.4.8l-.4 1.9H8.7l-.4-1.9c-.5-.2-1-.4-1.4-.8l-1.8.7-1.3-2.2L5.2 11a5 5 0 0 1-.1-1c0-.3 0-.7.1-1L3.8 7.7l1.3-2.2 1.8.7c.4-.3.9-.6 1.4-.8l.4-1.9ZM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
            </svg>
          </CaIconButton>
        </div>
      </CaCard>

      <CaCard :title="t('showcase.sections.forms')" subtitle="Kontrol formulir dengan label, petunjuk, dan validasi.">
        <div class="showcase__form-grid">
          <CaField label="Kata kunci" hint="Cari berdasarkan nama atau email.">
            <template #default="{ id, describedBy }">
              <CaInput
                :id="id"
                v-model="inputValue"
                :aria-describedby="describedBy"
                placeholder="cth. ayu"
                @blur="validateInput"
              />
            </template>
          </CaField>
          <CaField label="Email" :error="inputError ? '' : undefined">
            <template #default="{ id, describedBy }">
              <CaInput
                :id="id"
                v-model="inputValue"
                :aria-describedby="describedBy"
                :invalid="!!inputError"
                type="email"
                placeholder="nama@perusahaan.co.id"
              />
            </template>
          </CaField>
          <CaField label="Cakupan data" required>
            <template #default="{ describedBy }">
              <CaSelect
                v-model="selectValue"
                placeholder="Pilih cakupan..."
                :options="selectOptions"
                :described-by="describedBy"
              />
            </template>
          </CaField>
          <CaField label="Status" :error="inputError">
            <template #default="{ id, describedBy }">
              <CaInput
                :id="id"
                v-model="inputValue"
                :aria-describedby="describedBy"
                :invalid="!!inputError"
                placeholder="contoh keadaan galat"
              />
            </template>
          </CaField>
        </div>
        <div class="showcase__row showcase__row--spaced">
          <CaCheckbox v-model="checkboxValue">Kirim notifikasi email</CaCheckbox>
          <CaSwitch v-model="switchValue" label="Aktifkan audit ketat" />
        </div>
        <p class="showcase__label">Cakupan data</p>
        <CaRadioGroup v-model="radioValue" :options="selectOptions" />
      </CaCard>

      <CaCard :title="t('showcase.sections.feedback')" subtitle="Badge, spinner, skeleton, dan notifikasi toast.">
        <p class="showcase__label">Badge</p>
        <div class="showcase__row">
          <CaBadge variant="brand">Administrator</CaBadge>
          <CaBadge variant="informative">Manajer</CaBadge>
          <CaBadge variant="neutral">Staf</CaBadge>
          <CaBadge variant="success">Aktif</CaBadge>
          <CaBadge variant="warning">Menunggu</CaBadge>
          <CaBadge variant="danger">Nonaktif</CaBadge>
          <CaBadge variant="danger" strong>Terlarang</CaBadge>
        </div>
        <p class="showcase__label">Spinner</p>
        <div class="showcase__row showcase__row--center">
          <CaSpinner size="tiny" />
          <CaSpinner size="small" />
          <CaSpinner size="medium" label="Memuat data" />
        </div>
        <p class="showcase__label">Skeleton</p>
        <CaSkeleton :lines="3" />
        <p class="showcase__label">Toast</p>
        <div class="showcase__row">
          <CaButton
            v-for="demo in TOAST_DEMO"
            :key="demo.variant"
            :variant="demo.variant === 'danger' ? 'danger' : 'secondary'"
            size="small"
            @click="pushToast(demo)"
          >
            {{ demo.title }}
          </CaButton>
        </div>
      </CaCard>

      <CaCard :title="t('showcase.sections.data')" subtitle="Tabel, tab, dan paginasi daftar.">
        <CaTabs
          v-model="activeTab"
          :items="[
            { key: 'ringkasan', label: 'Ringkasan' },
            { key: 'anggota', label: 'Anggota', count: people.length },
            { key: 'riwayat', label: 'Riwayat' },
          ]"
        />
        <div class="showcase__tab-body">
          <template v-if="activeTab === 'anggota' || activeTab === 'ringkasan'">
            <CaTable :columns="columns" :rows="people" :row-key="(row) => row.id" :loading="tableLoading">
              <template #cell-name="{ row }">
                <span class="showcase__cell-user">
                  <CaAvatar :name="row.name" size="small" />
                  {{ row.name }}
                </span>
              </template>
              <template #cell-status="{ row }">
                <CaBadge :variant="row.status === 'active' ? 'success' : 'danger'">
                  {{ row.status === 'active' ? 'Aktif' : 'Nonaktif' }}
                </CaBadge>
              </template>
            </CaTable>
            <div class="showcase__pagination">
              <CaPagination :page="page" :limit="10" :total="57" @change="page = $event" />
            </div>
          </template>
          <CaEmptyState
            v-else
            title="Belum ada riwayat"
            description="Riwayat perubahan akan tampil di sini setelah ada aktivitas."
          >
            <template #action>
              <CaButton variant="secondary">Muat ulang</CaButton>
            </template>
          </CaEmptyState>
        </div>
      </CaCard>

      <CaCard :title="t('showcase.sections.overlays')" subtitle="Dialog modal dan menu tindakan.">
        <div class="showcase__row">
          <CaButton variant="primary" @click="dialogOpen = true">Buka dialog</CaButton>
          <CaMenu :items="menuItems" align="start" @select="onMenuSelect">
            <template #trigger>
              <CaButton variant="secondary" aria-haspopup="menu">Aksi</CaButton>
            </template>
          </CaMenu>
          <CaButton variant="outline" size="small" @click="tableLoading = !tableLoading">
            {{ tableLoading ? 'Matikan' : 'Nyalakan' }} status memuat
          </CaButton>
        </div>
        <CaDialog
          v-model:open="dialogOpen"
          title="Nonaktifkan pengguna?"
          subtitle="Pengguna tidak akan bisa masuk sampai diaktifkan kembali."
          size="small"
        >
          <p>
            Tindakan ini mencabut seluruh sesi aktif <strong>Budi Santoso</strong> dan mencatatnya di log audit.
          </p>
          <template #footer>
            <CaButton variant="secondary" @click="dialogOpen = false">Batal</CaButton>
            <CaButton variant="danger" @click="submitDialog">Ya, nonaktifkan</CaButton>
          </template>
        </CaDialog>
      </CaCard>
    </div>
  </div>

</template>

<style scoped>
.showcase {
  max-width: var(--ca-content-max-width);
  margin: 0 auto;
  padding: var(--ca-space-8) var(--ca-space-8) var(--ca-space-24);
}

.showcase__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-8);
  flex-wrap: wrap;
  padding: var(--ca-space-8) 0 var(--ca-space-12);
}

.showcase__title {
  margin-top: var(--ca-space-4);
  font-size: var(--ca-text-800);
  line-height: var(--ca-line-800);
  font-weight: var(--ca-font-weight-semibold);
  letter-spacing: -0.02em;
}

.showcase__subtitle {
  margin-top: var(--ca-space-2);
  font-size: var(--ca-text-400);
  line-height: var(--ca-line-400);
  color: var(--ca-fg-3);
  max-width: 640px;
}

.showcase__hero-actions {
  padding: var(--ca-space-6) var(--ca-space-8);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
}

.showcase__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: var(--ca-space-8);
  align-items: start;
}

.showcase__label {
  margin: var(--ca-space-6) 0 var(--ca-space-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.showcase__label:first-child {
  margin-top: 0;
}

.showcase__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
}

.showcase__swatch {
  width: 44px;
  height: 44px;
  border-radius: var(--ca-radius-md);
}

.showcase__swatch--outlined {
  border: 1px solid var(--ca-stroke-2);
}

.showcase__type-ramp {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.showcase__type-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--ca-space-4);
  align-items: baseline;
}

.showcase__type-meta {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.showcase__type-meta code {
  font-family: var(--ca-font-family-mono);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-4);
}

.showcase__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-4);
  align-items: center;
}

.showcase__row--center {
  align-items: center;
}

.showcase__row--spaced {
  justify-content: space-between;
  margin-top: var(--ca-space-8);
}

.showcase__form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--ca-space-8);
}

.showcase__tab-body {
  padding-top: var(--ca-space-4);
}

.showcase__cell-user {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-4);
  font-weight: var(--ca-font-weight-medium);
}

.showcase__pagination {
  margin-top: var(--ca-space-4);
}

@media (max-width: 640px) {
  .showcase__form-grid {
    grid-template-columns: 1fr;
  }

  .showcase__grid {
    grid-template-columns: 1fr;
  }
}
</style>
