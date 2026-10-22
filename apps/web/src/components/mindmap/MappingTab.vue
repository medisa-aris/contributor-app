<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import * as d3 from 'd3';
import { CaEmptyState, CaSkeleton } from '@/components/ui';
import { mindMapOrg, mindMapPersonThoughts } from '@/api/mindmap';
import type {
  MindMapMode,
  MindMapOrg,
  MindMapPerson,
  MindMapPersonThoughts,
  MindMapQuery,
} from '@/api/mindmap/types';
import { useUiStore } from '@/stores/ui.store';
import MindThoughtList from './MindThoughtList.vue';
import { MODE_COLORS, MODE_ORDER, dominantMode, initials, truncate } from './mode-colors';

const props = defineProps<{ query: MindMapQuery }>();
const { t } = useI18n();
const ui = useUiStore();

interface Datum {
  id: string;
  kind: 'root' | 'dept' | 'person';
  name: string;
  total: number;
  members: number;
  person?: MindMapPerson;
  parent?: Datum;
  children?: Datum[];
  collapsed?: boolean;
}

const host = ref<HTMLDivElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const org = ref<MindMapOrg | null>(null);
const loading = ref(true);
const failed = ref(false);
const focusId = ref('root');
const selected = ref<MindMapPerson | null>(null);
const detail = ref<MindMapPersonThoughts | null>(null);
const detailLoading = ref(false);

let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
let observer: ResizeObserver | null = null;
let loadSeq = 0;

/** Membangun pohon penuh: akar -> departemen -> sub-departemen -> orang. */
const tree = computed(() => {
  const data = org.value;
  if (!data) return null;
  const depts = new Map<string, Datum>();
  for (const d of data.departments) {
    depts.set(d.id, { id: d.id, kind: 'dept', name: d.name, total: 0, members: 0, children: [] });
  }
  const root: Datum = {
    id: 'root',
    kind: 'root',
    name: t('workspace.mindMap.mapping.root'),
    total: 0,
    members: 0,
    children: [],
  };
  for (const d of data.departments) {
    const node = depts.get(d.id)!;
    const parent = (d.parentId && depts.get(d.parentId)) || root;
    node.parent = parent;
    parent.children!.push(node);
  }
  for (const p of data.people) {
    const parent = (p.departmentId && depts.get(p.departmentId)) || root;
    const node: Datum = {
      id: p.id,
      kind: 'person',
      name: p.displayName,
      total: p.total,
      members: 1,
      person: p,
      parent,
    };
    parent.children!.push(node);
  }
  const sum = (n: Datum): void => {
    for (const c of n.children ?? []) {
      sum(c);
      n.total += c.total;
      n.members += c.members;
    }
  };
  sum(root);
  return root;
});

const nodeIndex = computed(() => {
  const index = new Map<string, Datum>();
  const walk = (n: Datum): void => {
    index.set(n.id, n);
    n.children?.forEach(walk);
  };
  if (tree.value) walk(tree.value);
  return index;
});

const focus = computed(() => nodeIndex.value.get(focusId.value) ?? tree.value);
const crumbs = computed(() => {
  const path: Datum[] = [];
  for (let n: Datum | undefined | null = focus.value; n; n = n.parent) path.unshift(n);
  return path;
});

/** Salinan fokus yang dipangkas dua tingkat; departemen di tingkat akhir ditampilkan tertutup. */
function trim(node: Datum, depth: number): Datum {
  const copy: Datum = { ...node, children: undefined };
  if (node.children && node.kind !== 'person') {
    if (depth >= 2 && node.kind === 'dept') copy.collapsed = true;
    else copy.children = node.children.map((c) => trim(c, depth + 1));
  }
  return copy;
}

/** Mulai dari departemen pertama yang punya percabangan, bukan dari akar yang hanya punya satu anak. */
function skipSingleChain(node: Datum | null): Datum {
  let current = node!;
  while (current.children?.length === 1 && current.children[0]!.kind === 'dept') {
    current = current.children[0]!;
  }
  return current;
}

