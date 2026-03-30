import { ref, onBeforeUnmount } from 'vue'
import { useStreamingSafe } from './useStreamingSafe'

export interface SubtitleMessage {
  id: string
  text: string
  timestamp: number
  isFinal: boolean
  /** 녹음 시작 기준 재생 위치(초). 일시정지 구간은 제외 */
  offsetSec?: number
}

export interface UseSubtitleChannelOptions {
  /**
   * WebSocket URL.
   * 생략 시 BroadcastChannel(로컬 탭간 통신)만 사용 → 서버 없이 두 창 데모 가능
   */
  wsUrl?: string
  /** 자막 최대 보관 개수 (기본 80) */
  maxMessages?: number
  /** BroadcastChannel 이름 (기본: wowza-subtitle) */
  channelName?: string
  /** broadcaster = 자막 송신, listener = 자막 수신 */
  role: 'broadcaster' | 'listener'
}

let _msgIdSeq = 0
function nextId() { return `msg-${Date.now()}-${++_msgIdSeq}` }

/**
 * 자막 브로드캐스트 채널 Composable
 *
 * 동작 방식 (두 가지 동시 지원):
 *  1. BroadcastChannel API  — 같은 오리진의 다른 탭/창과 실시간 메시지 교환 (서버 불필요)
 *  2. WebSocket             — wsUrl 제공 시 서버 경유로 2,000명 청취자에게 자막 배포
 *
 * 로컬 데모:
 *  BroadcastPage 창과 ListenPage 창을 동시에 열면 즉시 동작
 */
export function useSubtitleChannel(opts: UseSubtitleChannelOptions) {
  const {
    wsUrl,
    maxMessages = 80,
    channelName = 'wowza-subtitle',
    role,
  } = opts

  const messages = ref<SubtitleMessage[]>([])
  const wsConnected = ref(false)
  const channelReady = ref(false)
  let bc: BroadcastChannel | null = null
  let ws: WebSocket | null = null

  const { scheduleRetry, onReconnectSuccess } = useStreamingSafe({ maxRetries: 0 })

  function pushMessage(msg: SubtitleMessage) {
    if (!msg.isFinal) return
    const next = [...messages.value, msg]
    messages.value = next.length > maxMessages ? next.slice(next.length - maxMessages) : next
  }

  // ── BroadcastChannel 초기화 ─────────────────────────────────
  function openChannel() {
    try {
      bc = new BroadcastChannel(channelName)
      bc.onmessage = (e: MessageEvent<SubtitleMessage>) => {
        if (role === 'listener') pushMessage(e.data)
      }
      channelReady.value = true
    } catch {
      channelReady.value = false
    }
  }

  // ── WebSocket 초기화 (선택) ──────────────────────────────────
  function connectWs() {
    if (!wsUrl) return
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      wsConnected.value = true
      onReconnectSuccess()
    }
    ws.onmessage = (e: MessageEvent) => {
      if (role !== 'listener') return
      try {
        const msg: SubtitleMessage = JSON.parse(e.data as string)
        pushMessage(msg)
      } catch { /* ignore malformed */ }
    }
    ws.onclose = () => {
      wsConnected.value = false
      scheduleRetry(connectWs)
    }
    ws.onerror = () => ws?.close()
  }

  // ── 자막 전송 (broadcaster only) ────────────────────────────
  function send(text: string, isFinal = true, offsetSec?: number) {
    if (role !== 'broadcaster' || !text.trim()) return
    const msg: SubtitleMessage = {
      id: nextId(),
      text,
      timestamp: Date.now(),
      isFinal,
      ...(offsetSec !== undefined ? { offsetSec } : {}),
    }

    // 자신의 미리보기에도 즉시 표시
    pushMessage(msg)

    bc?.postMessage(msg)

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  function clearMessages() { messages.value = [] }

  function destroy() {
    bc?.close()
    bc = null
    ws?.close()
    ws = null
    channelReady.value = false
    wsConnected.value = false
  }

  openChannel()
  if (wsUrl) connectWs()

  onBeforeUnmount(destroy)

  return {
    messages,
    wsConnected,
    channelReady,
    send,
    clearMessages,
    destroy,
  }
}
