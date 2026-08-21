/**
 * App Module — Main controller, router, keyboard shortcuts, dashboard
 */

import { eventBus, formatFileSize, Icons, escapeHTML, generateId } from './utils.js';
import { StorageManager } from './storage.js';
import { FFmpegManager } from './ffmpeg-manager.js';
import { VideoPlayer } from './video-player.js';
import { ThumbnailGenerator } from './thumbnail.js';
import { CutListEditor } from './cutter.js';
import { QueueManager } from './queue.js';
import { YouTubeImporter } from './youtube.js';
import { SnackVideoManager } from './snackvideo.js';
import { ProjectManager } from './project.js';

export class AppController {
    constructor() {
        this.storage = new StorageManager();
        this.ffmpeg = new FFmpegManager();
        this.thumbnail = new ThumbnailGenerator(this.ffmpeg);

        this.modules = {
            player: new VideoPlayer('editorPlayer'),
            cutter: new CutListEditor('editorCutter'),
            queue: new QueueManager(this.ffmpeg, 'queueContainer'),
            youtube: new YouTubeImporter('youtubeContainer'),
            snackvideo: new SnackVideoManager('snackvideoContainer'),
            project: new ProjectManager(this.storage, 'projectContainer')
        };

        this.currentPage = 'dashboard';
        this.currentProject = null;
    }

    async init() {
        await this.storage.ready();

        // Build UI for modules
        this.modules.player.build();
        this.modules.cutter.build();
        this.modules.queue.build();
        this.modules.youtube.build();
        this.modules.snackvideo.build();
        this.modules.project.build();

        // Build Settings
        this._buildSettings();
        
        // Build Results
        this._buildResults();

        // Initialize FFmpeg
        await this.ffmpeg.init();

        this._bindEvents();
        this._setupRouter();
        this._setupKeyboardShortcuts();
        
        // Initial dashboard update
        this._updateDashboard();

        // Auto-save logic
        eventBus.on('project:loaded', (proj) => {
            this.currentProject = proj;
            document.getElementById('appNameSuffix').textContent = ` - ${proj.name}`;
            this.modules.project.startAutoSave();
        });

        eventBus.on('project:created', (proj) => {
            this.currentProject = proj;
            document.getElementById('appNameSuffix').textContent = ` - ${proj.name}`;
            this.modules.project.startAutoSave();
        });
        
        // Start a default project
        if (this.storage.getRecentProjects().length > 0) {
            this.modules.project.load(this.storage.getRecentProjects()[0].id);
        } else {
            this.modules.project.createNew();
        }

        console.log('App initialized successfully');
    }

