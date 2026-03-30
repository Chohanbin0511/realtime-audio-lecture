<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  id?: string
  checked?: boolean
  disabled?: boolean
  class?: string
}

interface Emits {
  (e: 'update:checked', value: boolean): void
}

const props = withDefaults(defineProps<Props>(), {
  checked: false,
  disabled: false
})

const emits = defineEmits<Emits>()

const isChecked = computed({
  get: () => props.checked,
  set: (value) => emits('update:checked', value)
})
</script>

<template>
  <button
    type="button"
    role="switch"
    :id="id"
    :aria-checked="isChecked"
    :disabled="disabled"
    :class="cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      isChecked && 'bg-primary',
      !isChecked && 'bg-input',
      props.class
    )"
    :data-state="isChecked ? 'checked' : 'unchecked'"
    @click="isChecked = !isChecked"
  >
    <span
      :class="cn(
        'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
        isChecked ? 'translate-x-5' : 'translate-x-0'
      )"
    />
  </button>
</template>