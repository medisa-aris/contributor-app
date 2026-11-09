<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { OrthographicCamera, Scene } from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { useAuthStore } from '@/stores/auth.store';
import { CaButton, CaCard, CaIcon, CaPageHeader } from '@/components/ui';
import AsciiRippleBackground from '@/components/workspace/AsciiRippleBackground.vue';
import {
  clampToStage,
  gridHeight,
  gridLayout,
  type CardSize,
  type NormalizedPoint,
} from '@/utils/cardStage';

const { t } = useI18n();
const auth = useAuthStore();

interface LandingCard {
  key: string;
  to: string;
  icon: string;
  title: string;
  description: string;
  action: string;
  variant: 'primary' | 'secondary';
}

const cards = computed<LandingCard[]>(() => {
  const list: LandingCard[] = [];
  const modes = [
    {
      key: 'secondBrain',
      to: '/workspace/second-brain',
      icon: 'book',
      permission: 'ai.secondbrain.query',
    },
    {
      key: 'counterpart',
      to: '/workspace/counterpart',
      icon: 'people',
      permission: 'ai.counterpart.analyze',
    },
    {
      key: 'subordinate',
      to: '/workspace/subordinate',
      icon: 'bot',
      permission: 'ai.subordinate.execute',
    },
  ];
  for (const mode of modes) {
    if (!auth.can(mode.permission)) continue;
    list.push({
      key: mode.key,
      to: mode.to,
      icon: mode.icon,
      title: t(`workspace.landing.${mode.key}.name`),
      description: t(`workspace.landing.${mode.key}.description`),
      action: t('workspace.landing.open'),
      variant: 'primary',
    });
  }
  if (auth.can('ai.workspace.history.read')) {
    list.push({
      key: 'history',
      to: '/workspace/history',
      icon: 'history',
      title: t('workspace.landing.history.name'),
      description: t('workspace.landing.history.description'),
      action: t('workspace.landing.history.open'),
      variant: 'secondary',
    });
  }
  if (auth.can('ai.mindmap.team.read')) {
    list.push({
      key: 'mindMap',
      to: '/workspace/mind-map',
      icon: 'sparkle',
      title: t('workspace.landing.mindMap.name'),
      description: t('workspace.landing.mindMap.description'),
      action: t('workspace.landing.mindMap.open'),
      variant: 'secondary',
    });
  }
  return list;
});

const hasModes = computed(() => cards.value.some((card) => card.variant === 'primary'));

// ---- Panggung three.js: kartu DOM sebagai CSS3DObject yang bisa digeser ----

const POSITIONS_KEY = 'ca.workspaceCardPositions';
const GRID = { gap: 20, padding: 24 };
const DRAG_THRESHOLD = 4;
const NARROW_QUERY = '(max-width: 640px)';
const STAGE_BOTTOM_GAP = 15;

const stageRef = ref<HTMLElement | null>(null);
const sourceRef = ref<HTMLElement | null>(null);
const cardEls = new Map<string, HTMLElement>();
const stageActive = ref(false);

let scene: Scene | null = null;
let camera: OrthographicCamera | null = null;
let renderer: CSS3DRenderer | null = null;
let resizeObserver: ResizeObserver | null = null;
let narrowMedia: MediaQueryList | null = null;
const objects = new Map<string, CSS3DObject>();
const positions = new Map<string, NormalizedPoint>();
let topZ = 1;
const cleanups: (() => void)[] = [];

function setCardRef(key: string, el: unknown): void {
  if (el instanceof HTMLElement) cardEls.set(key, el);
  else cardEls.delete(key);
}

function readSaved(): Record<string, NormalizedPoint> {
  try {
    const raw = window.localStorage.getItem(POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, NormalizedPoint>) : {};
  } catch {
    return {};
  }
}

