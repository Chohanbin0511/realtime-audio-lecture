import { ref, onBeforeUnmount } from 'vue'

const DEFAULT_NAME = 'wowza-live-audio'

export type LiveAudioCtrl =
  | { kind: 'ctrl'; ctrl: 'session-start'; startedAt: number }
  | { kind: 'ctrl'; ctrl: 'session-end' }

export type LiveAudioChunkMsg = {
  kind: 'chunk'
  seq: number
  mime: string
  data: ArrayBuffer
}

export type LiveAudioMsg = LiveAudioCtrl | LiveAudioChunkMsg

export interface UseLiveAudioChannelOptions {
  role: 'broadcaster' | 'listener'
  channelName?: string
  /** listener: 방송 시작 시각 (타이머 동기화) */
  onSessionStart?: (startedAt: number) => void
  /** listener: 세션 종료 */
  onSessionEnd?: () => void
}

export function useLiveAudioChannel(opts: UseLiveAudioChannelOptions) {
  const {
    role,
    channelName = DEFAULT_NAME,
    onSessionStart,
    onSessionEnd,
  } = opts

  const channelReady = ref(false)
  let bc: BroadcastChannel | null = null

  /** listener: HTMLAudioElement에 붙일 blob URL (정리용) */
  const liveAudioSrc = ref<string | null>(null)
  const liveAudioError = ref<string | null>(null)

  let audioEl: HTMLAudioElement | null = null
  let mediaSource: MediaSource | null = null
  let sourceBuffer: SourceBuffer | null = null
  const pending: ArrayBuffer[] = []
  let sourceOpen = false
  let chunkMime = ''

  function teardownMse() {
    pending.length = 0
    sourceOpen = false
    chunkMime = ''
    try {
      sourceBuffer = null
      if (mediaSource && mediaSource.readyState === 'open') {
        mediaSource.endOfStream()
      }
    } catch { /* ignore */ }
    mediaSource = null
    if (liveAudioSrc.value) {
      URL.revokeObjectURL(liveAudioSrc.value)
      liveAudioSrc.value = null
    }
    if (audioEl) {
      audioEl.pause()
      audioEl.removeAttribute('src')
      audioEl.load()
    }
  }

  function appendNext() {
    if (!sourceBuffer || sourceBuffer.updating || pending.length === 0) return
    const buf = pending.shift()!
    try {
      sourceBuffer.appendBuffer(buf)
    } catch (e) {
      liveAudioError.value =
        e instanceof Error ? e.message : '라이브 오디오 버퍼 추가 실패'
    }
  }

  /** MediaSource 미생성 시에만 호출 (세션 시작 후 첫 오디오 청크) */
  function ensureListenerPipeline(mime: string) {
    if (role !== 'listener' || mediaSource) return
    liveAudioError.value = null
    if (!MediaSource.isTypeSupported(mime)) {
      liveAudioError.value = '이 브라우저에서 라이브 오디오 형식을 지원하지 않습니다.'
      return
    }
    chunkMime = mime
    mediaSource = new MediaSource()
    const url = URL.createObjectURL(mediaSource)
    liveAudioSrc.value = url
    if (audioEl) {
      audioEl.src = url
      void audioEl.play().catch(() => {})
    }

    mediaSource.addEventListener('sourceopen', () => {
      if (!mediaSource || mediaSource.readyState !== 'open') return
      try {
        sourceBuffer = mediaSource.addSourceBuffer(chunkMime)
        sourceBuffer.addEventListener('updateend', appendNext)
        sourceOpen = true
        appendNext()
      } catch (e) {
        liveAudioError.value =
          e instanceof Error ? e.message : 'MediaSource 초기화 실패'
      }
    })
  }

  function handleListenerMessage(msg: LiveAudioMsg) {
    if (role !== 'listener') return
    if (msg.kind === 'ctrl') {
      if (msg.ctrl === 'session-start') {
        teardownMse()
        onSessionStart?.(msg.startedAt)
      } else if (msg.ctrl === 'session-end') {
        try {
          if (mediaSource?.readyState === 'open' && sourceBuffer && !sourceBuffer.updating) {
            mediaSource.endOfStream()
          } else if (mediaSource?.readyState === 'open') {
            const once = () => {
              sourceBuffer?.removeEventListener('updateend', once)
              try {
                if (mediaSource?.readyState === 'open') mediaSource.endOfStream()
              } catch { /* ignore */ }
            }
            sourceBuffer?.addEventListener('updateend', once)
          }
        } catch { /* ignore */ }
        onSessionEnd?.()
      }
      return
    }
    if (msg.kind === 'chunk') {
      if (!mediaSource) ensureListenerPipeline(msg.mime)
      if (!mediaSource) return
      pending.push(msg.data)
      if (sourceOpen && sourceBuffer && !sourceBuffer.updating) appendNext()
    }
  }

  function openChannel() {
    try {
      bc = new BroadcastChannel(channelName)
      bc.onmessage = (e: MessageEvent<LiveAudioMsg>) => {
        if (role === 'listener') handleListenerMessage(e.data)
      }
      channelReady.value = true
    } catch {
      channelReady.value = false
    }
  }

  function sendSessionStart(startedAt = Date.now()) {
    if (role !== 'broadcaster') return
    const msg: LiveAudioCtrl = { kind: 'ctrl', ctrl: 'session-start', startedAt }
    bc?.postMessage(msg)
  }

  function sendSessionEnd() {
    if (role !== 'broadcaster') return
    const msg: LiveAudioCtrl = { kind: 'ctrl', ctrl: 'session-end' }
    bc?.postMessage(msg)
  }

  function sendChunk(blob: Blob, mime: string, seq: number) {
    if (role !== 'broadcaster') return
    void blob.arrayBuffer().then((data) => {
      const msg: LiveAudioChunkMsg = { kind: 'chunk', seq, mime, data }
      bc?.postMessage(msg)
    })
  }

  function bindAudioElement(el: HTMLAudioElement | null) {
    audioEl = el
    if (el && liveAudioSrc.value) {
      el.src = liveAudioSrc.value
      void el.play().catch(() => {})
    }
  }

  function destroy() {
    bc?.close()
    bc = null
    channelReady.value = false
    teardownMse()
  }

  openChannel()

  onBeforeUnmount(destroy)

  return {
    channelReady,
    liveAudioSrc,
    liveAudioError,
    sendSessionStart,
    sendSessionEnd,
    sendChunk,
    bindAudioElement,
    destroy,
  }
}