async function load(): Promise<void> {
  const seq = ++loadSeq;
  loading.value = true;
  failed.value = false;
  try {
    const data = await mindMapOrg(props.query);
    if (seq !== loadSeq) return;
    const firstLoad = org.value === null;
    org.value = data;
    if (!nodeIndex.value.has(focusId.value)) focusId.value = 'root';
    if (firstLoad) focusId.value = skipSingleChain(tree.value).id;
    if (selected.value) {
      selected.value = data.people.find((p) => p.id === selected.value!.id) ?? null;
      if (selected.value) void loadDetail(selected.value);
    }
  } catch {
    if (seq === loadSeq) failed.value = true;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
  await nextTick();
  draw();
}

async function loadDetail(person: MindMapPerson): Promise<void> {
  detail.value = null;
  detailLoading.value = true;
  try {
    const result = await mindMapPersonThoughts(person.id, props.query);
    if (selected.value?.id === person.id) detail.value = result;
  } catch {
    if (selected.value?.id === person.id) detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

function pick(person: MindMapPerson): void {
  selected.value = person;
  void loadDetail(person);
}

function closePanel(): void {
  selected.value = null;
  detail.value = null;
}

function setFocus(id: string): void {
  focusId.value = id;
  closePanel();
}

function nodeRadius(d: Datum, isCenter: boolean): number {
  if (isCenter) return 36;
  if (d.kind === 'person') return Math.min(7 + Math.sqrt(d.total) * 2.4, 24);
  return Math.min(15 + Math.sqrt(d.total) * 1.6, 34);
}

function draw(): void {
  const svgNode = svgEl.value;
  const hostNode = host.value;
  const start = focus.value;
  if (!svgNode || !hostNode || !start || !org.value || org.value.people.length === 0) return;

  const width = hostNode.clientWidth;
  const height = hostNode.clientHeight;
  const svg = d3.select(svgNode).attr('width', width).attr('height', height);
  svg.selectAll('*').remove();

  const root = d3.hierarchy<Datum>(trim(start, 0));
  const leaves = Math.max(root.leaves().length, 1);
  const radius = Math.max(Math.min(width, height) / 2 - 130, leaves * 12);
  d3
    .tree<Datum>()
    .size([2 * Math.PI, radius])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.5) / Math.max(a.depth, 1))(root);
  // Jarak antar cincin dibuat tetap agar simpul tingkat pertama tidak menempel ke pusat.
  const ring = Math.max(150, radius / Math.max(root.height, 1));
  root.each((n) => {
    (n as d3.HierarchyPointNode<Datum>).y = n.depth * ring;
  });

  const layer = svg.append('g');
  zoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 3])
    .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      layer.attr('transform', event.transform.toString());
    });
  svg.call(zoomBehavior);
  const point = (d: d3.HierarchyPointNode<Datum>): [number, number] => [
    Math.sin(d.x) * d.y,
    -Math.cos(d.x) * d.y,
  ];

  // Sesuaikan zoom awal agar seluruh peta (plus ruang untuk label) muat di kanvas.
  const points = (root.descendants() as d3.HierarchyPointNode<Datum>[]).map(point);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const labelRoom = 150;
  const spanX = Math.max(...xs) - Math.min(...xs) + labelRoom * 2 + 80;
  const spanY = Math.max(...ys) - Math.min(...ys) + 160;
  const scale = Math.min(1, width / spanX, height / spanY);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  svg.call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(width / 2 - cx * scale, height / 2 - cy * scale).scale(scale),
  );

  layer
    .append('g')
    .attr('fill', 'none')
    .selectAll('path')
    .data(root.links() as d3.HierarchyPointLink<Datum>[])
    .join('path')
    .attr(
      'd',
      d3
        .linkRadial<d3.HierarchyPointLink<Datum>, d3.HierarchyPointNode<Datum>>()
        .angle((n) => n.x)
        .radius((n) => n.y) as unknown as string,
    )
    .style('stroke', 'var(--ca-stroke-2)')
    .style('stroke-width', 1.4)
    .style('opacity', 0)
    .transition()
    .duration(450)
    .style('opacity', 0.8);

  const nodes = layer
    .append('g')
    .selectAll<SVGGElement, d3.HierarchyPointNode<Datum>>('g')
    .data(root.descendants() as d3.HierarchyPointNode<Datum>[])
    .join('g')
    .attr('transform', (d) => {
      const [x, y] = point(d);
      return `translate(${x},${y})`;
    })
    .style('cursor', 'pointer')
    .style('opacity', 0)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) =>
      `${d.data.name}, ${t('workspace.mindMap.thoughtsCount', { n: d.data.total })}`,
    )
    .on('click', (_event, d) => activate(d))
    .on('keydown', (event: KeyboardEvent, d) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(d);
      }
    });

  nodes.append('title').text((d) => {
    const p = d.data.person;
    return p
      ? `${p.displayName}${p.jobTitle ? ` — ${p.jobTitle}` : ''}\n` +
          MODE_ORDER.map((m) => `${t(`workspace.mindMap.modes.${m}`)}: ${p.counts[m]}`).join('\n')
      : `${d.data.name}\n${t('workspace.mindMap.mapping.members', { n: d.data.members })} · ${t('workspace.mindMap.thoughtsCount', { n: d.data.total })}`;
  });

  const pie = d3.pie<MindMapMode>().sort(null).value(() => 1);
  nodes.each(function (d) {
    const g = d3.select(this);
    const isCenter = d.depth === 0;
    const r = nodeRadius(d.data, isCenter);
    const person = d.data.person;

    if (person) {
      g.append('circle')
        .attr('r', r + 3)
        .style('fill', 'var(--ca-bg-surface)')
        .style('stroke', selected.value?.id === person.id ? 'var(--ca-color-brand)' : 'transparent')
        .style('stroke-width', 2.5);
      if (person.total === 0) {
        g.append('circle')
          .attr('r', r)
          .style('fill', 'var(--ca-bg-surface-3, var(--ca-bg-surface-2))')
          .style('stroke', 'var(--ca-stroke-2)');
      } else {
        const arc = d3.arc<d3.PieArcDatum<MindMapMode>>().innerRadius(r * 0.55).outerRadius(r);
        const weights = pie.value((m) => person.counts[m])(MODE_ORDER as MindMapMode[]);
        g.selectAll('path')
          .data(weights.filter((w) => w.value > 0))
          .join('path')
          .attr('d', arc)
          .style('fill', (w) => MODE_COLORS[w.data]);
      }
      if (r >= 12) {
        g.append('text')
          .text(initials(person.displayName))
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .style('font-size', '9px')
          .style('font-weight', 600)
          .style('fill', 'var(--ca-fg-1)')
          .style('pointer-events', 'none');
      }
    } else {
      g.append('circle')
        .attr('r', r)
        .style('fill', isCenter ? 'var(--ca-color-brand)' : 'var(--ca-color-brand-subtle)')
        .style('stroke', 'var(--ca-color-brand)')
        .style('stroke-width', d.data.collapsed ? 2.5 : 1.5)
        .style('stroke-dasharray', d.data.collapsed ? '4 3' : 'none');
      g.append('text')
        .text(String(d.data.total))
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', isCenter ? '14px' : '11px')
        .style('font-weight', 700)
        .style('fill', isCenter ? 'var(--ca-fg-on-brand)' : 'var(--ca-fg-1)')
        .style('pointer-events', 'none');
    }

    const label = g.append('text').style('font-size', '12px').style('fill', 'var(--ca-fg-1)');
    label
      .style('paint-order', 'stroke')
      .style('stroke', 'var(--ca-bg-canvas)')
      .style('stroke-width', '3px')
      .style('pointer-events', 'none');
    const text = truncate(d.data.name, 24);
    if (isCenter) {
      label.text(text).attr('text-anchor', 'middle').attr('y', r + 18).style('font-weight', 600);
    } else {
      // Teks tetap horizontal agar mudah dibaca; sisinya mengikuti posisi node terhadap pusat.
      const right = d.x < Math.PI;
      label
        .text(text)
        .attr('dy', '0.32em')
        .attr('x', right ? r + 8 : -(r + 8))
        .attr('text-anchor', right ? 'start' : 'end');
      if (d.data.kind === 'person' && d.data.total > 0) {
        label.append('tspan').text(`  ${d.data.total}`).style('fill', 'var(--ca-fg-3)');
      }
    }
  });

  nodes.transition().duration(450).style('opacity', 1);

  nodes
    .on('mouseenter', function () {
      d3.select(this).raise().select('circle').style('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,.35))');
    })
    .on('mouseleave', function () {
      d3.select(this).select('circle').style('filter', null);
    });
}

