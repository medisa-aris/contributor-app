<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import CaIconButton from './CaIconButton.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    size?: 'small' | 'medium' | 'large';
    persistent?: boolean;
  }>(),
  { size: 'medium' },
);

const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();

const surface = ref<HTMLElement | null>(null);
const titleId = useId();
let previouslyFocused: Element | null = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !props.persistent) {
    event.stopPropagation();
    open.value = false;
    return;
  }
  if (event.key !== 'Tab' || !surface.value) return;
  const focusable = Array.from(surface.value.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0] as HTMLElement;
  const last = focusable[focusable.length - 1] as HTMLElement;
  const activeElement = document.activeElement;
  if (event.shiftKey && (activeElement === first || activeElement === surface.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(open, async (isOpen) => {
  if (typeof document === 'undefined') return;
  if (isOpen) {
    previouslyFocused = document.activeElement;
    document.documentElement.style.overflow = 'hidden';
    await nextTick();
    surface.value?.focus();
  } else {
    document.documentElement.style.overflow = '';
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    previouslyFocused = null;
  }
});

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.documentElement.style.overflow = '';
});

function onOverlayClick(): void {
  if (!props.persistent) open.value = false;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ca-dialog">
      <div v-if="open" class="ca-dialog" @keydown="onKeydown">
        <div class="ca-dialog__overlay" @click="onOverlayClick" />
        <div
          ref="surface"
          class="ca-dialog__surface"
          :class="`ca-dialog__surface--${size}`"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
        >
          <header class="ca-dialog__header">
            <div class="ca-dialog__heading">
              <h2 :id="titleId" class="ca-dialog__title">{{ title }}</h2>
              <p v-if="subtitle" class="ca-dialog__subtitle">{{ subtitle }}</p>
            </div>
            <CaIconButton :label="t('common.close')" @click="open = false">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path
                  d="M4.09 4.22a.5.5 0 0 1 .7-.04L10 8.97l5.2-4.79a.5.5 0 0 1 .68.74L10.72 9.7l5.17 4.76a.5.5 0 0 1-.68.74L10 10.42l-5.2 4.79a.5.5 0 0 1-.68-.74L9.28 9.7 4.1 4.94a.5.5 0 0 1-.02-.72Z"
                />
              </svg>
            </CaIconButton>
          </header>
          <div class="ca-dialog__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="ca-dialog__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ca-dialog {
  position: fixed;
  inset: 0;
  z-index: var(--ca-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ca-space-8);
}

.ca-dialog__overlay {
  position: absolute;
  inset: 0;
  background: var(--ca-bg-overlay);
}

.ca-dialog__surface {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 64px);
  width: 100%;
  background: var(--ca-bg-surface);
  border-radius: var(--ca-radius-xl);
  box-shadow: var(--ca-shadow-64);
  outline: none;
}

.ca-dialog__surface--small {
  max-width: 360px;
}

.ca-dialog__surface--medium {
  max-width: 520px;
}

.ca-dialog__surface--large {
  max-width: 760px;
}

.ca-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-4);
  padding: var(--ca-space-8) var(--ca-space-8) var(--ca-space-4);
}

.ca-dialog__title {
  font-size: var(--ca-text-500);
  line-height: var(--ca-line-500);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ca-dialog__subtitle {
  margin-top: var(--ca-space-1);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.ca-dialog__body {
  padding: 0 var(--ca-space-8);
  overflow-y: auto;
  flex: 1;
}

.ca-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--ca-space-4);
  padding: var(--ca-space-8);
}

.ca-dialog-enter-active,
.ca-dialog-leave-active {
  transition: opacity var(--ca-duration-normal) var(--ca-curve-easy-ease);
}

.ca-dialog-enter-active .ca-dialog__surface,
.ca-dialog-leave-active .ca-dialog__surface {
  transition: transform var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
}

.ca-dialog-enter-from,
.ca-dialog-leave-to {
  opacity: 0;
}

.ca-dialog-enter-from .ca-dialog__surface,
.ca-dialog-leave-to .ca-dialog__surface {
  transform: scale(0.96) translateY(8px);
}
</style>
