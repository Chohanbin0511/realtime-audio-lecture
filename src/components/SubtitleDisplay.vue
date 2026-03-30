<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { SubtitleMessage } from '@/composables/useSubtitleChannel'

const props = withDefaults(
  defineProps<{
    /** 확정된 자막 목록 */
    messages?: SubtitleMessage[]
    /** 현재 인식 중(미확정) 자막 */
    interimText?: string
    /** 최대 표시 줄 수 */
    maxVisible?: number
  }>(),
  { messages: () => [], interimText: '', maxVisible: 6 }
)

const scrollEl = ref<HTMLElement | null>(null)

watch(
  () => [props.messages.length, props.interimText],
  async () => {
    await nextTick()
    if (scrollEl.value) {
      scrollEl.value.scrollTop = scrollEl.value.scrollHeight
    }
  }
)
</script>

<template>
  <div class="subtitle-wrap">
    <div v-if="messages.length === 0 && !interimText" class="empty">
      자막 대기 중...
    </div>
    <div v-else ref="scrollEl" class="subtitle-scroll">
      <div
        v-for="msg in messages.slice(-maxVisible)"
        :key="msg.id"
        class="subtitle-line final"
      >
        {{ msg.text }}
      </div>
      <div v-if="interimText" class="subtitle-line interim">
        {{ interimText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.subtitle-wrap {
  background: rgba(0, 0, 0, 0.7);
  border-radius: 6px;
  padding: 10px 14px;
  min-height: 64px;
  max-height: 140px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.empty {
  color: #475569;
  font-size: 13px;
}
.subtitle-scroll {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.subtitle-line {
  font-size: 14px;
  line-height: 1.5;
  border-radius: 4px;
  padding: 2px 4px;
}
.subtitle-line.final {
  color: #e2e8f0;
}
.subtitle-line.interim {
  color: #94a3b8;
  font-style: italic;
  background: rgba(255, 255, 255, 0.05);
}
</style>
