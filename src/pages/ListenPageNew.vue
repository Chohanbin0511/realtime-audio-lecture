<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Calendar,
  Briefcase,
  BookOpen,
  Clock,
  MapPin,
  User,
  Bookmark,
  Globe,
} from 'lucide-vue-next'
import { loadLastBroadcastSession } from '@/utils/recordingSessionStore'
import type { StoredBroadcastSession } from '@/utils/recordingSessionStore'
import { formatOffsetSec } from '@/utils/formatMediaTime'
import { useSubtitleChannel } from '@/composables/useSubtitleChannel'
import type { SubtitleMessage } from '@/composables/useSubtitleChannel'
import { useLiveAudioChannel } from '@/composables/useLiveAudioChannel'
import { isBroadcastLive } from '@/utils/broadcastLiveFlag'

type ListenShell = 'before' | 'empty' | 'live'

interface TranscriptRow {
  text: string
  offsetSec?: number
}

const route = useRoute()
const router = useRouter()

const shell = ref<ListenShell>('before')

// ── 저장된 세션 (IndexedDB) ──────────────────────────────────────────
const storedSession = ref<StoredBroadcastSession | null>(null)
const audioUrl = ref<string | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadStoredSession() {
  try {
    const s = await loadLastBroadcastSession()
    storedSession.value = s
    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value)
      audioUrl.value = null
    }
    if (s?.buffer?.byteLength) {
      const blob = new Blob([s.buffer], { type: s.mimeType || 'audio/wav' })
      audioUrl.value = URL.createObjectURL(blob)
    }
  } catch {
    storedSession.value = null
  }
}

function startPolling() {
  if (pollTimer !== null) return
  pollTimer = setInterval(() => { void loadStoredSession() }, 5000)
}

function stopPolling() {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
}

// ── BroadcastChannel 실시간 수신 (listener) ──────────────────────────
const { messages: liveMsgs } = useSubtitleChannel({ role: 'listener' })

/** 다른 탭에서 마이크 방송 중 (localStorage 동기화) */
const broadcastLiveRef = ref(false)

function refreshBroadcastLiveFlag() {
  broadcastLiveRef.value = isBroadcastLive()
}

/** 방송 탭에서 자막이 온 적 있음 */
const hasLiveSubtitles = computed(() => liveMsgs.value.length > 0)

/** 방송 중 UI: 마이크 라이브 또는 실시간 자막 */
const isLiveBroadcast = computed(
  () => broadcastLiveRef.value || hasLiveSubtitles.value,
)

/** 라이브 세션 경과(초) — 방송 시작 시각 기준 */
const sessionStartedAtMs = ref<number | null>(null)
const liveElapsedSec = ref(0)
let liveElapsedTimer: ReturnType<typeof setInterval> | null = null

function startLiveElapsedTicker() {
  if (liveElapsedTimer !== null) return
  liveElapsedTimer = setInterval(() => {
    if (sessionStartedAtMs.value === null) {
      liveElapsedSec.value = 0
      return
    }
    liveElapsedSec.value = Math.max(
      0,
      (Date.now() - sessionStartedAtMs.value) / 1000,
    )
  }, 500)
}

function stopLiveElapsedTicker() {
  if (liveElapsedTimer !== null) {
    clearInterval(liveElapsedTimer)
    liveElapsedTimer = null
  }
}

const liveElapsedLabel = computed(() => formatOffsetSec(liveElapsedSec.value))

const {
  liveAudioSrc,
  liveAudioError,
  bindAudioElement,
} = useLiveAudioChannel({
  role: 'listener',
  onSessionStart: (startedAt) => {
    sessionStartedAtMs.value = startedAt
    startLiveElapsedTicker()
  },
})

const liveAudioRef = ref<HTMLAudioElement | null>(null)
watchEffect(() => {
  bindAudioElement(liveAudioRef.value)
})

// ── 라우트 동기화 ────────────────────────────────────────────────────
function parseMode(q: unknown): ListenShell | null {
  if (q === 'before' || q === 'empty' || q === 'live') return q
  return null
}

