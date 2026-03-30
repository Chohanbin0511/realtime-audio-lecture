<script setup lang="ts">
/**
 * AudioWaveformRecorder
 *
 * 상태 머신:
 *   idle ──[시작]──▶ recording ──[일시정지]──▶ paused ──[재개]──▶ recording
 *                 └──[완료]──▶ finished ◀──[완료]──┘
 *
 * - extendable-media-recorder: 브라우저 호환 + WAV 인코딩
 * - wavesurfer.js: 녹음 완료 후 파형 + 재생
 */

import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  MediaRecorder as ExtMediaRecorder,
  register,
} from 'extendable-media-recorder'
import { connect } from 'extendable-media-recorder-wav-encoder'
import WaveSurfer from 'wavesurfer.js'
import { Mic, Play, Pause, Download, RotateCcw, StopCircle } from 'lucide-vue-next'

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  noiseSuppression?: boolean
  echoCancellation?: boolean
  autoGainControl?: boolean
  waveColor?: string
  progressColor?: string
  accentColor?: string
}

const props = withDefaults(defineProps<Props>(), {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  waveColor: '#ff2d78',
  progressColor: '#ff6b9d',
  accentColor: '#ff2d78',
})

const emit = defineEmits<{
  (e: 'sttResult', payload: { text: string; offsetSec: number }): void
  (e: 'recorded', blob: Blob): void
  (e: 'recordingChange', value: boolean): void
  /** 실시간 청취 탭용 WebM/Opus 청크 (BroadcastChannel) */
  (e: 'liveAudioChunk', payload: { blob: Blob; mime: string; seq: number }): void
  (e: 'liveAudioEnd'): void
  /** STT 인식 중(미확정) 텍스트 */
  (e: 'sttInterim', text: string): void
  /** STT 상태 변화 */
  (e: 'sttStatus', status: 'active' | 'idle' | 'error' | 'unavailable'): void
}>()

// ── 상태 ──────────────────────────────────────────────────────────────────────
type RecState = 'idle' | 'recording' | 'paused' | 'finished'
const recState = ref<RecState>('idle')

const isPlaying  = ref(false)
const audioUrl   = ref<string | null>(null)
const errorMsg   = ref<string | null>(null)

const recordingTime = ref(0) // 일시정지 중에도 누적
const formattedTimeLong = computed(() => {
  const t = recordingTime.value
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
})

// ── DOM Refs ──────────────────────────────────────────────────────────────────
const waveformRef    = ref<HTMLDivElement | null>(null)
const canvasRef      = ref<HTMLCanvasElement | null>(null)
const canvasWrapRef  = ref<HTMLDivElement | null>(null)

// ── 내부 변수 ─────────────────────────────────────────────────────────────────
let mediaRecorder : InstanceType<typeof ExtMediaRecorder> | null = null
/** 실시간 청취용 (브라우저 네이티브 WebM — MediaSource 재생) */
let liveStreamRecorder: MediaRecorder | null = null
let liveChunkSeq = 0
let liveMime = ''
let stream        : MediaStream | null = null
let audioCtx      : AudioContext | null = null
let analyser      : AnalyserNode | null = null
let rafId         : number | null = null
let timerInterval : ReturnType<typeof setInterval> | null = null
let waveSurfer    : WaveSurfer | null = null
let chunks        : Blob[] = []
let mimeType      = 'audio/webm'
let wavEncoderReg = false
let ro            : ResizeObserver | null = null

/** 녹음 세션 기준 활성 경과(초). 일시정지 구간 제외 — 재생 파일 currentTime 과 맞춤 */
let sessionStartPerf = 0
let pauseStartPerf: number | null = null
let totalPausedMs = 0

function activeElapsedSec(): number {
  if (sessionStartPerf <= 0) return 0
  return Math.max(0, (performance.now() - sessionStartPerf - totalPausedMs) / 1000)
}

// ── STT ───────────────────────────────────────────────────────────────────────
interface ISpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}
interface ISpeechRecognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
  onresult: ((e: ISpeechRecognitionEvent) => void) | null
  onend:    (() => void) | null
  onerror:  ((e: Event) => void) | null
}
type SpeechRecognitionCtor = new () => ISpeechRecognition
let recognition: ISpeechRecognition | null = null

