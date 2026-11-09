<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import * as d3 from 'd3';
import { CaEmptyState, CaIcon, CaSkeleton } from '@/components/ui';
import { mindMapPersonThoughts, mindMapTopics } from '@/api/mindmap';
import type {
  MindMapQuery,
  MindMapThought,
  MindMapTopicPerson,
  MindMapTopics,
} from '@/api/mindmap/types';
import { useUiStore } from '@/stores/ui.store';
import MindThoughtList from './MindThoughtList.vue';
import { MODE_COLORS, initials, truncate } from './mode-colors';

const props = defineProps<{ query: MindMapQuery }>();
const { t } = useI18n();
const ui = useUiStore();

const DEBOUNCE_MS = 350;

const host = ref<HTMLDivElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const q = ref('');
const result = ref<MindMapTopics | null>(null);
const loading = ref(false);
const failed = ref(false);
const selected = ref<MindMapTopicPerson | null>(null);
const fullList = ref<MindMapThought[] | null>(null);
const fullLoading = ref(false);

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
let simulation: d3.Simulation<GraphNode, undefined> | null = null;
let observer: ResizeObserver | null = null;

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  kind: 'topic' | 'person' | 'thought';
  label: string;
  r: number;
  color: string;
  person?: MindMapTopicPerson;
}
interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  kind: 'topic' | 'thought';
}

const hasQuery = computed(() => q.value.trim().length > 0);
const maxCount = computed(() => Math.max(1, ...(result.value?.people.map((p) => p.count) ?? [1])));

async function search(): Promise<void> {
  const mySeq = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const data = await mindMapTopics(q.value.trim(), props.query);
    if (mySeq !== seq) return;
    result.value = data;
    if (selected.value) {
      selected.value = data.people.find((p) => p.id === selected.value!.id) ?? null;
      fullList.value = null;
    }
  } catch {
    if (mySeq === seq) failed.value = true;
  } finally {
    if (mySeq === seq) loading.value = false;
  }
  await nextTick();
  draw();
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void search(), DEBOUNCE_MS);
}

function useKeyword(word: string): void {
  q.value = q.value.trim() ? `${q.value.trim()} ${word}` : word;
}

function choose(person: MindMapTopicPerson): void {
  selected.value = person;
  fullList.value = null;
  draw();
}

async function showAll(): Promise<void> {
  const person = selected.value;
  if (!person) return;
  fullLoading.value = true;
  try {
    const data = await mindMapPersonThoughts(person.id, props.query);
    const needle = q.value.trim().toLowerCase();
    if (selected.value?.id !== person.id) return;
    fullList.value = needle
      ? data.thoughts.filter((item) => item.title.toLowerCase().includes(needle))
      : data.thoughts;
  } finally {
    fullLoading.value = false;
  }
}

function stage(): { width: number; height: number; svg: d3.Selection<SVGSVGElement, unknown, null, undefined> } | null {
  if (!svgEl.value || !host.value) return null;
  const width = host.value.clientWidth;
  const height = host.value.clientHeight;
  const svg = d3.select(svgEl.value).attr('width', width).attr('height', height);
  svg.on('.zoom', null);
  svg.selectAll('*').remove();
  return { width, height, svg };
}

function draw(): void {
  simulation?.stop();
  simulation = null;
  const s = stage();
  if (!s || !result.value) return;
  if (hasQuery.value) drawGraph(s.svg, s.width, s.height);
  else drawBubbles(s.svg, s.width, s.height);
}

