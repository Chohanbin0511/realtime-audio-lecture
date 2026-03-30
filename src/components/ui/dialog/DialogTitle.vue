<script setup lang="ts">
import { DialogTitle as DialogTitlePrimitive } from 'radix-vue'
import { cn } from '@/lib/utils'

interface Props {
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <DialogTitlePrimitive
    :class="cn('text-lg font-semibold leading-none tracking-tight text-foreground', props.class)"
  >
    <slot />
  </DialogTitlePrimitive>
</template>
