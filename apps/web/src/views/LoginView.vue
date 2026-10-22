<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth.store';
import { useConfigStore } from '@/stores/config.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { CaButton, CaField, CaIcon, CaIconButton, CaInput } from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const config = useConfigStore();
const navigation = useNavigationStore();

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const submitting = ref(false);
const errorMessage = ref('');

const canSubmit = computed(
  () => email.value.trim().length > 0 && password.value.length > 0 && !submitting.value,
);

onMounted(() => {
  void config.load();
});

// Akun demo (sesuai seed) — hanya untuk kemudahan login pada aplikasi demo.
interface DemoAccount {
  email: string;
  password: string;
  label: string;
  hint?: string;
}

const HSE_PASSWORD = 'HseDemo123!';

const demoGroups = computed<{ title: string; accounts: DemoAccount[] }[]>(() => [
  {
    title: t('login.demoGroupSystem'),
    accounts: [
      { email: 'admin@bara.local', password: 'Kontrib-d98a5d6d!', label: t('login.demoAdmin') },
      { email: 'manajer@bara.local', password: 'ManajerDemo123!', label: t('login.demoManager') },
      { email: 'staf@bara.local', password: 'StafDemo123!', label: t('login.demoStaff') },
    ],
  },
  {
    title: t('login.demoGroupHse'),
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
]);

const demoOpen = ref(false);

async function loginAsDemo(account: DemoAccount): Promise<void> {
  if (submitting.value) return;
  email.value = account.email;
  password.value = account.password;
  await submit();
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await auth.login(email.value.trim().toLowerCase(), password.value);
    navigation.reset();
    await navigation.load(true);
    const redirect = route.query.redirect;
    await router.push(typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/');
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : t('login.errorGeneric');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="login">
    <div class="login__panel">
      <div class="login__card">
        <div class="login__brand">
          <span class="login__logo" aria-hidden="true">B</span>
          <span class="login__app">{{ config.appName }}</span>
        </div>
        <h1 class="login__title">{{ t('login.title') }}</h1>
        <p class="login__subtitle">{{ t('login.subtitle') }}</p>

        <p v-if="errorMessage" class="login__error" role="alert">{{ errorMessage }}</p>

        <form class="login__form" @submit.prevent="submit">
          <CaField :label="t('login.email')" required>
            <template #default="{ id, describedBy }">
              <CaInput
                :id="id"
                v-model="email"
                :aria-describedby="describedBy"
                type="email"
                size="large"
                autocomplete="username"
                placeholder="nama@perusahaan.co.id"
              />
            </template>
          </CaField>
          <CaField :label="t('login.password')" required>
            <template #default="{ id, describedBy }">
              <div class="login__password">
                <CaInput
                  :id="id"
                  v-model="password"
                  :aria-describedby="describedBy"
                  :type="showPassword ? 'text' : 'password'"
                  size="large"
                  autocomplete="current-password"
                  :placeholder="t('login.passwordPlaceholder')"
                />
                <CaIconButton
                  class="login__password-toggle"
                  :label="showPassword ? t('login.hidePassword') : t('login.showPassword')"
                  :aria-pressed="showPassword"
                  size="small"
                  @click="showPassword = !showPassword"
                >
                  <CaIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
                </CaIconButton>
              </div>
            </template>
          </CaField>
          <CaButton
            variant="primary"
            size="large"
            type="submit"
            block
            :loading="submitting"
            :disabled="!canSubmit"
          >
            {{ submitting ? t('login.submitting') : t('login.submit') }}
          </CaButton>
        </form>
        <div class="login__demo">
          <button
            type="button"
            class="login__demo-toggle"
            :aria-expanded="demoOpen"
            aria-controls="login-demo-list"
            @click="demoOpen = !demoOpen"
          >
            <span>{{ t('login.demoTitle') }}</span>
            <CaIcon :name="demoOpen ? 'chevron-up' : 'chevron-down'" :size="16" />
          </button>
          <div v-show="demoOpen" id="login-demo-list" class="login__demo-list">
            <section v-for="group in demoGroups" :key="group.title" class="login__demo-group">
              <h2 class="login__demo-group-title">{{ group.title }}</h2>
              <CaButton
                v-for="account in group.accounts"
                :key="account.email"
                variant="secondary"
                block
                type="button"
                :disabled="submitting"
                @click="loginAsDemo(account)"
              >
                <span class="login__demo-account">
                  <span>{{ account.label }}</span>
                  <span v-if="account.hint" class="login__demo-hint">{{ account.hint }}</span>
                </span>
              </CaButton>
            </section>
          </div>
        </div>
        <p class="login__footer">{{ t('login.footer') }}</p>
      </div>
    </div>
    <aside class="login__hero">
      <img
        class="login__hero-image"
        src="/login-hero.webp"
        :alt="t('login.heroAlt')"
        width="1414"
        height="2000"
        decoding="async"
      />
    </aside>
  </main>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  background:
    radial-gradient(1200px 600px at 20% -10%, var(--ca-color-brand-subtle), transparent 60%),
    var(--ca-bg-canvas);
}

/* Formulir login berada di tengah area kosong di sisi kiri poster. */
.login__panel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: var(--ca-space-8);
}

.login__hero {
  width: min(50vw, calc(100vh * 0.707));
  height: 100vh;
  position: sticky;
  top: 0;
  background: #f7f6f2;
  border-left: 1px solid var(--ca-stroke-2);
}

.login__hero-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.login__card {
  width: 100%;
  max-width: 400px;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-top: 4px solid var(--ca-brand-60);
  border-radius: var(--ca-radius-xl);
  box-shadow: var(--ca-shadow-8);
  padding: var(--ca-space-12) var(--ca-space-10);
}

.login__brand {
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  margin-bottom: var(--ca-space-8);
}

.login__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--ca-radius-lg);
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
  font-weight: var(--ca-font-weight-bold);
  font-size: var(--ca-text-400);
}

