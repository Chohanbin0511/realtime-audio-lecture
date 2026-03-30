# realtime-audio-lecture

Vue 3 + Vite 기반 **실시간 오디오 방송**과 **학생용 실시간 강의(청취)** 화면을 한 앱에서 다루는 웹 데모입니다.  
같은 브라우저의 다른 탭끼리 `BroadcastChannel`으로 자막·라이브 오디오를 주고받습니다.

## 요구 사항

- **Node.js** 18+
- **pnpm** 8+ ([설치](https://pnpm.io/installation))

## 설치

```bash
pnpm install
```

## 스크립트

| 명령 | 설명 |
|------|------|
| `pnpm dev` | 개발 서버 (기본 `http://localhost:5173`, `--host 0.0.0.0` 으로 LAN 접속 가능) |
| `pnpm build` | 타입체크(`vue-tsc`) 후 프로덕션 빌드 |
| `pnpm preview` | 빌드 결과 미리보기 |

## 사용 방법 (데모)

1. `pnpm dev` 실행 후 브라우저에서 앱을 연다.
2. **방송하기** 탭 → 수업 시작 및 녹음 → 마이크로 방송을 시작한다.
3. **실시간 강의(학생)** 탭을 새 탭으로 연다 (같은 출처·같은 브라우저).
4. 방송 중에는 학생 화면이 **수업 중**으로 맞춰지고, 자막·경과 시간·라이브 오디오(지원 브라우저)가 동기화된다.

> 자막(STT)은 **Chrome/Edge**의 Web Speech API를 사용한다.  
> 마이크·STT 권한이 필요하다.

## 주요 기능

- **방송**: 마이크 녹음(WAV), Web Speech API 자막, 탭 간 자막 브로드캐스트
- **청취**: 자막 수신, 방송 종료 후 IndexedDB에 저장된 녹음 재생
- **라이브 오디오**: WebM 청크 + MediaSource(청취 탭, 같은 브라우저)
- **상태 동기화**: `localStorage` 플래그로 “방송 중” 여부 공유
- **PWA**: `vite-plugin-pwa` (빌드 후 서비스 워커 생성)

## 기술 스택

- Vue 3, Vue Router, TypeScript, Vite  
- Tailwind CSS, SCSS  
- extendable-media-recorder, wavesurfer.js  
- BroadcastChannel, IndexedDB, MediaRecorder / MediaSource  

## 환경 변수

로컬 전용 설정이 있다면 프로젝트 루트에 `.env`를 두고 사용한다.  
저장소에는 `.env`를 올리지 않는다 (`.gitignore` 처리).

## Vercel 배포

1. GitHub에 이 프로젝트를 푸시해 둔다.
2. [Vercel](https://vercel.com)에 로그인 → **Add New…** → **Project** → 해당 GitHub 저장소를 import한다.
3. **Framework Preset**은 `Vite`로 잡히면 그대로 두면 된다.  
   - **Install Command**: `pnpm install` (또는 `pnpm-lock.yaml`이 있으면 자동으로 pnpm 사용)  
   - **Build Command**: `pnpm run build`  
   - **Output Directory**: `dist`
4. **Deploy**를 누르면 빌드 후 `*.vercel.app` URL로 배포된다.

루트의 `vercel.json`은 Vue Router용 **SPA 폴백**(`/listen` 등 직접 접속·새로고침 시 `index.html` 제공)을 위해 넣어 두었다.

배포 URL은 **HTTPS**이므로 마이크·미디어 API 사용에 유리하다.  
탭 간 통신은 **같은 브라우저·같은 도메인**에서만 동작한다.

## 라이선스

개인/학습용 프로젝트에 맞게 필요 시 본인이 `LICENSE`를 추가하면 된다.
