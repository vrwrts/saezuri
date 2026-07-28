import type { LayoutManifest } from './manifest.ts'

// Fallback-only manifest, baked from pipeline output. The mask is the exact
// silhouette of public/assets/illustrations/_fallback.png so packing is
// faithful even with no manifest file present — a fresh checkout, a build that
// ships no borrowed art, or (server-side) the refresh service before the first
// build_masks run.
//
// Kept in its own React/SWR-free module so both the browser hook
// (useLayoutManifest) and the Node refresh service can import it without one
// pulling the other's dependencies into its bundle.
export const DEFAULT_MANIFEST: LayoutManifest = {
  dims: { _fallback: [560, 460] },
  masks: {
    _fallback: {
      w: 93,
      h: 76,
      bits: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/gAAAAAAAAAAAAD//AAAAAAAAAAAAA//+AAAAAAAAAAAAP//4AAAAAAAAAAAD///AAAAAAAAAAAA///8AAAAAAAAAAAP///wAAAAAAAAAAB///+AAAAAAAAAAAP///8AAAAAAAAAwD/j///gAAAAAAAB4f8f///gAAAAAAAH//3////gAAAAAAAP///////AAAAAAAAf//////8AAAAAAAB///////wAAAAAAAD///////gAAAAAAAP//////+AAAAAAAA///////wAAAAAAAH///////AAAAAAAAf//////8AAAAAAAD///////gAAAAAAA///////+AAADAAAH///////wAAH4AAB////////AAP/AAAP///////4Af/wAAB////////B//+AAAP///////////wAAB///////////8AAAP///////////gAAB///////////8AAAP///////////gAAB////////D//4AAAP///////4D//AAAB////////AD/4AAAH///////wAD+AAAA///////+AADwAAAD///////gAAAAAAAf//////8AAAAAAAB///////AAAAAAAAH//////wAAAAAAAAf/////8AAAAAAAAB//////AAAAAAAAAH/////wAAAAAAAAAf////8AAAAAAAAAA////+AAAAAAAAAAB////AAAAAAAAAAAB///gAAAAAAAAAAAB//AAAAAAAAAAAAACAgAAAAAAAAAAAAAQEAAAAAAAAAAAAACAgAAAAAAAAAAAAAQEAAAAAAAAAAAAACAgAAAAAAAAAAAAAQEAAAAAAAAAAAAACAgAAAAAAAAAAAAAQEAAAAAAAAAAAD/////wAAAAAAAAAf/////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    },
  },
  fallbackKey: '_fallback',
}