/** Gelembung topik populer; klik untuk mencari topik tersebut. */
function drawBubbles(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  width: number,
  height: number,
): void {
  const words = result.value?.keywords ?? [];
  if (words.length === 0) return;
  const rootNode = d3
    .hierarchy<{ word?: string; count?: number; children?: { word: string; count: number }[] }>({
      children: words,
    })
    .sum((d) => d.count ?? 0);
  const pack = d3.pack<typeof rootNode.data>().size([width - 40, height - 40]).padding(8);
  const leaves = pack(rootNode).leaves();
  const max = Math.max(...words.map((w) => w.count));
  const g = svg.append('g').attr('transform', 'translate(20,20)');
  const bubble = g
    .selectAll('g')
    .data(leaves)
    .join('g')
    .attr('transform', (d) => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => `${d.data.word}, ${d.data.count}`)
    .on('click', (_e, d) => (q.value = d.data.word ?? ''))
    .on('keydown', (e: KeyboardEvent, d) => {
      if (e.key === 'Enter') q.value = d.data.word ?? '';
    });
  bubble
    .append('circle')
    .attr('r', 0)
    .style('fill', 'var(--ca-color-brand)')
    .style('fill-opacity', (d) => 0.18 + 0.5 * ((d.data.count ?? 0) / max))
    .style('stroke', 'var(--ca-color-brand)')
    .transition()
    .duration(500)
    .delay((_d, i) => i * 30)
    .attr('r', (d) => d.r);
  bubble
    .append('text')
    .text((d) => truncate(d.data.word ?? '', Math.max(4, Math.floor(d.r / 4.5))))
    .attr('text-anchor', 'middle')
    .attr('dy', '-0.1em')
    .style('font-size', (d) => `${Math.max(11, Math.min(d.r / 2.6, 20))}px`)
    .style('font-weight', 600)
    .style('fill', 'var(--ca-fg-1)')
    .style('pointer-events', 'none');
  bubble
    .append('text')
    .text((d) => d.data.count ?? 0)
    .attr('text-anchor', 'middle')
    .attr('dy', '1.2em')
    .style('font-size', '11px')
    .style('fill', 'var(--ca-fg-2)')
    .style('pointer-events', 'none');
}

/** Grafik gaya: topik di pusat, orang di sekelilingnya, judul pikiran sebagai satelit. */
function drawGraph(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  width: number,
  height: number,
): void {
  const data = result.value;
  if (!data || data.people.length === 0) return;

  const nodes: GraphNode[] = [
    { id: 'topic', kind: 'topic', label: truncate(data.query, 22), r: 38, color: 'var(--ca-color-brand)', fx: 0, fy: 0 },
  ];
  const links: GraphLink[] = [];
  for (const p of data.people) {
    nodes.push({
      id: p.id,
      kind: 'person',
      label: p.displayName,
      r: 13 + Math.sqrt(p.count) * 5,
      color: 'var(--ca-bg-surface)',
      person: p,
    });
    links.push({ source: 'topic', target: p.id, kind: 'topic' });
    for (const item of p.thoughts) {
      const id = `${p.id}:${item.id}`;
      nodes.push({ id, kind: 'thought', label: item.title, r: 5, color: MODE_COLORS[item.mode] });
      links.push({ source: p.id, target: id, kind: 'thought' });
    }
  }

  const layer = svg.append('g');
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 3])
    .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => layer.attr('transform', event.transform.toString()));
  svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));

  const link = layer
    .append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .style('stroke', 'var(--ca-stroke-2)')
    .style('stroke-width', (l) => (l.kind === 'topic' ? 1.8 : 1))
    .style('opacity', 0.8);

  const node = layer
    .append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .style('cursor', (d) => (d.kind === 'thought' ? 'default' : 'pointer'))
    .on('click', (_e, d) => {
      if (d.person) choose(d.person);
    });

  node.append('title').text((d) => (d.person ? `${d.person.displayName} — ${d.person.count}` : d.label));
  node
    .append('circle')
    .attr('r', (d) => d.r)
    .style('fill', (d) => d.color)
    .style('stroke', (d) =>
      d.kind === 'person'
        ? selected.value?.id === d.id
          ? 'var(--ca-color-brand)'
          : 'var(--ca-stroke-2)'
        : 'transparent',
    )
    .style('stroke-width', (d) => (d.kind === 'person' ? 2.5 : 0));
  node
    .filter((d) => d.kind !== 'thought')
    .append('text')
    .text((d) => (d.kind === 'topic' ? truncate(d.label, 12) : initials(d.label)))
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .style('font-size', (d) => (d.kind === 'topic' ? '13px' : '11px'))
    .style('font-weight', 700)
    .style('fill', (d) => (d.kind === 'topic' ? 'var(--ca-fg-on-brand)' : 'var(--ca-fg-1)'))
    .style('pointer-events', 'none');
  node
    .filter((d) => d.kind === 'person')
    .append('text')
    .text((d) => `${truncate(d.label, 22)} · ${d.person?.count ?? 0}`)
    .attr('text-anchor', 'middle')
    .attr('y', (d) => d.r + 15)
    .style('font-size', '12px')
    .style('fill', 'var(--ca-fg-1)')
    .style('paint-order', 'stroke')
    .style('stroke', 'var(--ca-bg-canvas)')
    .style('stroke-width', '3px')
    .style('pointer-events', 'none');

  simulation = d3
    .forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      d3
        .forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((l) => (l.kind === 'topic' ? 170 : 55))
        .strength((l) => (l.kind === 'topic' ? 0.6 : 0.9)),
    )
    .force('charge', d3.forceManyBody<GraphNode>().strength((d) => (d.kind === 'thought' ? -30 : -320)))
    .force('collide', d3.forceCollide<GraphNode>().radius((d) => d.r + 6))
    .force('x', d3.forceX(0).strength(0.03))
    .force('y', d3.forceY(0).strength(0.03))
    .on('tick', () => {
      link
        .attr('x1', (l) => (l.source as GraphNode).x ?? 0)
        .attr('y1', (l) => (l.source as GraphNode).y ?? 0)
        .attr('x2', (l) => (l.target as GraphNode).x ?? 0)
        .attr('y2', (l) => (l.target as GraphNode).y ?? 0);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

  node.call(
    d3
      .drag<SVGGElement, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation?.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation?.alphaTarget(0);
        if (d.kind !== 'topic') {
          d.fx = null;
          d.fy = null;
        }
      }),
  );
}