// ── WAV 인코더 ────────────────────────────────────────────────────────────────
async function ensureWavEncoder() {
  if (wavEncoderReg) return
  try { await register(await connect()) } catch { /* already registered */ }
  wavEncoderReg = true
}

// ── 캔버스 DPR 리사이즈 ───────────────────────────────────────────────────────
function resizeCanvas() {
  const canvas = canvasRef.value
  const wrap   = canvasWrapRef.value
  if (!canvas || !wrap) return

  const dpr = window.devicePixelRatio || 1
  const w   = wrap.clientWidth  || 300
  const h   = 72
  canvas.width  = w * dpr
  canvas.height = h * dpr
  canvas.style.width  = '100%'
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

onMounted(() => {
  nextTick(() => {
    resizeCanvas()
    if (canvasWrapRef.value && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => resizeCanvas())
      ro.observe(canvasWrapRef.value)
    }
  })
})

// ── 파형 그리기 ───────────────────────────────────────────────────────────────
function drawBars(data: Uint8Array) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const W = canvas.width  / dpr
  const H = canvas.height / dpr
  ctx.clearRect(0, 0, W, H)

  const barCount = Math.max(10, Math.floor(W / 6))
  const gap      = 2
  const barW     = (W - gap * (barCount - 1)) / barCount
  const step     = Math.max(1, Math.floor(data.length / barCount))

  const hex = props.accentColor.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) || 255
  const g = parseInt(hex.slice(2, 4), 16) || 45
  const b = parseInt(hex.slice(4, 6), 16) || 120

  // 일시정지 중 희미하게
  const dimmed = recState.value === 'paused'

  for (let i = 0; i < barCount; i++) {
    const value = data[i * step] / 255
    const barH  = Math.max(2, value * H * 0.9)
    const alpha = dimmed ? 0.25 : (0.35 + value * 0.65)
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
    ctx.beginPath()
    const x = i * (barW + gap)
    if (ctx.roundRect) {
      ctx.roundRect(x, H - barH, Math.max(barW, 2), barH, 2)
    } else {
      ctx.rect(x, H - barH, Math.max(barW, 2), barH)
    }
    ctx.fill()
  }
}

let lastData: Uint8Array = new Uint8Array(128)

function startVolumeLoop() {
  if (!analyser) return
  const data = new Uint8Array(analyser.frequencyBinCount)
  lastData = data

  const tick = () => {
    if (!analyser) return
    analyser.getByteFrequencyData(data)
    drawBars(data)
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopVolumeLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  // 일시정지 상태 표시용 — 마지막 데이터를 희미하게 한 번 더 그림
  drawBars(lastData)
}

// ── 타이머 ────────────────────────────────────────────────────────────────────
function startTimer() {
  if (timerInterval !== null) return
  timerInterval = setInterval(() => { recordingTime.value++ }, 1000)
}

function pauseTimer() {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null }
}

// ── STT ───────────────────────────────────────────────────────────────────────
let sttRestartCount = 0

function startStt() {
  const Ctor = (
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition
  )
  if (!Ctor) {
    emit('sttStatus', 'unavailable')
    return
  }
  sttRestartCount = 0
  const rec = new Ctor()
  recognition = rec
  rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true

  rec.onresult = (e: ISpeechRecognitionEvent) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) {
        const text = r[0].transcript.trim()
        if (text) {
          emit('sttResult', { text, offsetSec: activeElapsedSec() })
          emit('sttInterim', '')
        }
      } else {
        interim += r[0].transcript
      }
    }
    if (interim) emit('sttInterim', interim)
    emit('sttStatus', 'active')
  }

  rec.onend = () => {
    if (recState.value === 'recording' && sttRestartCount < 20) {
      sttRestartCount++
      rec.start()
    } else if (recState.value !== 'recording') {
      emit('sttStatus', 'idle')
    }
  }

  rec.onerror = (e: Event) => {
    const errName = (e as ErrorEvent & { error?: string }).error ?? (e as ErrorEvent).message ?? 'unknown'
    if (errName === 'no-speech') {
      // 무음 — 정상, 재시작
      return
    }
    if (errName === 'not-allowed' || errName === 'service-not-allowed') {
      emit('sttStatus', 'error')
      recognition = null
      return
    }
    if (errName === 'network' || errName === 'service-not-available') {
      emit('sttStatus', 'error')
      return
    }
    // aborted 등 나머지는 onend 에서 재시작 처리
  }

  rec.start()
  emit('sttStatus', 'active')
}

