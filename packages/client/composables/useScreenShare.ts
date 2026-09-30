import { onScopeDispose, shallowRef, watch } from 'vue'
import { screenShareState } from '../state/screenShare'

/**
 * Screen sharing from the presenter view to the audience (play) view.
 *
 * The existing "Screen Mirror" feature pulls another monitor/window *into* the
 * presenter view. This is the opposite: the presenter captures a screen/window
 * and pushes it onto the main slides view that the audience sees.
 *
 * A captured `MediaStream` can't travel through the synced state, so the live
 * video is delivered over WebRTC. The offer/answer/ICE handshake, however, goes
 * through Slidev's regular sync transport via `screenShareState` — so signaling
 * works across devices wherever the rest of the presenter/viewer sync does
 * (e.g. `slidev --remote`). Establishing the media stream across networks may
 * still require a TURN server, which Slidev does not provide.
 */

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

function randomId() {
  return Math.random().toString(36).slice(2, 10)
}

// Raise the per-stream encoder budget well above the WebRTC default (which is
// tuned for camera video) and keep full resolution under bandwidth pressure.
const MAX_VIDEO_BITRATE = 12_000_000 // 12 Mbps

async function tuneVideoSenders(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video')
      continue
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0)
      params.encodings = [{}]
    params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE
    params.degradationPreference = 'maintain-resolution'
    try {
      await sender.setParameters(params)
    }
    catch {
      // some browsers reject parameter changes; fall back to defaults
    }
  }
}

async function addCandidates(
  pc: RTCPeerConnection,
  candidates: RTCIceCandidateInit[],
  processed: { count: number },
) {
  for (let i = processed.count; i < candidates.length; i++) {
    try {
      await pc.addIceCandidate(candidates[i])
    }
    catch {
      // ignore candidates that can't be added yet
    }
  }
  processed.count = candidates.length
}

/**
 * Presenter side: capture a screen/window and offer it to any audience view.
 */
export function usePresenterScreenShare() {
  const selfId = randomId()
  const stream = shallowRef<MediaStream | null>(null)
  const sharing = shallowRef(false)

  const peers = new Map<string, RTCPeerConnection>()
  const negotiating = new Set<string>()
  const answered = new Set<string>()
  const processedCandidates = new Map<string, { count: number }>()

  function closePeer(viewerId: string) {
    const pc = peers.get(viewerId)
    if (pc) {
      pc.onicecandidate = null
      pc.onconnectionstatechange = null
      pc.close()
      peers.delete(viewerId)
    }
    negotiating.delete(viewerId)
    answered.delete(viewerId)
    processedCandidates.delete(viewerId)
    delete screenShareState.presenter.offers[viewerId]
  }

  async function offerTo(viewerId: string) {
    if (!stream.value || negotiating.has(viewerId) || peers.has(viewerId))
      return
    negotiating.add(viewerId)

    const pc = new RTCPeerConnection(RTC_CONFIG)
    peers.set(viewerId, pc)
    // Create the slot up front so ICE candidates have somewhere to land.
    screenShareState.presenter.offers[viewerId] = { candidates: [] }

    for (const track of stream.value.getTracks())
      pc.addTrack(track, stream.value)

    pc.onicecandidate = (e) => {
      if (e.candidate && screenShareState.presenter.offers[viewerId])
        screenShareState.presenter.offers[viewerId].candidates.push(e.candidate.toJSON())
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
        closePeer(viewerId)
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await tuneVideoSenders(pc)
    if (screenShareState.presenter.offers[viewerId])
      screenShareState.presenter.offers[viewerId].sdp = offer
    negotiating.delete(viewerId)
  }

  async function reconcile() {
    if (!sharing.value || screenShareState.presenter.id !== selfId)
      return

    const viewers = screenShareState.viewers
    // Drop peers for viewers that have gone away.
    for (const viewerId of [...peers.keys()]) {
      if (!viewers[viewerId] || viewers[viewerId].presenterId !== selfId)
        closePeer(viewerId)
    }
    // Connect / advance each viewer addressed to us.
    for (const [viewerId, entry] of Object.entries(viewers)) {
      if (!entry || entry.presenterId !== selfId)
        continue

      if (!peers.has(viewerId)) {
        await offerTo(viewerId)
        continue
      }

      const pc = peers.get(viewerId)!
      if (entry.answer && !answered.has(viewerId)) {
        answered.add(viewerId)
        await pc.setRemoteDescription(entry.answer)
      }
      if (pc.currentRemoteDescription) {
        const processed = processedCandidates.get(viewerId) ?? { count: 0 }
        processedCandidates.set(viewerId, processed)
        await addCandidates(pc, entry.candidates, processed)
      }
    }
  }

  async function start() {
    if (sharing.value)
      return
    const captured = await navigator.mediaDevices.getDisplayMedia({
      video: {
        // @ts-expect-error non-standard but widely supported
        cursor: 'always',
        // Capture at the source's full resolution (up to 4K) and a smooth
        // frame rate, so detail isn't lost before it reaches the encoder.
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30 },
      },
      audio: false,
      selfBrowserSurface: 'exclude',
      preferCurrentTab: false,
    })

    // Hint the encoder to favour sharpness over frame rate — screen content is
    // mostly static text/UI where crisp detail matters more than motion.
    for (const track of captured.getVideoTracks())
      track.contentHint = 'detail'

    stream.value = captured
    sharing.value = true
    screenShareState.presenter.offers = {}
    screenShareState.presenter.id = selfId

    captured.getVideoTracks()[0]?.addEventListener('ended', stop)
  }

  function stop() {
    if (!sharing.value)
      return
    sharing.value = false

    for (const viewerId of [...peers.keys()])
      closePeer(viewerId)

    stream.value?.getTracks().forEach(track => track.stop())
    stream.value = null

    if (screenShareState.presenter.id === selfId) {
      screenShareState.presenter.id = ''
      screenShareState.presenter.offers = {}
    }
  }

  function toggle() {
    return sharing.value ? stop() : start()
  }

  watch(() => screenShareState.viewers, reconcile, { deep: true })

  onScopeDispose(stop)

  return { stream, sharing, start, stop, toggle }
}

