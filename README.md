# 🚀 Professional Video Automation Studio

A powerful, entirely client-side web application designed for processing, cutting, and exporting videos automatically. Built without frontend frameworks, this studio utilizes **FFmpeg WASM** to handle everything locally inside your browser—no backend servers or cloud rendering required.

Features a sleek **Glassmorphism Dark Mode** UI, multi-page navigation, project management, and automated workflows.

---

## ✨ Key Features

- **⚡ 100% Client-Side Processing**: All video editing and encoding happen in the browser's RAM using WebAssembly. Your files never leave your device.
- **🎬 Advanced Video Player**: Built-in player with timeline scrubber, frame capture, and precise "Set Start/End" capabilities.
- **✂️ Auto Batch Cutting**: 
  - **Fixed Duration**: Split videos into equal segments (e.g., every 30s).
  - **Custom Timestamps**: Import text/JSON lists of cut points.
  - **Scene Detection**: Automatically detect scene changes and split accordingly.
- **📋 Cut List Editor**: Drag-and-drop table interface to manage segments with inline editing and Undo/Redo history.
- **🔄 Batch Queue System**: Process multiple videos and clips sequentially. Real-time progress, speed, and ETA tracking.
- **📺 YouTube Metadata Import**: Fetch video info via oEmbed API. *(Note: Actual video download requires configuring a backend proxy).*
- **📱 SnackVideo Export Workflow**: Prepare clips with auto-generated captions, hashtags, and metadata for easy manual upload to SnackVideo.
- **💾 Project Management**: Save, load, export, and import complete project states (JSON) with automatic background saving.
- **⚙️ Advanced Output Settings**: Configure video codecs (copy, H.264, VP9), audio, resolutions, and quality (CRF). Includes a **Short Video Mode (9:16)** with center-crop or fit strategies.
- **🧹 Memory Management**: Robust garbage collection and Blob/URL revocation to prevent browser crashes on large files.

---

## 🛠️ Technology Stack

- **HTML5 & CSS3** (Custom properties, CSS Grid, Flexbox, Native Media Queries)
- **Vanilla JavaScript (ES6+)** (ES Modules, Classes, Async/Await)
- **[FFmpeg WASM](https://ffmpegwasm.netlify.app/) (v0.12)** - Core video processing engine
- **IndexedDB & LocalStorage** - Local data persistence
- **[JSZip](https://stuk.github.io/jszip/)** - Batch file downloading
- **[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)** - Bypasses CORS/SharedArrayBuffer restrictions

---

## 📂 Architecture

```text
video-cutter/
│
├── index.html                # Single Page Application Shell
├── style.css                 # Comprehensive Design System (~1500 lines)
├── js/                       # Modular ES6 JavaScript
│   ├── app.js                # Main Application Controller & Router
│   ├── utils.js              # EventBus, Formatters, SVG Icons
│   ├── storage.js            # IndexedDB & LocalStorage Manager
│   ├── ffmpeg-manager.js     # FFmpeg WASM Wrapper & Memory Manager
│   ├── video-player.js       # Custom Video Player Engine
│   ├── thumbnail.js          # Canvas/FFmpeg Thumbnail Generator
│   ├── cutter.js             # Cut List Editor & Auto-Split Logic
│   ├── queue.js              # Batch Processing Queue
│   ├── youtube.js            # YouTube oEmbed Importer
│   ├── snackvideo.js         # SnackVideo Export Workflow
│   └── project.js            # Project State Manager
│
├── ffmpeg/                   # FFmpeg WASM Core Files (Preserved)
├── coi-serviceworker.min.js  # Cross-Origin Isolation Worker
└── README.md                 # Documentation
```

---

## 🚀 Getting Started

1. **Serve the Directory**: Since this app relies on `SharedArrayBuffer` (required for FFmpeg WASM), it must be served over a secure context with specific headers. You cannot simply open `index.html` from the file system.
2. **Local Testing**:
   Use a local server capable of setting `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`. The included `coi-serviceworker.min.js` attempts to handle this automatically for basic HTTP servers.
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Using Node (http-server)
   npx http-server -p 8000
   ```
3. Open `http://localhost:8000` in your browser.

## ⚠️ Limitations & Notes

- **Browser Memory**: WebAssembly has memory limits (usually ~2GB-4GB depending on the browser). Processing extremely large 4K files may result in Out-Of-Memory errors.
- **YouTube Downloads**: Direct browser-based YouTube downloading is blocked by CORS. The YouTube Import module provides metadata and requires a configured backend proxy to fetch actual video files.
- **SnackVideo API**: SnackVideo does not provide a public upload API. The app generates an "Export Workflow" that bundles the videos and metadata for manual upload.