function stopStt() {
  recognition?.stop()
  recognition = null
  emit('sttStatus', 'idle')
  emit('sttInterim', '')
}

const NO_INPUT_DEVICES = 'NO_INPUT_DEVICES'

function formatMicError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  const raw = e instanceof Error ? e.message : String(e)
  if (e instanceof Error && e.message === NO_INPUT_DEVICES) {
    return (
      '브라우저가 마이크 입력 장치를 하나도 찾지 못했습니다. '
      + '장치 관리자에서 마이크가 비활성화되지 않았는지, '
      + 'Windows 설정 → 개인 정보 보호 및 보안 → 마이크 에서 데스크톱 앱 마이크 접근이 켜져 있는지 확인해 주세요.'
    )
  }
  if (name === 'NotFoundError' || /not\s*found/i.test(raw)) {
    return (
      '마이크를 찾을 수 없습니다. 마이크·헤드셋 연결을 확인하고, '
      + 'Windows 설정 → 시스템 → 소리 → 입력 에서 입력 장치를 선택하거나 테스트해 보세요. '
      + '설정 → 개인 정보 보호 → 마이크 에서 Chrome/Edge 등 브라우저가 마이크를 쓸 수 있게 허용했는지도 확인해 주세요. '
      + `(기술 정보: ${raw})`
    )
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return `마이크 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요. (${raw})`
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `마이크를 사용할 수 없습니다. 다른 앱(Zoom 등)이 마이크를 점유 중인지 확인해 주세요. (${raw})`
  }
  return `마이크 접근 실패: ${raw}`
}

/**
 * 기본 장치만 실패하는 경우가 있어, enumerateDevices 로 잡힌 audioinput 마다 순서대로 시도합니다.
 * (sampleRate 같은 강한 제약은 넣지 않음)
 */
async function openMicStream(): Promise<MediaStream> {
  const withProcessing: MediaStreamConstraints = {
    audio: {
      noiseSuppression: props.noiseSuppression,
      echoCancellation: props.echoCancellation,
      autoGainControl: props.autoGainControl,
    },
  }

  let lastErr: unknown
  for (const get of [
    () => navigator.mediaDevices.getUserMedia(withProcessing),
    () => navigator.mediaDevices.getUserMedia({ audio: true }),
  ]) {
    try {
      return await get()
    } catch (e) {
      lastErr = e
    }
  }

  let devices: MediaDeviceInfo[] = []
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    throw lastErr
  }

  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId)
  if (inputs.length === 0) {
    const err = new Error(NO_INPUT_DEVICES)
    err.name = 'NotFoundError'
    throw err
  }

  for (const d of inputs) {
    const withDevice = (extra: Record<string, unknown>): MediaStreamConstraints => ({
      audio: {
        deviceId: { ideal: d.deviceId },
        ...extra,
      },
    })
    const attempts: MediaStreamConstraints[] = [
      withDevice({
        noiseSuppression: props.noiseSuppression,
        echoCancellation: props.echoCancellation,
        autoGainControl: props.autoGainControl,
      }),
      { audio: { deviceId: { ideal: d.deviceId } } },
      { audio: { deviceId: { exact: d.deviceId } } },
    ]
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints)
      } catch (e) {
        lastErr = e
      }
    }
  }

  throw lastErr
}

