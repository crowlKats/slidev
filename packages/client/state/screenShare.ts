// @ts-expect-error - virtual module
import serverScreenShareState from 'server-reactive:screenShare?diff'
import { createSyncState } from './syncState'

/**
 * Signaling state for sharing the presenter's captured screen to the audience
 * (play) view. The live video itself travels over WebRTC; this synced state only
 * carries the offer/answer/ICE handshake.
 *
 * It reuses Slidev's regular sync transport (`BroadcastChannel` in build mode,
 * the dev server WebSocket in server/`--remote` mode), so signaling works across
 * devices wherever the rest of the presenter/viewer sync does.
 *
 * To stay conflict-free under the diff-based merge, every peer only ever writes
 * its *own* subtree: the presenter owns `presenter`, and each viewer owns its
 * entry in `viewers`.
 *
 * Note: we never use `null` in this state. The server-ref diff/apply treats
 * `typeof null === 'object'` and crashes when a `null` transitions into an
 * object, so "nobody is sharing" is represented by `presenter.id === ''`.
 */

export interface ScreenSharePeerOffer {
  sdp?: RTCSessionDescriptionInit
  candidates: RTCIceCandidateInit[]
}

export interface ScreenShareViewerEntry {
  presenterId: string
  answer?: RTCSessionDescriptionInit
  candidates: RTCIceCandidateInit[]
}

export interface ScreenShareState {
  // The presenter currently sharing. `id === ''` means nobody is sharing.
  presenter: {
    id: string
    // Offer + presenter-side ICE candidates, keyed by viewer id.
    offers: Record<string, ScreenSharePeerOffer>
  }
  // Viewers that have requested a connection, keyed by viewer id.
  viewers: Record<string, ScreenShareViewerEntry>
}

export const {
  init: initScreenShareState,
  state: screenShareState,
} = createSyncState<ScreenShareState>(
  serverScreenShareState,
  {
    presenter: { id: '', offers: {} },
    viewers: {},
  },
)
