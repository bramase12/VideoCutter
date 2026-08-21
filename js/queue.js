/**
 * Queue Module — Processing queue with status management, progress tracking, batch support
 */

import { eventBus, formatTime, formatTimeFull, formatDuration, formatFileSize, showToast, generateId, escapeHTML, Icons, applyNamingTemplate, formatDate } from './utils.js';

/** Status enum */
export const QueueStatus = {
    WAITING: 'waiting',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RETRY: 'retry',
    CANCELLED: 'cancelled'
};

/** Single queue item (a clip to be processed) */
class QueueItem {
    constructor(videoId, segmentIndex, segment, outputName) {
        this.id = generateId('qi');
        this.videoId = videoId;
        this.segmentIndex = segmentIndex;
        this.segment = segment; // { start, end, startStr, endStr }
        this.outputName = outputName;
        this.status = QueueStatus.WAITING;
        this.progress = 0;
        this.result = null; // { blob, url, size }
        this.error = null;
        this.startedAt = null;
        this.completedAt = null;
    }

    get duration() {
        return this.segment.end - this.segment.start;
    }
}

/** Video group in queue */
class QueueVideoGroup {
    constructor(id, name, file, inputName) {
        this.id = id;
        this.name = name;
        this.file = file;
        this.inputName = inputName;
        this.items = [];
        this.status = QueueStatus.WAITING;
    }

    get completedCount() {
        return this.items.filter(i => i.status === QueueStatus.COMPLETED).length;
    }

    get failedCount() {
        return this.items.filter(i => i.status === QueueStatus.FAILED).length;
    }

    get totalCount() {
        return this.items.length;
    }

    get progress() {
        if (this.items.length === 0) return 0;
        return this.completedCount / this.totalCount;
    }
}

export class QueueManager {
    constructor(ffmpegManager, containerId) {
        this.ffmpeg = ffmpegManager;
        this.container = document.getElementById(containerId);
        this.videoGroups = [];
        this.isProcessing = false;
        this._cancelled = false;
        this._currentItem = null;
        this._processStartTime = null;
        this._processedCount = 0;
        this._outputSettings = {};
    }

    build() {
        this.container.innerHTML = `
            <div class="q-header">
                <h3>${Icons.queue} Processing Queue</h3>
                <div class="q-actions">
                    <button class="btn btn-primary" id="qStartAll" disabled>
                        ${Icons.zap} Start Processing
                    </button>
                    <button class="btn btn-danger hidden" id="qCancelAll">
                        ${Icons.x} Cancel
                    </button>
                    <button class="btn btn-secondary" id="qClearCompleted">
                        ${Icons.trash} Clear Completed
                    </button>
                </div>
            </div>

            <div class="q-progress-panel hidden" id="qProgressPanel">
                <div class="q-progress-stats">
                    <div class="q-stat">
                        <span class="q-stat-label">Overall</span>
                        <span class="q-stat-value" id="qOverallProgress">0%</span>
                    </div>
                    <div class="q-stat">
                        <span class="q-stat-label">Current</span>
                        <span class="q-stat-value" id="qCurrentClip">—</span>
                    </div>
                    <div class="q-stat">
                        <span class="q-stat-label">Speed</span>
                        <span class="q-stat-value" id="qSpeed">—</span>
                    </div>
                    <div class="q-stat">
                        <span class="q-stat-label">ETA</span>
                        <span class="q-stat-value" id="qEta">—</span>
                    </div>
                    <div class="q-stat">
                        <span class="q-stat-label">Completed</span>
                        <span class="q-stat-value" id="qCompletedCount">0</span>
                    </div>
                    <div class="q-stat">
                        <span class="q-stat-label">Failed</span>
                        <span class="q-stat-value" id="qFailedCount">0</span>
                    </div>
                </div>
                <div class="q-progress-bar-wrap">
                    <div class="q-progress-bar">
                        <div class="q-progress-fill" id="qProgressFill"></div>
                    </div>
                    <span class="q-progress-percent" id="qProgressPercent">0%</span>
                </div>
                <div class="q-clip-progress">
                    <div class="q-clip-bar">
                        <div class="q-clip-fill" id="qClipFill"></div>
                    </div>
                    <span class="q-clip-text" id="qClipText">Clip: 0%</span>
                </div>
            </div>

            <div class="q-list" id="qList">
                <div class="q-empty" id="qEmpty">
                    <p>${Icons.queue}</p>
                    <p>Queue is empty. Add segments from the Editor to start processing.</p>
                </div>
            </div>

            <div class="q-summary" id="qSummary">
                <span id="qTotalItems">0 items</span>
                <span id="qTotalStatus">Ready</span>
            </div>
        `;

        this._cacheElements();
        this._bindEvents();
    }

