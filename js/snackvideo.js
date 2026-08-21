/**
 * SnackVideo Module — Adapter interface for SnackVideo upload + Export workflow
 * No official SnackVideo API exists — provides modular adapter and manual export workflow
 */

import { eventBus, showToast, escapeHTML, generateId, downloadFile, applyNamingTemplate, formatDate, Icons } from './utils.js';

/** Modular SnackVideo API Adapter (ready for future official API) */
export class SnackVideoAdapter {
    constructor() {
        this.isAuthenticated = false;
        this.apiEndpoint = null;
        this.apiAvailable = false;
    }

    /** Check if official API is available */
    async checkApiAvailability() {
        // As of current date, SnackVideo does not provide a public upload API.
        this.apiAvailable = false;
        return false;
    }

    /** Authenticate with SnackVideo (placeholder for future API) */
    async authenticate(credentials) {
        if (!this.apiAvailable) {
            throw new Error('Official SnackVideo API is not available. Use the Export workflow instead.');
        }
        // Future: implement OAuth flow when API becomes available
        this.isAuthenticated = false;
        return false;
    }

    /** Upload a video to SnackVideo (placeholder for future API) */
    async uploadVideo(file, metadata) {
        if (!this.apiAvailable || !this.isAuthenticated) {
            throw new Error('SnackVideo API not available or not authenticated.');
        }
        // Future: POST to official upload endpoint
        throw new Error('Not implemented — waiting for official API.');
    }

    /** Check upload status (placeholder for future API) */
    async getUploadStatus(uploadId) {
        if (!this.apiAvailable) {
            throw new Error('SnackVideo API not available.');
        }
        throw new Error('Not implemented — waiting for official API.');
    }

    /** Cancel an upload (placeholder for future API) */
    async cancelUpload(uploadId) {
        if (!this.apiAvailable) {
            throw new Error('SnackVideo API not available.');
        }
        throw new Error('Not implemented — waiting for official API.');
    }
}

/** Upload Profile for a single video */
class UploadProfile {
    constructor(videoResult) {
        this.id = generateId('up');
        this.videoId = videoResult.id;
        this.outputName = videoResult.outputName;
        this.blob = videoResult.blob;
        this.url = videoResult.url;
        this.size = videoResult.size;
        this.duration = videoResult.duration;
        this.caption = '';
        this.hashtags = [];
        this.thumbnailUrl = null;
        this.thumbnailBlob = null;
        this.privacy = 'public';
        this.schedule = null;
        this.status = 'ready'; // ready, exporting, exported
    }
}

