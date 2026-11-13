<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; color?: string | null; size?: number }>(), {
  color: null,
  size: 32,
});

const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join(''),
);
</script>

<template>
  <span
    class="agent-avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.4)}px`,
      background: color ?? 'var(--ca-color-brand-strong)',
    }"
    :title="name"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

<style scoped>
.agent-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 50%;
  color: #fff;
  font-weight: var(--ca-font-weight-semibold);
  letter-spacing: 0.02em;
}
</style>
