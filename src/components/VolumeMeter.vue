<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(
  defineProps<{
    level?: number
    isSilent?: boolean
    waveOnly?: boolean
  }>(),
  { level: 0, isSilent: false, waveOnly: false }
)

const canvas = ref<HTMLCanvasElement | null>(null)
let rafId: number | null = null
let smoothLevel = 0

interface Ring {
  r: number
  opacity: number
  speed: number
  born: number
}

const rings: Ring[] = []
let lastSpawnTime = 0

function spawnRing(now: number, vol: number) {
  if (vol < 2) return
  const minGap = Math.max(60, 300 - vol * 2.5)
  if (now - lastSpawnTime < minGap) return
  lastSpawnTime = now
  rings.push({ r: 0, opacity: 0.85, speed: 1.2 + vol * 0.04, born: now })
}

function getColor(vol: number): string {
  if (vol > 80) return '#f87171'
  if (vol > 50) return '#facc15'
  return '#38bdf8'
}

function draw(now: number) {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return

  const W = c.width
  const H = c.height
  const cx = W / 2
  const cy = H / 2

  ctx.clearRect(0, 0, W, H)

  const vol = smoothLevel
  spawnRing(now, vol)

  // 퍼져나가는 링
  for (let i = rings.length - 1; i >= 0; i--) {
    const ring = rings[i]
    ring.r += ring.speed
    ring.opacity -= 0.012

    if (ring.opacity <= 0 || ring.r > cx * 1.5) {
      rings.splice(i, 1)
      continue
    }

    const color = getColor(vol)
    ctx.beginPath()
    ctx.arc(cx, cy, ring.r, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.globalAlpha = ring.opacity
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // 중심 글로우 원 (음량에 따라 크기 변화)
  const coreR = 10 + vol * 0.28
  const color = getColor(vol)

  // 외곽 글로우
  for (let g = 3; g >= 1; g--) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR + g * 10)
    grad.addColorStop(0, color + 'aa')
    grad.addColorStop(1, color + '00')
    ctx.beginPath()
    ctx.arc(cx, cy, coreR + g * 10, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
  }

  // 중심 원
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
  coreGrad.addColorStop(0, '#fff')
  coreGrad.addColorStop(0.4, color)
  coreGrad.addColorStop(1, color + '88')
  ctx.beginPath()
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
  ctx.fillStyle = coreGrad
  ctx.fill()

  // 무음 표시 (회색 링)
  if (props.isSilent) {
    ctx.beginPath()
    ctx.arc(cx, cy, coreR + 6, 0, Math.PI * 2)
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.6
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  rafId = requestAnimationFrame(draw)
}

function loop(now: number) {
  // 볼륨 스무딩
  const target = props.isSilent ? 0 : props.level
  smoothLevel += (target - smoothLevel) * 0.15
  draw(now)
  rafId = requestAnimationFrame(loop)
}

onMounted(() => {
  rafId = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="volume-meter">
    <canvas ref="canvas" class="wave-canvas" :width="140" :height="140" />
    <div v-if="!waveOnly" class="side">
      <div class="bars">
        <div
          v-for="i in 16"
          :key="i"
          class="bar"
          :style="{
            background: level > ((i - 1) / 16) * 100
              ? (i < 10 ? '#38bdf8' : i < 14 ? '#facc15' : '#f87171')
              : 'rgba(255,255,255,0.08)',
          }"
        />
      </div>
      <span class="label" :class="{ silent: isSilent }">
        {{ isSilent ? '무음' : `${level}%` }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.volume-meter {
  display: flex;
  align-items: center;
  gap: 14px;
}
.wave-canvas {
  display: block;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
}
.side {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bars {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  height: 24px;
}
.bar {
  width: 6px;
  height: 100%;
  border-radius: 2px;
  transition: background 0.06s;
}
.label {
  font-size: 11px;
  color: #94a3b8;
  min-width: 32px;
}
.label.silent {
  color: #f87171;
}
</style>
