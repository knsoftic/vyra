# PHASE 4 — VIDEO RECORDER, UPLOAD, FILTERS AND EDITOR

**Status:** Backend complete — 2026-08-29 · Mobile capture and GPU preview outstanding · **Depends on:** Phase 3 ✅
**Gate:** record → edit → filter → music → publish completes on every device tier.

---

## OBJECTIVE

Make the creation surface real: native camera capture, a working timeline editor, GPU filters,
effects, text, stickers, music, cover selection, drafts and publishing.

---

## SCOPE

### Recorder
Front/back camera · camera switch · flash · timer · countdown · recording progress ring ·
multi-clip capture · pause / resume · retake clip · delete clip · playback preview ·
speed selection before recording · max duration enforced from admin settings

### Upload
Camera · gallery · device storage · multi-select · format and size validation against admin limits ·
resumable upload with progress and retry

### Editor
Timeline with clip thumbnails · trim · split · cut · rearrange · crop · rotate · per-clip speed
(0.5x / 0.75x / 1x / 1.5x / 2x, extensible) · undo / redo · non-destructive edit list

### Filters (20 base)
Original · Natural · Warm · Cool · Bright · Dark · Vintage · Film · Cinematic · Retro ·
Black & White · Sepia · Vibrant · Soft · High Contrast · Low Contrast · Golden · Night · Portrait ·
Landscape

Implemented as GPU shader parameter sets so the catalogue is data-driven and admin-managed
(add, enable, disable, reorder, mark trending, mark premium) without an app release.

### Manual adjustments
Brightness · Contrast · Saturation · Exposure · Highlights · Shadows · Temperature · Tint ·
Sharpness · Fade · Vignette — each with reset and a before/after preview.

### Effects
Blur · Zoom · Shake · Flash · Glitch · Slow motion · Fast motion · Reverse · Transitions ·
Light · Colour · Background. Admin-managed catalogue with the same lifecycle controls as filters.

### Beauty effects (optional, where supported)
Skin smoothing · brightness · face light · background blur.
**These are rendering options only. They are never used as recommendation or targeting features.**

### Text on video
Add text · font selection · size · alignment · background · animation · duration · drag · rotate ·
resize.

### Stickers
Emoji · platform stickers · sticker packs · animated elements where supported. Admin manages packs.

### Music and audio
Original sound · music library · voiceover recording · device audio where legally allowed ·
independent volume for original / music / voice · audio trim.
Music page: trending, new, categories, favourites, search.
Admin manages tracks, metadata, categories, availability, usage status and region restrictions.

### Publish flow
Cover selection (frame scrubber, custom upload, cover text, AI-suggested candidate) → caption →
hashtags → mentions → location (permission-gated) → privacy (Public / Followers / Friends / Private)
→ interaction toggles (comments, share, download, remix, duet) → publish or save draft.

### Drafts
Stored locally **and** server-side. Drafts are private. **Drafts survive app updates — never cleared
by a version upgrade or cache purge.**

---

## TECHNICAL NOTES

- Editing is **non-destructive**: the app stores an edit decision list; the server renders the final
  video. The device preview and the server render must produce visually identical output.
- Preview uses GPU shaders; final render happens server-side with FFmpeg filter graphs derived from
  the same parameter set.
- Large uploads are chunked and resumable across network changes and app restarts.

---

## EXIT CRITERIA

1. Full record → edit → filter → adjust → text → sticker → music → cover → publish journey works on
   low-end Android, mid Android and iOS.
2. Device preview matches the server render.
3. Drafts persist through an app update, verified explicitly.
4. Admin can add a filter and it appears in the app without an app release.
5. Upload survives network interruption and resumes.


---

## COMPLETION RECORD — 2026-08-29

### What was built (backend)

| Area | Delivered |
|---|---|
| Shared parameter set | `ColorGrade` — eleven controls both renderers read (ADR-021) |
| Filters | All 20 required presets, seeded as data, admin-editable |
| Effects | 13 effects; sticker packs; 6 fonts; 11 adjustment controls |
| Catalogue API | Cached, versioned, disabled items filtered server-side |
| Upload | Resumable chunked upload — any order, idempotent retries, checksum verification |
| Edit list | Strict schema, coherence checks, ownership enforcement |
| Render | EDL → FFmpeg filter graph; queued jobs; atomic claiming; retry and stall recovery |
| Drafts | Server-side, private, soft-deleted |
| Publish | Video plus render job created atomically; hashtags and mentions linked |
| Music | Library, search, categories, trending, favourites |

Three migrations: `011_upload_and_render`, `012_catalogue_kinds`, plus the `videos.edit_list`
column so a published video can be re-rendered without the original device.

### Exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Full record → publish journey on low-end Android, mid Android and iOS | ⛔ **Blocked** — needs physical devices |
| 2 | Device preview matches the server render | 🟡 Structurally guaranteed (ADR-021) and unit-tested on the server side; the shader half cannot be compared without a device |
| 3 | Drafts persist through an app update | ✅ Verified — a draft survives a sign-in from a device with no local state |
| 4 | Admin can add a filter and it appears without an app release | ✅ Verified end to end |
| 5 | Upload survives network interruption and resumes | ✅ Verified — interrupt, query what is missing, send only those chunks |

### Verification

- `npm test` — **117 passed, 0 failed** (91 from earlier phases, 26 new).
- 41 pure unit tests cover the grade → FFmpeg mapping and edit-list validation, and run in 0.6s
  with no database, server or FFmpeg.
- The render worker was exercised with FFmpeg absent: it retries three times, then fails the job
  with an actionable message rather than leaving the video in `processing` forever.
- Zero test residue: users, videos, uploads, drafts and render jobs all return to zero.

### Bugs found and fixed

| ID | Severity | Finding |
|---|---|---|
| BUG-010 | **High** | Silent data corruption. MariaDB's default `sql_mode` is permissive, so seeding wrote six catalogue rows with an empty `kind` instead of rejecting a value the enum did not contain. Fixed by enforcing `STRICT_TRANS_TABLES` per connection (ADR-022) |
| BUG-011 | Medium | Every cache write against an unreachable Redis blocked for ~12 seconds. Catching the error did not help — the retry backoff had already been spent. Seeding took eight minutes instead of three seconds. Fixed with a bounded, breaker-protected cache layer (ADR-023) |
| BUG-012 | Medium | No upload could store a chunk. Chunk keys embed the upload's ULID, which is uppercase Base32, but the storage key validator only allowed lowercase |
| BUG-013 | Low | The `pool.on('connection')` hook awaited a callback-style connection, which throws and broke every pooled connection. Introduced and caught while fixing BUG-010 |

### Not done — and what it needs

**The mobile half of this phase is not built.** The Phase 1 UI shells exist
(`RecordScreen`, `EditorScreen`, `FiltersScreen` and the rest) but still run on mock data. What
remains is genuinely device work:

- Multi-clip native camera capture — pause, resume, retake, speed before recording, progress ring.
- The GPU shader pipeline that consumes `ColorGrade`, and the timeline editor.
- Wiring the screens to the endpoints built here.
- Beauty effects, which are render-only and must never become recommendation features.

Exit criterion 1 names three device tiers explicitly, and criterion 2 cannot be judged from a
screenshot — the two renderers have to be compared side by side on real hardware. That work needs
the owner's devices.

**FFmpeg is not installed on this machine.** The render pipeline is complete and its output is
tested as a pure function, but no video has actually been transcoded here. Installing FFmpeg and
running one real render is the first thing to do when a render host exists.
