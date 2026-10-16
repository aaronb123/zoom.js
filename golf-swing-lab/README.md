# Swing Lab

A private golf swing coach that runs in the browser. Record or drop in a phone video and it:

- finds every swing in the clip (one swing, a Topgolf bucket, or a whole 40-minute lesson)
- tracks 33 body points on every frame with **BlazePose GHUM Heavy** (the model behind MediaPipe Pose) on TensorFlow.js WebGL, so it runs even where WebAssembly is blocked
- marks address, halfway back, top, halfway down, impact and finish, and times rhythm (impact from the strike sound when the audio decodes)
- scores 18 swing checks against published tour and amateur reference ranges, honestly: a beginner cannot score 80
- shows one fix at a time with a drill, coach lines on the video, and a check only counts as fixed after five good swings in a row
- tracks progress, a "road to 90" round log with a WHS-style handicap estimate, a crew leaderboard, and lets Coach Claude review a swing or answer questions

Video never leaves the device. Only scores and a few small stills are saved.

## Accuracy

The pipeline follows published practice for single-camera golf analysis:

- golfer-cropped input so bystanders are ignored and the model gets more pixels
- every video frame through the swing (frame rate measured from the video)
- offline, zero-lag cleaning: left/right swap repair (Viterbi per limb chain, feet anchored), Hampel outlier filter, forward-backward Butterworth low-pass with per-joint cutoffs (6–12 Hz)
- distances scaled from the golfer's height via shin length (not a fixed torso guess)
- head position from the ear midpoint, not the nose
- a tracking-quality gate (body size, frame edges, camera movement, square camera, frame rate) that switches checks off instead of guessing

Expected precision with good filming (estimates, to be confirmed against a coach's hand marks): rhythm ±0.2 at 60 fps (±0.5 at 30 fps), posture change and knee flex about ±5°, sway and shift about ±2–3 cm, turn angles ±10° (labelled estimates). There is no club or ball tracking.

## Develop

```
node tools/build.mjs             # src/ -> index.html (an artifact page body)
node tools/serve.mjs 8080        # http://localhost:8080
```

`src/core.js` engine, sampling, cleaning, events, quality · `src/checks.js` checks, reference ranges, scoring · `src/ui.js` interface · `src/markup.html`, `src/styles.css`.

## Analyze a clip headless

```
NODE_PATH=$(npm root -g) node tools/analyze-clip.mjs swing.webm --view auto --hand R --height 180 --shots out/
```

Headless Chromium cannot decode H.264, so convert first: `ffmpeg -i swing.mp4 -c:v libvpx-vp9 swing.webm`.
`SWINGLAB_CSP="script-src 'unsafe-inline' 'self' https://cdn.jsdelivr.net/npm/"` mimics the artifact viewer's restrictions;
`SWINGLAB_NO_BIN=1 SWINGLAB_OVERLAY=<dir>` serves the base64 model chunks instead of the raw files.

## Publishing as an artifact

The artifact host serves text, not raw binaries, so `tools/build-artifact.sh <dir>` writes the model weights as base64 chunks (`*.bin.b64.N.txt`) that the app reassembles.
