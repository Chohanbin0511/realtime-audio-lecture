/**
 * Flutter WebView ↔ Vue 브릿지 시스템
 * 모바일에서는 Flutter 네이티브 기능 호출, PC에서는 웹 API 사용
 */

import { detectPlatform } from './platform'

export interface AudioRecordingOptions {
  quality: 'low' | 'medium' | 'high'
  sampleRate?: number
  bitrate?: number
  format?: 'webm' | 'mp4' | 'wav'
}

export interface AudioPlaybackOptions {
  streamUrl: string
  lowLatency?: boolean
  bufferSize?: number
}

export interface SubtitleMessage {
  text: string
  timestamp: number
  language?: string
  /** 녹음/재생 타임라인 기준 초 (선택) */
  offsetSec?: number
}

export interface FlutterBridgeCallbacks {
  onRecordingStart?: () => void
  onRecordingStop?: (audioBlob: Blob | string) => void
  onRecordingError?: (error: string) => void
  onSubtitleReceived?: (subtitle: SubtitleMessage) => void
  onPlaybackStateChange?: (isPlaying: boolean) => void
  onPlaybackError?: (error: string) => void
}

class FlutterBridge {
  private platform = detectPlatform()
  private callbacks: FlutterBridgeCallbacks = {}
  
  constructor() {
    this.setupMessageListener()
  }

  /**
   * Flutter에서 오는 메시지 리스너 설정
   */
  private setupMessageListener() {
    if (this.platform.isFlutter) {
      window.addEventListener('message', (event) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
          this.handleFlutterMessage(data)
        } catch (error) {
          console.error('Flutter message parse error:', error)
        }
      })
    }
  }

  /**
   * Flutter에서 온 메시지 처리
   */
  private handleFlutterMessage(data: any) {
    switch (data.type) {
      case 'recording_started':
        this.callbacks.onRecordingStart?.()
        break
      case 'recording_stopped':
        this.callbacks.onRecordingStop?.(data.audioData)
        break
      case 'recording_error':
        this.callbacks.onRecordingError?.(data.error)
        break
      case 'subtitle_received':
        this.callbacks.onSubtitleReceived?.(data.subtitle)
        break
      case 'playback_state':
        this.callbacks.onPlaybackStateChange?.(data.isPlaying)
        break
      case 'playback_error':
        this.callbacks.onPlaybackError?.(data.error)
        break
    }
  }

  /**
   * Flutter에 메시지 전송
   */
  private postToFlutter(message: any) {
    if (this.platform.isFlutter) {
      // Flutter WebView에서 메시지 수신
      if (window.parent !== window) {
        window.parent.postMessage(JSON.stringify(message), '*')
      }
      // 또는 Flutter InAppWebView 전용 채널
      if ((window as any).flutter_inappwebview) {
        (window as any).flutter_inappwebview.callHandler('webToFlutter', message)
      }
    }
  }

  /**
   * 콜백 등록
   */
  setCallbacks(callbacks: FlutterBridgeCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  /**
   * 녹음 시작 (OS별 분기)
   */
  async startRecording(options: AudioRecordingOptions = { quality: 'high' }): Promise<boolean> {
    if (this.platform.isMobile && this.platform.isFlutter) {
      // 모바일 Flutter: 네이티브 녹음
      this.postToFlutter({
        type: 'start_recording',
        options
      })
      return true
    } else {
      // PC/웹: 기존 웹 API 사용
      // 여기서는 실제 웹 녹음 로직을 호출하지 않고 
      // 호출하는 쪽에서 처리하도록 false 반환
      return false
    }
  }

  /**
   * 녹음 중지
   */
  async stopRecording(): Promise<void> {
    if (this.platform.isMobile && this.platform.isFlutter) {
      this.postToFlutter({
        type: 'stop_recording'
      })
    }
    // PC는 호출하는 쪽에서 처리
  }

  /**
   * 오디오 재생 시작
   */
  async startPlayback(options: AudioPlaybackOptions): Promise<boolean> {
    if (this.platform.isMobile && this.platform.isFlutter) {
      this.postToFlutter({
        type: 'start_playback',
        options
      })
      return true
    } else {
      return false // PC는 웹 API 사용
    }
  }

  /**
   * 재생 중지
   */
  async stopPlayback(): Promise<void> {
    if (this.platform.isMobile && this.platform.isFlutter) {
      this.postToFlutter({
        type: 'stop_playback'
      })
    }
  }

  /**
   * 자막 전송 (실시간 STT 결과)
   */
  sendSubtitle(subtitle: SubtitleMessage): void {
    if (this.platform.isFlutter) {
      this.postToFlutter({
        type: 'subtitle_data',
        subtitle
      })
    }
  }

  /**
   * 현재 플랫폼 정보
   */
  getPlatform() {
    return this.platform
  }

  /**
   * 모바일 네이티브 기능 사용 여부
   */
  shouldUseNative(): boolean {
    return this.platform.isMobile && this.platform.isFlutter
  }
}

export const flutterBridge = new FlutterBridge()