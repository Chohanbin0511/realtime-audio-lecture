/**
 * 하이브리드 오디오 레코더
 * - 모바일 Flutter: 네이티브 녹음 기능
 * - PC/웹: 기존 useAudioRecorder 사용
 */

import { ref, readonly, computed, onBeforeUnmount } from 'vue'
import { useAudioRecorder, type AudioQualityOptions, DEFAULT_QUALITY } from './useAudioRecorder'
import { flutterBridge, type AudioRecordingOptions } from '@/utils/flutterBridge'

export { DEFAULT_QUALITY }

export function useHybridAudioRecorder(quality: AudioQualityOptions) {
  const platform = flutterBridge.getPlatform()
  const shouldUseNative = flutterBridge.shouldUseNative()
  
  // 웹 버전 (PC용)
  const webRecorder = useAudioRecorder(quality)
  
  // 네이티브 버전 상태 (모바일용)
  const nativeIsRecording = ref(false)
  const nativeVolume = ref(0)
  const nativeError = ref<string | null>(null)
  const nativeBlob = ref<Blob | null>(null)
  
  // Flutter 브릿지 콜백 설정
  flutterBridge.setCallbacks({
    onRecordingStart: () => {
      nativeIsRecording.value = true
      nativeError.value = null
    },
    onRecordingStop: (audioData) => {
      nativeIsRecording.value = false
      if (typeof audioData === 'string') {
        // Base64 데이터를 Blob으로 변환
        try {
          const byteCharacters = atob(audioData)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          nativeBlob.value = new Blob([byteArray], { type: 'audio/mp4' })
        } catch (error) {
          console.error('Failed to convert audio data:', error)
        }
      } else if (audioData instanceof Blob) {
        nativeBlob.value = audioData
      }
    },
    onRecordingError: (error) => {
      nativeError.value = error
      nativeIsRecording.value = false
    }
  })
  
  // 통합 상태 (플랫폼별 분기)
  const isRecording = computed(() => 
    shouldUseNative ? nativeIsRecording.value : webRecorder.isRecording.value
  )
  
  const volumeLevel = computed(() =>
    shouldUseNative ? nativeVolume.value : webRecorder.volumeLevel.value
  )
  
  const errorMsg = computed(() =>
    shouldUseNative ? nativeError.value : webRecorder.errorMsg.value
  )
  
  const recordedBlob = computed(() =>
    shouldUseNative ? nativeBlob.value : webRecorder.getRecordedBlob()
  )
  
  // 통합 메서드
  async function startRecording(): Promise<boolean> {
    if (shouldUseNative) {
      const options: AudioRecordingOptions = {
        quality: 'high',
        sampleRate: quality.sampleRate,
        format: 'mp4' // iOS/Android 호환성
      }
      return await flutterBridge.startRecording(options)
    } else {
      return await webRecorder.startRecording()
    }
  }
  
  async function stopRecording(): Promise<void> {
    if (shouldUseNative) {
      await flutterBridge.stopRecording()
    } else {
      await webRecorder.stopRecording()
    }
  }
  
  function downloadRecording(filename?: string): void {
    const blob = recordedBlob.value
    if (!blob) return
    
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `recording-${Date.now()}.${shouldUseNative ? 'mp4' : 'webm'}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  
  // STT 관련은 웹 버전만 지원 (네이티브는 별도 구현 필요)
  function startStt(callback?: (text: string) => void) {
    if (!shouldUseNative) {
      webRecorder.startStt(callback)
    }
  }
  
  function stopStt() {
    if (!shouldUseNative) {
      webRecorder.stopStt()
    }
  }
  
  onBeforeUnmount(() => {
    void stopRecording()
    stopStt()
  })
  
  return {
    // 플랫폼 정보
    platform: readonly(ref(platform)),
    shouldUseNative: readonly(ref(shouldUseNative)),
    
    // 공통 상태
    isRecording,
    volumeLevel,
    errorMsg,
    recordedBlob,
    
    // 웹 전용 상태 (STT)
    isSttActive: shouldUseNative ? ref(false) : webRecorder.isSttActive,
    isSttMuted: shouldUseNative ? ref(false) : webRecorder.isSttMuted,
    isSilent: shouldUseNative ? ref(false) : webRecorder.isSilent,
    transcript: shouldUseNative ? ref('') : webRecorder.transcript,
    interimText: shouldUseNative ? ref('') : webRecorder.interimText,
    
    // 공통 메서드
    startRecording,
    stopRecording,
    downloadRecording,
    
    // 웹 전용 메서드
    startStt,
    stopStt,
    clearTranscript: shouldUseNative ? () => {} : webRecorder.clearTranscript,
  }
}