/**
 * Audience (play) side: receive the presenter's captured screen and expose the
 * incoming stream for display over the slides.
 */
export function useViewerScreenShare() {
  const selfId = randomId()
  const stream = shallowRef<MediaStream | null>(null)

  let pc: RTCPeerConnection | null = null
  let presenterId: string | null = null
  let offerApplied = false
  const processed = { count: 0 }

  function teardown() {
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
      pc = null
    }
    presenterId = null
    offerApplied = false
    processed.count = 0
    stream.value = null
  }

  function ensurePeer() {
    if (pc)
      return pc
    const peer = new RTCPeerConnection(RTC_CONFIG)
    peer.onicecandidate = (e) => {
      if (e.candidate && screenShareState.viewers[selfId])
        screenShareState.viewers[selfId].candidates.push(e.candidate.toJSON())
    }
    peer.ontrack = (e) => {
      stream.value = e.streams[0] ?? new MediaStream([e.track])
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected')
        teardown()
    }
    pc = peer
    return peer
  }

  async function reconcile() {
    const presenter = screenShareState.presenter

    // `id === ''` means nobody is sharing.
    if (!presenter.id) {
      if (presenterId !== null) {
        teardown()
        delete screenShareState.viewers[selfId]
      }
      return
    }

    // A presenter (re)started sharing — request a fresh connection.
    if (presenter.id !== presenterId) {
      teardown()
      presenterId = presenter.id
      screenShareState.viewers[selfId] = { presenterId: presenter.id, candidates: [] }
      return
    }

    // Our entry may have been dropped by a merge — re-announce.
    if (!screenShareState.viewers[selfId]) {
      screenShareState.viewers[selfId] = { presenterId: presenter.id, candidates: [] }
      return
    }

    const offer = presenter.offers[selfId]
    if (offer?.sdp && !offerApplied) {
      offerApplied = true
      const peer = ensurePeer()
      await peer.setRemoteDescription(offer.sdp)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      if (screenShareState.viewers[selfId])
        screenShareState.viewers[selfId].answer = answer
    }

    if (offerApplied && pc?.currentRemoteDescription && offer)
      await addCandidates(pc, offer.candidates, processed)
  }

  watch(() => screenShareState.presenter, reconcile, { deep: true })

  // Announce ourselves in case a presenter is already sharing.
  reconcile()

  onScopeDispose(() => {
    delete screenShareState.viewers[selfId]
    teardown()
  })

  return { stream }
}