// ── 녹음 시작 ─────────────────────────────────────────────────────────────────
async function startRecording() {
  errorMsg.value = null
  recState.value = 'idle'
  recordingTime.value = 0

  // 이전 wavesurfer 정리
  waveSurfer?.destroy(); waveSurfer = null
  if (audioUrl.value) { URL.revokeObjectURL(audioUrl.value); audioUrl.value = null }

  await ensureWavEncoder()

  try {
    stream = await openMicStream()
  } catch (e) {
    errorMsg.value = formatMicError(e)
    return
  }

  /** getUserMedia에 sampleRate를 넣으면 일부 환경에서 NotFoundError(Requested device not found)가 납니다. */
  audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') await audioCtx.resume()
  const source = audioCtx.createMediaStreamSource(stream)
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75
  source.connect(analyser)

  mimeType = ExtMediaRecorder.isTypeSupported('audio/wav') ? 'audio/wav' : 'audio/webm;codecs=opus'
  chunks = []
  mediaRecorder = new ExtMediaRecorder(stream, { mimeType })

  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

  liveChunkSeq = 0
  liveMime =
    MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''
  if (liveMime && stream) {
    try {
      liveStreamRecorder = new MediaRecorder(stream, { mimeType: liveMime })
      liveStreamRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          emit('liveAudioChunk', { blob: e.data, mime: liveMime, seq: liveChunkSeq++ })
        }
      }
      liveStreamRecorder.start(250)
    } catch {
      liveStreamRecorder = null
    }
  }

  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType })
    audioUrl.value = URL.createObjectURL(blob)
    recState.value = 'finished'
    emit('recorded', blob)
    emit('recordingChange', false)
    setTimeout(initWaveSurfer, 80)
  }

  mediaRecorder.start(250)
  recState.value = 'recording'
  emit('recordingChange', true)

  sessionStartPerf = performance.now()
  totalPausedMs = 0
  pauseStartPerf = null

  startTimer()
  startStt()
  startVolumeLoop()

  await nextTick()
  resizeCanvas()
}

// ── 일시정지 ──────────────────────────────────────────────────────────────────
function pauseRecording() {
  if (recState.value !== 'recording') return
  if (mediaRecorder?.state === 'recording') mediaRecorder.pause()
  try {
    if (liveStreamRecorder?.state === 'recording') liveStreamRecorder.pause()
  } catch { /* ignore */ }
  pauseStartPerf = performance.now()
  pauseTimer()
  stopStt()
  stopVolumeLoop()
  recState.value = 'paused'
}

// ── 재개 ─────────────────────────────────────────────────────────────────────
function resumeRecording() {
  if (recState.value !== 'paused') return
  if (pauseStartPerf !== null) {
    totalPausedMs += performance.now() - pauseStartPerf
    pauseStartPerf = null
  }
  if (mediaRecorder?.state === 'paused') mediaRecorder.resume()
  try {
    if (liveStreamRecorder?.state === 'paused') liveStreamRecorder.resume()
  } catch { /* ignore */ }
  startTimer()
  startStt()
  startVolumeLoop()
  recState.value = 'recording'
}

// ── 완료 (녹음 종료 + Blob 생성) ─────────────────────────────────────────────
function stopLiveStreamRecorder() {
  if (liveStreamRecorder && liveStreamRecorder.state !== 'inactive') {
    try {
      liveStreamRecorder.stop()
    } catch { /* ignore */ }
  }
  liveStreamRecorder = null
}

function finishRecording() {
  stopStt()
  pauseTimer()
  stopVolumeLoop()

  stopLiveStreamRecorder()
  emit('liveAudioEnd')

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    // paused 상태에서 stop하면 이전 청크까지 포함
    if (mediaRecorder.state === 'paused') mediaRecorder.resume()
    setTimeout(() => mediaRecorder?.stop(), 50)
  }

  stream?.getTracks().forEach(t => t.stop())
  audioCtx?.close()
  stream = null; audioCtx = null; analyser = null
}

// ── 큰 원 버튼 ───────────────────────────────────────────────────────────────
function onMainBtnClick() {
  if      (recState.value === 'idle')      startRecording()
  else if (recState.value === 'recording') pauseRecording()
  else if (recState.value === 'paused')    resumeRecording()
}

// ── WaveSurfer ────────────────────────────────────────────────────────────────
function initWaveSurfer() {
  if (!waveformRef.value || !audioUrl.value) return
  waveSurfer?.destroy()
  waveSurfer = WaveSurfer.create({
    container     : waveformRef.value,
    waveColor     : props.waveColor,
    progressColor : props.progressColor,
    height: 80, barWidth: 2, barGap: 1, barRadius: 2,
    normalize: true, interact: true,
    cursorWidth: 2, cursorColor: 'rgba(255,255,255,0.3)',
  })
  waveSurfer.load(audioUrl.value)
  waveSurfer.on('play',   () => isPlaying.value = true)
  waveSurfer.on('pause',  () => isPlaying.value = false)
  waveSurfer.on('finish', () => isPlaying.value = false)
}

