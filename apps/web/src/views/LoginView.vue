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
    errorMessage.value =
      error instanceof ApiError ? error.message : t('login.errorGeneric');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="login">
    <div class="login__card">
      <div class="login__brand">
        <span class="login__logo" aria-hidden="true">C</span>
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
      <p class="login__footer">{{ t('login.footer') }}</p>
    </div>
  </main>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ca-space-8);
  background:
    radial-gradient(1200px 600px at 20% -10%, var(--ca-color-brand-subtle), transparent 60%),
    var(--ca-bg-canvas);
}

.login__card {
  width: 100%;
  max-width: 400px;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
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

.login__footer {
  margin-top: var(--ca-space-8);
  text-align: center;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-4);
}
</style>
