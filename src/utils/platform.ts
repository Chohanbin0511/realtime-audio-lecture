/**
 * 플랫폼 감지 유틸리티
 * Flutter WebView에서 실행될 때 OS 타입 구분
 */

export type OSType = 'web' | 'ios' | 'android' | 'windows' | 'macos' | 'linux'

export interface PlatformInfo {
  os: OSType
  isFlutter: boolean
  isMobile: boolean
  isDesktop: boolean
  userAgent: string
}

/**
 * 현재 플랫폼 정보 감지
 */
export function detectPlatform(): PlatformInfo {
  const ua = navigator.userAgent.toLowerCase()
  
  // Flutter WebView 감지 (Flutter에서 커스텀 User-Agent 추가 가능)
  const isFlutter = ua.includes('flutter') || 
                   window.hasOwnProperty('flutter_inappwebview') ||
                   window.hasOwnProperty('Flutter')

  let os: OSType = 'web'
  
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    os = 'ios'
  } else if (ua.includes('android')) {
    os = 'android'
  } else if (ua.includes('windows')) {
    os = 'windows'
  } else if (ua.includes('mac')) {
    os = 'macos'
  } else if (ua.includes('linux')) {
    os = 'linux'
  }

  const isMobile = os === 'ios' || os === 'android'
  const isDesktop = !isMobile

  return {
    os,
    isFlutter,
    isMobile,
    isDesktop,
    userAgent: navigator.userAgent
  }
}

/**
 * 반응형 디자인을 위한 화면 크기 기반 모바일 감지
 */
export function isMobileScreen(): boolean {
  return window.innerWidth < 768 // Tailwind md breakpoint
}

/**
 * 터치 지원 여부
 */
export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}