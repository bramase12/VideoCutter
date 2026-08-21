/**
 * YouTube Module — URL validation, metadata via oEmbed, import workflow
 * Uses only official/public APIs. No DRM bypass, scraping, or credential theft.
 */

import { eventBus, showToast, escapeHTML, Icons } from './utils.js';

/** YouTube URL patterns */
const YT_PATTERNS = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
];

export class YouTubeImporter {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.currentVideoId = null;
        this.metadata = null;
    }

    build() {
        this.container.innerHTML = `
            <div class="yt-page">
                <div class="yt-header">
                    <h2>${Icons.youtube} YouTube Import</h2>
                    <p class="yt-subtitle">Import video metadata from YouTube. Only process videos you own or have permission to use.</p>
                </div>

                <div class="yt-legal-notice glass-panel">
                    <div class="yt-legal-icon">${Icons.alertTriangle}</div>
                    <div class="yt-legal-text">
                        <strong>Important Legal Notice</strong>
                        <p>Only import videos that you own or have explicit permission to use. This tool does not bypass DRM, CAPTCHA, or any platform restrictions. A compatible backend service is required for actual video download.</p>
                    </div>
                </div>

                <div class="yt-input-section glass-panel">
                    <label for="ytUrl">YouTube Video URL</label>
                    <div class="yt-input-row">
                        <input type="url" id="ytUrl" placeholder="https://www.youtube.com/watch?v=VIDEO_ID" class="input-full">
                        <button class="btn btn-primary" id="ytFetchBtn">${Icons.download} Fetch Info</button>
                    </div>
                    <small class="yt-help">Supports: youtube.com/watch, youtu.be, youtube.com/shorts</small>
                </div>

                <div class="yt-result hidden" id="ytResult">
                    <div class="yt-video-card glass-panel">
                        <div class="yt-thumbnail-wrap">
                            <img id="ytThumbnail" alt="Video Thumbnail" class="yt-thumbnail">
                        </div>
                        <div class="yt-video-info">
                            <h3 id="ytTitle" class="yt-title"></h3>
                            <div class="yt-meta-grid">
                                <div class="yt-meta-item">
                                    <span class="yt-meta-label">Author</span>
                                    <span class="yt-meta-value" id="ytAuthor"></span>
                                </div>
                                <div class="yt-meta-item">
                                    <span class="yt-meta-label">Video ID</span>
                                    <span class="yt-meta-value" id="ytVideoId"></span>
                                </div>
                                <div class="yt-meta-item">
                                    <span class="yt-meta-label">Source</span>
                                    <span class="yt-meta-value" id="ytSource"></span>
                                </div>
                            </div>
                            <div class="yt-actions">
                                <button class="btn btn-primary" id="ytImportBtn" disabled>
                                    ${Icons.download} Import Video
                                </button>
                                <a href="#" target="_blank" id="ytWatchLink" class="btn btn-secondary">
                                    ${Icons.play} Watch on YouTube
                                </a>
                            </div>
                        </div>
                    </div>

                    <div class="yt-backend-notice glass-panel" id="ytBackendNotice">
                        <div class="yt-notice-icon">${Icons.alertTriangle}</div>
                        <div class="yt-notice-content">
                            <h4>Backend Service Required</h4>
                            <p>Direct video download from YouTube requires a backend proxy service to comply with CORS policies and platform terms. This frontend-only application cannot download videos directly.</p>
                            <div class="yt-alternatives">
                                <h5>Alternatives:</h5>
                                <ul>
                                    <li>Use the <strong>Local Upload</strong> mode — download the video through official means first, then upload it here.</li>
                                    <li>Connect a <strong>compatible backend API</strong> that handles YouTube video retrieval with proper authorization.</li>
                                </ul>
                            </div>
                            <div class="yt-api-config">
                                <label for="ytApiEndpoint">Backend API Endpoint (Optional)</label>
                                <div class="yt-input-row">
                                    <input type="url" id="ytApiEndpoint" placeholder="https://your-backend.com/api/youtube/download" class="input-full">
                                    <button class="btn btn-secondary" id="ytSaveEndpoint">${Icons.save} Save</button>
                                </div>
                                <small>If you have a compatible backend service, enter its endpoint here.</small>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="yt-error hidden" id="ytError">
                    <div class="glass-panel yt-error-card">
                        <span class="yt-error-icon">${Icons.alertTriangle}</span>
                        <p id="ytErrorMsg"></p>
                    </div>
                </div>
            </div>
        `;

        this._cacheElements();
        this._bindEvents();
    }

    _cacheElements() {
        this.els = {
            urlInput: document.getElementById('ytUrl'),
            fetchBtn: document.getElementById('ytFetchBtn'),
            result: document.getElementById('ytResult'),
            thumbnail: document.getElementById('ytThumbnail'),
            title: document.getElementById('ytTitle'),
            author: document.getElementById('ytAuthor'),
            videoId: document.getElementById('ytVideoId'),
            source: document.getElementById('ytSource'),
            importBtn: document.getElementById('ytImportBtn'),
            watchLink: document.getElementById('ytWatchLink'),
            error: document.getElementById('ytError'),
            errorMsg: document.getElementById('ytErrorMsg'),
            apiEndpoint: document.getElementById('ytApiEndpoint'),
            saveEndpoint: document.getElementById('ytSaveEndpoint')
        };
    }

    _bindEvents() {
        this.els.fetchBtn.addEventListener('click', () => this._fetchVideoInfo());
        this.els.urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._fetchVideoInfo();
        });

        this.els.importBtn.addEventListener('click', () => this._importVideo());

        this.els.saveEndpoint.addEventListener('click', () => {
            const endpoint = this.els.apiEndpoint.value.trim();
            if (endpoint) {
                localStorage.setItem('vas_ytApiEndpoint', endpoint);
                showToast('Backend endpoint saved', 'success');
                this.els.importBtn.disabled = false;
            } else {
                localStorage.removeItem('vas_ytApiEndpoint');
                this.els.importBtn.disabled = true;
                showToast('Backend endpoint cleared', 'info');
            }
        });

        // Load saved endpoint
        const savedEndpoint = localStorage.getItem('vas_ytApiEndpoint');
        if (savedEndpoint) {
            this.els.apiEndpoint.value = savedEndpoint;
            this.els.importBtn.disabled = false;
        }
    }

    /* ─── URL Validation ─── */

    extractVideoId(url) {
        if (!url) return null;
        for (const pattern of YT_PATTERNS) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    isValidUrl(url) {
        return this.extractVideoId(url) !== null;
    }

    /* ─── Fetch Metadata via oEmbed ─── */

    async _fetchVideoInfo() {
        const url = this.els.urlInput.value.trim();
        if (!url) {
            showToast('Please enter a YouTube URL', 'warning');
            return;
        }

        const videoId = this.extractVideoId(url);
        if (!videoId) {
            this._showError('Invalid YouTube URL. Please enter a valid YouTube video or Shorts URL.');
            return;
        }

        this.currentVideoId = videoId;
        this.els.fetchBtn.disabled = true;
        this.els.fetchBtn.innerHTML = `<span class="spinner-sm"></span> Fetching...`;
        this._hideError();

        try {
            // Use YouTube oEmbed API (no API key required)
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            const response = await fetch(oembedUrl);

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('This video is private or restricted. Cannot access metadata.');
                }
                throw new Error('Failed to fetch video info. The video may not exist or is unavailable.');
            }

            const data = await response.json();

            this.metadata = {
                videoId,
                title: data.title || 'Unknown',
                author: data.author_name || 'Unknown',
                thumbnailUrl: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                providerName: data.provider_name || 'YouTube',
                sourceUrl: url
            };

            this._displayResult();
        } catch (err) {
            console.error('YouTube fetch error:', err);
            this._showError(err.message || 'Failed to fetch video information.');
        } finally {
            this.els.fetchBtn.disabled = false;
            this.els.fetchBtn.innerHTML = `${Icons.download} Fetch Info`;
        }
    }

    _displayResult() {
        const m = this.metadata;

        this.els.thumbnail.src = m.thumbnailUrl;
        this.els.thumbnail.onerror = () => {
            this.els.thumbnail.src = `https://img.youtube.com/vi/${m.videoId}/hqdefault.jpg`;
        };
        this.els.title.textContent = m.title;
        this.els.author.textContent = m.author;
        this.els.videoId.textContent = m.videoId;
        this.els.source.textContent = m.providerName;
        this.els.watchLink.href = `https://www.youtube.com/watch?v=${m.videoId}`;

        // Check if backend endpoint is configured
        const hasEndpoint = !!localStorage.getItem('vas_ytApiEndpoint');
        this.els.importBtn.disabled = !hasEndpoint;

        this.els.result.classList.remove('hidden');
        this.els.error.classList.add('hidden');
    }

    async _importVideo() {
        const endpoint = localStorage.getItem('vas_ytApiEndpoint');
        if (!endpoint || !this.currentVideoId) {
            showToast('Configure a backend API endpoint first', 'warning');
            return;
        }

        this.els.importBtn.disabled = true;
        this.els.importBtn.innerHTML = `<span class="spinner-sm"></span> Importing...`;

        try {
            const response = await fetch(`${endpoint}?videoId=${this.currentVideoId}`, {
                method: 'GET',
                headers: { 'Accept': 'video/mp4,video/*' }
            });

            if (!response.ok) {
                throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
            }

            const blob = await response.blob();
            const filename = `${this.metadata.title || this.currentVideoId}.mp4`;
            const file = new File([blob], filename, { type: blob.type || 'video/mp4' });

            eventBus.emit('youtube:imported', { file, metadata: this.metadata });
            showToast(`Video "${this.metadata.title}" imported successfully!`, 'success');
        } catch (err) {
            console.error('Import error:', err);
            showToast(`Import failed: ${err.message}`, 'error');
        } finally {
            this.els.importBtn.disabled = false;
            this.els.importBtn.innerHTML = `${Icons.download} Import Video`;
        }
    }

    _showError(message) {
        this.els.errorMsg.textContent = message;
        this.els.error.classList.remove('hidden');
        this.els.result.classList.add('hidden');
    }

    _hideError() {
        this.els.error.classList.add('hidden');
    }

    /** Get current metadata */
    getMetadata() {
        return this.metadata;
    }
}
