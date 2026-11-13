<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
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
const appVersion = __APP_VERSION__;

// Cabang ini dibuang saat build bila `__QUICK_LOGIN__` false, beserta seluruh modulnya.
const devPanel = __QUICK_LOGIN__
  ? defineAsyncComponent(() => import('@/components/auth/QuickLogin.vue'))
  : null;

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
    <section class="login__hero" :aria-label="t('login.aboutLabel', { app: config.appName })">
      <div class="login__brand">
        <span class="login__logo" aria-hidden="true">{{ config.appName.charAt(0) }}</span>
        <span class="login__app">{{ config.appName }}</span>
      </div>
      <div class="login__pitch">
        <h1 class="login__hero-title">{{ t('login.heroTitle') }}</h1>
        <p class="login__hero-lead">{{ t('login.heroLead') }}</p>
        <ul class="login__trust">
          <li v-for="key in ['trustMasking', 'trustAudit', 'trustApproval']" :key="key">
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
              <path d="m4.5 10 3.5 3.5 7.5-7.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>{{ t(`login.${key}`) }}</span>
          </li>
        </ul>
      </div>
      <span class="login__version">Fusi Solusi · v{{ appVersion }}</span>
    </section>

    <section class="login__panel">
      <div class="login__card">
        <h2 class="login__title">{{ t('login.title') }}</h2>
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
          <CaButton variant="primary" type="submit" block :loading="submitting" :disabled="!canSubmit">
            {{ submitting ? t('login.submitting') : t('login.submit') }}
          </CaButton>
        </form>
        <component :is="devPanel" v-if="devPanel" />
        <p class="login__footer">{{ t('login.footer') }}</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  flex-wrap: wrap;
  background: var(--ca-bg-canvas);
}

.login__hero {
  flex: 1 1 420px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--ca-space-16);
  padding: var(--ca-space-24);
  background: var(--ca-color-brand-strong);
  color: var(--ca-fg-on-brand-strong);
}

.login__brand {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
}

.login__logo {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-xl);
  background: var(--ca-fg-on-brand-strong);
  color: var(--ca-color-brand-strong);
  font-weight: var(--ca-font-weight-semibold);
  font-size: var(--ca-text-500);
}

.login__app {
  font-size: var(--ca-text-500);
  line-height: var(--ca-line-500);
  font-weight: var(--ca-font-weight-semibold);
}

.login__pitch {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-12);
  max-width: 480px;
}

.login__hero-title {
  font-size: var(--ca-text-900);
  line-height: var(--ca-line-900);
  font-weight: var(--ca-font-weight-semibold);
}

.login__hero-lead {
  font-size: var(--ca-text-450);
  line-height: var(--ca-line-450);
}

.login__trust {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.login__trust li {
  display: flex;
  align-items: flex-start;
  gap: var(--ca-space-6);
}

.login__trust svg {
  flex: none;
  color: var(--ca-brand-50);
}

.login__version {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.login__panel {
  flex: 1 1 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ca-space-24) var(--ca-space-12);
}

.login__card {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-10);
  padding: var(--ca-space-16);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  box-shadow: var(--ca-shadow-16);
}

.login__title {
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
}

.login__subtitle {
  margin-top: calc(var(--ca-space-8) * -1);
  color: var(--ca-fg-3);
}

.login__error {
  padding: var(--ca-space-4) var(--ca-space-6);
  border-radius: var(--ca-radius-md);
  background: var(--ca-danger-bg);
  border: 1px solid var(--ca-danger-stroke);
  color: var(--ca-danger-fg);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-10);
}

.login__password {
  position: relative;
}

.login__password :deep(.ca-input) {
  padding-right: 40px;
}

.login__password-toggle {
  position: absolute;
  top: 4px;
  right: 4px;
}

.login__footer {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

@media (max-width: 900px) {
  .login__hero {
    padding: var(--ca-space-16) var(--ca-space-8);
  }

  .login__hero-title {
    font-size: var(--ca-text-700);
    line-height: var(--ca-line-700);
  }

  .login__panel {
    padding: var(--ca-space-16) var(--ca-space-8);
  }

  .login__card {
    padding: var(--ca-space-12);
  }
}
</style>
