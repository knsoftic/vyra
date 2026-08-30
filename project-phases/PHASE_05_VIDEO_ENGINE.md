# PHASE 5 — VIDEO PROCESSING AND STREAMING

**Status:** Backend complete — 2026-08-29 · Device playback targets outstanding · **Depends on:** Phase 4 ✅
**Gate:** every rendition produced; playback starts under 1s on mid-tier devices.

---

## OBJECTIVE

A reliable pipeline that turns an upload into fast, adaptive, globally delivered playback — and the
analysis that feeds the recommendation engine.

---

## PIPELINE

```
Upload (resumable)
  -> Validate (extension + MIME + magic bytes + size + duration + codec)
  -> Store original in object storage (immutable, retained)
  -> Queue processing job
  -> Apply edit decision list (FFmpeg filter graph)
  -> Transcode ABR ladder: 240p 360p 480p 720p 1080p
  -> Package HLS (+ optional DASH), generate thumbnails and cover candidates
  -> Extract audio track and waveform
  -> Quality scoring  (Phase 5)
  -> Content intelligence (Phase 6/7 input)
  -> Publish -> CDN
```

Every stage is idempotent and retryable. A failed stage never loses the original.

---

## VIDEO QUALITY SCORE (0–100)

Technical analysis: resolution · fps · bitrate · blur · sharpness · lighting · exposure · noise ·
stability · audio quality · aspect ratio · compression artefacts · black frames · corrupted frames.

Score is stored **decomposed**, not as a single opaque number:

| Component | Used for |
|---|---|
| Technical quality | Mild ranking adjustment only |
| Content relevance | Ranking input |
| Thumbnail quality | Ranking + cover suggestion |
| Caption relevance | Ranking input |
| Spam probability | Can suppress |
| Duplicate probability | Can suppress |
| Safety status | Can suppress / block |

**Rule (ADR-011): a video is never suppressed merely because it was recorded on an inexpensive
phone.** Only safety, spam and duplicate signals suppress distribution. Audience response outweighs
technical quality.

---

## PLAYBACK

- Adaptive bitrate selection from network conditions
- Preload window: next 2–3 videos prefetched, previous 1 retained
- Player instance recycling in the feed — never one player per list item
- Start-of-playback target: **under 1 second** on a mid-tier device on 4G
- Offline-tolerant buffering and graceful degradation on poor networks

---

## STORAGE AND DELIVERY

- Media lives in object storage, **outside** any code or deployment directory
- Originals, renditions, thumbnails and audio in separate prefixes with distinct lifecycle rules
- Signed URLs for private and follower-only content
- CDN in front of all public renditions

---

## EXIT CRITERIA

1. Every rendition and thumbnail is produced for a representative sample of source videos.
2. Playback start time meets budget on the mid-tier device.
3. Feed scroll holds 60fps on the low-end device with preloading active.
4. Quality scores are produced and stored decomposed.
5. A killed worker mid-job resumes without duplicating or losing output.
6. Admin can trigger reprocessing and quality recalculation for a video.


---

## COMPLETION RECORD — 2026-08-29

### What was built

| Area | Delivered |
|---|---|
| Validation | Magic-byte checking, executable rejection, MIME/content agreement, ffprobe inspection |
| ABR ladder | 240p–1080p, never upscaled, aligned keyframes across renditions |
| Packaging | HLS segments plus a generated master playlist ordered cheapest-first |
| Thumbnails | Poster frame and cover candidates, skipping the black frames videos open on |
| Quality | Decomposed score with the suppression rule enforced in code (ADR-011) |
| Pipeline | Eight recorded stages, atomically claimed, resumable, stall-swept (ADR-024) |
| Playback | Privacy-gated URLs; signed for restricted media, plain CDN for public |
| Admin | Reprocess and rescore, audited, source never touched |

Migration `013_processing_pipeline`: `processing_stages`, `video_probes`, and the columns playback
needs on `videos`.

### Exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Every rendition and thumbnail produced for a sample of sources | 🟡 Translation verified as a pure function; no real transcode — FFmpeg is not installed here |
| 2 | Playback start under 1s on a mid-tier device | ⛔ Needs a device |
| 3 | Feed holds 60fps on a low-end device with preloading | ⛔ Needs a device |
| 4 | Quality scores produced and stored decomposed | ✅ Verified |
| 5 | Killed worker resumes without duplicating or losing output | ✅ Verified by simulating an abandoned claim |
| 6 | Admin can trigger reprocessing and recalculation | ✅ Verified, with the source proven untouched |

### Verification

- `npm test` — **189 passed, 0 failed**, stable across three consecutive runs.
- 43 live smoke checks against a booted server, walking two users through every phase.
- Typecheck clean across mobile, admin and backend; the admin panel builds.
- Zero database residue after a full run.

### Bugs found — and how

Four of the six were found by the **live smoke test**, not by the unit or integration suites. That
is the point of running one: the suites test units in isolation, and three of these bugs only
appear when the pieces are wired together with a real render job in the queue.

| ID | Severity | Finding |
|---|---|---|
| BUG-014 | **High** | A video whose render was merely slow stalled forever. Polling the render stage consumed an attempt each time, so three polls — fifteen seconds — exhausted the retry budget with nothing having failed |
| BUG-015 | **High** | `status` and `processing_status` could disagree. A stage failing via `failStage` rather than by throwing skipped the reconciliation, leaving a video that read as failed in one column and processing in the other |
| BUG-016 | **High** | A failed video was served as playable. The readiness check only treated `status = 'processing'` as unready, so a failed video fell through with `ready: true` and a null URL |
| BUG-017 | Medium | The render worker published videos before they were transcoded or packaged — exposing a video with no renditions and no manifest |
| BUG-018 | Medium | The render worker wrote `video_assets.kind = 'video'`, which is not in that enum. Before strict SQL mode it was silently stored as `''`, making the asset invisible to the pipeline and stalling it with no error anywhere |
| BUG-019 | Medium | `technicalRankingAdjustment(NaN)` returned NaN. A NaN ranking adjustment poisons every comparison it touches without ever throwing |

Also fixed during this pass: `closeRedis()` hung when the server was unreachable, because `quit()`
queues behind a connection that never opens — the same hang would have taken down the API's
graceful shutdown.

### Not done — and what it needs

- **No video has been transcoded.** FFmpeg is not installed on this machine. The ladder, HLS and
  filter-graph translation are verified as pure functions; the first real render still has to
  happen on a host that has FFmpeg.
- **Exit criteria 2 and 3 need devices.** Playback start time and 60fps scroll cannot be judged from
  a server. These join the device work already carried from Phases 1 and 4.
- **CDN and object storage.** Media is on local disk behind the storage interface. Swapping in S3 or
  MinIO is one driver implementation; no call site changes.
- **Waveform extraction** is stubbed pending the audio work in Phase 9.
