<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name: string;
    size?: 'small' | 'medium' | 'large';
  }>(),
  { size: 'medium' },
);

const PALETTE = [
  '#0f6cbd',
  '#4f6bed',
  '#7d4fd1',
  '#b146c2',
  '#e3008c',
  '#c50f1f',
  '#ca5010',
  '#986f0b',
  '#498205',
  '#0e700e',
  '#008272',
  '#005b70',
];

const initials = computed(() => {
  const parts = props.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) : '';
  return (first + (last ?? '')).toUpperCase();
});

const color = computed(() => {
  let hash = 0;
  for (const char of props.name) {
    hash = (hash * 31 + char.charCodeAt(0)) % PALETTE.length;
  }
  return PALETTE[hash] ?? '#0f6cbd';
});
</script>

<template>
  <span
    class="ca-avatar"
    :class="`ca-avatar--${size}`"
    :style="{ '--ca-avatar-color': color }"
    role="img"
    :aria-label="name"
  >
    {{ initials }}
  </span>
</template>

<style scoped>
.ca-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-avatar-color);
  color: #ffffff;
  font-weight: var(--ca-font-weight-semibold);
  user-select: none;
}

.ca-avatar--small {
  width: 24px;
  height: 24px;
  font-size: var(--ca-text-100);
}

.ca-avatar--medium {
  width: 32px;
  height: 32px;
  font-size: var(--ca-text-200);
}

.ca-avatar--large {
  width: 48px;
  height: 48px;
  font-size: var(--ca-text-400);
}
</style>