    _cacheElements() {
        this.els = {
            startBtn: document.getElementById('qStartAll'),
            cancelBtn: document.getElementById('qCancelAll'),
            clearBtn: document.getElementById('qClearCompleted'),
            progressPanel: document.getElementById('qProgressPanel'),
            overallProgress: document.getElementById('qOverallProgress'),
            currentClip: document.getElementById('qCurrentClip'),
            speed: document.getElementById('qSpeed'),
            eta: document.getElementById('qEta'),
            completedCount: document.getElementById('qCompletedCount'),
            failedCount: document.getElementById('qFailedCount'),
            progressFill: document.getElementById('qProgressFill'),
            progressPercent: document.getElementById('qProgressPercent'),
            clipFill: document.getElementById('qClipFill'),
            clipText: document.getElementById('qClipText'),
            list: document.getElementById('qList'),
            empty: document.getElementById('qEmpty'),
            totalItems: document.getElementById('qTotalItems'),
            totalStatus: document.getElementById('qTotalStatus')
        };
    }

    _bindEvents() {
        this.els.startBtn.addEventListener('click', () => this.startProcessing());
        this.els.cancelBtn.addEventListener('click', () => this.cancelProcessing());
        this.els.clearBtn.addEventListener('click', () => this.clearCompleted());

        // Listen for FFmpeg progress
        eventBus.on('ffmpeg:progress', (data) => {
            if (this._currentItem) {
                this._currentItem.progress = data.percent;
                this._updateClipProgress(data.percent);
            }
        });
    }

    /* ─── Public API ─── */

    /** Add a video with its segments to the queue */
    addToQueue(videoFile, segments, settings = {}) {
        const videoId = generateId('vid');
        const inputName = `input_${videoId}${videoFile.name.substring(videoFile.name.lastIndexOf('.'))}`;
        const group = new QueueVideoGroup(videoId, videoFile.name, videoFile, inputName);

        const format = settings.format || 'mp4';
        const prefix = settings.prefix || 'Video_';
        const namingTemplate = settings.namingTemplate || '{prefix}{number}';

        segments.forEach((seg, idx) => {
            const numStr = (idx + 1).toString().padStart(3, '0');
            const outputName = applyNamingTemplate(namingTemplate, {
                prefix: prefix,
                number: numStr,
                title: videoFile.name.replace(/\.[^.]+$/, ''),
                date: formatDate(),
                source: 'local',
                start: formatTimeFull(seg.start).replace(/:/g, ''),
                end: formatTimeFull(seg.end).replace(/:/g, '')
            }) + `.${format}`;

            const item = new QueueItem(videoId, idx + 1, seg, outputName);
            group.items.push(item);
        });

        this.videoGroups.push(group);
        this.render();
        this._updateStartButton();
        eventBus.emit('queue:updated', this._getStats());
        showToast(`Added ${segments.length} clips from "${videoFile.name}" to queue`, 'success');
        return videoId;
    }