function savePositions(): void {
  try {
    window.localStorage.setItem(POSITIONS_KEY, JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // penyimpanan tidak tersedia; posisi hanya berlaku pada kunjungan ini
  }
}

function stageSize(): { width: number; height: number } {
  const el = stageRef.value;
  return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
}

function cardSize(key: string): CardSize {
  const el = cardEls.get(key);
  return { width: el?.offsetWidth ?? 0, height: el?.offsetHeight ?? 0 };
}

function render(): void {
  if (renderer && scene && camera) renderer.render(scene, camera);
}

/** Terapkan posisi ternormalisasi ke objek (dibatasi agar tetap di panggung), lalu render. */
function applyPositions(): void {
  const stage = stageSize();
  for (const [key, object] of objects) {
    const point = positions.get(key);
    if (!point) continue;
    const px = clampToStage(point, stage, cardSize(key));
    object.position.x = px.x;
    object.position.y = px.y;
  }
  render();
}

/** Samakan tinggi semua kartu dengan kartu tertinggi (lebar sudah sama, 300px). */
function equalizeHeights(): void {
  const els = cards.value.map((c) => cardEls.get(c.key)).filter((el): el is HTMLElement => !!el);
  for (const el of els) el.style.height = '';
  const tallest = Math.max(0, ...els.map((el) => el.offsetHeight));
  for (const el of els) el.style.height = `${tallest}px`;
}

function fitStageHeight(): void {
  const stage = stageRef.value;
  if (!stage) return;
  const keys = cards.value.map((c) => c.key);
  const needed = gridHeight(stage.clientWidth, keys.map(cardSize), GRID);
  // Isi sisa tinggi layar sampai bawah halaman, menyisakan 15px di bawah.
  const scroller = stage.closest<HTMLElement>('.shell__main');
  const top = stage.getBoundingClientRect().top + window.scrollY + (scroller?.scrollTop ?? 0);
  const available = window.innerHeight - top - STAGE_BOTTOM_GAP;
  stage.style.minHeight = `${Math.max(needed, available, 520)}px`;
}

function onWindowResize(): void {
  if (!stageActive.value) return;
  fitStageHeight();
  onResize();
}

function resetLayout(): void {
  if (!stageActive.value) return;
  const keys = cards.value.map((c) => c.key);
  const layout = gridLayout(stageSize(), keys.map(cardSize), GRID);
  keys.forEach((key, index) => positions.set(key, layout[index]!));
  savePositions();
  applyPositions();
}

function onResize(): void {
  const stage = stageSize();
  if (!renderer || !camera || stage.width === 0) return;
  camera.left = -stage.width / 2;
  camera.right = stage.width / 2;
  camera.top = stage.height / 2;
  camera.bottom = -stage.height / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.width, stage.height);
  applyPositions();
}

function bringToFront(key: string): void {
  const object = objects.get(key);
  if (!object) return;
  topZ += 1;
  object.position.z = topZ;
  object.element.style.zIndex = String(topZ);
}

function moveBy(key: string, dx: number, dy: number): void {
  const object = objects.get(key);
  if (!object) return;
  const stage = stageSize();
  const px = clampToStage(
    {
      x: (object.position.x + dx) / stage.width,
      y: (object.position.y - dy) / stage.height,
    },
    stage,
    cardSize(key),
  );
  object.position.x = px.x;
  object.position.y = px.y;
  positions.set(key, { x: px.x / stage.width, y: px.y / stage.height });
  render();
}

function attachInteractions(key: string, el: HTMLElement): void {
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let travelled = 0;
  let dragging = false;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    travelled = 0;
    dragging = false;
    bringToFront(key);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    travelled += Math.abs(dx) + Math.abs(dy);
    if (!dragging && travelled < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      el.setPointerCapture(event.pointerId);
      el.classList.add('landing-card--dragging');
    }
    moveBy(key, dx, dy);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    if (dragging) {
      el.classList.remove('landing-card--dragging');
      savePositions();
    }
  };
  // Setelah menggeser, klik pada tombol tidak boleh ikut berpindah halaman.
  const onClick = (event: MouseEvent) => {
    if (dragging) {
      event.preventDefault();
      event.stopPropagation();
      dragging = false;
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== el) return;
    const step = event.shiftKey ? 48 : 16;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    bringToFront(key);
    moveBy(key, move[0], move[1]);
    savePositions();
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('click', onClick, true);
  el.addEventListener('keydown', onKeyDown);
  cleanups.push(() => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('click', onClick, true);
    el.removeEventListener('keydown', onKeyDown);
  });
}

function setupStage(): void {
  const stage = stageRef.value;
  if (!stage || stageActive.value || cards.value.length === 0) return;
  equalizeHeights();
  fitStageHeight();
  const size = stageSize();

  scene = new Scene();
  camera = new OrthographicCamera(
    -size.width / 2,
    size.width / 2,
    size.height / 2,
    -size.height / 2,
    -1000,
    1000,
  );
  camera.position.z = 500;
  renderer = new CSS3DRenderer();
  renderer.setSize(size.width, size.height);
  renderer.domElement.classList.add('landing-stage__renderer');
  stage.appendChild(renderer.domElement);
  stageActive.value = true;

  const saved = readSaved();
  const keys = cards.value.map((c) => c.key);
  const layout = gridLayout(size, keys.map(cardSize), GRID);
  keys.forEach((key, index) => {
    const el = cardEls.get(key);
    if (!el) return;
    const object = new CSS3DObject(el);
    objects.set(key, object);
    scene!.add(object);
    positions.set(key, saved[key] ?? layout[index]!);
    attachInteractions(key, el);
  });
  applyPositions();

  resizeObserver = new ResizeObserver(() => onResize());
  resizeObserver.observe(stage);
  window.addEventListener('resize', onWindowResize);
  // Petunjuk dan tombol atur ulang baru muncul setelah panggung aktif sehingga panggung
  // bergeser ke bawah; hitung ulang tinggi setelah DOM diperbarui.
  void nextTick(() => {
    fitStageHeight();
    onResize();
  });
}

