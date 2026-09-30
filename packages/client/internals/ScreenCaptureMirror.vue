<script setup lang="ts">
import { shallowRef, useTemplateRef, watch } from 'vue'

// Whether a screen is currently being shared to the audience view. This state is
// owned by the presenter page so it survives switching the main area away from
// the "Screen Mirror" tab — sharing keeps running while you look at your slides.
const props = defineProps<{
  sharingToAudience: boolean
  audienceStream: MediaStream | null
}>()
const emit = defineEmits<{
  (e: 'toggleShareToAudience'): void
}>()

const video = useTemplateRef('video')
const audiencePreview = useTemplateRef('audiencePreview')
const stream = shallowRef<MediaStream | null>(null)
const started = shallowRef(false)

async function startCapture() {
  stream.value = await navigator.mediaDevices.getDisplayMedia({
    video: {
      // @ts-expect-error missing types
      cursor: 'always',
    },
    audio: false,
    selfBrowserSurface: 'include',
    preferCurrentTab: false,
  })
  video.value!.srcObject = stream.value
  video.value!.play()
  started.value = true
  stream.value.addEventListener('inactive', () => {
    video.value!.srcObject = null
    started.value = false
  })
  stream.value.addEventListener('ended', () => {
    video.value!.srcObject = null
    started.value = false
  })
}

watch([() => audiencePreview.value, () => props.audienceStream], ([el, s]) => {
  if (el) {
    el.srcObject = s ?? null
    if (s)
      el.play().catch(() => {})
  }
})
</script>

<template>
  <div h-full w-full>
    <video v-show="started" ref="video" class="w-full h-full object-contain" />

    <div v-if="!started" w-full h-full flex="~ col gap-6 items-center justify-center" p6 of-auto>
      <div flex="~ col gap-1 items-center">
        <div text-lg font-bold>
          Screen Capture
        </div>
        <div op50 text-sm text-center max-w-2xl>
          Both options use your browser's screen-capture picker. The difference is <b>where</b> the captured screen or window shows up.
        </div>
      </div>

      <div flex="~ col md:row gap-4 items-stretch justify-center" w-full max-w-3xl>
        <!-- Mirror into the presenter view (this screen) -->
        <div flex="~ col gap-3 items-center" border="~ main rounded-lg" p4 flex-1>
          <div class="i-carbon:laptop text-3xl op75" />
          <div font-bold>
            Mirror to presenter view
          </div>
          <div op50 text-sm text-center flex-auto>
            Capture another monitor or window and display it <b>here, on your presenter screen</b>. Useful to watch a live demo or see what's on your other display while presenting.
          </div>
          <button class="slidev-form-button" @click="startCapture">
            Start Mirroring
          </button>
        </div>

        <!-- Share onto the audience's main view -->
        <div flex="~ col gap-3 items-center" border="~ main rounded-lg" p4 flex-1 :class="sharingToAudience ? 'border-green/60' : ''">
          <div class="i-carbon:screen text-3xl op75" />
          <div font-bold>
            Share to audience
          </div>
          <div op50 text-sm text-center flex-auto>
            Capture a screen or window and show it on the <b>main view your audience sees</b>, on top of the current slide. Useful for live demos or external apps without leaving Slidev.
          </div>
          <video
            v-show="sharingToAudience && audienceStream"
            ref="audiencePreview"
            class="w-full max-h-28 rounded border border-main object-contain bg-black"
            muted
            playsinline
          />
          <div v-if="sharingToAudience" flex="~ gap-1 items-center" text-green text-xs>
            <div class="i-carbon:dot-mark" />
            Live to audience
          </div>
          <button class="slidev-form-button" :class="sharingToAudience ? '!text-red border-red/40' : ''" @click="emit('toggleShareToAudience')">
            {{ sharingToAudience ? 'Stop Sharing' : 'Share to Audience' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