function togglePlayback() { waveSurfer?.playPause() }

// ── 다시 녹음 ─────────────────────────────────────────────────────────────────
function resetRecorder() {
  waveSurfer?.destroy(); waveSurfer = null
  if (audioUrl.value) { URL.revokeObjectURL(audioUrl.value); audioUrl.value = null }
  recState.value   = 'idle'
  isPlaying.value  = false
  recordingTime.value = 0
  errorMsg.value   = null
  sessionStartPerf = 0
  pauseStartPerf = null
  totalPausedMs = 0
  // 캔버스 초기화
  const canvas = canvasRef.value
  if (canvas) {
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
  }
}

// ── 다운로드 ─────────────────────────────────────────────────────────────────
function downloadAudio() {
  if (!audioUrl.value) return
  const a = document.createElement('a')
  a.href = audioUrl.value
  a.download = `recording-${Date.now()}.wav`
  a.click()
}

// ── 정리 ─────────────────────────────────────────────────────────────────────
onBeforeUnmount(() => {
  ro?.disconnect()
  if (recState.value === 'recording' || recState.value === 'paused') finishRecording()
  waveSurfer?.destroy()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})
</script>

<template>
  <div class="awr">
    <!-- 에러 -->
    <div v-if="errorMsg" class="awr-error">{{ errorMsg }}</div>

    <!-- ══ IDLE: 마이크 버튼 ══ -->
    <div v-if="recState === 'idle'" class="awr-center-wrap">
      <button
        type="button"
        class="awr-circle"
        :style="{ '--accent': accentColor }"
        aria-label="녹음 시작"
        @click="startRecording"
      >
        <Mic :size="52" stroke-width="1.8" />
      </button>
      <p class="awr-hint">준비되시면 녹음을 시작해 주세요</p>
    </div>

    <!-- ══ RECORDING / PAUSED ══ -->
    <div v-else-if="recState === 'recording' || recState === 'paused'" class="awr-live-wrap">
      <!-- 큰 원 버튼 (클릭 → 일시정지 / 재개) -->
      <div class="awr-pulse-ring" :class="{ paused: recState === 'paused' }" :style="{ '--accent': accentColor }">
        <button
          type="button"
          class="awr-circle"
          :style="{ '--accent': accentColor, opacity: recState === 'paused' ? '0.85' : '1' }"
          :aria-label="recState === 'recording' ? '일시정지' : '이어 녹음'"
          @click="onMainBtnClick"
        >
          <Pause v-if="recState === 'recording'" :size="42" fill="white" stroke="white" stroke-width="0" />
          <Mic   v-else :size="44" stroke-width="1.8" />
        </button>
      </div>

      <!-- 배지 -->
      <div
        class="awr-badge"
        :style="{ borderColor: accentColor, color: recState === 'paused' ? '#94a3b8' : accentColor }"
      >
        {{ recState === 'recording' ? '● 방송 녹음 중' : '⏸ 일시정지' }}
      </div>

      <!-- 타이머 -->
      <div class="awr-timer">{{ formattedTimeLong }}</div>

      <!-- 라이브 파형 캔버스 -->
      <div ref="canvasWrapRef" class="awr-canvas-wrap">
        <canvas ref="canvasRef" class="awr-canvas" />
      </div>

      <!-- 완료 버튼 -->
      <button
        type="button"
        class="awr-finish-btn"
        :style="{ '--accent': accentColor }"
        @click="finishRecording"
      >
        <StopCircle :size="18" />
        녹음 완료
      </button>
    </div>

    <!-- ══ FINISHED: 파형 미리듣기 ══ -->
    <div v-if="recState === 'finished'" class="awr-post-wrap">
      <p class="awr-post-label">녹음 미리듣기</p>
      <div ref="waveformRef" class="awr-ws" />
      <div class="awr-post-actions">
        <button type="button" class="awr-play" @click="togglePlayback">
          <component :is="isPlaying ? Pause : Play" :size="18" />
          {{ isPlaying ? '일시정지' : '재생' }}
        </button>
        <button type="button" class="awr-icon-btn" title="다시 녹음" @click="resetRecorder">
          <RotateCcw :size="18" />
        </button>
        <button type="button" class="awr-icon-btn" title="WAV 저장" @click="downloadAudio">
          <Download :size="18" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 기본 ─────────────────────────────────────────────────── */
