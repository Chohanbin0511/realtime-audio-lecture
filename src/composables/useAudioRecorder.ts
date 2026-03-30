import { ref, readonly, onBeforeUnmount } from 'vue'

export interface AudioQualityOptions {
  /** 마이크 노이즈 억제 (브라우저 DSP) */
  noiseSuppression: boolean
  /** 에코 제거 */
  echoCancellation: boolean
  /** 자동 게인 조절 */
  autoGainControl: boolean
  /** 샘플레이트 (Hz) */
  sampleRate?: 16000 | 44100 | 48000
}

export interface SilenceDetectOptions {
  /** 무음 판단 기준 볼륨 (0-255, 기본 15) */
  threshold?: number
  /** 이 ms 이상 무음 지속 시 onSilence 콜백 (기본 1500ms) */
  durationMs?: number
}

export const DEFAULT_QUALITY: AudioQualityOptions = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  /** 방송/음성 데모에 맞춘 48kHz (Opus·HLS와 잘 맞음) */
  sampleRate: 48000,
}

/** 브라우저에서 쓸 수 있는 가장 나은 MediaRecorder 옵션 (Opus + 비트레이트 우선) */
export function pickBestMediaRecorderOptions(): MediaRecorderOptions {
  const opus = 'audio/webm;codecs=opus'
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(opus)) {
    return { mimeType: opus, audioBitsPerSecond: 128_000 }
  }
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')) {
    return { mimeType: 'audio/webm' }
  }
  const mp4 = 'audio/mp4'
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mp4)) {
    return { mimeType: mp4, audioBitsPerSecond: 128_000 }
  }
  return {}
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance
interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: Event) => void) | null
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

/**
 * 오디오 녹음 + 노이즈 억제 + 무음 감지 + 실시간 STT Composable
 *
 * 오디오 품질 향상 방법 3종:
 *  1. getUserMedia constraints: noiseSuppression / echoCancellation / autoGainControl
 *  2. Web Audio API AnalyserNode: 볼륨 모니터링 + 기침/공백 감지
 *  3. Web Speech API: 실시간 자막(STT) - Chrome/Edge 지원
 */
