<script setup lang="ts">
import { DialogPortal, DialogOverlay, DialogContent as DialogContentPrimitive } from 'radix-vue'
import { cn } from '@/lib/utils'

interface Props {
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="fixed inset-0 z-[200] bg-[#0a0a0a]" />
    <DialogContentPrimitive
      :class="cn(
        'fixed left-0 top-0 z-[201] grid h-dvh w-full overflow-y-auto border-0 bg-transparent p-0 shadow-none outline-none ring-offset-background focus:outline-none focus-visible:outline-none focus-visible:ring-0',
        props.class,
      )"
    >
      <slot />
    </DialogContentPrimitive>
  </DialogPortal>
</template>
