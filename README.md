# 🚀 Auto Video Cutter Pro

Auto Video Cutter Pro adalah aplikasi web revolusioner yang dirancang untuk memotong video secara otomatis (Batch Processing) sepenuhnya di sisi klien (browser). Dibangun tanpa framework, aplikasi ini memanfaatkan tenaga **FFmpeg WASM** untuk memproses video secara lokal tanpa memerlukan server *backend* atau proses *upload*.

Aplikasi ini dibalut dengan antarmuka UI/UX bernuansa *Glassmorphism* dan *Dark Mode* yang modern, futuristik, dan responsif untuk semua perangkat.

---

## ✨ Fitur Utama

- **⚡ 100% Client-Side Processing:** Seluruh proses *cutting* dan *encoding* dilakukan di dalam RAM browser menggunakan WebAssembly. Tidak ada antrean server, tidak ada risiko privasi.
- **✂️ Auto Batch Cutting:** Masukkan daftar *timestamp* (contoh: `00:00 - 00:30`), dan aplikasi akan memotong video menjadi banyak bagian secara otomatis.
- **📁 Import & Export Cut List:** Dukungan untuk mengimpor file `TXT`, `CSV`, atau `JSON` yang berisi daftar waktu pemotongan.
- **🚀 Fast Mode & Quality Mode:** Pilihan mode pemotongan tanpa render ulang (*Lossless / Copy Codec*) untuk kecepatan kilat, atau *Re-encode* untuk akurasi *keyframe* tingkat tinggi.
- **📦 Download ZIP:** Mengunduh seluruh hasil potongan video sekaligus dalam satu file `.zip` (didukung oleh JSZip).
- **🧹 Auto Memory Management:** Sistem pembersihan memori otomatis (Garbage Collection via `URL.revokeObjectURL` & `FS.unlink`) untuk mencegah *browser crash* saat memproses file besar.
- **🎨 Modern UI/UX:** Desain *Glassmorphism* yang elegan, indikator *progress bar realtime*, sistem *Queue*, dan notifikasi *Toast*.

---

## 🛠️ Teknologi yang Digunakan

- **HTML5 & CSS3** (Pendekatan Native & Semantik)
- **Vanilla JavaScript (ES6+)**
- **Google Gemini AI**
- **[FFmpeg WASM](https://ffmpegwasm.netlify.app/)** (v0.12.x) - *Core Engine*
- **[JSZip](https://stuk.github.io/jszip/)** - *Batch zipping library*
- **[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)** - *Bypass HTTP Headers untuk GitHub Pages*

---

## 📂 Struktur Direktori

```text
auto-video-cutter/
│
├── index.html                # Struktur utama & pemuatan library via CDN
├── style.css                 # Styling UI, Animasi, dan Glassmorphism (Dark Theme)
├── script.js                 # Logika aplikasi, Manajemen State, & Eksekusi FFmpeg
├── coi-serviceworker.min.js  # Script wajib untuk hosting di GitHub Pages
└── README.md                 # Dokumentasi Project
