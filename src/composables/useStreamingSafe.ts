import { ref, readonly, type Ref } from 'vue'

export interface UseStreamingSafeOptions {
  /** 최대 재연결 시도 횟수 (0 = 무제한) */
  maxRetries?: number
  /** 초기 대기 시간(ms) */
  initialDelayMs?: number
  /** 최대 대기 시간(ms) */
  maxDelayMs?: number
  /** 지수 백오프 승수 */
  backoffMultiplier?: number
  /** 재연결 성공 시 카운터 리셋 여부 */
  resetOnSuccess?: boolean
}

const DEFAULT_OPTIONS: Required<UseStreamingSafeOptions> = {
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  resetOnSuccess: true,
}

/**
 * Exponential Backoff + Jitter 적용 재연결 지연 시간(ms) 계산
 * jitter: [0, 1) 구간 랜덤으로 캡하여 동시 재연결 폭주 방지
 */
function getDelayWithJitter(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt)
  const capped = Math.min(exponentialDelay, maxDelayMs)
  const jitter = capped * Math.random()
  return Math.floor(capped + jitter)
}

export interface UseStreamingSafeReturn {
  /** 현재 재연결 시도 횟수 */
  retryCount: Ref<number>
  /** 재연결 중 여부 */
  isReconnecting: Ref<boolean>
  /** 다음 재연결까지 대기 시간(ms). 재연결 중일 때만 유효 */
  nextRetryDelayMs: Ref<number>
  /** 실패 시 재연결 스케줄 실행. scheduleRetry(callback) 호출 후 delay 후 callback 실행 */
  scheduleRetry: (callback: () => void | Promise<void>) => void
  /** 재연결 성공 시 호출하여 카운터 리셋 */
  onReconnectSuccess: () => void
  /** 수동으로 재시도 카운터 리셋 */
  resetRetryCount: () => void
}

/**
 * Wowza 등 스트리밍 재연결을 위한 Exponential Backoff + Jitter Composable
 */
export function useStreamingSafe(
  options: UseStreamingSafeOptions = {}
): UseStreamingSafeReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const retryCount = ref(0)
  const isReconnecting = ref(false)
  const nextRetryDelayMs = ref(0)

  let timeoutId: ReturnType<typeof setTimeout> | null = null

  function clearSchedule() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  function scheduleRetry(callback: () => void | Promise<void>) {
    clearSchedule()
    if (opts.maxRetries > 0 && retryCount.value >= opts.maxRetries) {
      isReconnecting.value = false
      return
    }
    isReconnecting.value = true
    const delay = getDelayWithJitter(
      retryCount.value,
      opts.initialDelayMs,
      opts.maxDelayMs,
      opts.backoffMultiplier
    )
    nextRetryDelayMs.value = delay
    retryCount.value += 1

    timeoutId = setTimeout(() => {
      timeoutId = null
      Promise.resolve(callback()).finally(() => {
        isReconnecting.value = false
      })
    }, delay)
  }

  function onReconnectSuccess() {
    clearSchedule()
    if (opts.resetOnSuccess) {
      retryCount.value = 0
    }
    isReconnecting.value = false
    nextRetryDelayMs.value = 0
  }

  function resetRetryCount() {
    clearSchedule()
    retryCount.value = 0
    isReconnecting.value = false
    nextRetryDelayMs.value = 0
  }

  return {
    retryCount: readonly(retryCount),
    isReconnecting: readonly(isReconnecting),
    nextRetryDelayMs: readonly(nextRetryDelayMs),
    scheduleRetry,
    onReconnectSuccess,
    resetRetryCount,
  }
}
