# Video Studio

A video editor that runs **entirely in your browser**. No server, no uploads, no database. Your files never leave your device.

- **Quick Editor**: one-job tools. Trim, split, merge, remove audio, extract audio, compress, convert, rotate/flip, resize, change speed.
- **Advanced Editor**: multi-track timeline with video, audio, images and text. Split, trim, move, duplicate, ripple delete, snapping, fades, colour adjustments, waveforms, undo/redo, autosave.
- **Smart Export**: picks the cheapest correct path. Simple cuts copy the original video data (no quality loss); everything else is rendered and re-encoded.
- Deploys as a static site to **Vercel** or **Netlify**.

Stack: React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · [Mediabunny](https://mediabunny.dev) (WebCodecs) · Web Audio API · IndexedDB + OPFS · Zod · Vitest · Playwright.

---

## 1. Set up and run on your PC

**You need:** [Node.js](https://nodejs.org) 20 or newer (22 recommended) and a desktop **Chrome or Edge**.

```bash
cd video-studio
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173).

> WebCodecs only works on `localhost` or HTTPS. `npm run dev` is fine. Opening `index.html` directly from disk will not work.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build at http://localhost:4173 |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | Oxlint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) |
| `npm run check` | Typecheck + lint + unit tests (run before committing) |

## 2. Test it

### Automated

```bash
npm test                          # unit tests, about 1 second
npx playwright install chromium   # first time only (downloads a test browser)
npm run test:e2e                  # builds the app, then drives a real browser
```

- **Unit tests** cover the timeline engine (split, trim, delete, ripple, move, duplicate, snapping, validation), undo/redo and gestures, the Smart Export planner, and the project file format.
- **Browser tests** (`e2e/smoke.spec.ts`, `e2e/cut-merge.spec.ts`) import real videos, edit them, reload to check autosave, and export. They cover the cut/split/merge workflow: split into 3, cut part 2, undo, I/O/X keyboard cut, skip controls, merging a second video and exporting it. They run against the production build.

### Manual checklist (about 5 minutes)

1. **Home**: the page loads and shows no red warning. If it does, your browser lacks WebCodecs. Use Chrome or Edge.
2. **Quick Editor, Trim**: pick *Video Trimmer*, drop a video, set start and end, click *Process & save*. Open the result: it should be exactly the part you chose.
3. **Quick Editor, Merge**: drop two videos, reorder them, process. The output should play both in order.
4. **Advanced Editor**: *New project*, import a video and an audio file.
   - Double-click each media card (or press **Add**) to put it on the timeline.
   - Move the playhead (click the ruler) and press **S** to split. Drag clips. Drag a clip's edge to trim it.
   - **Ctrl/⌘+Z** undoes, **Space** plays.
   - Add a *Caption* in the **Text** tab and edit it on the right.
   - Reload the page. The project and media should come back (autosave).
5. **Split, cut and merge in one go**: import a video. The left panel switches to **Cut & Split**.
   - **Skip around**: use the ±5 s / ±10 s buttons, **J / L** (−5 s / +5 s), **[ / ]** (previous / next cut point), or type a time in *Go to time*.
   - Click **Split into equal parts** with 3, then click **Cut part 2** in the parts list. Parts 1 and 3 join with no gap. **Ctrl+Z** brings part 2 back.
   - Or mark a range: press **I** at the start and **O** at the end, then **X** (cut and join), or use *Cut, keep gap* / *Keep only this*.
   - Open the **Merge** tab, choose another video, then use **Join at end** or **Insert here** (at the playhead).
   - The **Audio** tab removes the original sound or adds music. The **Text** tab adds titles.
6. **Export**: click *Export*. A single untouched or trimmed clip says *Smart Export: fast path*. Add text or a second clip and it says *full render*. Check the file in a player.
7. **Edge cases worth trying**: a video with no audio, an audio-only file, a very large file, a file your browser can't decode (you should get a clear message), cancelling an export halfway.

## 3. Deploy

There is nothing to configure. No environment variables, no server. Build command `npm run build`, output folder `dist`. Both hosts give you HTTPS, which WebCodecs needs.

### Vercel

1. Push the project to GitHub.
2. In Vercel: **Add New, Project**, import the repo. The Vite preset is detected (`vercel.json` already sets it).
3. Click **Deploy**.

Or from the terminal: `npx vercel` (preview) and `npx vercel --prod`.

### Netlify

1. Push the project to GitHub.
2. In Netlify: **Add new site, Import an existing project**. `netlify.toml` already sets the build command, output folder and Node version.
3. Click **Deploy**.

Or from the terminal: `npm run build && npx netlify deploy --prod --dir=dist`. You can also drag the `dist` folder onto https://app.netlify.com/drop (`public/_redirects` makes deep links work in that case).

Both configs rewrite every path to `index.html`, so `/editor/<id>` still works after a refresh.

**Optional, cross-origin isolation.** Only needed if you later add multithreaded FFmpeg.wasm (see roadmap). Run the dev server with `COOP_COEP=1 npm run dev`. For production, add the `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers in `vercel.json` / `netlify.toml`. Mediabunny and WebCodecs do **not** need this.

---

## 4. What was built and why

### The one rule

> The UI never runs media commands. It calls timeline functions that change a plain data model. The engine only *reads* that model when previewing or exporting.

So **Split** in the UI changes JSON, not video. The video is only touched at preview and export time.

### Layers

```
React UI  (features/*, components/)
   │  calls
Zustand store  (store/editorStore.ts: project + undo/redo + selection)
   │  applies pure functions
Timeline engine  (engine/timeline/ops.ts: split, trim, move, ripple, ...)
   │  produces
Project data model  (types/project.ts: Zod schema, library-independent JSON)
   │  read by
┌───────────────────────────┬──────────────────────────────┐
│ Preview engine            │ Export engine                │
│ canvas + <video>/<audio>  │ Mediabunny + WebCodecs       │
└───────────────────────────┴──────────────────────────────┘
   │
Storage  (services/storage.ts: IndexedDB for projects, OPFS for media files)
```

### Folder structure

```
src/
  app/                 shared page header + logo
  components/ui.tsx    Button, Modal, Select, Progress, DropZone, Toaster
  features/
    home/              landing page, new project, recent projects, backup restore
    quick-editor/      tool grid + one generic tool page (tools.ts lists the tools)
    advanced-editor/   page, toolbar, preview, properties, timeline/ (ruler, clips)
    media-library/     imported media list, text presets, re-link missing files
    export/            export dialog
  engine/
    timeline/          ops.ts: pure editing functions (+ tests)
    preview/           PreviewEngine (live playback) + VideoCompositor (shared drawing)
    media/             importer (metadata, thumbnails), waveform peaks, file registry
    export/            planner, renderExport, convertExport, ExportManager, sink
    capabilities/      browser feature detection
  store/               editor store (history, selection, zoom) and toasts
  services/            local storage, project helpers, file hand-off between routes
  types/project.ts     the data model (Zod)
  utils/               time formatting, ids, class names
e2e/                   Playwright tests + a tiny sample video
```

If you replace Mediabunny later, only `engine/export`, `engine/media` and `engine/capabilities` change. The UI and saved projects stay the same.

### Data model (`types/project.ts`)

A project holds **assets** (imported files), **tracks**, and **clips**. A clip is a *reference*: `mediaId`, `timelineStart`, `sourceStart`, `sourceEnd`, `playbackRate`, `volume`, plus opacity, fades, colour and optional text. Splitting a 60 s clip at 20 s gives clips (0-20) and (20-60) that point at the same file. Deleting a clip never deletes the media. The JSON contains no FFmpeg or Mediabunny objects.

### Timeline engine (`engine/timeline/ops.ts`)

Every function takes a project and returns a **new** one: `splitClip`, `trimClip`, `deleteClip`, `rippleDelete`, `moveClip`, `duplicateClip`, `addTrack`, `snapTime`, `validateProject`, and others. It is written and tested before any UI, which is why undo/redo is just a stack of old projects. Clips on one track can never overlap: invalid moves are refused.

### Editor store

`commit()` records an undo step. Drags and sliders use a *gesture* (`beginGesture`, `live`, `endGesture`), so a whole drag is one undo step.

### Preview

`PreviewEngine` draws the timeline on a canvas (video, images, text, opacity, colour) and plays audio through `<video>`/`<audio>` elements. It re-syncs elements if they drift. The same drawing code (`VideoCompositor`) is used by the exporter, so the preview matches the export. Preview audio caps at 100% volume (browser limit); boosts above 100% apply in the export.

### Export and Smart Export

`ExportPlanner` is a pure function that decides the path:

| Case | Path |
| --- | --- |
| One untouched, trimmed or muted video clip | **Fast path**: Mediabunny `Conversion` copies compressed data when the container allows it, re-encoding only when it must |
| Several clips, text, speed, fades, filters, overlays, volume changes | **Full render**: decode, composite on a canvas, re-encode |

The full render:

- decodes frames in order, so each frame is decoded once;
- mixes audio in 5-second windows with an `OfflineAudioContext`, so memory stays flat on long projects;
- runs video and audio concurrently (the muxer needs both);
- picks only codecs your browser can really encode (H.264/AAC for MP4, VP9/Opus for WebM, with fallbacks);
- on Chrome/Edge, **streams straight to a file you choose**, so large exports don't sit in RAM. Other browsers build the file in memory and download it.

Re-encoding is never described as lossless anywhere in the UI.

### Storage

- **IndexedDB**: project JSON and preferences. Projects are validated with Zod when loaded.
- **OPFS**: the imported media files (streamed in, not copied into memory). IndexedDB is the fallback.
- Reloading restores everything. If a media file is gone (cleared site data, restored backup), the media panel shows **re-link**.
- **Backup** downloads the project JSON (the edit, not the media). Browsers can evict storage, so back up important projects.

### Cut, split and merge (left panel tabs)
The left panel is tabbed: **Media**, **Cut & Split**, **Merge**, **Audio**, **Text**. Importing the first video opens *Cut & Split*. These tools only call pure functions in `engine/timeline/ops.ts` (`splitIntoParts`, `cutRange`, `keepRange`, `closeGaps`, `moveSegment`, `insertGap`), so every action is one undo step and is covered by unit tests. Shortcuts: Space/K play, J/L ±5 s, [ ] cut points, I/O marks, X cut, S split, Delete / Shift+Delete.

### Quick Editor

Most tools use the fast `Conversion` path (trim, split, mute, extract audio, convert, rotate/flip, resize, compress). Merge and Speed use the full render. The **Converter** prefers H.264/AAC for MP4 so files play everywhere.

---

## 5. Where this differs from the original blueprint (and why)

| Blueprint | What I did | Why |
| --- | --- | --- |
| shadcn/ui | Small hand-written components in `components/ui.tsx` | The shadcn CLI is interactive and adds many files. These cover everything the app needs. You can still add shadcn later. |
| dnd-kit | Native pointer events (clips) and HTML5 drag-and-drop (media to tracks) | Fewer dependencies, and the timeline needs custom drag maths anyway. |
| wavesurfer.js | Own waveform: peaks computed once at import, drawn as SVG | Wavesurfer wants a full audio element per waveform. Peaks are cheap and saved with the project. |
| Export in a Web Worker | Export runs on the main thread, **asynchronously** | The heavy work (decode/encode) already runs on the browser's own codec threads. Audio mixing needs `OfflineAudioContext`, which does not exist in workers. See roadmap. |
| FFmpeg.wasm fallback | Not included | Everything in scope works without it, and it adds about 30 MB. The export layer is where it would plug in. |
| Transitions | **Fade in / fade out** per clip (picture and sound) | A real cross-dissolve between two clips is on the roadmap. |
| Rotator + GIF maker | Rotator included. **GIF maker shows "soon"** | GIF needs an extra encoder library. |
| Splitter / Merger / etc. as separate files | One generic `QuickToolPage` driven by `tools.ts` | The tools share one workflow, so this avoids ten near-identical files. |

## 6. Honest limits

- **Browsers**: built and tested for desktop **Chrome/Edge**. Firefox and Safari have partial WebCodecs support and are untested. The app tells you when something isn't supported.
- **Codecs vary by browser and OS.** If a file can't be decoded or an encoder is missing you get a plain message, not a crash. For example, some Chromium builds can't encode AAC, so MP4 exports use Opus audio there. Regular desktop Chrome and Edge can.
- **Big files**: 2 GB+ and 4K are handled with streaming where possible, but I have not stress-tested them. Expect slow exports and a warning dialog for 4K or videos over 10 minutes.
- **Frame-accurate cuts** in the fast path: when a cut isn't on a keyframe, Mediabunny re-encodes around it. The Smart Export panel says whether re-encoding happens.
- Preview is a live canvas, not a rendered proxy, so heavy multi-layer 4K projects will play choppily. The export is unaffected.
- No Undo for media import/removal (these are not timeline edits).

## 7. Roadmap ideas

1. Move the export loop to a Worker (use `AudioSampleSink` and mix manually instead of `OfflineAudioContext`).
2. Cross-dissolve transitions and keyframed opacity/position.
3. Lazy-loaded FFmpeg.wasm as a fallback for codecs WebCodecs can't handle.
4. Proxy (low-res) previews for 4K footage.
5. GIF maker; subtitle (SRT) import; crop and per-clip rotation.
6. Project backup with media included (zip).

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Red banner "does not support WebCodecs" | Use a current desktop Chrome or Edge. |
| Blank page after deploy on a deep link | Make sure `vercel.json` / `netlify.toml` / `public/_redirects` were deployed (they send all paths to `index.html`). |
| "codec cannot be decoded by this browser" | Convert the file first (for example HEVC/H.265 to H.264) or try Chrome/Edge. |
| "Browser storage is full" | Delete old projects on the home page or free disk space. |
| `npm run test:e2e` says the browser is missing | Run `npx playwright install chromium` once. |
| Export asks where to save | That's Chrome streaming to disk. Pick a location. |
