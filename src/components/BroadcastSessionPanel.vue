<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ref, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardContent from '@/components/ui/CardContent.vue'
import AudioWaveformRecorder from '@/components/AudioWaveformRecorder.vue'
import SubtitleDisplay from '@/components/SubtitleDisplay.vue'
import { useSubtitleChannel } from '@/composables/useSubtitleChannel'
import { useLiveAudioChannel } from '@/composables/useLiveAudioChannel'
import { flutterBridge } from '@/utils/flutterBridge'
import { saveLastBroadcastSession } from '@/utils/recordingSessionStore'
import { setBroadcastLive } from '@/utils/broadcastLiveFlag'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const router = useRouter()

const sessionTitle = ref('실시간 오디오 방송')
const sessionMeta = ref('웹 브라우저 · 마이크 권한 필요')

const lastSentText = ref('')
const lastSentAt = ref(0)

const wsUrl = ref('')
const { messages: subtitleMsgs, channelReady, wsConnected, send: sendSubtitle } = useSubtitleChannel({
  role: 'broadcaster',
  wsUrl: wsUrl.value || undefined,
})
const { sendSessionStart, sendSessionEnd, sendChunk } = useLiveAudioChannel({ role: 'broadcaster' })
const transcript = ref('')
const interimText = ref('')
type SttStatus = 'active' | 'idle' | 'error' | 'unavailable'
const sttStatus = ref<SttStatus>('idle')

function handleSttResult(payload: { text: string; offsetSec: number }) {
  const { text, offsetSec } = payload
  if (!text) return
  transcript.value += text + ' '

  const now = Date.now()
  if (text === lastSentText.value && now - lastSentAt.value < 1500) return
  lastSentText.value = text
  lastSentAt.value = now

  sendSubtitle(text, true, offsetSec)
  flutterBridge.sendSubtitle({ text, timestamp: now, language: 'ko', offsetSec })
}

async function onRecorded(blob: Blob) {
  await saveLastBroadcastSession({ blob, segments: [...subtitleMsgs.value] })
}

function handleRecordingChange(isRecording: boolean) {
  setBroadcastLive(isRecording)
  if (isRecording) sendSessionStart()
}

function onLiveAudioChunk(payload: { blob: Blob; mime: string; seq: number }) {
  sendChunk(payload.blob, payload.mime, payload.seq)
}

function onLiveAudioEnd() {
  sendSessionEnd()
}

function onSttInterim(text: string) {
  interimText.value = text
}

function onSttStatus(status: SttStatus) {
  sttStatus.value = status
}

function clearTranscript() {
  transcript.value = ''
}

onBeforeUnmount(() => {
  setBroadcastLive(false)
})

function endAndDistribute() {
  emit('close')
  router.push('/listen')
}
</script>

<template>
  <div class="broadcast-sc">
    <header class="sc-topbar">
      <span id="broadcast-modal-title" class="sc-brand">Audio Wowza</span>
      <button type="button" class="sc-close" aria-label="닫기" @click="emit('close')">
        <X :size="26" stroke-width="2" />
      </button>
    </header>

    <div class="sc-body">
      <section class="sc-session">
        <h1 class="sc-title">{{ sessionTitle }}</h1>
        <p class="sc-meta">{{ sessionMeta }}</p>
        <p class="sc-greet">안녕하세요 👋</p>
        <p class="sc-sub">준비되시면 녹음을 시작해 주세요</p>
      </section>

      <div class="sc-chips">
        <span class="sc-chip" :class="channelReady ? 'ok' : 'err'">
          {{ channelReady ? '자막 채널 연결됨' : '자막 채널 끊김' }}
        </span>
        <span v-if="wsUrl" class="sc-chip" :class="wsConnected ? 'ok' : 'dim'">
          WS {{ wsConnected ? '연결' : '미연결' }}
        </span>
        <span
          class="sc-chip"
          :class="{
            ok: sttStatus === 'active',
            err: sttStatus === 'error' || sttStatus === 'unavailable',
            dim: sttStatus === 'idle',
          }"
        >
          <template v-if="sttStatus === 'active'">🎙 STT 인식 중</template>
          <template v-else-if="sttStatus === 'error'">⚠️ STT 오류 (Chrome만 지원)</template>
          <template v-else-if="sttStatus === 'unavailable'">🚫 STT 미지원 브라우저</template>
          <template v-else>STT 대기 중</template>
        </span>
      </div>

      <section class="sc-recorder">
        <AudioWaveformRecorder
          :noise-suppression="true"
          :echo-cancellation="true"
          :auto-gain-control="true"
          accent-color="#ff2d78"
          wave-color="#ff2d78"
          progress-color="#ff6b9d"
          @stt-result="handleSttResult"
          @recorded="onRecorded"
          @recording-change="handleRecordingChange"
          @live-audio-chunk="onLiveAudioChunk"
          @live-audio-end="onLiveAudioEnd"
          @stt-interim="onSttInterim"
          @stt-status="onSttStatus"
        />
      </section>

      <div class="sc-footer-actions">
        <button type="button" class="sc-btn-end" @click="endAndDistribute">
          방송 종료 및 청취로 이동
        </button>
        <p class="sc-footer-hint">
          종료 후 청취 화면으로 이동합니다. (데모)
        </p>
      </div>

      <Card class="sc-card">
        <CardHeader class="sc-card-h">
          <h2 class="sc-card-title">실시간 자막</h2>
          <Button variant="ghost" size="sm" @click="clearTranscript">지우기</Button>
        </CardHeader>
        <CardContent>
          <SubtitleDisplay :messages="subtitleMsgs" :interim-text="interimText" :max-visible="20" />
          <p v-if="transcript" class="sc-transcript">
            <strong>전체 기록:</strong> {{ transcript }}
          </p>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<style scoped lang="scss" src="@/styles/components/broadcast-session.scss"></style>
