# Wowza HLS Player (Vue 3 + Video.js + HLS.js)

Vue 3와 Video.js, HLS.js를 사용한 Wowza 전용 HLS 플레이어입니다.  
1,000명 동시 접속을 고려한 버퍼링·폴링·캐싱 전략을 적용했습니다.

## 기능

- **useStreamingSafe**: Exponential Backoff + Jitter 재연결 (동시 play 폭주 방지)
- **화질(ABR) localStorage**: 사용자 화질 설정 저장/불러오기
- **버퍼링 프로그레스 바**: HLS.js `fragBuffered` 기반 버퍼 구간 시각화
- **Wowza-FE 설정 매칭**: Application.xml ↔ HLS.js 옵션 동기화 (chunk, DVR, 버퍼)
- **useSwrWithJitter**: SWR + Jitter 메타데이터 폴링 (요청 시점 분산)
- **Service Worker**: 정적 리소스 강력 캐싱 (PWA)

## 설치 및 실행

```bash
npm install
npm run dev
```

빌드:

```bash
npm run build
```

## 사용법

### 플레이어

`WowzaPlayer`에 HLS 스트림 URL을 넘깁니다. SecureToken 사용 시 URL에 `?wowzatoken=hash`를 포함하세요.

```vue
<WowzaPlayer
  src="https://your-wowza-host/stream.m3u8?wowzatoken=..."
  :max-retries="10"
  :config="wowzaConfig"
  :show-status="true"
/>
```

#### 기능 상태 패널 (showStatus)

플레이어 하단에 **기능 상태** 패널이 표시됩니다. 각 기능의 동작 여부를 한눈에 확인할 수 있습니다.

| 항목 | 정상 시 표시 |
|------|-------------|
| 재연결(useStreamingSafe) | `정상 (재시도 0회)` |
| ABR(localStorage) | `자동 (N개 레벨)` 또는 `레벨 N 고정` |
| 버퍼(fragBuffered) | `N개 구간, 약 Xs` |
| DVR 윈도우 | `3600s` (설정 시) |
| HLS 레벨 | `자동` 또는 `레벨 N` |
| Service Worker | `캐싱 활성화` (build 후 배포 시) |

`show-status="false"`로 비활성화 가능합니다.

#### Wowza-FE 설정 매칭 (config)

| Wowza 서버 (Application.xml) | FE 옵션 |
|-------------------------------|---------|
| cupertinoChunkDurationTarget (2~4s) | `config.hlsjs.maxBufferLength` |
| dvrWindowDuration (초) | `config.dvrWindowDuration` → 타임라인 Max Seek Range |
| Transcoder Bitrate 리스트 | qualityLevels UI (자동 1:1 매칭) |
| security/SecureToken | `src`에 `?wowzatoken=hash` 포함 |

```ts
import { WOWZA_DEFAULT_CONFIG } from '@/types/wowza'

const wowzaConfig = {
  ...WOWZA_DEFAULT_CONFIG,
  hlsjs: {
    maxBufferLength: 30,
    liveSyncDuration: 4,
    liveMaxLatencyDuration: 8,
  },
  dvrWindowDuration: 3600, // 1시간 DVR
}
```

### useSwrWithJitter (메타데이터 폴링)

강의 정보, 참여자 수 등 API 폴링 시 요청 시점을 분산합니다.  
`5000ms + random(0, 1000ms)` = 1,000명이 동시에 5초 타이머로 요청하지 않도록 방지.

```ts
import { useSwrWithJitter } from '@/composables/useSwrWithJitter'

const { data, error, mutate, refresh } = useSwrWithJitter({
  fetcher: () => fetch('/api/lecture-info').then(r => r.json()),
  pollIntervalMs: 5000,
  jitterMs: 1000,
  immediate: true,
})
```

### useStreamingSafe

네트워크 오류 시 재연결이 필요할 때 사용합니다.

```ts
import { useStreamingSafe } from '@/composables/useStreamingSafe'

const { scheduleRetry, onReconnectSuccess, isReconnecting, retryCount } = useStreamingSafe({
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  resetOnSuccess: true,
})

// 실패 시
scheduleRetry(() => {
  // 재연결 시도 (예: hls.loadSource(url))
})

// 성공 시
onReconnectSuccess()
```

### useAbrStorage

화질(ABR) 인덱스를 localStorage에 저장/불러옵니다. `-1`은 자동, `0` 이상은 해당 레벨 고정입니다.

```ts
import { useAbrStorage } from '@/composables/useAbrStorage'

const { levelIndex, load, save, setLevels } = useAbrStorage()
load()           // 저장된 값 불러오기
save(0)          // 0번 레벨로 저장
setLevels([...]) // 플레이어에서 레벨 목록 주입
```

### SecureToken URL 헬퍼

```ts
import { buildSecureTokenUrl } from '@/utils/secureToken'

const src = buildSecureTokenUrl({
  baseUrl: 'https://host:1935/app/stream/playlist.m3u8',
  token: '공유비밀키로_생성한_해시',
  paramName: 'wowzatoken', // 기본값
})
```

## 프로젝트 구조

```
src/
  composables/
    useStreamingSafe.ts   # 재연결 (Exponential Backoff + Jitter)
    useAbrStorage.ts     # ABR localStorage
    useSwrWithJitter.ts  # SWR + Jitter 메타데이터 폴링
  components/
    WowzaPlayer.vue      # 메인 플레이어
    BufferingProgressBar.vue  # fragBuffered 기반 버퍼 바
  types/
    wowza.ts             # Wowza-FE 설정 타입
  utils/
    secureToken.ts       # SecureToken URL 헬퍼
  App.vue
  main.ts
```

## 1,000명 동시 접속 대응 전략

1. **정적 리소스 캐싱**: Service Worker (vite-plugin-pwa)로 JS/CSS/이미지 캐시
2. **메타데이터 폴링**: `useSwrWithJitter`로 요청 시점 분산
3. **재연결**: `useStreamingSafe` 지수 백오프 + Jitter로 동시 play 폭주 방지