export function useAudioRecorder(
  quality: AudioQualityOptions = DEFAULT_QUALITY,
  silenceOpts: SilenceDetectOptions = {}
) {
  const isRecording = ref(false)
  const isSttActive = ref(false)
  const isSttMuted = ref(false)    // VAD: 무음 구간 → STT 일시 정지 상태
  const volumeLevel = ref(0)       // 0~100 (현재 볼륨)
  const isSilent = ref(false)      // 무음 감지 상태
  const transcript = ref('')       // 확정된 STT 텍스트
  const interimText = ref('')      // 인식 중인 STT 텍스트
  const recordedChunks: Blob[] = []
  const errorMsg = ref<string | null>(null)
  const stream = ref<MediaStream | null>(null)

  let mediaRecorder: MediaRecorder | null = null
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let rafId: number | null = null
  let recognition: SpeechRecognitionInstance | null = null
  let silenceTimerId: ReturnType<typeof setTimeout> | null = null
  let vadResumeTimerId: ReturnType<typeof setTimeout> | null = null
  let sttOnFinalCallback: ((text: string) => void) | undefined = undefined
  let RecognitionCtor: SpeechRecognitionCtor | undefined = undefined
  /** stop 후에도 Blob type 복원용 */
  let lastRecordedMime = 'audio/webm'

  const silenceThreshold = silenceOpts.threshold ?? 15
  const silenceDurationMs = silenceOpts.durationMs ?? 1500

  async function startRecording(): Promise<boolean> {
    errorMsg.value = null
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          noiseSuppression: quality.noiseSuppression,
          echoCancellation: quality.echoCancellation,
          autoGainControl: quality.autoGainControl,
          ...(quality.sampleRate ? { sampleRate: quality.sampleRate } : {}),
        },
        video: false,
      }
      stream.value = await navigator.mediaDevices.getUserMedia(constraints)
    } catch (e) {
      errorMsg.value = '마이크 접근 실패: ' + (e instanceof Error ? e.message : String(e))
      return false
    }

    try {
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('이 브라우저는 MediaRecorder를 지원하지 않습니다.')
      }

      audioCtx = new AudioContext(
        quality.sampleRate != null ? { sampleRate: quality.sampleRate } : undefined
      )
      // 모바일·WebView는 사용자 제스처 후에도 suspended인 경우가 많음
      if (audioCtx.state === 'suspended') await audioCtx.resume()
      const source = audioCtx.createMediaStreamSource(stream.value)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      function tick() {
        if (!analyser) return
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        volumeLevel.value = Math.min(100, Math.round(avg * 100 / 255))

        if (avg < silenceThreshold) {
          // 무음 진입 타이머 시작
          if (!silenceTimerId) {
            silenceTimerId = setTimeout(() => {
              isSilent.value = true
              // VAD: 무음이 지속되면 STT 일시 정지 (겹침 방지)
              if (isSttActive.value && !isSttMuted.value) {
                isSttMuted.value = true
                recognition?.stop()
                interimText.value = ''
              }
            }, silenceDurationMs)
          }
        } else {
          // 소리가 다시 감지됨
          if (silenceTimerId) {
            clearTimeout(silenceTimerId)
            silenceTimerId = null
          }
          isSilent.value = false

          // VAD: 뮤트 상태였으면 STT 재시작
          if (isSttActive.value && isSttMuted.value) {
            if (vadResumeTimerId) clearTimeout(vadResumeTimerId)
            // 200ms 디바운스: 순간적인 소리(기침 등)에 즉시 반응 방지
            vadResumeTimerId = setTimeout(() => {
              vadResumeTimerId = null
              if (isSttActive.value && isSttMuted.value) {
                isSttMuted.value = false
                _restartRecognition()
              }
            }, 200)
          }
        }
        rafId = requestAnimationFrame(tick)
      }
      tick()

      const recorderOpts = pickBestMediaRecorderOptions()
      mediaRecorder = new MediaRecorder(stream.value, recorderOpts)
      lastRecordedMime = mediaRecorder.mimeType || recorderOpts.mimeType || 'audio/webm'
      recordedChunks.length = 0
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data)
      }
      // 짧은 타임슬라이스로 끊김 감소·라이브 전송 시 유리 (데모 녹음도 균일하게)
      mediaRecorder.start(250)
      isRecording.value = true
      return true
    } catch (e) {
      // setup 실패 시 열린 리소스 정리
      stream.value?.getTracks().forEach((t) => t.stop())
      stream.value = null
      audioCtx?.close()
      audioCtx = null
      analyser = null
      errorMsg.value = '녹음 시작 실패: ' + (e instanceof Error ? e.message : String(e))
      return false
    }
  }

  /**
   * MediaRecorder.stop() 후 마지막 ondataavailable 이 끝나야 Blob이 완전해짐.
   * 다운로드·미리듣기 전에 반드시 await 할 것.
   */
  function stopRecording(): Promise<void> {
    return new Promise((resolve) => {
      const mr = mediaRecorder

      const cleanup = () => {
        mediaRecorder = null
        stream.value?.getTracks().forEach((t) => t.stop())
        stream.value = null

        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        if (silenceTimerId !== null) {
          clearTimeout(silenceTimerId)
          silenceTimerId = null
        }
        if (vadResumeTimerId !== null) {
          clearTimeout(vadResumeTimerId)
          vadResumeTimerId = null
        }

        audioCtx?.close()
        audioCtx = null
        analyser = null

        isRecording.value = false
        volumeLevel.value = 0
        isSilent.value = false
        isSttMuted.value = false
        resolve()
      }

      if (!mr || mr.state === 'inactive') {
        cleanup()
        return
      }
      mr.addEventListener('stop', cleanup, { once: true })
      mr.stop()
    })
  }

  function getRecordedBlob(): Blob | null {
    if (recordedChunks.length === 0) return null
    const fromChunk = recordedChunks[0] ? (recordedChunks[0] as Blob).type : ''
    const type = fromChunk || lastRecordedMime || 'audio/webm'
    return new Blob(recordedChunks, { type })
  }

  function downloadRecording(filename = 'recording.webm') {
    const blob = getRecordedBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  function _buildRecognition() {
    if (!RecognitionCtor) return null
    const r = new RecognitionCtor()
    r.lang = 'ko-KR'
    r.continuous = true
    r.interimResults = true

    r.onresult = (e: SpeechRecognitionEvent) => {
      // VAD 뮤트 중 결과가 들어오면 무시
      if (isSttMuted.value) return
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const text = e.results[i][0].transcript
          transcript.value += text + ' '
          sttOnFinalCallback?.(text)
        } else {
          interim += e.results[i][0].transcript
        }
      }
      interimText.value = interim
    }

    r.onend = () => {
      // VAD가 stop()한 경우 isSttMuted=true → 재시작 하지 않음
      // Chrome 자동 종료 시(isSttMuted=false)에만 재시작
      if (isSttActive.value && !isSttMuted.value) {
        _restartRecognition()
      }
    }

    r.onerror = (e: Event) => {
      const err = (e as ErrorEvent).message
      // 뮤트 중 no-speech 오류는 정상 동작이므로 무시
      if (err !== 'no-speech' && err !== 'aborted') {
        errorMsg.value = 'STT 오류: ' + err
      }
    }

    return r
  }

  function _restartRecognition() {
    if (!isSttActive.value || isSttMuted.value) return
    recognition = _buildRecognition()
    recognition?.start()
  }

  function startStt(onFinal?: (text: string) => void) {
    RecognitionCtor =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition

    if (!RecognitionCtor) {
      errorMsg.value = 'Web Speech API를 지원하지 않는 브라우저입니다 (Chrome/Edge 권장)'
      return
    }

    sttOnFinalCallback = onFinal
    isSttActive.value = true
    isSttMuted.value = false
    recognition = _buildRecognition()
    recognition?.start()
  }

  function stopStt() {
    isSttActive.value = false
    isSttMuted.value = false
    recognition?.stop()
    recognition = null
    interimText.value = ''
    sttOnFinalCallback = undefined
  }

  function clearTranscript() { transcript.value = '' }

  onBeforeUnmount(() => {
    void stopRecording()
    stopStt()
  })

  return {
    isRecording: readonly(isRecording),
    isSttActive: readonly(isSttActive),
    isSttMuted: readonly(isSttMuted),
    volumeLevel: readonly(volumeLevel),
    isSilent: readonly(isSilent),
    transcript,
    interimText: readonly(interimText),
    stream: readonly(stream),
    errorMsg: readonly(errorMsg),
    startRecording,
    stopRecording,
    getRecordedBlob,
    downloadRecording,
    startStt,
    stopStt,
    clearTranscript,
  }
}