    /** Start processing the entire queue */
    async startProcessing() {
        if (this.isProcessing) return;

        const pendingGroups = this.videoGroups.filter(g =>
            g.items.some(i => i.status === QueueStatus.WAITING || i.status === QueueStatus.RETRY)
        );

        if (pendingGroups.length === 0) {
            showToast('No pending items in queue', 'warning');
            return;
        }

        this.isProcessing = true;
        this._cancelled = false;
        this._processStartTime = Date.now();
        this._processedCount = 0;

        this._outputSettings = eventBus.emit('settings:getOutputSettings') || {};

        this.els.startBtn.classList.add('hidden');
        this.els.cancelBtn.classList.remove('hidden');
        this.els.progressPanel.classList.remove('hidden');

        eventBus.emit('queue:started');

        for (const group of this.videoGroups) {
            if (this._cancelled) break;

            const pendingItems = group.items.filter(i =>
                i.status === QueueStatus.WAITING || i.status === QueueStatus.RETRY
            );

            if (pendingItems.length === 0) continue;

            group.status = QueueStatus.PROCESSING;

            try {
                // Write video file to FFmpeg FS
                this.els.currentClip.textContent = `Loading: ${group.name}`;
                await this.ffmpeg.writeInputFile(group.file, group.inputName);

                // Process each clip
                for (const item of pendingItems) {
                    if (this._cancelled) {
                        item.status = QueueStatus.CANCELLED;
                        continue;
                    }

                    this._currentItem = item;
                    item.status = QueueStatus.PROCESSING;
                    item.startedAt = Date.now();
                    item.progress = 0;
                    this.render();

                    this.els.currentClip.textContent = item.outputName;

                    try {
                        // Get output settings from storage
                        const settings = this._getOutputSettings();

                        const result = await this.ffmpeg.cutSegment(
                            group.inputName,
                            item.outputName,
                            item.segment.start,
                            item.segment.end,
                            settings
                        );

                        item.status = QueueStatus.COMPLETED;
                        item.result = result;
                        item.completedAt = Date.now();
                        item.progress = 100;

                        eventBus.emit('queue:itemCompleted', {
                            item: this._serializeItem(item),
                            videoName: group.name
                        });

                    } catch (err) {
                        console.error(`Failed to process ${item.outputName}:`, err);
                        item.status = QueueStatus.FAILED;
                        item.error = err.message;
                        item.completedAt = Date.now();

                        eventBus.emit('queue:itemFailed', {
                            item: this._serializeItem(item),
                            error: err.message
                        });
                    }

                    this._processedCount++;
                    this._updateOverallProgress();
                    this.render();
                }

                // Cleanup input file
                await this.ffmpeg.deleteInputFile(group.inputName);

            } catch (err) {
                console.error(`Failed to load video ${group.name}:`, err);
                group.items.forEach(i => {
                    if (i.status === QueueStatus.WAITING || i.status === QueueStatus.PROCESSING) {
                        i.status = QueueStatus.FAILED;
                        i.error = `Failed to load source: ${err.message}`;
                    }
                });
            }

            group.status = group.failedCount > 0 ? QueueStatus.FAILED : QueueStatus.COMPLETED;
        }

        this.isProcessing = false;
        this._currentItem = null;
        this.els.startBtn.classList.remove('hidden');
        this.els.cancelBtn.classList.add('hidden');
        this._updateStartButton();
        this.render();

        const stats = this._getStats();
        eventBus.emit('queue:completed', stats);

        if (stats.failed > 0) {
            showToast(`Processing complete: ${stats.completed} succeeded, ${stats.failed} failed`, 'warning');
        } else {
            showToast(`All ${stats.completed} clips processed successfully!`, 'success');
        }
    }

    cancelProcessing() {
        this._cancelled = true;
        showToast('Cancelling processing...', 'warning');
    }

    /** Retry failed items */
    retryFailed() {
        for (const group of this.videoGroups) {
            for (const item of group.items) {
                if (item.status === QueueStatus.FAILED) {
                    item.status = QueueStatus.RETRY;
                    item.error = null;
                    item.progress = 0;
                }
            }
            if (group.status === QueueStatus.FAILED) {
                group.status = QueueStatus.WAITING;
            }
        }
        this.render();
        this._updateStartButton();
    }

    retryItem(itemId) {
        for (const group of this.videoGroups) {
            const item = group.items.find(i => i.id === itemId);
            if (item && item.status === QueueStatus.FAILED) {
                item.status = QueueStatus.RETRY;
                item.error = null;
                item.progress = 0;
                group.status = QueueStatus.WAITING;
                this.render();
                this._updateStartButton();
                return;
            }
        }
    }

    clearCompleted() {
        this.videoGroups = this.videoGroups.filter(g => {
            // Remove completed items
            g.items = g.items.filter(i => i.status !== QueueStatus.COMPLETED);
            return g.items.length > 0;
        });
        this.render();
        this._updateStartButton();
        eventBus.emit('queue:updated', this._getStats());
    }

