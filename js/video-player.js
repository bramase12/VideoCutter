/**
 * Video Player Module — Advanced video player with Set Start/End and timeline
 */

import { eventBus, formatTime, formatTimeFull, throttle, Icons } from './utils.js';

export class VideoPlayer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.video = null;
        this.file = null;
        this.objectUrl = null;
        this.duration = 0;
        this.startMark = null;
        this.endMark = null;
        this._isBuilt = false;
        this._animFrame = null;
    }

    build() {
        if (this._isBuilt) return;
        this._isBuilt = true;

        this.container.innerHTML = `
            <div class="vp-wrapper" id="vpWrapper">
                <div class="vp-empty-state" id="vpEmptyState">
                    <div class="vp-empty-icon">${Icons.film}</div>
                    <p>No video loaded</p>
                    <small>Upload a video or import from YouTube to get started</small>
                </div>
                <div class="vp-player-area hidden" id="vpPlayerArea">
                    <div class="vp-video-container">
                        <video id="vpVideo" preload="metadata"></video>
                        <div class="vp-overlay" id="vpOverlay">
                            <button class="vp-play-big" id="vpPlayBig">${Icons.play}</button>
                        </div>
                    </div>
                    <div class="vp-controls">
                        <div class="vp-timeline-container">
                            <div class="vp-timeline" id="vpTimeline">
                                <div class="vp-timeline-buffered" id="vpBuffered"></div>
                                <div class="vp-timeline-progress" id="vpProgress"></div>
                                <div class="vp-timeline-region" id="vpRegion"></div>
                                <div class="vp-timeline-handle" id="vpHandle"></div>
                            </div>
                        </div>
                        <div class="vp-controls-bar">
                            <div class="vp-controls-left">
                                <button class="vp-btn" id="vpPlayBtn" title="Play/Pause (Space)">${Icons.play}</button>
                                <div class="vp-volume-group">
                                    <button class="vp-btn" id="vpMuteBtn" title="Mute">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                                    </button>
                                    <input type="range" class="vp-volume" id="vpVolume" min="0" max="1" step="0.05" value="1">
                                </div>
                                <span class="vp-time" id="vpTimeDisplay">00:00 / 00:00</span>
                            </div>
                            <div class="vp-controls-right">
                                <button class="vp-btn vp-btn-mark" id="vpSetStart" title="Set Start (I)">
                                    ${Icons.clock} Start
                                </button>
                                <button class="vp-btn vp-btn-mark" id="vpSetEnd" title="Set End (O)">
                                    ${Icons.clock} End
                                </button>
                                <button class="vp-btn" id="vpFullscreen" title="Fullscreen">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="vp-info-bar">
                        <div class="vp-info-left">
                            <span class="vp-filename" id="vpFilename"></span>
                        </div>
                        <div class="vp-info-right">
                            <span class="vp-mark-display" id="vpMarkDisplay"></span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._cacheElements();
        this._bindEvents();
    }

    _cacheElements() {
        this.video = document.getElementById('vpVideo');
        this.els = {
            emptyState: document.getElementById('vpEmptyState'),
            playerArea: document.getElementById('vpPlayerArea'),
            overlay: document.getElementById('vpOverlay'),
            playBig: document.getElementById('vpPlayBig'),
            timeline: document.getElementById('vpTimeline'),
            buffered: document.getElementById('vpBuffered'),
            progress: document.getElementById('vpProgress'),
            region: document.getElementById('vpRegion'),
            handle: document.getElementById('vpHandle'),
            playBtn: document.getElementById('vpPlayBtn'),
            muteBtn: document.getElementById('vpMuteBtn'),
            volume: document.getElementById('vpVolume'),
            timeDisplay: document.getElementById('vpTimeDisplay'),
            setStart: document.getElementById('vpSetStart'),
            setEnd: document.getElementById('vpSetEnd'),
            fullscreen: document.getElementById('vpFullscreen'),
            filename: document.getElementById('vpFilename'),
            markDisplay: document.getElementById('vpMarkDisplay'),
            wrapper: document.getElementById('vpWrapper')
        };
    }

    _bindEvents() {
        const { video, els } = this;

        // Playback
        els.playBtn.addEventListener('click', () => this.togglePlay());
        els.playBig.addEventListener('click', () => this.togglePlay());
        els.overlay.addEventListener('click', (e) => {
            if (e.target === els.overlay) this.togglePlay();
        });

        video.addEventListener('play', () => {
            els.playBtn.innerHTML = Icons.pause;
            els.overlay.classList.add('hidden');
            this._startTimeUpdate();
        });

        video.addEventListener('pause', () => {
            els.playBtn.innerHTML = Icons.play;
            els.overlay.classList.remove('hidden');
            els.playBig.innerHTML = Icons.play;
            this._stopTimeUpdate();
        });

        video.addEventListener('ended', () => {
            els.playBtn.innerHTML = Icons.play;
            els.overlay.classList.remove('hidden');
            els.playBig.innerHTML = Icons.play;
            this._stopTimeUpdate();
        });

        video.addEventListener('loadedmetadata', () => {
            this.duration = video.duration;
            this._updateTimeDisplay();
            eventBus.emit('player:metadata', {
                duration: this.duration,
                width: video.videoWidth,
                height: video.videoHeight
            });
        });

        video.addEventListener('progress', () => this._updateBuffered());

        // Volume
        els.volume.addEventListener('input', (e) => {
            video.volume = parseFloat(e.target.value);
            video.muted = false;
            this._updateVolumeIcon();
        });

        els.muteBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            this._updateVolumeIcon();
        });

        // Timeline seeking
        let isSeeking = false;
        const seek = (e) => {
            const rect = els.timeline.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const ratio = x / rect.width;
            video.currentTime = ratio * this.duration;
            this._updateProgress();
        };

        els.timeline.addEventListener('mousedown', (e) => {
            isSeeking = true;
            seek(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (isSeeking) seek(e);
        });

        document.addEventListener('mouseup', () => {
            isSeeking = false;
        });

        // Touch support for timeline
        els.timeline.addEventListener('touchstart', (e) => {
            isSeeking = true;
            const touch = e.touches[0];
            seek({ clientX: touch.clientX });
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (isSeeking) {
                const touch = e.touches[0];
                seek({ clientX: touch.clientX });
            }
        }, { passive: true });

        document.addEventListener('touchend', () => {
            isSeeking = false;
        });

        // Set Start / Set End
        els.setStart.addEventListener('click', () => this.setStart());
        els.setEnd.addEventListener('click', () => this.setEnd());

        // Fullscreen
        els.fullscreen.addEventListener('click', () => this.toggleFullscreen());
    }

    /* ─── Public API ─── */

    async loadFile(file) {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
        }

        this.file = file;
        this.objectUrl = URL.createObjectURL(file);
        this.video.src = this.objectUrl;
        this.startMark = null;
        this.endMark = null;

        this.els.filename.textContent = file.name;
        this.els.emptyState.classList.add('hidden');
        this.els.playerArea.classList.remove('hidden');
        this._updateMarkDisplay();

        eventBus.emit('player:loaded', { file });
    }

    async loadUrl(url, name = 'Video') {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }

        this.file = null;
        this.video.src = url;
        this.startMark = null;
        this.endMark = null;

        this.els.filename.textContent = name;
        this.els.emptyState.classList.add('hidden');
        this.els.playerArea.classList.remove('hidden');
        this._updateMarkDisplay();

        eventBus.emit('player:loaded', { name });
    }

    togglePlay() {
        if (!this.video.src) return;
        if (this.video.paused) {
            this.video.play();
        } else {
            this.video.pause();
        }
    }

    setStart() {
        if (!this.video.src || !this.duration) return;
        this.startMark = this.video.currentTime;
        if (this.endMark !== null && this.startMark >= this.endMark) {
            this.endMark = null;
        }
        this._updateMarkDisplay();
        this._updateRegion();
        eventBus.emit('player:setStart', { time: this.startMark });
    }

    setEnd() {
        if (!this.video.src || !this.duration) return;
        this.endMark = this.video.currentTime;
        if (this.startMark !== null && this.endMark <= this.startMark) {
            this.startMark = null;
        }
        this._updateMarkDisplay();
        this._updateRegion();
        eventBus.emit('player:setEnd', { time: this.endMark });
    }

    getMarks() {
        return {
            start: this.startMark,
            end: this.endMark
        };
    }

    clearMarks() {
        this.startMark = null;
        this.endMark = null;
        this._updateMarkDisplay();
        this._updateRegion();
    }

    seekTo(time) {
        if (this.video) {
            this.video.currentTime = time;
        }
    }

    getCurrentTime() {
        return this.video ? this.video.currentTime : 0;
    }

    getDuration() {
        return this.duration;
    }

    toggleFullscreen() {
        const wrapper = this.els.wrapper;
        if (!document.fullscreenElement) {
            wrapper.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen();
        }
    }

    /** Capture current frame as canvas image data */
    captureFrame(format = 'image/jpeg', quality = 0.92) {
        if (!this.video || !this.video.videoWidth) return null;
        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0);
        return new Promise(resolve => {
            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                resolve({ blob, url, width: canvas.width, height: canvas.height });
            }, format, quality);
        });
    }

    unload() {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
        this.video.src = '';
        this.file = null;
        this.duration = 0;
        this.startMark = null;
        this.endMark = null;
        this.els.emptyState.classList.remove('hidden');
        this.els.playerArea.classList.add('hidden');
        this._stopTimeUpdate();
    }

    /* ─── Private Methods ─── */

    _startTimeUpdate() {
        const update = () => {
            this._updateProgress();
            this._updateTimeDisplay();
            this._animFrame = requestAnimationFrame(update);
        };
        this._animFrame = requestAnimationFrame(update);
    }

    _stopTimeUpdate() {
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
    }

    _updateProgress() {
        if (!this.duration) return;
        const ratio = this.video.currentTime / this.duration;
        const percent = (ratio * 100).toFixed(2);
        this.els.progress.style.width = `${percent}%`;
        this.els.handle.style.left = `${percent}%`;
    }

    _updateBuffered() {
        if (!this.video.buffered.length || !this.duration) return;
        const end = this.video.buffered.end(this.video.buffered.length - 1);
        this.els.buffered.style.width = `${(end / this.duration * 100).toFixed(2)}%`;
    }

    _updateTimeDisplay() {
        const current = formatTime(this.video.currentTime || 0);
        const total = formatTime(this.duration || 0);
        this.els.timeDisplay.textContent = `${current} / ${total}`;
    }

    _updateMarkDisplay() {
        const parts = [];
        if (this.startMark !== null) parts.push(`Start: ${formatTimeFull(this.startMark)}`);
        if (this.endMark !== null) parts.push(`End: ${formatTimeFull(this.endMark)}`);
        this.els.markDisplay.textContent = parts.join('  |  ');
    }

    _updateRegion() {
        if (this.startMark === null && this.endMark === null) {
            this.els.region.style.display = 'none';
            return;
        }
        this.els.region.style.display = 'block';
        const start = (this.startMark || 0) / this.duration * 100;
        const end = (this.endMark || this.duration) / this.duration * 100;
        this.els.region.style.left = `${start}%`;
        this.els.region.style.width = `${end - start}%`;
    }
}
