<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked, type Tokens } from 'marked';
import { writeClipboard } from '@/utils/clipboard';

const props = withDefaults(defineProps<{ content: string; pending?: boolean }>(), {
  pending: false,
});

const { t } = useI18n();

const hostRef = ref<HTMLElement | null>(null);

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

if (!purifyHookInstalled) {
  purifyHookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}
function renderCode(token: Tokens.Code): string {
  const source = token.text.replace(/\n$/, '');
  const lang = token.lang?.trim().split(/\s+/)[0] ?? '';
  const label = lang ? lang.toUpperCase() : t('workspace.chat.codePlain');

  if (lang === 'mermaid') {
    return `<div class="md-mermaid" data-mermaid="${encodeURIComponent(source)}"><span class="md-mermaid__loading">${escapeHtml(t('workspace.chat.diagramLoading'))}</span></div>`;
  }

  let highlighted: string;
  try {
    highlighted =
      lang && hljs.getLanguage(lang)
        ? hljs.highlight(source, { language: lang }).value
        : hljs.highlightAuto(source).value;
  } catch {
    highlighted = escapeHtml(source);
  }

  return [
    '<figure class="code-block">',
    `<figcaption class="code-block__head"><span class="code-block__lang">${escapeHtml(label)}</span>`,
    `<button type="button" class="code-block__copy" data-copy-code="${encodeURIComponent(source)}">${escapeHtml(t('workspace.chat.copyCode'))}</button></figcaption>`,
    `<pre><code class="hljs">${highlighted}</code></pre>`,
    '</figure>',
  ].join('');
}

const marked = new Marked({ gfm: true, breaks: true });
marked.use({ renderer: { code: renderCode } });

const renderedHtml = computed(() => {
  const raw = marked.parse(props.content) as string;
  return DOMPurify.sanitize(raw);
});

function onContentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>('button[data-copy-code]');
  if (!button) return;
  void (async () => {
    if (!(await writeClipboard(decodeURIComponent(button.dataset.copyCode ?? '')))) return;
    const original = t('workspace.chat.copyCode');
    button.textContent = t('workspace.chat.copied');
    button.classList.add('code-block__copy--done');
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('code-block__copy--done');
    }, 1600);
  })();
}

let renderSeq = 0;
let instanceId = 0;
let disposed = false;

async function renderDiagrams(): Promise<void> {
  if (props.pending) return;
  await nextTick();
  const host = hostRef.value;
  if (!host || disposed) return;
  const targets = Array.from(host.querySelectorAll<HTMLElement>('.md-mermaid[data-mermaid]'));
  if (targets.length === 0) return;

  const seq = ++renderSeq;
  const { default: mermaid } = await import('mermaid');
  if (disposed || seq !== renderSeq) return;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
    fontFamily: 'inherit',
  });

  for (const [index, element] of targets.entries()) {
    if (disposed || seq !== renderSeq) return;
    const source = decodeURIComponent(element.dataset.mermaid ?? '');
    try {
      const { svg } = await mermaid.render(`mermaid-${instanceId}-${seq}-${index}`, source);
      if (disposed || seq !== renderSeq) return;
      element.innerHTML = svg;
      element.classList.add('md-mermaid--ready');
    } catch {
      element.classList.add('md-mermaid--error');
      element.textContent = t('workspace.chat.diagramError');
    }
  }
}

watch(
  () => [props.content, props.pending],
  () => void renderDiagrams(),
);

onMounted(() => {
  instanceId = ++mermaidInstance;
  void renderDiagrams();
});

onBeforeUnmount(() => {
  disposed = true;
  renderSeq += 1;
});
</script>

<script lang="ts">
let mermaidInstance = 0;
let purifyHookInstalled = false;
</script>

<template>
  <div
    ref="hostRef"
    class="markdown"
    :class="{ 'markdown--pending': pending }"
    @click="onContentClick"
    v-html="renderedHtml"
  />
</template>

<style scoped>
.markdown--pending :deep(p:last-child::after) {
  content: '▍';
  color: var(--ca-color-brand);
  animation: caret-blink 0.9s step-end infinite;
}

@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}

.markdown {
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-1);
  word-break: break-word;
}

.markdown :deep(> :first-child) {
  margin-top: 0;
}

.markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown :deep(p) {
  margin: 0 0 var(--ca-space-3);
}

.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  margin: var(--ca-space-4) 0 var(--ca-space-2);
  line-height: 1.3;
  color: var(--ca-fg-1);
}

.markdown :deep(h1) {
  font-size: 1.25em;
}

.markdown :deep(h2) {
  font-size: 1.15em;
}

.markdown :deep(h3) {
  font-size: 1.05em;
}