function activate(d: d3.HierarchyPointNode<Datum>): void {
  if (d.depth === 0) {
    const parent = focus.value?.parent;
    if (parent) setFocus(parent.id);
    return;
  }
  if (d.data.kind === 'person' && d.data.person) {
    pick(d.data.person);
    draw();
    return;
  }
  setFocus(d.data.id);
}

watch(() => [props.query.days, props.query.modes.join(',')], load);
watch([focusId], async () => {
  await nextTick();
  draw();
});
watch(() => selected.value?.id, async () => {
  await nextTick();
  draw();
});
watch(() => ui.fullscreen, async () => {
  await nextTick();
  setTimeout(draw, 60);
});

onMounted(() => {
  void load();
  observer = new ResizeObserver(() => draw());
  if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  loadSeq++;
});

const selectedCounts = computed(() =>
  selected.value ? MODE_ORDER.map((m) => ({ mode: m, n: selected.value!.counts[m] })) : [],
);
const dominantColor = computed(() =>
  selected.value ? MODE_COLORS[dominantMode(selected.value.counts)] : 'transparent',
);
</script>

<template>
  <div class="map">
    <div v-if="loading && !org" class="map__state"><CaSkeleton shape="rect" height="320px" /></div>
    <div v-else-if="failed" class="map__state">
      <CaEmptyState :title="t('workspace.mindMap.loadFailed')" />
    </div>
    <div v-else-if="!org || org.people.length === 0" class="map__state">
      <CaEmptyState :title="t('workspace.mindMap.mapping.empty')" />
    </div>

    <div v-show="org && org.people.length > 0 && !failed" ref="host" class="map__canvas">
      <svg ref="svgEl" class="map__svg" role="img" :aria-label="t('workspace.mindMap.tabs.mapping')" />
    </div>

    <nav v-if="org && org.people.length > 0" class="map__crumbs" :aria-label="t('workspace.mindMap.tabs.mapping')">
      <template v-for="(c, i) in crumbs" :key="c.id">
        <span v-if="i > 0" class="map__sep">/</span>
        <button
          type="button"
          class="map__crumb"
          :class="{ 'map__crumb--on': i === crumbs.length - 1 }"
          @click="setFocus(c.id)"
        >
          {{ c.name }}
        </button>
      </template>
    </nav>

    <div v-if="org && org.people.length > 0" class="map__legend">
      <span v-for="m in MODE_ORDER" :key="m" class="map__legend-item">
        <i class="map__legend-dot" :style="{ background: MODE_COLORS[m] }" />
        {{ t(`workspace.mindMap.modes.${m}`) }}
      </span>
      <span class="map__hint">{{ t('workspace.mindMap.mapping.hint') }}</span>
    </div>

    <aside v-if="selected" class="map__panel" :style="{ '--accent': dominantColor }">
      <header class="map__panel-head">
        <span class="map__avatar">{{ initials(selected.displayName) }}</span>
        <div class="map__panel-who">
          <strong>{{ selected.displayName }}</strong>
          <span v-if="selected.jobTitle">{{ selected.jobTitle }}</span>
        </div>
        <button type="button" class="map__close" :aria-label="t('workspace.mindMap.mapping.close')" @click="closePanel">
          ×
        </button>
      </header>
      <div class="map__counts">
        <span v-for="c in selectedCounts" :key="c.mode" class="map__count">
          <i class="map__legend-dot" :style="{ background: MODE_COLORS[c.mode] }" />
          {{ t(`workspace.mindMap.modes.${c.mode}`) }} <b>{{ c.n }}</b>
        </span>
      </div>
      <div class="map__panel-body">
        <CaSkeleton v-if="detailLoading" :lines="4" />
        <MindThoughtList v-else-if="detail && detail.thoughts.length > 0" :thoughts="detail.thoughts" />
        <p v-else class="map__none">{{ t('workspace.mindMap.mapping.noThoughts') }}</p>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}