/** Kembalikan kartu ke wadah sumber Vue agar Vue tetap bisa memperbarui/melepasnya. */
function teardownStage(): void {
  resizeObserver?.disconnect();
  window.removeEventListener('resize', onWindowResize);
  resizeObserver = null;
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const object of objects.values()) {
    scene?.remove(object);
    const el = object.element;
    el.style.transform = '';
    el.style.position = '';
    el.style.zIndex = '';
    el.style.pointerEvents = '';
    el.style.userSelect = '';
    el.style.height = '';
    sourceRef.value?.appendChild(el);
  }
  objects.clear();
  renderer?.domElement.remove();
  renderer = null;
  scene = null;
  camera = null;
  stageActive.value = false;
  if (stageRef.value) stageRef.value.style.minHeight = '';
}

function syncStageMode(): void {
  if (narrowMedia?.matches) teardownStage();
  else setupStage();
}

watch(
  () => cards.value.map((c) => c.key).join(','),
  async () => {
    teardownStage();
    await nextTick();
    syncStageMode();
  },
);

onMounted(async () => {
  await nextTick();
  narrowMedia = window.matchMedia(NARROW_QUERY);
  narrowMedia.addEventListener('change', syncStageMode);
  syncStageMode();
});

onBeforeUnmount(() => {
  narrowMedia?.removeEventListener('change', syncStageMode);
  teardownStage();
});
</script>

<template>
  <section class="landing">
    <CaPageHeader
      :title="t('workspace.landing.title')"
      :description="t('workspace.landing.subtitle')"
    >
      <template v-if="stageActive" #actions>
        <CaButton size="small" variant="subtle" @click="resetLayout">
          {{ t('workspace.landing.resetLayout') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="stageActive" class="landing__hint">{{ t('workspace.landing.dragHint') }}</p>

    <div ref="stageRef" class="landing-stage" :class="{ 'landing-stage--active': stageActive }">
      <!-- Latar ASCII beranimasi dengan riak air saat kursor bergerak; di bawah kartu. -->
      <AsciiRippleBackground v-if="stageActive" />
      <!-- Wadah sumber: kartu dirender Vue di sini lalu dipindahkan ke panggung three.js. -->
      <div ref="sourceRef" class="landing-stage__source">
        <div
          v-for="card in cards"
          :key="card.key"
          :ref="(el) => setCardRef(card.key, el)"
          class="landing-card"
          :tabindex="stageActive ? 0 : undefined"
          :aria-label="
            stageActive ? t('workspace.landing.cardMoveLabel', { name: card.title }) : undefined
          "
        >
          <CaCard class="landing-card__inner">
            <template #header>
              <span class="landing__icon" aria-hidden="true">
                <CaIcon :name="card.icon" :size="22" />
              </span>
              <h3 class="ca-card__title">{{ card.title }}</h3>
              <p class="ca-card__subtitle">{{ card.description }}</p>
            </template>
            <template #footer>
              <CaButton :variant="card.variant" :to="card.to">{{ card.action }}</CaButton>
            </template>
          </CaCard>
        </div>
      </div>
    </div>

    <p v-if="!hasModes" class="landing__empty">
      {{ t('workspace.landing.noAccess') }}
    </p>
  </section>
</template>

<style scoped>
.landing__hint {
  margin: 0 0 var(--ca-space-4);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.landing-stage {
  position: relative;
}

.landing-stage--active {
  min-height: 520px;
  border: 1px dashed var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-canvas);
  overflow: hidden;
}

/* Tanpa panggung (layar sempit), kartu disusun biasa dengan lebar yang sama. */
.landing-stage__source {
  display: grid;
  grid-auto-rows: 1fr;
  grid-template-columns: repeat(auto-fill, 300px);
  justify-content: center;
  gap: var(--ca-space-5);
}

.landing-stage--active .landing-stage__source {
  display: none;
}

.landing-stage :deep(.landing-stage__renderer) {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.landing-card {
  width: 300px;
  box-sizing: border-box;
}

.landing-stage--active .landing-card {
  cursor: grab;
  touch-action: none;
  border-radius: var(--ca-radius-xl);
  transition: box-shadow var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.landing-stage--active .landing-card:focus-visible {
  outline: 2px solid var(--ca-color-brand);
  outline-offset: 3px;
}

.landing-card--dragging {
  cursor: grabbing !important;
  box-shadow: var(--ca-shadow-16);
}

.landing-card__inner {
  height: 100%;
}

.landing__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--ca-radius-lg);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand);
  margin-bottom: var(--ca-space-3);
}

.landing__empty {
  color: var(--ca-fg-2);
  font-size: var(--ca-text-300);
}

@media (max-width: 640px) {
  .landing-stage__source {
    grid-template-columns: minmax(0, 1fr);
  }

  .landing-card {
    width: 100%;
  }
}
</style>