watch(q, schedule);
watch(() => [props.query.days, props.query.modes.join(',')], () => void search());
watch(() => ui.fullscreen, async () => {
  await nextTick();
  setTimeout(draw, 60);
});

onMounted(() => {
  void search();
  observer = new ResizeObserver(() => draw());
  if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  simulation?.stop();
  observer?.disconnect();
  seq++;
});

const shownThoughts = computed<MindMapThought[]>(() => fullList.value ?? selected.value?.thoughts ?? []);
const hiddenCount = computed(() =>
  selected.value && !fullList.value ? Math.max(0, selected.value.count - selected.value.thoughts.length) : 0,
);
</script>

<template>
  <div class="ts">
    <aside class="ts__side">
      <label class="ts__search">
        <CaIcon name="search" :size="16" />
        <input
          v-model="q"
          type="search"
          class="ts__input"
          maxlength="100"
          :placeholder="t('workspace.mindMap.thinking.searchPlaceholder')"
          :aria-label="t('workspace.mindMap.thinking.searchPlaceholder')"
        />
      </label>

      <div v-if="hasQuery && result && result.keywords.length > 0" class="ts__kw">
        <span class="ts__kw-label">{{ t('workspace.mindMap.thinking.keywordsFor') }}</span>
        <button v-for="k in result.keywords" :key="k.word" type="button" class="ts__kw-chip" @click="useKeyword(k.word)">
          {{ k.word }} <b>{{ k.count }}</b>
        </button>
      </div>

      <p v-if="!hasQuery" class="ts__hint">
        {{ t('workspace.mindMap.thinking.hint') }}
        <strong v-if="result && result.keywords.length > 0">{{ t('workspace.mindMap.thinking.topKeywords') }}</strong>
      </p>
      <p v-else-if="result && !loading" class="ts__hint">
        {{ t('workspace.mindMap.thinking.results', { n: result.total, people: result.people.length }) }}
      </p>

      <ol v-if="hasQuery && result" class="ts__rank">
        <li v-for="p in result.people" :key="p.id">
          <button
            type="button"
            class="ts__row"
            :class="{ 'ts__row--on': selected?.id === p.id }"
            @click="choose(p)"
          >
            <span class="ts__avatar">{{ initials(p.displayName) }}</span>
            <span class="ts__who">
              <strong>{{ p.displayName }}</strong>
              <small>{{ p.departmentName ?? p.jobTitle ?? '' }}</small>
              <span class="ts__bar"><i :style="{ width: `${(p.count / maxCount) * 100}%` }" /></span>
            </span>
            <span class="ts__n">{{ p.count }}</span>
          </button>
        </li>
      </ol>
    </aside>

    <div class="ts__stage">
      <div ref="host" class="ts__canvas">
        <svg ref="svgEl" class="ts__svg" role="img" :aria-label="t('workspace.mindMap.tabs.thinking')" />
      </div>
      <div v-if="loading && !result" class="ts__overlay"><CaSkeleton shape="rect" height="240px" /></div>
      <div v-else-if="failed" class="ts__overlay"><CaEmptyState :title="t('workspace.mindMap.loadFailed')" /></div>
      <div v-else-if="hasQuery && result && result.people.length === 0 && !loading" class="ts__overlay">
        <CaEmptyState :title="t('workspace.mindMap.thinking.noResults')" />
      </div>

      <aside v-if="selected" class="ts__panel">
        <header class="ts__panel-head">
          <span class="ts__avatar">{{ initials(selected.displayName) }}</span>
          <div class="ts__who">
            <strong>{{ selected.displayName }}</strong>
            <small>{{ [selected.jobTitle, selected.departmentName].filter(Boolean).join(' · ') }}</small>
          </div>
          <button type="button" class="ts__close" :aria-label="t('workspace.mindMap.mapping.close')" @click="selected = null; draw()">
            ×
          </button>
        </header>
        <div class="ts__panel-body">
          <CaSkeleton v-if="fullLoading" :lines="4" />
          <MindThoughtList v-else :thoughts="shownThoughts" />
          <p v-if="hiddenCount > 0" class="ts__more">
            {{ t('workspace.mindMap.thinking.moreThoughts', { n: hiddenCount }) }}
            <button type="button" class="ts__link" @click="showAll">{{ t('workspace.mindMap.thinking.showThoughts') }}</button>
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ts {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 300px 1fr;
}
.ts__side {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  padding: var(--ca-space-3);
  background: var(--ca-bg-surface);
  border-right: 1px solid var(--ca-stroke-1);
  overflow-y: auto;
  min-height: 0;
}
.ts__search {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: 0 var(--ca-space-3);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-canvas);
  color: var(--ca-fg-3);
}
.ts__search:focus-within {
  border-color: var(--ca-color-brand);
}
.ts__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 9px 0;
  color: var(--ca-fg-1);
  font: inherit;
}
.ts__hint {
  margin: 0;
  color: var(--ca-fg-2);
  font-size: 13px;
}
.ts__hint strong {
  display: block;
  margin-top: var(--ca-space-1);
  color: var(--ca-fg-1);
}
.ts__kw {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.ts__kw-label {
  width: 100%;
  font-size: 12px;
  color: var(--ca-fg-3);
}
.ts__kw-chip {
  padding: 3px 10px;
  border-radius: var(--ca-radius-circular);
  border: 1px solid var(--ca-stroke-2);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.ts__kw-chip:hover {
  border-color: var(--ca-color-brand);
}
.ts__rank {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
}
.ts__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  padding: var(--ca-space-2);
  border-radius: var(--ca-radius-md);
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--ca-fg-1);
  font: inherit;
}
.ts__row:hover,
.ts__row--on {
  background: var(--ca-color-brand-subtle);
  border-color: var(--ca-stroke-2);
}
.ts__avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
  font-size: 12px;
  font-weight: 700;
}
.ts__who {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.ts__who small {
  color: var(--ca-fg-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ts__bar {
  height: 4px;
  border-radius: 2px;
  background: var(--ca-stroke-1);
  overflow: hidden;
}
.ts__bar i {
  display: block;
  height: 100%;
  background: var(--ca-color-brand);
}
.ts__n {
  font-weight: 700;
  color: var(--ca-fg-2);
}
.ts__stage {
  position: relative;
  min-width: 0;
  min-height: 0;
}
.ts__canvas,
.ts__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.ts__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ca-space-6);
  pointer-events: none;
}
.ts__panel {
  position: absolute;
  top: var(--ca-space-3);
  right: var(--ca-space-3);
  bottom: var(--ca-space-3);
  width: min(360px, calc(100% - 24px));
  display: flex;
  flex-direction: column;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-lg);
  box-shadow: var(--ca-shadow-16, 0 8px 24px rgba(0, 0, 0, 0.18));
}
.ts__panel-head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  padding: var(--ca-space-3) var(--ca-space-4);
  border-bottom: 1px solid var(--ca-stroke-1);
  color: var(--ca-fg-1);
}
.ts__close {
  border: 0;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--ca-fg-2);
  cursor: pointer;
}
.ts__panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--ca-space-3) var(--ca-space-4);
}
.ts__more {
  color: var(--ca-fg-3);
  font-size: 13px;
}
.ts__link {
  border: 0;
  background: transparent;
  color: var(--ca-color-brand);
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}
@media (max-width: 800px) {
  .ts {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 42%) 1fr;
  }
  .ts__side {
    border-right: 0;
    border-bottom: 1px solid var(--ca-stroke-1);
  }
}
</style>