function syncFromRoute() {
  const m = parseMode(route.query.mode)
  if (m) shell.value = m
}

let broadcastPollTimer: ReturnType<typeof setInterval> | null = null

function onWindowStorage(e: StorageEvent) {
  if (e.key === 'wowza-broadcast-live') refreshBroadcastLiveFlag()
}

onMounted(() => {
  syncFromRoute()
  refreshBroadcastLiveFlag()
  window.addEventListener('storage', onWindowStorage)
  window.addEventListener('focus', refreshBroadcastLiveFlag)
  broadcastPollTimer = setInterval(refreshBroadcastLiveFlag, 1500)
  if (shell.value === 'live') {
    void loadStoredSession()
    startPolling()
  }
})

watch(() => route.query.mode, syncFromRoute)

watch(shell, (v) => {
  if (v === 'live') {
    void loadStoredSession()
    startPolling()
  } else {
    stopPolling()
  }
})

/** 방송 중이면 실시간 강의 화면은 항상 「수업 중」 */
watch(
  broadcastLiveRef,
  (live) => {
    if (live) {
      if (shell.value !== 'live') setShell('live')
      if (sessionStartedAtMs.value === null) {
        sessionStartedAtMs.value = Date.now()
        startLiveElapsedTicker()
      }
    } else {
      stopLiveElapsedTicker()
      sessionStartedAtMs.value = null
      liveElapsedSec.value = 0
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('storage', onWindowStorage)
  window.removeEventListener('focus', refreshBroadcastLiveFlag)
  if (broadcastPollTimer !== null) {
    clearInterval(broadcastPollTimer)
    broadcastPollTimer = null
  }
  stopLiveElapsedTicker()
  stopPolling()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})

function setShell(next: ListenShell) {
  shell.value = next
  router.replace({ path: route.path, query: { ...route.query, mode: next } })
}

// ── 자막 행 계산 ─────────────────────────────────────────────────────
const transcriptRows = computed((): TranscriptRow[] => {
  // 방송 중(BroadcastChannel로 자막이 들어오는 중)
  if (broadcastLiveRef.value || hasLiveSubtitles.value) {
    return liveMsgs.value.map((m: SubtitleMessage) => ({
      text: m.text,
      offsetSec: m.offsetSec,
    }))
  }
  // 방송 종료 후 저장된 세션
  const segs = storedSession.value?.segments
  if (segs && segs.length > 0) {
    return segs.map((m) => ({ text: m.text, offsetSec: m.offsetSec }))
  }
  // 둘 다 없으면 데모
  return transcriptDemo
})

/** 오디오가 로드된 경우에만 seek 가능 (라이브 방송·실시간 자막 중에는 비활성) */
const canSeek = computed(
  () =>
    !!audioUrl.value &&
    !broadcastLiveRef.value &&
    !hasLiveSubtitles.value,
)

function timeLabel(row: TranscriptRow): string {
  return formatOffsetSec(row.offsetSec ?? 0)
}

function onTranscriptRowClick(row: TranscriptRow) {
  if (!canSeek.value || row.offsetSec === undefined) return
  const a = audioEl.value
  if (!a) return
  a.currentTime = row.offsetSec
  void a.play().catch(() => {})
}

// ── 더미 데이터 ──────────────────────────────────────────────────────
const recentClasses = [
  {
    title: '데이터 사이언스 개론',
    subtitle: '데이터 사이언티스트는 무슨 일을 하게 될까?',
    when: '2026년 05월 29일 (수) 13:00',
    place: '과학관 304호',
    prof: '김태진 교수님',
  },
  {
    title: '머신러닝의 기초',
    subtitle: '지도학습과 비지도학습',
    when: '2026년 06월 03일 (화) 10:00',
    place: '공학관 201호',
    prof: '이수연 교수님',
  },
]

const transcriptDemo: TranscriptRow[] = [
  { offsetSec: 3805, text: '오늘은 지도학습의 대표적인 예시인 회귀와 분류를 살펴보겠습니다.' },
  { offsetSec: 3842, text: '먼저 손실 함수를 정의하고, 경사 하강법으로 가중치를 갱신합니다.' },
  { offsetSec: 3918, text: '과적합을 막기 위해 드롭아웃과 정규화를 함께 쓰는 경우가 많습니다.' },
]

const liveCourse = {
  title: '머신러닝의 기초',
  prof: '강화영 교수님',
  room: '공학관 302호',
}
</script>

<template>
  <div class="listen-student">
    <div class="listen-inner">
      <div class="listen-shell-switch" role="tablist" aria-label="화면 상태(데모)">
        <button
          type="button"
          role="tab"
          :class="{ 'is-active': shell === 'before' }"
          :disabled="broadcastLiveRef"
          :title="broadcastLiveRef ? '방송 중에는 수업 중 화면만 사용할 수 있습니다' : undefined"
          @click="setShell('before')"
        >
          수업 전
        </button>
        <button
          type="button"
          role="tab"
          :class="{ 'is-active': shell === 'empty' }"
          :disabled="broadcastLiveRef"
          :title="broadcastLiveRef ? '방송 중에는 수업 중 화면만 사용할 수 있습니다' : undefined"
          @click="setShell('empty')"
        >
          수업 없음
        </button>
        <button
          type="button"
          role="tab"
          :class="{ 'is-active': shell === 'live' }"
          @click="setShell('live')"
        >
          수업 중
        </button>
      </div>

      <template v-if="shell === 'before'">
        <div class="listen-notice">
          <div class="listen-notice-icon" aria-hidden="true">
            <Calendar class="h-14 w-14" stroke-width="1.25" />
          </div>
          <p class="listen-notice-title">현재 수업 시간이 아닙니다.</p>
          <p class="listen-notice-desc">
            수업이 시작되면 교수님의 강의 내용이 실시간으로 보여집니다.
          </p>
        </div>

        <h2 class="listen-section-title">최근 수업 목록</h2>
        <div class="listen-class-list">
          <div
            v-for="(c, i) in recentClasses"
            :key="i"
            class="listen-class-card"
          >
            <div class="listen-class-card-ic">
              <BookOpen class="h-5 w-5" stroke-width="2" />
            </div>
            <div class="listen-class-card-body">
              <p class="listen-class-card-title">{{ c.title }}</p>
              <p class="listen-class-card-sub">{{ c.subtitle }}</p>
              <div class="listen-class-card-meta">
                <span class="listen-meta-row">
                  <Clock class="h-3 w-3" />
                  {{ c.when }}
                </span>
                <span class="listen-meta-row">
                  <MapPin class="h-3 w-3" />
                  {{ c.place }}
                </span>
                <span class="listen-meta-row">
                  <User class="h-3 w-3" />
                  {{ c.prof }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="shell === 'empty'">
        <div class="listen-empty">
          <div class="listen-empty-icon" aria-hidden="true">
            <Briefcase class="h-16 w-16" stroke-width="1.25" />
          </div>
          <p class="listen-empty-title">등록된 실시간 강의 수업이 없습니다.</p>
          <p class="listen-empty-desc">
            수강 신청 내역에서 확인된 수업이 없습니다. 학사 일정을 확인한 뒤 다시
            이용해 주세요.
          </p>
        </div>
      </template>

      <template v-else>
        <header class="listen-live-head">
          <div>
            <h1 class="listen-live-title">{{ liveCourse.title }}</h1>
            <div class="listen-live-meta">
              <span>
                <User class="h-4 w-4" />
                {{ liveCourse.prof }}
              </span>
              <span>
                <MapPin class="h-4 w-4" />
                {{ liveCourse.room }}
              </span>
            </div>
          </div>
          <div class="listen-live-head-right">
            <span v-if="broadcastLiveRef" class="listen-live-elapsed" aria-live="polite">
              <Clock class="h-3.5 w-3.5" />
              경과 {{ liveElapsedLabel }}
            </span>
            <!-- 방송 중 표시 -->
            <span v-if="isLiveBroadcast" class="listen-live-badge">
              <span class="listen-live-dot" />
              방송 중
            </span>
            <button type="button" class="listen-live-head-btn">
              <Globe class="h-4 w-4" />
              동시통역
            </button>
          </div>
        </header>

        <div class="listen-live-grid">
          <div>
            <div class="listen-transcript-panel">
              <div class="listen-transcript-head">
                {{ isLiveBroadcast ? '실시간 자막 (방송 중)' : '실시간 자막 · 녹취' }}
              </div>
              <div class="listen-transcript-scroll">
                <div
                  v-if="transcriptRows.length === 0"
                  class="listen-transcript-empty"
                >
                  자막 대기 중...
                </div>
                <div
                  v-for="(row, i) in transcriptRows"
                  :key="i"
                  class="listen-transcript-row"
                  :class="{ 'listen-transcript-row--seekable': canSeek && row.offsetSec !== undefined }"
                  :tabindex="canSeek && row.offsetSec !== undefined ? 0 : -1"
                  :role="canSeek && row.offsetSec !== undefined ? 'button' : undefined"
                  @click="onTranscriptRowClick(row)"
                  @keydown.enter.prevent="onTranscriptRowClick(row)"
                  @keydown.space.prevent="onTranscriptRowClick(row)"
                >
                  <span class="listen-ts">
                    <Clock class="h-3 w-3" />
                    {{ timeLabel(row) }}
                  </span>
                  <p class="listen-transcript-text">{{ row.text }}</p>
                  <Bookmark class="listen-bookmark h-5 w-5" stroke-width="1.5" />
                </div>
              </div>
            </div>

            <div class="listen-audio-shell">
              <p class="listen-audio-label">
                <template v-if="broadcastLiveRef">
                  실시간 방송 오디오 (다른 탭에서 녹음 중일 때 재생됩니다)
                </template>
                <template v-else-if="audioUrl">
                  방송에서 저장한 녹음 — 자막을 클릭하면 해당 시간으로 이동합니다
                </template>
                <template v-else>
                  녹음 재생 (방송 종료 후 자동 저장)
                </template>
              </p>
              <audio
                v-if="broadcastLiveRef && liveAudioSrc"
                ref="liveAudioRef"
                class="listen-audio-player"
                controls
                playsinline
                :src="liveAudioSrc"
              />
              <p v-else-if="broadcastLiveRef && liveAudioError" class="listen-live-audio-err">
                {{ liveAudioError }}
              </p>
              <p v-else-if="broadcastLiveRef" class="listen-live-audio-wait">
                라이브 오디오 연결 중… (방송 탭에서 마이크를 시작했는지 확인하세요)
              </p>
              <audio
                v-else-if="audioUrl"
                ref="audioEl"
                class="listen-audio-player"
                controls
                :src="audioUrl"
              />
              <div
                v-else
                class="listen-audio-placeholder"
                aria-hidden="true"
              />
            </div>
          </div>

          <aside class="listen-ai-panel">
            <div class="listen-ai-pill">Live 학습 Assistant</div>
            <div class="listen-ai-body">
              <div class="listen-ai-block">
                <span class="listen-ai-tag">AI 추천</span>
                <p class="listen-ai-term">머신러닝</p>
                <p class="listen-ai-desc">
                  데이터로부터 패턴을 학습해 예측·분류 등에 활용하는 알고리즘
                  총칭입니다.
                </p>
                <div class="listen-ai-sources">
                  <span class="listen-ai-source">출처 부산대학교 자료실</span>
                </div>
              </div>
              <div class="listen-ai-block">
                <span class="listen-ai-tag">AI 추천</span>
                <p class="listen-ai-term">지도학습</p>
                <p class="listen-ai-desc">
                  정답 레이블이 있는 데이터로 학습하는 방식입니다.
                </p>
                <div class="listen-ai-sources">
                  <span class="listen-ai-source">국회 논문 DB</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss" src="@/styles/pages/listen-student.scss"></style>