.map__state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ca-space-6);
}
.map__canvas,
.map__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.map__svg {
  cursor: grab;
}
.map__crumbs {
  position: absolute;
  top: var(--ca-space-3);
  left: var(--ca-space-3);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 24px);
  padding: 4px 8px;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
}
.map__crumb {
  border: 0;
  background: transparent;
  padding: 2px 4px;
  color: var(--ca-fg-2);
  cursor: pointer;
  font: inherit;
}
.map__crumb:hover {
  color: var(--ca-color-brand);
}
.map__crumb--on {
  color: var(--ca-fg-1);
  font-weight: 600;
}
.map__sep {
  color: var(--ca-fg-3);
}
.map__legend {
  position: absolute;
  left: var(--ca-space-3);
  bottom: var(--ca-space-3);
  right: var(--ca-space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-1) var(--ca-space-4);
  font-size: 12px;
  color: var(--ca-fg-2);
  pointer-events: none;
}
.map__legend-item,
.map__count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.map__legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.map__hint {
  color: var(--ca-fg-3);
}
.map__panel {
  position: absolute;
  top: var(--ca-space-3);
  right: var(--ca-space-3);
  bottom: var(--ca-space-3);
  width: min(380px, calc(100% - 24px));
  display: flex;
  flex-direction: column;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-1);
  border-top: 3px solid var(--accent);
  border-radius: var(--ca-radius-lg);
  box-shadow: var(--ca-shadow-16, 0 8px 24px rgba(0, 0, 0, 0.18));
  animation: map-panel-in var(--ca-duration-normal, 200ms) ease-out;
}
@keyframes map-panel-in {
  from {
    opacity: 0;
    transform: translateX(16px);
  }
}
.map__panel-head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  padding: var(--ca-space-3) var(--ca-space-4);
}
.map__avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;
}
.map__panel-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  color: var(--ca-fg-1);
}
.map__panel-who span {
  color: var(--ca-fg-3);
  font-size: 12px;
}
.map__close {
  border: 0;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--ca-fg-2);
  cursor: pointer;
}
.map__counts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-1) var(--ca-space-3);
  padding: 0 var(--ca-space-4) var(--ca-space-3);
  font-size: 12px;
  color: var(--ca-fg-2);
  border-bottom: 1px solid var(--ca-stroke-1);
}
.map__panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--ca-space-3) var(--ca-space-4);
}
.map__none {
  color: var(--ca-fg-3);
}
</style>
