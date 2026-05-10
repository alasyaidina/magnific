# Magnific Kling 2.6 Motion Control — Desktop App

An Electron + React desktop application for the Magnific API Kling 2.6
**Motion Control** endpoints (Pro 1080p / Standard 720p). Submit a character
image and a reference motion video, watch progress in real time, and download
the generated video to a local folder. All API traffic is performed from the
Electron main process — your API key never touches the renderer.

## Features

- **Motion Control Generator** — pick an image + reference video, set prompt /
  quality / orientation / cfg_scale, submit and watch live status.
- **Task History** — every job is persisted via `electron-store`, with status
  badge, duration, prompt, and download button.
- **Download Result** — save generated MP4s to any folder you choose.
- **Multi API key management** — store any number of keys with labels, switch
  the active key with one click, and the app will automatically fall back to
  the next available key on `429` (rate limit) or `402` (insufficient credits)
  responses.
- **Aspect ratio cropper (pre-upload)** — after picking a character image,
  choose a ratio (1:1, 9:16, 16:9, 4:3) and drag the crop box in a modal
  before submission. The cropped JPEG is uploaded in place of the original.
  Pick **Free** to skip cropping and upload the source as-is. The Magnific
  request body is unchanged — output orientation is still derived from the
  uploaded image.
- **Resume polling on restart** — any task still `IN_PROGRESS` when the app
  closes will be polled again on next launch.

## Stack

