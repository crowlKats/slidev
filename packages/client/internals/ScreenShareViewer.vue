<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'
import { useViewerScreenShare } from '../composables/useScreenShare'

const { stream } = useViewerScreenShare()
const video = useTemplateRef<HTMLVideoElement>('video')

watch([stream, video], ([s, el]) => {
  if (el) {
    el.srcObject = s
    if (s)
      el.play().catch(() => {})
  }
})
</script>

<template>
  <Transition name="fade">
    <div
      v-if="stream"
      class="slidev-screen-share-viewer absolute inset-0 z-50 bg-black"
    >
      <video
        ref="video"
        class="w-full h-full object-contain"
        autoplay
        playsinline
        muted
      />
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