/** SnackVideo Integration Page */
export class SnackVideoManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.adapter = new SnackVideoAdapter();
        this.uploadProfiles = [];
        this.captionTemplate = '{title} — Part {number}';
        this.defaultHashtags = ['#fyp', '#viral', '#shortvideo'];
    }

    build() {
        this.container.innerHTML = `
            <div class="sv-page">
                <div class="sv-header">
                    <h2>${Icons.snackvideo} SnackVideo Integration</h2>
                    <p class="sv-subtitle">Prepare and export video clips for SnackVideo upload</p>
                </div>

                <div class="sv-api-status glass-panel">
                    <div class="sv-status-indicator sv-status-unavailable">
                        ${Icons.alertTriangle}
                        <div>
                            <strong>Official API Unavailable</strong>
                            <p>SnackVideo does not currently provide a public upload API. Use the Export for Manual Upload workflow below.</p>
                        </div>
                    </div>
                </div>

                <div class="sv-config glass-panel">
                    <h3>Caption & Hashtag Configuration</h3>
                    <div class="sv-form-group">
                        <label for="svCaptionTemplate">Caption Template</label>
                        <input type="text" id="svCaptionTemplate" value="${escapeHTML(this.captionTemplate)}" class="input-full" placeholder="{title} — Part {number}">
                        <small>Variables: {title}, {number}, {duration}, {date}, {source}</small>
                    </div>
                    <div class="sv-form-group">
                        <label for="svHashtags">Default Hashtags</label>
                        <input type="text" id="svHashtags" value="${this.defaultHashtags.join(' ')}" class="input-full" placeholder="#fyp #viral #shortvideo">
                        <small>Space-separated hashtags applied to all clips</small>
                    </div>
                    <button class="btn btn-primary btn-sm" id="svSaveConfig">${Icons.save} Save Configuration</button>
                </div>

                <div class="sv-upload-queue glass-panel">
                    <div class="sv-queue-header">
                        <h3>Upload Queue</h3>
                        <div class="sv-queue-actions">
                            <button class="btn btn-sm btn-secondary" id="svLoadResults">Load Completed Results</button>
                            <button class="btn btn-sm btn-primary" id="svExportAll">${Icons.download} Export All</button>
                            <button class="btn btn-sm btn-danger" id="svClearQueue">${Icons.trash} Clear</button>
                        </div>
                    </div>
                    <div class="sv-queue-list" id="svQueueList">
                        <div class="sv-queue-empty" id="svQueueEmpty">
                            <p>No videos in upload queue. Process videos first, then load results here.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._cacheElements();
        this._bindEvents();
        this._loadConfig();
    }

    _cacheElements() {
        this.els = {
            captionTemplate: document.getElementById('svCaptionTemplate'),
            hashtags: document.getElementById('svHashtags'),
            saveConfig: document.getElementById('svSaveConfig'),
            loadResults: document.getElementById('svLoadResults'),
            exportAll: document.getElementById('svExportAll'),
            clearQueue: document.getElementById('svClearQueue'),
            queueList: document.getElementById('svQueueList'),
            queueEmpty: document.getElementById('svQueueEmpty')
        };
    }

    _bindEvents() {
        this.els.saveConfig.addEventListener('click', () => this._saveConfig());
        this.els.loadResults.addEventListener('click', () => {
            eventBus.emit('snackvideo:requestResults');
        });
        this.els.exportAll.addEventListener('click', () => this._exportAll());
        this.els.clearQueue.addEventListener('click', () => {
            this.uploadProfiles = [];
            this.render();
            showToast('Upload queue cleared', 'info');
        });

        eventBus.on('snackvideo:resultsLoaded', (results) => {
            this._loadResults(results);
        });
    }

    _loadConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem('vas_captionSettings') || '{}');
            if (saved.template) {
                this.captionTemplate = saved.template;
                this.els.captionTemplate.value = saved.template;
            }
            if (saved.hashtags && Array.isArray(saved.hashtags)) {
                this.defaultHashtags = saved.hashtags;
                this.els.hashtags.value = saved.hashtags.join(' ');
            }
        } catch (e) {
            // Use defaults
        }
    }

    _saveConfig() {
        this.captionTemplate = this.els.captionTemplate.value.trim() || '{title} — Part {number}';
        this.defaultHashtags = this.els.hashtags.value.trim().split(/\s+/).filter(h => h.startsWith('#'));

        localStorage.setItem('vas_captionSettings', JSON.stringify({
            template: this.captionTemplate,
            hashtags: this.defaultHashtags
        }));

        // Update captions for existing profiles
        this.uploadProfiles.forEach((profile, idx) => {
            profile.caption = this._generateCaption(profile, idx + 1);
            profile.hashtags = [...this.defaultHashtags];
        });

        this.render();
        showToast('Configuration saved', 'success');
    }

    _loadResults(results) {
        if (!results || results.length === 0) {
            showToast('No completed results to load', 'warning');
            return;
        }

        const newProfiles = results
            .filter(r => !this.uploadProfiles.some(p => p.videoId === r.id))
            .map((r, idx) => {
                const profile = new UploadProfile(r);
                profile.caption = this._generateCaption(r, this.uploadProfiles.length + idx + 1);
                profile.hashtags = [...this.defaultHashtags];
                return profile;
            });

        this.uploadProfiles.push(...newProfiles);
        this.render();
        showToast(`Loaded ${newProfiles.length} new videos to upload queue`, 'success');
    }

    _generateCaption(item, number) {
        return applyNamingTemplate(this.captionTemplate, {
            title: (item.outputName || '').replace(/\.[^.]+$/, ''),
            number: number.toString(),
            duration: item.duration ? `${Math.round(item.duration)}s` : '',
            date: formatDate(),
            source: item.videoName || 'local'
        });
    }

    async _exportAll() {
        if (this.uploadProfiles.length === 0) {
            showToast('No videos to export', 'warning');
            return;
        }

        // Export each video with metadata
        for (const profile of this.uploadProfiles) {
            if (!profile.blob) continue;
            profile.status = 'exporting';
            this.render();

            // Download the video
            downloadFile(profile.blob, profile.outputName);

            // Create metadata file
            const metadata = {
                filename: profile.outputName,
                caption: profile.caption + ' ' + profile.hashtags.join(' '),
                hashtags: profile.hashtags,
                privacy: profile.privacy,
                schedule: profile.schedule,
                duration: profile.duration,
                exportedAt: new Date().toISOString()
            };

            const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
            downloadFile(metaBlob, profile.outputName.replace(/\.[^.]+$/, '_metadata.json'));

            profile.status = 'exported';
            await new Promise(r => setTimeout(r, 500)); // Brief delay between downloads
        }

        this.render();
        showToast('All videos exported with metadata. Upload them manually to SnackVideo.', 'success');
    }

    /** Export a single profile */
    _exportSingle(profileId) {
        const profile = this.uploadProfiles.find(p => p.id === profileId);
        if (!profile || !profile.blob) return;

        downloadFile(profile.blob, profile.outputName);

        const metadata = {
            filename: profile.outputName,
            caption: profile.caption + ' ' + profile.hashtags.join(' '),
            hashtags: profile.hashtags,
            privacy: profile.privacy,
            exportedAt: new Date().toISOString()
        };
        const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
        downloadFile(metaBlob, profile.outputName.replace(/\.[^.]+$/, '_metadata.json'));

        profile.status = 'exported';
        this.render();
        showToast(`Exported: ${profile.outputName}`, 'success');
    }

    /* ─── Rendering ─── */

    render() {
        const list = this.els.queueList;

        if (this.uploadProfiles.length === 0) {
            list.innerHTML = '';
            this.els.queueEmpty.classList.remove('hidden');
            list.appendChild(this.els.queueEmpty);
            return;
        }

        this.els.queueEmpty.classList.add('hidden');
        list.innerHTML = '';

        this.uploadProfiles.forEach((profile, idx) => {
            const card = document.createElement('div');
            card.className = `sv-item sv-item-${profile.status}`;

            const statusBadge = profile.status === 'exported'
                ? '<span class="badge badge-completed">Exported</span>'
                : profile.status === 'exporting'
                ? '<span class="badge badge-processing">Exporting...</span>'
                : '<span class="badge badge-waiting">Ready</span>';

            card.innerHTML = `
                <div class="sv-item-header">
                    <span class="sv-item-num">${idx + 1}</span>
                    <span class="sv-item-name">${escapeHTML(profile.outputName)}</span>
                    ${statusBadge}
                </div>
                <div class="sv-item-body">
                    <div class="sv-form-group">
                        <label>Caption</label>
                        <textarea class="sv-caption input-sm" data-id="${profile.id}" rows="2">${escapeHTML(profile.caption)}</textarea>
                    </div>
                    <div class="sv-form-group">
                        <label>Hashtags</label>
                        <input type="text" class="sv-hashtags input-sm" data-id="${profile.id}" value="${escapeHTML(profile.hashtags.join(' '))}">
                    </div>
                    <div class="sv-form-row">
                        <div class="sv-form-group">
                            <label>Privacy</label>
                            <select class="sv-privacy input-sm" data-id="${profile.id}">
                                <option value="public" ${profile.privacy === 'public' ? 'selected' : ''}>Public</option>
                                <option value="private" ${profile.privacy === 'private' ? 'selected' : ''}>Private</option>
                                <option value="friends" ${profile.privacy === 'friends' ? 'selected' : ''}>Friends Only</option>
                            </select>
                        </div>
                        <div class="sv-item-actions">
                            <button class="btn btn-xs btn-primary" data-action="export" data-id="${profile.id}">${Icons.download} Export</button>
                            <button class="btn btn-xs btn-danger" data-action="remove" data-id="${profile.id}">${Icons.trash}</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind inline editing
            card.querySelector('.sv-caption').addEventListener('change', (e) => {
                profile.caption = e.target.value;
            });
            card.querySelector('.sv-hashtags').addEventListener('change', (e) => {
                profile.hashtags = e.target.value.trim().split(/\s+/).filter(h => h);
            });
            card.querySelector('.sv-privacy').addEventListener('change', (e) => {
                profile.privacy = e.target.value;
            });

            // Actions
            card.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.currentTarget.dataset.action;
                    const id = e.currentTarget.dataset.id;
                    if (action === 'export') this._exportSingle(id);
                    if (action === 'remove') {
                        this.uploadProfiles = this.uploadProfiles.filter(p => p.id !== id);
                        this.render();
                    }
                });
            });

            list.appendChild(card);
        });
    }
}
