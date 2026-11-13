<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CaIcon from './CaIcon.vue';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    hint?: string;
    tone?: Tone;
    hero?: boolean;
    to?: string;
  }>(),
  { tone: 'neutral' },
);

const TONE_ICON: Record<Tone, string | null> = {
  neutral: null,
  success: 'check-circle',
  warning: 'warning',
  danger: 'error-circle',
  info: 'info',
};

const hintIcon = computed(() => (props.hero ? null : TONE_ICON[props.tone]));
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    class="ca-stat"
    :class="[{ 'ca-stat--hero': hero, 'ca-stat--link': !!to }]"
  >
    <span class="ca-stat__label">{{ label }}</span>
    <span class="ca-stat__value">{{ value }}</span>
    <span v-if="hint || $slots.hint" class="ca-stat__hint" :class="`ca-stat__hint--${tone}`">
      <CaIcon v-if="hintIcon" :name="hintIcon" :size="16" />
      <slot name="hint">{{ hint }}</slot>
    </span>
  </component>
</template>

<style scoped>
.ca-stat {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  min-width: 0;
  padding: var(--ca-space-10);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  box-shadow: var(--ca-shadow-4);
  color: var(--ca-fg-1);
  text-decoration: none;
  transition: box-shadow var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
}

.ca-stat--link:hover {
  box-shadow: var(--ca-shadow-8);
  text-decoration: none;
  color: var(--ca-fg-1);
}

.ca-stat__label {
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-3);
}

.ca-stat__value {
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.ca-stat__hint {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.ca-stat__hint--success {
  color: var(--ca-success-fg);
}

.ca-stat__hint--warning {
  color: var(--ca-warning-fg);
}

.ca-stat__hint--danger {
  color: var(--ca-danger-fg);
}

.ca-stat__hint--info {
  color: var(--ca-info-fg);
}

.ca-stat--hero {
  background: var(--ca-color-brand-strong);
  border-color: transparent;
  color: var(--ca-fg-on-brand-strong);
}

.ca-stat--hero.ca-stat--link:hover {
  color: var(--ca-fg-on-brand-strong);
}

.ca-stat--hero .ca-stat__label,
.ca-stat--hero .ca-stat__hint {
  color: var(--ca-fg-on-brand-strong);
}

.ca-stat--hero .ca-stat__value {
  font-size: var(--ca-text-900);
  line-height: var(--ca-line-900);
}
</style>