    _bindEvents() {
        // Navigation clicks
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = e.currentTarget.getAttribute('href').replace('#', '');
                this.navigate(page);
            });
        });

        // Mobile menu toggle
        document.getElementById('menuToggle').addEventListener('click', () => {
            document.querySelector('.sidebar').classList.toggle('active');
        });

        // Import Local Video
        const dropZone = document.getElementById('importDropZone');
        const fileInput = document.getElementById('importFileInput');
        
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) this._handleLocalVideo(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) this._handleLocalVideo(e.target.files[0]);
        });

        // Event Bus connections
        eventBus.on('player:loaded', () => {
            const dur = this.modules.player.getDuration();
            this.modules.cutter.setVideoDuration(dur);
            this.navigate('editor');
        });

        eventBus.on('player:setStart', (data) => {
            // Nothing needed here, cutter requests marks directly
        });

        eventBus.on('cutter:requestMarks', () => {
            eventBus.emit('player:marksResponse', this.modules.player.getMarks());
        });
        
        eventBus.on('player:seekTo', (time) => {
            this.modules.player.seekTo(time);
        });

        eventBus.on('youtube:imported', (data) => {
            this._handleLocalVideo(data.file, data.metadata.title);
        });

        eventBus.on('cutter:detectScenes', async (data) => {
            if (!this.modules.player.file) return;
            const btn = document.getElementById('clDetectScenes');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<span class="spinner-sm"></span> Detecting...`;
            btn.disabled = true;

            try {
                const inputName = `temp_${Date.now()}.mp4`;
                await this.ffmpeg.writeInputFile(this.modules.player.file, inputName);
                const scenes = await this.ffmpeg.detectScenes(inputName, data.threshold);
                await this.ffmpeg.deleteInputFile(inputName);
                eventBus.emit('cutter:scenesDetected', scenes);
            } catch (err) {
                console.error(err);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });

        // Connect Editor to Queue
        document.getElementById('editorAddToQueue').addEventListener('click', () => {
            const segments = this.modules.cutter.getSegments();
            if (segments.length === 0) return;
            if (!this.modules.player.file) return;

            const settings = this.storage.getOutputSettings();
            this.modules.queue.addToQueue(this.modules.player.file, segments, settings);
            this.navigate('queue');
        });

        // Queue completion updates results & SnackVideo
        eventBus.on('queue:completed', () => {
            this._updateResultsList();
            this.modules.snackvideo._loadResults(this.modules.queue.getResults());
        });

        eventBus.on('queue:itemCompleted', () => {
            this._updateDashboard();
        });

        // Project state collection
        eventBus.on('project:collectState', (callback) => {
            callback({
                cutList: this.modules.cutter.getSegments(),
                outputSettings: this.storage.getOutputSettings(),
                captionSettings: this.storage.getCaptionSettings(),
                source: this.modules.player.file ? { name: this.modules.player.file.name } : null
            });
        });

        eventBus.on('project:applyState', (state) => {
            if (state.cutList) {
                this.modules.cutter.setSegments(state.cutList);
            }
            if (state.outputSettings) {
                this.storage.saveOutputSettings(state.outputSettings);
                this._populateSettings();
            }
        });
    }

    _handleLocalVideo(file, nameOverride = null) {
        if (!file.type.startsWith('video/')) {
            eventBus.emit('toast', { message: 'Invalid file format. Video required.', type: 'error' });
            return;
        }
        this.modules.player.loadFile(file, nameOverride || file.name);
    }

    _setupRouter() {
        window.addEventListener('hashchange', () => {
            const page = window.location.hash.replace('#', '') || 'dashboard';
            this.navigate(page);
        });
        
        // Initial route
        const page = window.location.hash.replace('#', '') || 'dashboard';
        this.navigate(page);
    }

    navigate(pageId) {
        if (!document.getElementById(`page-${pageId}`)) pageId = 'dashboard';
        
        // Hide all pages
        document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
        // Show target page
        document.getElementById(`page-${pageId}`).classList.add('active');

        // Update nav links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${pageId}`) {
                link.classList.add('active');
            }
        });

        this.currentPage = pageId;
        window.location.hash = pageId;

        if (pageId === 'dashboard') this._updateDashboard();
        if (pageId === 'results') this._updateResultsList();
        
        // Close mobile menu
        document.querySelector('.sidebar').classList.remove('active');
    }

    _setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger if typing in input/textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.code === 'Space') {
                e.preventDefault();
                this.modules.player.togglePlay();
            } else if (e.code === 'KeyI') {
                e.preventDefault();
                this.modules.player.setStart();
            } else if (e.code === 'KeyO') {
                e.preventDefault();
                this.modules.player.setEnd();
            } else if (e.code === 'Delete' || e.code === 'Backspace') {
                // Not mapped globally to avoid deleting selected segments unintentionally
            } else if (e.ctrlKey && e.code === 'KeyZ') {
                e.preventDefault();
                this.modules.cutter.undo();
            } else if (e.ctrlKey && e.code === 'KeyY') {
                e.preventDefault();
                this.modules.cutter.redo();
            } else if (e.ctrlKey && e.code === 'KeyS') {
                e.preventDefault();
                this.modules.project.save();
            }
        });
    }

    /* ─── Dashboard ─── */
    
    async _updateDashboard() {
        const qStats = this.modules.queue._getStats();
        const usage = await this.storage.estimateUsage();
        
        document.getElementById('dashTotalVideos').textContent = qStats.videos;
        document.getElementById('dashTotalClips').textContent = qStats.total;
        document.getElementById('dashCompleted').textContent = qStats.completed;
        document.getElementById('dashProcessing').textContent = qStats.processing;
        document.getElementById('dashFailed').textContent = qStats.failed;
        document.getElementById('dashStorage').textContent = formatFileSize(usage.used);
        
        // Recent Projects
        const recentProjContainer = document.getElementById('dashRecentProjects');
        const recent = this.storage.getRecentProjects().slice(0, 5);
        
        if (recent.length === 0) {
            recentProjContainer.innerHTML = '<p class="dash-empty">No recent projects.</p>';
        } else {
            recentProjContainer.innerHTML = recent.map(p => `
                <div class="dash-recent-item" data-id="${p.id}">
                    <span class="dash-recent-name">${escapeHTML(p.name)}</span>
                    <button class="btn btn-xs btn-secondary" onclick="window.app.modules.project.load('${p.id}')">Open</button>
                </div>
            `).join('');
        }
    }

    /* ─── Settings ─── */
    
    _buildSettings() {
        const container = document.getElementById('settingsContainer');
        container.innerHTML = `
            <div class="settings-page">
                <h2>${Icons.settings} Output Settings</h2>
                
                <div class="settings-grid">
                    <div class="settings-group glass-panel">
                        <h3>General</h3>
                        <div class="form-group">
                            <label>Output Format</label>
                            <select id="setFormat">
                                <option value="mp4">MP4</option>
                                <option value="webm">WebM</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Naming Template</label>
                            <input type="text" id="setNaming" value="{prefix}{number}">
                            <small>Vars: {prefix}, {number}, {title}, {date}</small>
                        </div>
                        <div class="form-group">
                            <label>Prefix</label>
                            <input type="text" id="setPrefix" value="Video_">
                        </div>
                    </div>
                    
                    <div class="settings-group glass-panel">
                        <h3>Video & Audio</h3>
                        <div class="form-group">
                            <label>Video Codec</label>
                            <select id="setVideoCodec">
                                <option value="copy">Copy (Lossless/Fast)</option>
                                <option value="libx264">H.264 (Re-encode)</option>
                                <option value="libvpx-vp9">VP9 (Re-encode)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Quality (CRF)</label>
                            <select id="setQuality">
                                <option value="low">Low (Smaller File)</option>
                                <option value="medium">Medium</option>
                                <option value="high">High (Better Quality)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Audio Codec</label>
                            <select id="setAudioCodec">
                                <option value="copy">Copy</option>
                                <option value="aac">AAC</option>
                                <option value="none">Disable Audio</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="settings-group glass-panel">
                        <h3>Transformation (Short Video Mode)</h3>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="setShortMode"> Enable Short Video Mode (9:16)
                            </label>
                        </div>
                        <div class="form-group">
                            <label>Fit Strategy</label>
                            <select id="setShortFit">
                                <option value="center-crop">Center Crop</option>
                                <option value="fit">Fit (Add Black Bars)</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="settings-actions">
                    <button class="btn btn-primary" id="setSaveBtn">${Icons.save} Save Settings</button>
                </div>
            </div>
        `;

        this._populateSettings();

        document.getElementById('setSaveBtn').addEventListener('click', () => {
            const settings = {
                format: document.getElementById('setFormat').value,
                namingTemplate: document.getElementById('setNaming').value,
                prefix: document.getElementById('setPrefix').value,
                videoCodec: document.getElementById('setVideoCodec').value,
                quality: document.getElementById('setQuality').value,
                audio: document.getElementById('setAudioCodec').value,
                shortVideoMode: document.getElementById('setShortMode').checked,
                shortVideoFit: document.getElementById('setShortFit').value,
                resolution: 'original',
                aspectRatio: 'original'
            };
            this.storage.saveOutputSettings(settings);
            eventBus.emit('toast', { message: 'Settings saved', type: 'success' });
        });
    }

    _populateSettings() {
        const settings = this.storage.getOutputSettings();
        if (document.getElementById('setFormat')) document.getElementById('setFormat').value = settings.format || 'mp4';
        if (document.getElementById('setNaming')) document.getElementById('setNaming').value = settings.namingTemplate || '{prefix}{number}';
        if (document.getElementById('setPrefix')) document.getElementById('setPrefix').value = settings.prefix || 'Video_';
        if (document.getElementById('setVideoCodec')) document.getElementById('setVideoCodec').value = settings.videoCodec || 'copy';
        if (document.getElementById('setQuality')) document.getElementById('setQuality').value = settings.quality || 'medium';
        if (document.getElementById('setAudioCodec')) document.getElementById('setAudioCodec').value = settings.audio || 'copy';
        if (document.getElementById('setShortMode')) document.getElementById('setShortMode').checked = settings.shortVideoMode || false;
        if (document.getElementById('setShortFit')) document.getElementById('setShortFit').value = settings.shortVideoFit || 'center-crop';
    }

    /* ─── Results ─── */
    
    _buildResults() {
        const container = document.getElementById('resultsContainer');
        container.innerHTML = `
            <div class="res-page">
                <div class="res-header">
                    <h2>${Icons.results} Results Manager</h2>
                    <div class="res-actions">
                        <button class="btn btn-primary" id="resDownloadAll">${Icons.download} Download All (ZIP)</button>
                        <button class="btn btn-danger" id="resClearAll">${Icons.trash} Clear Results</button>
                    </div>
                </div>
                <div class="res-grid" id="resGrid">
                    <div class="res-empty" id="resEmpty">
                        <p>No results yet. Process videos in the queue first.</p>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('resDownloadAll').addEventListener('click', () => {
            const results = this.modules.queue.getResults();
            if (results.length === 0) return;
            
            // Simple JSZip implementation for downloading all
            eventBus.emit('toast', { message: 'Preparing ZIP...', type: 'info' });
            
            const zip = new window.JSZip();
            results.forEach(r => {
                zip.file(r.outputName, r.blob);
            });
            
            zip.generateAsync({ type: 'blob' }).then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Batch_Videos_${Date.now()}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                eventBus.emit('toast', { message: 'ZIP Downloaded', type: 'success' });
            });
        });

        document.getElementById('resClearAll').addEventListener('click', () => {
            this.modules.queue.clearAll();
            this._updateResultsList();
        });
    }

    _updateResultsList() {
        const results = this.modules.queue.getResults();
        const grid = document.getElementById('resGrid');
        const empty = document.getElementById('resEmpty');

        if (results.length === 0) {
            grid.innerHTML = '';
            grid.appendChild(empty);
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        grid.innerHTML = results.map(r => `
            <div class="res-card glass-panel">
                <div class="res-card-video">
                    <video src="${r.url}" controls preload="metadata"></video>
                </div>
                <div class="res-card-info">
                    <div class="res-card-name">${escapeHTML(r.outputName)}</div>
                    <div class="res-card-meta">${formatFileSize(r.size)}</div>
                    <div class="res-card-actions mt-2">
                        <a href="${r.url}" download="${escapeHTML(r.outputName)}" class="btn btn-sm btn-primary w-full">${Icons.download} Download</a>
                    </div>
                </div>
            </div>
        `).join('');
    }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
    window.app.init().catch(console.error);
});