.awr { width: 100%; }

.awr-error {
  padding: 10px 14px;
  margin-bottom: 12px;
  background: rgba(239,68,68,0.12);
  border: 1px solid rgba(239,68,68,0.35);
  border-radius: 10px;
  font-size: 13px;
  color: #fca5a5;
}

/* ── 공통: 가운데 정렬 래퍼 ─────────────────────────────────── */
.awr-center-wrap,
.awr-live-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px 0 12px;
  width: 100%;
}

/* ── 큰 원 버튼 ──────────────────────────────────────────────── */
.awr-circle {
  width: clamp(96px, 28vw, 120px);
  height: clamp(96px, 28vw, 120px);
  flex-shrink: 0;
  border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.3);
  background: linear-gradient(145deg, var(--accent, #ff2d78) 0%, #c41e5c 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 0 0 8px rgba(255,45,120,0.12), 0 12px 36px rgba(0,0,0,0.4);
  transition: transform 0.15s, box-shadow 0.2s;
}
.awr-circle:hover { transform: scale(1.03); box-shadow: 0 0 0 10px rgba(255,45,120,0.18), 0 16px 44px rgba(0,0,0,0.45); }
.awr-circle:active { transform: scale(0.97); }

/* ── 펄스 링 ─────────────────────────────────────────────────── */
.awr-pulse-ring {
  border-radius: 50%;
  animation: ring-pulse 1.8s ease-out infinite;
}
.awr-pulse-ring.paused { animation: none; }

@keyframes ring-pulse {
  0%  { box-shadow: 0 0 0 0   rgba(255,45,120,0.45); }
  70% { box-shadow: 0 0 0 20px rgba(255,45,120,0);  }
  100%{ box-shadow: 0 0 0 0   rgba(255,45,120,0);   }
}

/* ── 배지 ────────────────────────────────────────────────────── */
.awr-badge {
  font-size: 13px;
  font-weight: 600;
  padding: 5px 16px;
  border-radius: 999px;
  border: 1px solid;
  background: rgba(255,45,120,0.07);
  transition: color 0.2s, border-color 0.2s;
}

/* ── 타이머 ──────────────────────────────────────────────────── */
.awr-timer {
  font-size: clamp(1.9rem, 8vw, 2.7rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  color: #f8fafc;
  line-height: 1;
}

/* ── 라이브 파형 ─────────────────────────────────────────────── */
.awr-canvas-wrap {
  width: 100%;
  max-width: 520px;
}

.awr-canvas {
  display: block;
  width: 100%;
  height: 72px;
  border-radius: 10px;
  background: rgba(0,0,0,0.3);
}

/* ── 힌트 ────────────────────────────────────────────────────── */
.awr-hint {
  margin: 0;
  font-size: 14px;
  color: #94a3b8;
  text-align: center;
}

/* ── 완료 버튼 ───────────────────────────────────────────────── */
.awr-finish-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 28px;
  border-radius: 12px;
  border: none;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.14);
  color: #e2e8f0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.awr-finish-btn:hover { background: rgba(255,255,255,0.13); }

/* ── 완료 후 파형 ────────────────────────────────────────────── */
.awr-post-wrap {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
  width: 100%;
}

.awr-post-label {
  font-size: 11px;
  color: #64748b;
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.awr-ws {
  border-radius: 12px;
  overflow: hidden;
  background: rgba(0,0,0,0.3);
  min-height: 80px;
}

.awr-post-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.awr-play {
  flex: 1;
  min-width: 120px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 46px;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  background: linear-gradient(135deg, #ff2d78 0%, #db2777 100%);
  color: #fff;
}

.awr-icon-btn {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #94a3b8;
  cursor: pointer;
}
.awr-icon-btn:hover { background: rgba(255,255,255,0.1); }
</style>
