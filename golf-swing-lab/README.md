# Swing Lab

Golf swing analysis that runs in the browser. Drop in a phone video and it:

- finds every swing in the clip (one swing or a whole Topgolf bucket)
- tracks 13 body points frame by frame (MediaPipe Pose, with a TF.js MoveNet fallback)
- marks Address, Top, Impact and Finish, and measures tempo (backswing : downswing)
- scores the swing against beginner-friendly target ranges, picks your #1 focus and gives you a drill for it
- logs every swing, so Progress shows your trend over time and Crew ranks you against your mates

Video never leaves the device. Only scores and four small key frames are saved.

## What it measures

| Face-on | Down the line | Both |
|---|---|---|
| Head sway, hip sway, weight shift at impact, finish position, shoulder and hip turn (estimate) | Posture at address, posture through impact (early extension), hips toward ball, knee flex, head height | Tempo, lead arm at top, finish hold |

Distances are rough centimetres, scaled from your shoulder-to-hip length (taken as 50 cm). It is a 2D camera, so treat
turn angles as estimates. Tempo, posture changes and sway are the most reliable numbers.

## Run it locally

```
node tools/serve.mjs 8080      # then open http://localhost:8080
```

## Analyze a clip headless

```
NODE_PATH=$(npm root -g) node tools/analyze-clip.mjs swing.mp4 --view auto --hand R --shots out/
```

Prints the full analysis as JSON and saves the report screenshot plus key frames. Headless Chromium cannot decode
H.264, so convert first: `ffmpeg -i swing.mp4 -c:v libvpx-vp9 -an swing.webm`.

## Files

- `index.html` – the whole app (written as an artifact page body; `serve.mjs` adds the document wrapper)
- `models/` – MediaPipe `pose_landmarker_full.task`, MoveNet Thunder (TF.js graph model)
- `wasm/`, `vendor/` – MediaPipe runtime and TF.js, used when the CDNs are unreachable
