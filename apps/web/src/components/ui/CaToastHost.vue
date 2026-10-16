<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast.store';

const store = useToastStore();
const { t } = useI18n();

const ICONS: Record<string, string> = {
  info: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 5.5a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm-.75 7a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-1.5 0v4.5Z',
  success:
    'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm4.03 5.97c.3.3.3.77 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06l1.97 1.97 3.97-3.97c.3-.3.77-.3 1.06 0Z',
  warning:
    'M8.56 2.75c.55-1 2-1 2.55 0l6.5 12A1.5 1.5 0 0 1 16.25 17H3.75a1.5 1.5 0 0 1-1.31-2.25l6.12-12ZM10 7a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 10 7Zm0 8a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z',
  danger:
    'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm2.53 5.47c.3.3.3.77 0 1.06L11.06 10l1.47 1.47a.75.75 0 1 1-1.06 1.06L10 11.06l-1.47 1.47a.75.75 0 0 1-1.06-1.06L8.94 10 7.47 8.53a.75.75 0 0 1 1.06-1.06L10 8.94l1.47-1.47c.3-.3.77-.3 1.06 0Z',
};
</script>

<template>
  <Teleport to="body">
    <div class="ca-toast-host" role="region" :aria-label="'Notifikasi'">
      <TransitionGroup name="ca-toast">
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          class="ca-toast"
          :class="`ca-toast--${toast.variant}`"
          role="status"
        >
          <svg class="ca-toast__icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path :d="ICONS[toast.variant]" />
          </svg>
          <div class="ca-toast__content">
            <p class="ca-toast__title">{{ toast.title }}</p>
            <p v-if="toast.message" class="ca-toast__message">{{ toast.message }}</p>
          </div>
          <button
            type="button"
            class="ca-toast__close"
            :aria-label="t('common.close')"
            @click="store.dismiss(toast.id)"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path
                d="M4.09 4.22a.5.5 0 0 1 .7-.04L10 8.97l5.2-4.79a.5.5 0 0 1 .68.74L10.72 9.7l5.17 4.76a.5.5 0 0 1-.68.74L10 10.42l-5.2 4.79a.5.5 0 0 1-.68-.74L9.28 9.7 4.1 4.94a.5.5 0 0 1-.02-.72Z"
              />
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.ca-toast-host {
  position: fixed;
  top: var(--ca-space-8);
  right: var(--ca-space-8);
  z-index: var(--ca-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  max-width: 380px;
  pointer-events: none;
}

.ca-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: var(--ca-space-6);
  padding: var(--ca-space-6) var(--ca-space-6) var(--ca-space-6) var(--ca-space-8);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-left-width: 4px;
  border-radius: var(--ca-radius-lg);
  box-shadow: var(--ca-shadow-16);
}

.ca-toast--info {
  border-left-color: var(--ca-info-stroke);
}

.ca-toast--success {
  border-left-color: var(--ca-success-stroke);
}

.ca-toast--warning {
  border-left-color: var(--ca-warning-stroke);
}

.ca-toast--danger {
  border-left-color: var(--ca-danger-stroke);
}

.ca-toast__icon {
  width: 20px;
  height: 20px;
  flex: none;
  margin-top: 1px;
}

.ca-toast--info .ca-toast__icon {
  color: var(--ca-info-fg);
}

.ca-toast--success .ca-toast__icon {
  color: var(--ca-success-fg);
}

.ca-toast--warning .ca-toast__icon {
  color: var(--ca-warning-fg);
}

.ca-toast--danger .ca-toast__icon {
  color: var(--ca-danger-fg);
}

.ca-toast__content {
  flex: 1;
}

.ca-toast__title {
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ca-toast__message {
  margin-top: var(--ca-space-1);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.ca-toast__close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--ca-radius-md);
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
}

.ca-toast__close:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.ca-toast-enter-active,
.ca-toast-leave-active {
  transition:
    opacity var(--ca-duration-normal) var(--ca-curve-easy-ease),
    transform var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
}

.ca-toast-enter-from,
.ca-toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