.markdown :deep(h4) {
  font-size: 1em;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 var(--ca-space-3);
  padding-left: 1.4em;
}

.markdown :deep(li) {
  margin: 0.2em 0;
}

.markdown :deep(li > p) {
  margin: 0;
}

.markdown :deep(blockquote) {
  margin: 0 0 var(--ca-space-3);
  padding: var(--ca-space-1) var(--ca-space-4);
  border-left: 3px solid var(--ca-color-brand);
  color: var(--ca-fg-2);
  background: var(--ca-bg-surface-2);
  border-radius: var(--ca-radius-sm);
}

.markdown :deep(a) {
  color: var(--ca-color-link);
  text-decoration: none;
}

.markdown :deep(a:hover) {
  text-decoration: underline;
}

.markdown :deep(code) {
  font-family: var(--ca-font-family-mono);
  font-size: 0.92em;
  background: var(--ca-bg-surface-3);
  border-radius: 4px;
  padding: 1px 5px;
}

.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--ca-stroke-2);
  margin: var(--ca-space-4) 0;
}

.markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 var(--ca-space-3);
  font-size: var(--ca-text-200);
}

.markdown :deep(th),
.markdown :deep(td) {
  border: 1px solid var(--ca-stroke-2);
  padding: var(--ca-space-2) var(--ca-space-3);
  text-align: left;
  vertical-align: top;
}

.markdown :deep(th) {
  background: var(--ca-bg-surface-3);
  font-weight: var(--ca-font-weight-semibold);
}

.markdown :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--ca-radius-md);
}

.markdown :deep(.code-block) {
  margin: 0 0 var(--ca-space-3);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
  overflow: hidden;
  background: var(--ca-bg-surface-2);
}

.markdown :deep(.code-block__head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-2);
  padding: var(--ca-space-1) var(--ca-space-3);
  background: var(--ca-bg-surface-3);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.markdown :deep(.code-block__lang) {
  font-family: var(--ca-font-family-mono);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
  letter-spacing: 0.04em;
}

.markdown :deep(.code-block__copy) {
  border: none;
  background: none;
  color: var(--ca-fg-3);
  font: inherit;
  font-size: var(--ca-text-100);
  padding: 2px 6px;
  border-radius: var(--ca-radius-sm);
  cursor: pointer;
}

.markdown :deep(.code-block__copy:hover) {
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
}

.markdown :deep(.code-block__copy--done) {
  color: var(--ca-success-fg);
}

.markdown :deep(.code-block pre) {
  margin: 0;
  padding: var(--ca-space-3) var(--ca-space-4);
  overflow-x: auto;
  font-size: var(--ca-text-200);
  line-height: 1.55;
}

.markdown :deep(.code-block code) {
  background: none;
  padding: 0;
  font-size: inherit;
  white-space: pre;
}

.markdown :deep(.md-mermaid) {
  margin: 0 0 var(--ca-space-3);
  padding: var(--ca-space-3);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  overflow-x: auto;
  text-align: center;
}

.markdown :deep(.md-mermaid svg) {
  max-width: 100%;
  height: auto;
}

.markdown :deep(.md-mermaid__loading) {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  font-style: italic;
}

.markdown :deep(.md-mermaid--error) {
  border-color: var(--ca-danger-stroke);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
  text-align: left;
}

.markdown :deep(.hljs-comment),
.markdown :deep(.hljs-quote) {
  color: var(--ca-fg-3);
  font-style: italic;
}

.markdown :deep(.hljs-keyword),
.markdown :deep(.hljs-selector-tag),
.markdown :deep(.hljs-literal),
.markdown :deep(.hljs-section),
.markdown :deep(.hljs-doctag) {
  color: var(--ca-color-brand);
}

.markdown :deep(.hljs-string),
.markdown :deep(.hljs-title),
.markdown :deep(.hljs-name),
.markdown :deep(.hljs-type),
.markdown :deep(.hljs-attribute),
.markdown :deep(.hljs-symbol),
.markdown :deep(.hljs-bullet),
.markdown :deep(.hljs-addition) {
  color: var(--ca-success-fg);
}

.markdown :deep(.hljs-number),
.markdown :deep(.hljs-variable),
.markdown :deep(.hljs-template-variable),
.markdown :deep(.hljs-regexp),
.markdown :deep(.hljs-meta) {
  color: var(--ca-warning-fg);
}

.markdown :deep(.hljs-built_in),
.markdown :deep(.hljs-params) {
  color: var(--ca-info-fg);
}

.markdown :deep(.hljs-deletion) {
  color: var(--ca-danger-fg);
}

@media (max-width: 900px) {
  .msg {
    max-width: 100%;
  }
}
</style>
