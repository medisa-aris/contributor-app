import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  message?: string;
}

let nextId = 1;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);

  function push(toast: Omit<Toast, 'id'>, timeoutMs = 5000): number {
    const id = nextId++;
    toasts.value.push({ ...toast, id });
    if (timeoutMs > 0) {
      setTimeout(() => dismiss(id), timeoutMs);
    }
    return id;
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  return { toasts, push, dismiss };
});
