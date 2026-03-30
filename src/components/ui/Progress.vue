<script setup lang="ts">
import { cn } from '@/lib/utils'

interface Props {
  /** 0–100 */
  modelValue?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: 0,
})
</script>

<template>
  <div
    :class="cn('relative h-2 w-full overflow-hidden rounded-full bg-slate-200', props.class)"
    role="progressbar"
    :aria-valuenow="Math.round(modelValue)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div
      class="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-500 transition-all duration-500"
      :style="{ width: `${Math.min(100, Math.max(0, modelValue))}%` }"
    />
  </div>
</template>