    clearAll() {
        // Revoke all result URLs
        for (const group of this.videoGroups) {
            for (const item of group.items) {
                if (item.result && item.result.url) {
                    this.ffmpeg.revokeUrl(item.result.url);
                }
            }
        }
        this.videoGroups = [];
        this.render();
        this._updateStartButton();
        eventBus.emit('queue:updated', this._getStats());
    }

    /** Get all completed results */
    getResults() {
        const results = [];
        for (const group of this.videoGroups) {
            for (const item of group.items) {
                if (item.status === QueueStatus.COMPLETED && item.result) {
                    results.push({
                        id: item.id,
                        videoId: item.videoId,
                        videoName: group.name,
                        outputName: item.outputName,
                        duration: item.duration,
                        blob: item.result.blob,
                        url: item.result.url,
                        size: item.result.size,
                        segment: item.segment
                    });
                }
            }
        }
        return results;
    }

    /* ─── Private Methods ─── */

    _getOutputSettings() {
        // Get from storage
        try {
            const stored = JSON.parse(localStorage.getItem('vas_outputSettings') || '{}');
            return {
                videoCodec: stored.videoCodec || 'copy',
                audioCodec: stored.audio || 'copy',
                format: stored.format || 'mp4',
                quality: stored.quality || 'medium',
                crf: stored.crf || 23,
                resolution: stored.resolution || 'original',
                customWidth: stored.customWidth || null,
                customHeight: stored.customHeight || null,
                aspectRatio: stored.aspectRatio || 'original',
                shortVideoMode: stored.shortVideoMode || false,
                shortVideoFit: stored.shortVideoFit || 'center-crop'
            };
        } catch {
            return { videoCodec: 'copy', format: 'mp4' };
        }
    }

    _getStats() {
        let total = 0, completed = 0, failed = 0, waiting = 0, processing = 0;
        for (const group of this.videoGroups) {
            for (const item of group.items) {
                total++;
                if (item.status === QueueStatus.COMPLETED) completed++;
                else if (item.status === QueueStatus.FAILED) failed++;
                else if (item.status === QueueStatus.PROCESSING) processing++;
                else waiting++;
            }
        }
        return { total, completed, failed, waiting, processing, videos: this.videoGroups.length };
    }

    _updateStartButton() {
        const hasPending = this.videoGroups.some(g =>
            g.items.some(i => i.status === QueueStatus.WAITING || i.status === QueueStatus.RETRY)
        );
        this.els.startBtn.disabled = !hasPending || !this.ffmpeg.isLoaded;
    }

    _updateOverallProgress() {
        const stats = this._getStats();
        const percent = stats.total > 0 ? Math.round((stats.completed + stats.failed) / stats.total * 100) : 0;

        this.els.progressFill.style.width = `${percent}%`;
        this.els.progressPercent.textContent = `${percent}%`;
        this.els.overallProgress.textContent = `${percent}%`;
        this.els.completedCount.textContent = stats.completed.toString();
        this.els.failedCount.textContent = stats.failed.toString();

        // Speed & ETA
        const elapsed = (Date.now() - this._processStartTime) / 1000;
        if (this._processedCount > 0 && elapsed > 0) {
            const speed = this._processedCount / elapsed;
            const remaining = stats.waiting + stats.processing;
            const eta = remaining / speed;
            this.els.speed.textContent = `${speed.toFixed(1)} clips/min`;
            this.els.eta.textContent = formatDuration(eta);
        }
    }

    _updateClipProgress(percent) {
        this.els.clipFill.style.width = `${percent}%`;
        this.els.clipText.textContent = `Clip: ${percent}%`;
    }

    _serializeItem(item) {
        return {
            id: item.id,
            outputName: item.outputName,
            status: item.status,
            segment: item.segment,
            duration: item.duration,
            size: item.result ? item.result.size : 0,
            url: item.result ? item.result.url : null,
            blob: item.result ? item.result.blob : null,
            error: item.error
        };
    }

    /* ─── Rendering ─── */