.login__app {
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
}

.login__title {
  font-size: var(--ca-text-600);
  line-height: var(--ca-line-600);
  font-weight: var(--ca-font-weight-semibold);
}

.login__subtitle {
  margin-top: var(--ca-space-1);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
}

.login__error {
  margin-top: var(--ca-space-6);
  padding: var(--ca-space-4) var(--ca-space-6);
  border-radius: var(--ca-radius-md);
  background: var(--ca-danger-bg);
  border: 1px solid var(--ca-danger-stroke);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.login__form {
  margin-top: var(--ca-space-8);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
}

.login__password {
  position: relative;
}

.login__password :deep(.ca-input) {
  padding-right: 40px;
}

.login__password-toggle {
  position: absolute;
  top: 8px;
  right: 8px;
}

.login__demo {
  margin-top: var(--ca-space-8);
  padding-top: var(--ca-space-4);
  border-top: 1px solid var(--ca-stroke-2);
}

.login__demo-toggle {
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

.login__demo-toggle:focus-visible {
  outline: 2px solid var(--ca-color-brand);
  outline-offset: 2px;
  border-radius: var(--ca-radius-md);
}

.login__demo-list {
  margin-top: var(--ca-space-3);
  max-height: 240px;
  overflow-y: auto;
  padding-right: var(--ca-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.login__demo-group {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.login__demo-group-title {
  font-size: var(--ca-text-100);
  font-weight: var(--ca-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ca-fg-4);
}

.login__demo-account {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.25;
}

.login__demo-hint {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.login__footer {
  margin-top: var(--ca-space-8);
  text-align: center;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-4);
}

@media (max-width: 960px) {
  .login {
    grid-template-columns: minmax(0, 1fr);
  }

  .login__hero {
    display: none;
  }
}
</style>
