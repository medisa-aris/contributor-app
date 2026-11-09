<script setup lang="ts">
// Hanya untuk DEV. LoginView memuat berkas ini lewat `__QUICK_LOGIN__`, jadi build PROD tidak
// membawanya. Teks sengaja tidak di id.ts, karena kamus itu selalu ikut ke browser.
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/http';
import { CaButton, CaIcon } from '@/components/ui';
import { useAuthStore } from '@/stores/auth.store';
import { useConfigStore } from '@/stores/config.store';
import { useNavigationStore } from '@/stores/navigation.store';

interface DemoAccount {
  email: string;
  password: string;
  label: string;
  hint?: string;
}

const HSE_PASSWORD = 'HseDemo123!';

const groups: { title: string; accounts: DemoAccount[] }[] = [
  {
    title: 'Akun sistem',
    accounts: [
      { email: 'admin@bara.local', password: 'Kontrib-d98a5d6d!', label: 'Masuk sebagai Admin' },
      { email: 'manajer@bara.local', password: 'ManajerDemo123!', label: 'Masuk sebagai Manajer' },
      { email: 'staf@bara.local', password: 'StafDemo123!', label: 'Masuk sebagai Staf' },
    ],
  },
  {
    title: 'Tim HSE K3L',
    accounts: [
      { email: 'hendra@bara.local', label: 'Hendra Wijaksana', hint: 'GM Safety' },
      { email: 'ratna@bara.local', label: 'Ratna Kusumawardani', hint: 'Manager HIRA' },
      { email: 'bambang@bara.local', label: 'Bambang Sutrisno', hint: 'Manager Safety' },
      { email: 'dimas@bara.local', label: 'Dimas Aryo Pratama', hint: 'Supt HIRA Operasional' },
      { email: 'siti@bara.local', label: 'Siti Nurhaliza Putri', hint: 'Supt Risk Control & MOC' },
      {
        email: 'fajar@bara.local',
        label: 'Fajar Nugroho',
        hint: 'Supt Safety Operasional & Inspeksi',
      },
      {
        email: 'maria@bara.local',
        label: 'Maria Magdalena Sinaga',
        hint: 'Supt Safety Compliance & Audit',
      },
    ].map((account) => ({ ...account, password: HSE_PASSWORD })),
  },
];

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const config = useConfigStore();
const navigation = useNavigationStore();

const open = ref(false);
const submitting = ref(false);
const errorMessage = ref('');

// Build DEV yang tersambung ke API PROD tetap tertutup.
const available = computed(() => config.environment === 'DEV');

async function login(account: DemoAccount): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await auth.login(account.email, account.password);
    navigation.reset();
    await navigation.load(true);
    const redirect = route.query.redirect;
    await router.push(typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/');
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : 'Gagal masuk.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="available" class="quick-login">
    <button
      type="button"
      class="quick-login__toggle"
      :aria-expanded="open"
      aria-controls="quick-login-list"
      @click="open = !open"
    >
      <span>Masuk cepat (demo)</span>
      <CaIcon :name="open ? 'chevron-up' : 'chevron-down'" :size="16" />
    </button>
    <p v-if="errorMessage" class="quick-login__error" role="alert">{{ errorMessage }}</p>
    <div v-show="open" id="quick-login-list" class="quick-login__list">
      <section v-for="group in groups" :key="group.title" class="quick-login__group">
        <h2 class="quick-login__group-title">{{ group.title }}</h2>
        <CaButton
          v-for="account in group.accounts"
          :key="account.email"
          variant="secondary"
          block
          type="button"
          :disabled="submitting"
          @click="login(account)"
        >
          <span class="quick-login__account">
            <span>{{ account.label }}</span>
            <span v-if="account.hint" class="quick-login__hint">{{ account.hint }}</span>
          </span>
        </CaButton>
      </section>
    </div>
  </div>
</template>

<style scoped>
.quick-login {
  margin-top: var(--ca-space-8);
  padding-top: var(--ca-space-4);
  border-top: 1px solid var(--ca-stroke-2);
}

.quick-login__toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ca-space-3) 0;
  background: none;
  border: 0;
  cursor: pointer;
  font: inherit;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.quick-login__toggle:focus-visible {
  outline: 2px solid var(--ca-color-brand);
  outline-offset: 2px;
  border-radius: var(--ca-radius-md);
}

.quick-login__error {
  margin: var(--ca-space-2) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-danger-fg);
}

.quick-login__list {
  margin-top: var(--ca-space-3);
  max-height: 240px;
  overflow-y: auto;
  padding-right: var(--ca-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.quick-login__group {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.quick-login__group-title {
  font-size: var(--ca-text-100);
  font-weight: var(--ca-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ca-fg-4);
}

.quick-login__account {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.25;
}

.quick-login__hint {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}
</style>