    render() {
        const list = this.els.list;

        if (this.videoGroups.length === 0) {
            list.innerHTML = '';
            this.els.empty.classList.remove('hidden');
            list.appendChild(this.els.empty);
            this.els.totalItems.textContent = '0 items';
            this.els.totalStatus.textContent = 'Ready';
            return;
        }

        this.els.empty.classList.add('hidden');
        list.innerHTML = '';

        for (const group of this.videoGroups) {
            const groupEl = document.createElement('div');
            groupEl.className = `q-video-group q-group-${group.status}`;

            const statusIcon = this._getStatusIcon(group.status);
            const progressPercent = Math.round(group.progress * 100);

            groupEl.innerHTML = `
                <div class="q-group-header">
                    <div class="q-group-info">
                        ${statusIcon}
                        <span class="q-group-name">${escapeHTML(group.name)}</span>
                        <span class="q-group-count">${group.completedCount}/${group.totalCount} clips</span>
                    </div>
                    <div class="q-group-progress-mini">
                        <div class="q-mini-bar"><div class="q-mini-fill" style="width:${progressPercent}%"></div></div>
                    </div>
                </div>
                <div class="q-group-items" id="qGroupItems_${group.id}"></div>
            `;

            const itemsContainer = groupEl.querySelector(`#qGroupItems_${group.id}`);

            for (const item of group.items) {
                const itemEl = document.createElement('div');
                itemEl.className = `q-item q-item-${item.status}`;

                const itemStatusIcon = this._getStatusIcon(item.status);
                const progressBar = item.status === QueueStatus.PROCESSING
                    ? `<div class="q-item-progress"><div class="q-item-progress-fill" style="width:${item.progress}%"></div></div>`
                    : '';

                let actions = '';
                if (item.status === QueueStatus.COMPLETED && item.result) {
                    actions = `
                        <button class="btn btn-xs btn-ghost" data-action="preview" data-id="${item.id}" title="Preview">${Icons.play}</button>
                        <a href="${item.result.url}" download="${escapeHTML(item.outputName)}" class="btn btn-xs btn-ghost" title="Download">${Icons.download}</a>
                    `;
                } else if (item.status === QueueStatus.FAILED) {
                    actions = `
                        <button class="btn btn-xs btn-ghost" data-action="retry" data-id="${item.id}" title="Retry">${Icons.refresh}</button>
                    `;
                }

                const sizeStr = item.result ? formatFileSize(item.result.size) : '';

                itemEl.innerHTML = `
                    <div class="q-item-left">
                        ${itemStatusIcon}
                        <div class="q-item-info">
                            <span class="q-item-name">${escapeHTML(item.outputName)}</span>
                            <span class="q-item-meta">${item.segment.startStr || formatTimeFull(item.segment.start)} → ${item.segment.endStr || formatTimeFull(item.segment.end)} ${sizeStr ? '• ' + sizeStr : ''}</span>
                            ${item.error ? `<span class="q-item-error">${escapeHTML(item.error)}</span>` : ''}
                        </div>
                    </div>
                    ${progressBar}
                    <div class="q-item-actions">${actions}</div>
                `;

                // Bind actions
                itemEl.querySelectorAll('[data-action]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const action = e.currentTarget.dataset.action;
                        const id = e.currentTarget.dataset.id;
                        if (action === 'retry') this.retryItem(id);
                        if (action === 'preview' && item.result) {
                            eventBus.emit('queue:previewResult', item.result);
                        }
                    });
                });

                itemsContainer.appendChild(itemEl);
            }

            list.appendChild(groupEl);
        }

        const stats = this._getStats();
        this.els.totalItems.textContent = `${stats.total} item${stats.total !== 1 ? 's' : ''} in ${stats.videos} video${stats.videos !== 1 ? 's' : ''}`;
        this.els.totalStatus.textContent = this.isProcessing ? 'Processing...' : 'Ready';
    }

    _getStatusIcon(status) {
        const map = {
            [QueueStatus.WAITING]: `<span class="q-status-icon q-status-waiting">${Icons.clock}</span>`,
            [QueueStatus.PROCESSING]: `<span class="q-status-icon q-status-processing"><span class="spinner-sm"></span></span>`,
            [QueueStatus.COMPLETED]: `<span class="q-status-icon q-status-completed">${Icons.check}</span>`,
            [QueueStatus.FAILED]: `<span class="q-status-icon q-status-failed">${Icons.alertTriangle}</span>`,
            [QueueStatus.RETRY]: `<span class="q-status-icon q-status-retry">${Icons.refresh}</span>`,
            [QueueStatus.CANCELLED]: `<span class="q-status-icon q-status-cancelled">${Icons.x}</span>`
        };
        return map[status] || map[QueueStatus.WAITING];
    }
}
