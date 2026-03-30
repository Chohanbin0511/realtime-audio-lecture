/** 초 단위 길이를 HH:MM:SS 또는 MM:SS 로 표시 */
export function formatOffsetSec(totalSec: number): string {
  const s = Math.max(0, totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`
  return `${pad(m)}:${pad(sec)}`
}
