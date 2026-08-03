/**
 * AUTO VIDEO CUTTER PRO
 * Architecture: Vanilla JS (ES6+), WebAssembly (FFmpeg), JSZip
 * No dependencies other than CDN scripts defined in HTML.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // --- 1. STATE MANAGEMENT ---
    const State = {
        ffmpeg: null,
        isFFmpegLoaded: false,
        currentFile: null,
        videoDuration: 0,
        cutQueue: [],
        completedFiles: [],
        isProcessing: false,
        totalQueue: 0
    };

    // --- 2. DOM ELEMENTS CACHING ---
    const DOM = {
        ffmpegStatus: document.getElementById('ffmpegStatus'),
        dropZone: document.getElementById('dropZone'),
        videoInput: document.getElementById('videoInput'),
        videoPreviewContainer: document.getElementById('videoPreviewContainer'),
        videoPlayer: document.getElementById('videoPlayer'),
        videoName: document.getElementById('videoName'),
        videoDuration: document.getElementById('videoDuration'),
        cutListInput: document.getElementById('cutListInput'),
        btnStartProcess: document.getElementById('btnStartProcess'),
        btnImportText: document.getElementById('btnImportText'),
        importInput: document.getElementById('importInput'),
        btnExportText: document.getElementById('btnExportText'),
        progressContainer: document.getElementById('progressContainer'),
        progressText: document.getElementById('progressText'),
        progressPercent: document.getElementById('progressPercent'),
        progressBar: document.getElementById('progressBar'),
        progressDetail: document.getElementById('progressDetail'),
        resultList: document.getElementById('resultList'),
        btnDownloadZip: document.getElementById('btnDownloadZip'),
        outputPrefix: document.getElementById('outputPrefix'),
        outputFormat: document.getElementById('outputFormat'),
        videoCodec: document.getElementById('videoCodec'),
        toastContainer: document.getElementById('toastContainer')
    };

    // --- 3. UTILITIES & HELPERS ---
    const Utils = {
        formatTime: (seconds) => {
            const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
            const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
            const s = Math.floor(seconds % 60).toString().padStart(2, '0');
            return h === '00' ? `${m}:${s}` : `${h}:${m}:${s}`;
        },
        timeToSeconds: (timeStr) => {
            const parts = timeStr.trim().split(':').map(Number);
            if (parts.some(isNaN)) return -1;
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            return -1;
        },
        showToast: (message, type = 'info') => {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            DOM.toastContainer.appendChild(toast);
            
            // Trigger animation
            requestAnimationFrame(() => toast.classList.add('show'));
            
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        },
        escapeHTML: (str) => str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]))
    };

   // --- 4. FFMPEG INITIALIZATION ---
    async function initFFmpeg() {
        try {
            if (!window.crossOriginIsolated) {
                console.warn("Peringatan: Browser tidak crossOriginIsolated. Pastikan vercel.json berjalan.");
            }

            const { FFmpeg } = window.FFmpegWASM; 
            State.ffmpeg = new FFmpeg();
            
            State.ffmpeg.on('progress', ({ progress }) => {
                if (State.isProcessing && progress >= 0 && progress <= 1) {
                    const percent = Math.round(progress * 100);
                    DOM.progressBar.style.width = `${percent}%`;
                    DOM.progressPercent.textContent = `${percent}%`;
                }
            });

            DOM.ffmpegStatus.textContent = 'Memuat Core Lokal...';
            DOM.ffmpegStatus.className = 'status-badge loading';
            
            // 🔥 Cukup panggil file lokal. Worker (814.ffmpeg.js) akan otomatis terpanggil!
            await State.ffmpeg.load({
                coreURL: 'ffmpeg/ffmpeg-core.js',
                wasmURL: 'ffmpeg/ffmpeg-core.wasm'
            });

            State.isFFmpegLoaded = true;
            DOM.ffmpegStatus.textContent = 'Ready (WASM Active)';
            DOM.ffmpegStatus.className = 'status-badge ready';
            Utils.showToast('FFmpeg berhasil dimuat!', 'success');
            validateInputs();
        } catch (error) {
            console.error("FFmpeg Load Error Detail:", error);
            DOM.ffmpegStatus.textContent = 'Gagal Memuat FFmpeg';
            DOM.ffmpegStatus.className = 'status-badge error';
            Utils.showToast('Gagal memuat engine FFmpeg. Cek Console.', 'error');
        }
    }
    
    // --- 5. EVENT LISTENERS (UI INTERACTIONS) ---
    const setupEventListeners = () => {
        // Drag & Drop
        DOM.dropZone.addEventListener('click', () => DOM.videoInput.click());
        DOM.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            DOM.dropZone.classList.add('dragover');
        });
        DOM.dropZone.addEventListener('dragleave', () => DOM.dropZone.classList.remove('dragover'));
        DOM.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            DOM.dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
        });
        DOM.videoInput.addEventListener('change', (e) => {
            if (e.target.files.length) handleFileSelect(e.target.files[0]);
        });

        // Input Text Validation
        DOM.cutListInput.addEventListener('input', validateInputs);

        // Buttons
        DOM.btnStartProcess.addEventListener('click', startQueueProcess);
        DOM.btnDownloadZip.addEventListener('click', downloadAllAsZip);
        
        // Import/Export
        DOM.btnImportText.addEventListener('click', () => DOM.importInput.click());
        DOM.importInput.addEventListener('change', importTextFile);
        DOM.btnExportText.addEventListener('click', exportTextFile);
    };

    // --- 6. FILE HANDLING & METADATA ---
    const handleFileSelect = (file) => {
        if (!file.type.startsWith('video/')) {
            Utils.showToast('Format tidak didukung. Harap upload video.', 'error');
            return;
        }

        // Clear previous state
        if (State.currentFile) URL.revokeObjectURL(DOM.videoPlayer.src);
        
        State.currentFile = file;
        const videoURL = URL.createObjectURL(file);
        
        DOM.videoPlayer.src = videoURL;
        DOM.videoName.textContent = file.name;
        
        DOM.videoPlayer.onloadedmetadata = () => {
            State.videoDuration = DOM.videoPlayer.duration;
            DOM.videoDuration.textContent = Utils.formatTime(State.videoDuration);
            DOM.videoPreviewContainer.classList.remove('hidden');
            validateInputs();
        };
    };

    // --- 7. PARSER & VALIDATION LOGIC ---
    const parseCutList = () => {
        const text = DOM.cutListInput.value.trim();
        if (!text) return { valid: false, items: [], error: '' };

        const lines = text.split('\n').filter(line => line.trim() !== '');
        const items = [];
        let error = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const parts = line.split('-').map(p => p.trim());
            
            if (parts.length !== 2) {
                error = `Baris ${i + 1}: Format salah. Gunakan Start - End`;
                return { valid: false, items, error };
            }

            const startSec = Utils.timeToSeconds(parts[0]);
            const endSec = Utils.timeToSeconds(parts[1]);

            if (startSec === -1 || endSec === -1) {
                error = `Baris ${i + 1}: Format waktu tidak valid (HH:MM:SS atau MM:SS)`;
                return { valid: false, items, error };
            }

            if (startSec >= endSec) {
                error = `Baris ${i + 1}: Waktu akhir harus lebih besar dari waktu awal`;
                return { valid: false, items, error };
            }

            if (State.videoDuration > 0 && endSec > State.videoDuration) {
                error = `Baris ${i + 1}: Waktu akhir melebihi durasi video (${Utils.formatTime(State.videoDuration)})`;
                return { valid: false, items, error };
            }

            items.push({ 
                index: i + 1, 
                start: startSec, 
                end: endSec,
                startStr: parts[0],
                endStr: parts[1]
            });
        }

        return { valid: true, items, error: '' };
    };

    const validateInputs = () => {
        if (!State.isFFmpegLoaded || !State.currentFile) {
            DOM.btnStartProcess.disabled = true;
            return;
        }

        const parsed = parseCutList();
        if (DOM.cutListInput.value.trim() !== '' && !parsed.valid) {
            DOM.cutListInput.style.borderColor = 'var(--danger-color)';
            DOM.btnStartProcess.disabled = true;
            if(parsed.error) Utils.showToast(parsed.error, 'error');
        } else if (parsed.valid && parsed.items.length > 0) {
            DOM.cutListInput.style.borderColor = 'var(--panel-border)';
            DOM.btnStartProcess.disabled = false;
        } else {
            DOM.btnStartProcess.disabled = true;
        }
    };

    // --- 8. CORE PROCESSING (FFMPEG EXECUTION) ---
    const startQueueProcess = async () => {
        const parsed = parseCutList();
        if (!parsed.valid) return;

        State.cutQueue = parsed.items;
        State.totalQueue = parsed.items.length;
        State.completedFiles = [];
        State.isProcessing = true;

        // Update UI
        DOM.btnStartProcess.disabled = true;
        DOM.btnStartProcess.querySelector('.btn-text').textContent = 'MEMPROSES...';
        DOM.btnStartProcess.querySelector('.spinner').classList.remove('hidden');
        DOM.progressContainer.classList.remove('hidden');
        DOM.resultList.innerHTML = '';
        DOM.btnDownloadZip.classList.add('hidden');

        // Render Queue UI
        State.cutQueue.forEach(job => {
            const el = document.createElement('div');
            el.className = 'result-item status-waiting';
            el.id = `job-${job.index}`;
            el.innerHTML = `
                <div class="item-info">
                    <span class="item-title">Video Part ${job.index}</span>
                    <span class="item-meta">Menunggu Antrean (${job.startStr} - ${job.endStr})</span>
                </div>
            `;
            DOM.resultList.appendChild(el);
        });

        const inputFileName = `input${State.currentFile.name.substring(State.currentFile.name.lastIndexOf('.'))}`;

        try {
            // Write source file to Virtual FS Memory via Native JS
            DOM.progressDetail.textContent = "Menulis file video ke memori sistem...";
            
            // 🔥 MENGGUNAKAN NATIVE ARRAY BUFFER (Tanpa library tambahan)
            const fileData = await State.currentFile.arrayBuffer();
            await State.ffmpeg.writeFile(inputFileName, new Uint8Array(fileData));

            // Iterate through queue
            for (let i = 0; i < State.cutQueue.length; i++) {
                const job = State.cutQueue[i];
                await processSingleCut(job, inputFileName, i + 1);
            }
            
            // Clean up main input file from memory
            await State.ffmpeg.deleteFile(inputFileName);

            // Process Complete
            Utils.showToast('Semua proses potong video selesai!', 'success');
            if (State.completedFiles.length > 0) {
                DOM.btnDownloadZip.classList.remove('hidden');
            }

        } catch (error) {
            console.error("Processing Error:", error);
            Utils.showToast('Terjadi kesalahan kritis saat memproses.', 'error');
        } finally {
            // Reset UI State
            State.isProcessing = false;
            DOM.btnStartProcess.disabled = false;
            DOM.btnStartProcess.querySelector('.btn-text').textContent = 'MULAI PROSES';
            DOM.btnStartProcess.querySelector('.spinner').classList.add('hidden');
            DOM.progressBar.style.width = `100%`;
            DOM.progressPercent.textContent = `100%`;
            DOM.progressDetail.textContent = "Selesai.";
        }
    };

    const processSingleCut = async (job, inputFileName, currentIndex) => {
        const jobEl = document.getElementById(`job-${job.index}`);
        jobEl.className = 'result-item status-processing';
        jobEl.querySelector('.item-meta').textContent = `Memproses (${job.startStr} - ${job.endStr})...`;
        
        DOM.progressText.textContent = `Memproses: ${currentIndex} / ${State.totalQueue}`;
        DOM.progressDetail.textContent = `Memotong segmen ${currentIndex}...`;
        DOM.progressBar.style.width = `0%`; // Reset internal progress

        const format = DOM.outputFormat.value;
        const prefix = DOM.outputPrefix.value || 'Video_';
        const numStr = job.index.toString().padStart(3, '0');
        const outputFileName = `${prefix}${numStr}.${format}`;
        
        const codecMode = DOM.videoCodec.value;
        let ffmpegArgs = [];

        // Metode Cut Cepat & Optimal
        if (codecMode === 'copy') {
            ffmpegArgs = [
                '-ss', job.start.toString(),
                '-i', inputFileName,
                '-to', (job.end - job.start).toString(),
                '-c', 'copy',
                '-avoid_negative_ts', 'make_zero',
                outputFileName
            ];
        } else {
            // Re-encode jika frame tidak pas di keyframe
            ffmpegArgs = [
                '-i', inputFileName,
                '-ss', job.start.toString(),
                '-to', job.end.toString(),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-c:a', 'aac',
                outputFileName
            ];
        }

        try {
            // Eksekusi WASM
            await State.ffmpeg.exec(ffmpegArgs);
            
            // Baca output dan buat Object URL
            const fileData = await State.ffmpeg.readFile(outputFileName);
            const blob = new Blob([fileData.buffer], { type: `video/${format}` });
            const objectUrl = URL.createObjectURL(blob);
            
            // Cleanup file output dari virtual FS (PENTING untuk cegah Memory Leak)
            await State.ffmpeg.deleteFile(outputFileName);

            // Simpan ke array results
            const resultData = {
                name: outputFileName,
                url: objectUrl,
                blob: blob,
                duration: job.end - job.start
            };
            State.completedFiles.push(resultData);

            // Update UI Queue Item menjadi Completed with Actions
            jobEl.className = 'result-item status-completed';
            jobEl.innerHTML = `
                <div class="item-info">
                    <span class="item-title">${Utils.escapeHTML(outputFileName)}</span>
                    <span class="item-meta">Selesai • ${Utils.formatTime(resultData.duration)}</span>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary btn-sm" onclick="window.open('${objectUrl}', '_blank')">▶ Play</button>
                    <a href="${objectUrl}" download="${outputFileName}" class="btn btn-primary btn-sm">↓ Down</a>
                </div>
            `;

        } catch (error) {
            console.error(`Error segment ${job.index}:`, error);
            jobEl.className = 'result-item status-error';
            jobEl.querySelector('.item-meta').textContent = 'Gagal memotong';
        }
    };

    // --- 9. BATCH DOWNLOAD (JSZIP) ---
    const downloadAllAsZip = async () => {
        if (State.completedFiles.length === 0) return;
        
        DOM.btnDownloadZip.disabled = true;
        DOM.btnDownloadZip.textContent = "Mempersiapkan ZIP...";

        try {
            const zip = new JSZip();
            State.completedFiles.forEach(file => {
                zip.file(file.name, file.blob);
            });

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const zipUrl = URL.createObjectURL(zipBlob);
            
            const a = document.createElement('a');
            a.href = zipUrl;
            a.download = `Batch_Videos_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Clean up zip blob url
            setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
            Utils.showToast('File ZIP berhasil diunduh.', 'success');
        } catch (error) {
            console.error("ZIP Error:", error);
            Utils.showToast('Gagal membuat file ZIP.', 'error');
        } finally {
            DOM.btnDownloadZip.disabled = false;
            DOM.btnDownloadZip.textContent = "Download Semua (ZIP)";
        }
    };

    // --- 10. IMPORT & EXPORT TEXT LOGIC ---
    const importTextFile = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            DOM.cutListInput.value = ev.target.result;
            validateInputs();
            Utils.showToast('Daftar potongan berhasil diimpor.', 'success');
            DOM.importInput.value = ''; // reset input
        };
        reader.readAsText(file);
    };

    const exportTextFile = () => {
        const text = DOM.cutListInput.value.trim();
        if (!text) {
            Utils.showToast('Tidak ada daftar untuk diekspor.', 'error');
            return;
        }
        
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CutList_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // --- INIT APP ---
    setupEventListeners();
    initFFmpeg();
});