<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

export interface CaMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: CaMenuItem[];
    align?: 'start' | 'end';
  }>(),
  { align: 'start' },
);

const emit = defineEmits<{ select: [key: string] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle(): void {
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

function onSelect(item: CaMenuItem): void {
  if (item.disabled) return;
  emit('select', item.key);
  close();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

watch(open, (isOpen) => {
  if (typeof document === 'undefined') return;
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeydown);
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('keydown', onDocumentKeydown);
  }
});

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <span ref="root" class="ca-menu">
    <span class="ca-menu__trigger" @click="toggle">
      <slot name="trigger" :open="open" />
    </span>
    <Transition name="ca-menu-pop">
      <div
        v-if="open"
        class="ca-menu__popup"
        :class="`ca-menu__popup--${props.align}`"
        role="menu"
      >
        <template v-for="item in items" :key="item.key">
          <div v-if="item.divider" class="ca-menu__divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            class="ca-menu__item"
            :class="{ 'ca-menu__item--danger': item.danger }"
            :disabled="item.disabled"
            @click="onSelect(item)"
          >
            {{ item.label }}
          </button>
        </template>
      </div>
    </Transition>
  </span>
</template>

<style scoped>
.ca-menu {
  position: relative;
  display: inline-flex;
}

.ca-menu__trigger {
  display: inline-flex;
}

.ca-menu__popup {
  position: absolute;
  top: calc(100% + var(--ca-space-1));
  z-index: var(--ca-z-dropdown);
  min-width: 180px;
  padding: var(--ca-space-1);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  box-shadow: var(--ca-shadow-16);
}

.ca-menu__popup--start {
  left: 0;
}

.ca-menu__popup--end {
  right: 0;
}

.ca-menu__item {
  display: block;
  width: 100%;
  text-align: start;
  padding: var(--ca-space-3) var(--ca-space-6);
  border: none;
  border-radius: var(--ca-radius-md);
  background: transparent;
  color: var(--ca-fg-1);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  cursor: pointer;
  white-space: nowrap;
}

.ca-menu__item:hover:not(:disabled) {
  background: var(--ca-bg-surface-hover);
}

.ca-menu__item:active:not(:disabled) {
  background: var(--ca-bg-surface-pressed);
}

.ca-menu__item--danger {
  color: var(--ca-danger-fg);
}

.ca-menu__item:disabled {
  color: var(--ca-fg-disabled);
  cursor: not-allowed;
}

.ca-menu__divider {
  height: 1px;
  margin: var(--ca-space-1) var(--ca-space-2);
  background: var(--ca-stroke-3);
}

.ca-menu-pop-enter-active,
.ca-menu-pop-leave-active {
  transition:
    opacity var(--ca-duration-faster) var(--ca-curve-easy-ease),
    transform var(--ca-duration-faster) var(--ca-curve-decelerate-mid);
}

.ca-menu-pop-enter-from,
.ca-menu-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