- Electron 28 (CommonJS main process)
- React 18 + Vite 5 (renderer)
- Tailwind CSS v3 (dark theme: `#0f0f0f` / `#1a1a1a` / `#7c3aed`)
- axios for HTTP
- `electron-store` for persistence
- No backend server. The Magnific API is called directly from the main
  process; local files are uploaded to a temporary public URL via
  [transfer.sh](https://transfer.sh) before being submitted.

## Project layout

```
.
├── Start Magnific.bat        # Windows one-click launcher
├── Start Magnific.command    # macOS one-click launcher
├── Start Magnific.sh         # Linux one-click launcher
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── electron/
│   ├── main.js          # Electron main process, IPC handlers, API calls
│   └── preload.js       # contextBridge: uploadFile, submitTask, pollTask, downloadVideo, store
├── src/
│   ├── main.jsx         # React entry
│   ├── App.jsx          # Tab navigation: Generator | History | Settings
│   ├── index.css        # Tailwind directives
│   ├── components/
│   │   ├── StatusBadge.jsx
│   │   └── Toasts.jsx
│   ├── hooks/
│   │   └── useStore.js
│   └── pages/
│       ├── Generator.jsx
│       ├── History.jsx
│       └── Settings.jsx
└── .env.example
```

## Quick start (one-click launchers)

After cloning the repo, **double-click** the launcher for your operating
system — it installs dependencies on first run and starts the app. You only
need [Node.js 20 or newer](https://nodejs.org/) installed beforehand.

| Operating system | Double-click this file       |
| ---------------- | ---------------------------- |
| Windows          | `Start Magnific.bat`         |
| macOS            | `Start Magnific.command`     |
| Linux            | `Start Magnific.sh`          |

> macOS may show *“cannot be opened because it is from an unidentified
> developer”* the first time. Right-click the file → **Open** → **Open**, or
> run `xattr -d com.apple.quarantine "Start Magnific.command"` once.
>
> On Linux, some file managers default to opening `.sh` files in a text
> editor. Either run from a terminal (`./Start\ Magnific.sh`) or set the file
> manager to "Run executable text files" / "Run in Terminal".

## Setup (manual / for developers)

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on `http://localhost:5173` and launches Electron once
the dev server is ready. The Electron main process loads from the dev URL in
development and from `dist/index.html` in production builds.

To build the renderer bundle for production:

```bash
npm run build
npm start   # runs Electron against the built bundle
```

## Getting a Magnific API key

1. Sign in at [magnific.ai](https://magnific.ai) and open your account
   dashboard.
2. Navigate to **API** (or **Developer**) settings and create a new API key.
   Magnific keys typically begin with `mag_…`.
3. Copy the key — you will paste it into the app's **Settings** tab.

The app stores keys via `electron-store` under the `keys` collection. The key
value never leaves your machine except as the `x-magnific-api-key` header on
calls to `https://api.magnific.com`.

## Usage

### 1. Add an API key

On first launch the app routes you to the **Settings** tab. Click **Add Key**,
give it a label (e.g. *Production*), paste your `mag_…` key and **Save**. The
first key you add becomes the active key automatically.

### 2. Generate a Motion Control video

In the **Generator** tab:

- Choose a character image (JPG/PNG/WEBP, ≥300px on the short side, ≤10MB).
- (Optional) Pick an aspect ratio button below the image picker — **1:1**,
  **9:16**, **16:9**, or **4:3** opens a crop modal; **Free** uploads the
  original image untouched.
- Choose a reference motion video (MP4/MOV, 3–30s, ≤100MB).
- (Optional) Type a prompt up to 2,500 characters.
- Toggle quality between **Pro 1080p** and **Standard 720p**.
- Toggle character orientation between **Video** (≤30s) and **Image** (≤10s).
- Adjust `cfg_scale` (0–1, default 0.5).
- Click **Submit task**.

The app uploads each file to `transfer.sh`, submits the job to the appropriate
Magnific endpoint, and polls every 5 seconds (max 10 minutes) until the task is
`COMPLETED` or `FAILED`. A live preview and **Download** button appear when
the result is ready.

### 3. Manage history

The **History** tab lists every submitted task with date, status, quality,
duration, prompt and a **Download** button for completed jobs. Tasks still
running can be resumed manually if polling was interrupted.

### 4. Manage multiple keys

The **Settings** tab lets you store any number of keys, each with a label and a
masked preview (`mag_xx…xxxx`). The currently active key has a purple accent
border. **Set Active** promotes a key, **Add Key** opens the inline form, and
**Delete** removes a key (the last remaining key cannot be deleted).

If a Magnific call fails with HTTP `429` or `402`, the app automatically
switches to the next saved key, persists the change, and shows a toast:

> Switched to *Key 2* due to credit limit

If every key is exhausted, the request surfaces an error: *All API keys have
insufficient credits*.

## API endpoints used

| Purpose                          | Method | URL |
| -------------------------------- | ------ | --- |
| Submit Motion Control (Pro)      | POST   | `https://api.magnific.com/v1/ai/video/kling-v2-6-motion-control-pro` |
| Submit Motion Control (Standard) | POST   | `https://api.magnific.com/v1/ai/video/kling-v2-6-motion-control-std` |
| Poll task status                 | GET    | `https://api.magnific.com/v1/ai/image-to-video/kling-v2-6/{task_id}` |

Authentication header on every call: `x-magnific-api-key: {API_KEY}`.

## Persistence schema (`electron-store`)

```jsonc
{
  "keys": [
    { "id": "uuid", "label": "Key 1", "value": "mag_xxx…", "isActive": true }
  ],
  "tasks": [
    {
      "id": "task_…",
      "status": "CREATED|IN_PROGRESS|COMPLETED|FAILED",
      "quality": "pro|std",
      "prompt": "…",
      "imageUrl": "https://transfer.sh/…",
      "videoUrl": "https://transfer.sh/…",
      "resultUrl": "https://…",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

## Environment variables

The app does not require any environment variables — keys live in
`electron-store`. A blank `.env.example` is provided for parity with the spec.

## Security notes

- All Magnific API calls are made in `electron/main.js`. The renderer can only
  submit tasks via the `submitTask`, `pollTask`, etc. IPC channels exposed by
  `electron/preload.js` through `contextBridge`. The renderer never sees the
  raw API key.
- Local file paths are read by the main process; only their public
  `transfer.sh` URLs are sent to Magnific.
- The browser window runs with `contextIsolation: true` and
  `nodeIntegration: false`.
