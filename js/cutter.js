/**
 * Cutter Module — Cut list editor with drag & drop, auto-split, scene detection
 */

import { eventBus, formatTimeFull, timeToSeconds, formatDuration, showToast, generateId, escapeHTML, Icons } from './utils.js';

/** Single cut segment */
class CutSegment {
    constructor(start, end, id = null) {
        this.id = id || generateId('seg');
        this.start = start;
        this.end = end;
        this.status = 'pending'; // pending, processing, completed, failed
    }

    get duration() {
        return this.end - this.start;
    }

    get startStr() {
        return formatTimeFull(this.start);
    }

    get endStr() {
        return formatTimeFull(this.end);
    }

    clone() {
        return new CutSegment(this.start, this.end);
    }

    toJSON() {
        return { start: this.start, end: this.end, id: this.id };
    }
}

export class CutListEditor {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.segments = [];
        this.videoDuration = 0;
        this._history = [];
        this._historyIndex = -1;
        this._maxHistory = 50;
        this._draggedRow = null;
    }

    build() {
        this.container.innerHTML = `
            <div class="cl-header">
                <h3>${Icons.scissors} Cut List Editor</h3>
                <div class="cl-actions">
                    <button class="btn btn-sm btn-ghost" id="clUndo" title="Undo (Ctrl+Z)" disabled>${Icons.refresh} Undo</button>
                    <button class="btn btn-sm btn-ghost" id="clRedo" title="Redo (Ctrl+Y)" disabled>${Icons.refresh} Redo</button>
                    <button class="btn btn-sm btn-secondary" id="clImportTxt">${Icons.upload} Import</button>
                    <button class="btn btn-sm btn-secondary" id="clExportTxt">${Icons.download} Export</button>
                    <button class="btn btn-sm btn-danger" id="clClearAll">${Icons.trash} Clear</button>
                </div>
            </div>

            <div class="cl-auto-split">
                <h4>Auto Split</h4>
                <div class="cl-split-modes">
                    <div class="cl-split-mode">
                        <label>Fixed Duration (seconds)</label>
                        <div class="cl-split-row">
                            <input type="number" id="clFixedDuration" value="30" min="1" max="3600" class="input-sm">
                            <button class="btn btn-sm btn-primary" id="clSplitFixed">Split</button>
                        </div>
                    </div>
                    <div class="cl-split-mode">
                        <label>Custom Timestamps</label>
                        <div class="cl-split-row">
                            <textarea id="clCustomTimestamps" rows="3" class="input-sm" placeholder="00:00:00 - 00:00:30&#10;00:00:30 - 00:01:00"></textarea>
                            <button class="btn btn-sm btn-primary" id="clSplitCustom">Parse</button>
                        </div>
                    </div>
                    <div class="cl-split-mode">
                        <label>Scene Detection</label>
                        <div class="cl-split-row">
                            <label class="cl-threshold-label">Threshold:
                                <input type="range" id="clSceneThreshold" min="0.1" max="0.9" step="0.05" value="0.3">
                                <span id="clThresholdValue">0.30</span>
                            </label>
                            <button class="btn btn-sm btn-primary" id="clDetectScenes">Detect</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="cl-add-manual">
                <button class="btn btn-sm btn-primary" id="clAddFromPlayer">
                    ${Icons.clock} Add from Player
                </button>
                <button class="btn btn-sm btn-secondary" id="clAddManual">
                    + Add Row
                </button>
            </div>

            <div class="cl-table-wrap">
                <table class="cl-table" id="clTable">
                    <thead>
                        <tr>
                            <th class="cl-col-drag"></th>
                            <th class="cl-col-no">#</th>
                            <th class="cl-col-start">Start</th>
                            <th class="cl-col-end">End</th>
                            <th class="cl-col-dur">Duration</th>
                            <th class="cl-col-status">Status</th>
                            <th class="cl-col-actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="clTableBody"></tbody>
                </table>
                <div class="cl-empty" id="clEmpty">
                    <p>No segments added yet. Use Auto Split or add manually.</p>
                </div>
            </div>

            <div class="cl-summary" id="clSummary">
                <span id="clSegmentCount">0 segments</span>
                <span id="clTotalDuration">Total: 00:00:00</span>
            </div>

            <input type="file" id="clImportFile" accept=".txt,.csv,.json" hidden>
        `;

        this._cacheElements();
        this._bindEvents();
    }

    _cacheElements() {
        this.els = {
            undoBtn: document.getElementById('clUndo'),
            redoBtn: document.getElementById('clRedo'),
            importBtn: document.getElementById('clImportTxt'),
            exportBtn: document.getElementById('clExportTxt'),
            clearBtn: document.getElementById('clClearAll'),
            fixedDuration: document.getElementById('clFixedDuration'),
            splitFixedBtn: document.getElementById('clSplitFixed'),
            customTimestamps: document.getElementById('clCustomTimestamps'),
            splitCustomBtn: document.getElementById('clSplitCustom'),
            sceneThreshold: document.getElementById('clSceneThreshold'),
            thresholdValue: document.getElementById('clThresholdValue'),
            detectScenesBtn: document.getElementById('clDetectScenes'),
            addFromPlayerBtn: document.getElementById('clAddFromPlayer'),
            addManualBtn: document.getElementById('clAddManual'),
            tableBody: document.getElementById('clTableBody'),
            empty: document.getElementById('clEmpty'),
            segmentCount: document.getElementById('clSegmentCount'),
            totalDuration: document.getElementById('clTotalDuration'),
            importFile: document.getElementById('clImportFile')
        };
    }

    _bindEvents() {
        // Undo/Redo
        this.els.undoBtn.addEventListener('click', () => this.undo());
        this.els.redoBtn.addEventListener('click', () => this.redo());

        // Import/Export
        this.els.importBtn.addEventListener('click', () => this.els.importFile.click());
        this.els.importFile.addEventListener('change', (e) => this._importFile(e));
        this.els.exportBtn.addEventListener('click', () => this._exportFile());
        this.els.clearBtn.addEventListener('click', () => {
            if (this.segments.length === 0) return;
            this._saveHistory();
            this.segments = [];
            this.render();
            showToast('Cut list cleared', 'info');
        });

        // Auto Split
        this.els.splitFixedBtn.addEventListener('click', () => this.splitByFixedDuration());
        this.els.splitCustomBtn.addEventListener('click', () => this.splitByCustomTimestamps());
        this.els.detectScenesBtn.addEventListener('click', () => {
            eventBus.emit('cutter:detectScenes', {
                threshold: parseFloat(this.els.sceneThreshold.value)
            });
        });
        this.els.sceneThreshold.addEventListener('input', (e) => {
            this.els.thresholdValue.textContent = parseFloat(e.target.value).toFixed(2);
        });

        // Add segment
        this.els.addFromPlayerBtn.addEventListener('click', () => {
            eventBus.emit('cutter:requestMarks');
        });
        this.els.addManualBtn.addEventListener('click', () => {
            this.addSegment(0, Math.min(10, this.videoDuration || 10));
        });

        // Listen for player marks
        eventBus.on('player:marksResponse', (marks) => {
            if (marks.start !== null && marks.end !== null) {
                this.addSegment(marks.start, marks.end);
                showToast('Segment added from player', 'success');
            } else {
                showToast('Set both Start and End marks on the player first', 'warning');
            }
        });

        // Listen for scene detection results
        eventBus.on('cutter:scenesDetected', (timestamps) => {
            this._applySceneSegments(timestamps);
        });
    }

    /* ─── Public API ─── */

    setVideoDuration(duration) {
        this.videoDuration = duration;
    }

    addSegment(start, end) {
        this._saveHistory();
        const seg = new CutSegment(start, end);
        this.segments.push(seg);
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
        return seg;
    }

    removeSegment(id) {
        this._saveHistory();
        this.segments = this.segments.filter(s => s.id !== id);
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
    }

    duplicateSegment(id) {
        this._saveHistory();
        const seg = this.segments.find(s => s.id === id);
        if (!seg) return;
        const idx = this.segments.indexOf(seg);
        const clone = seg.clone();
        this.segments.splice(idx + 1, 0, clone);
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
    }

    moveSegment(id, direction) {
        const idx = this.segments.findIndex(s => s.id === id);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= this.segments.length) return;
        this._saveHistory();
        [this.segments[idx], this.segments[newIdx]] = [this.segments[newIdx], this.segments[idx]];
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
    }

    editSegment(id, start, end) {
        const seg = this.segments.find(s => s.id === id);
        if (!seg) return;
        this._saveHistory();
        seg.start = start;
        seg.end = end;
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
    }

    updateSegmentStatus(id, status) {
        const seg = this.segments.find(s => s.id === id);
        if (seg) {
            seg.status = status;
            this.render();
        }
    }

    getSegments() {
        return this.segments.map((s, i) => ({
            id: s.id,
            index: i + 1,
            start: s.start,
            end: s.end,
            duration: s.duration,
            startStr: s.startStr,
            endStr: s.endStr,
            status: s.status
        }));
    }

    setSegments(items) {
        this._saveHistory();
        this.segments = items.map(item => {
            const seg = new CutSegment(item.start, item.end, item.id);
            if (item.status) seg.status = item.status;
            return seg;
        });
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
    }

    resetAllStatus() {
        this.segments.forEach(s => s.status = 'pending');
        this.render();
    }

    splitByFixedDuration() {
        const dur = parseInt(this.els.fixedDuration.value);
        if (!dur || dur <= 0 || !this.videoDuration) {
            showToast('Enter a valid duration and load a video first', 'warning');
            return;
        }

        this._saveHistory();
        this.segments = [];
        let t = 0;
        while (t < this.videoDuration) {
            const end = Math.min(t + dur, this.videoDuration);
            if (end - t > 0.1) {
                this.segments.push(new CutSegment(t, end));
            }
            t = end;
        }
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
        showToast(`Created ${this.segments.length} segments (${dur}s each)`, 'success');
    }

    splitByCustomTimestamps() {
        const text = this.els.customTimestamps.value.trim();
        if (!text) {
            showToast('Enter timestamp pairs', 'warning');
            return;
        }

        const parsed = this._parseTimestampText(text);
        if (parsed.error) {
            showToast(parsed.error, 'error');
            return;
        }

        this._saveHistory();
        this.segments = parsed.items.map(p => new CutSegment(p.start, p.end));
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
        showToast(`Parsed ${this.segments.length} segments`, 'success');
    }

    _applySceneSegments(timestamps) {
        if (!timestamps || timestamps.length === 0) {
            showToast('No scene changes detected. Try a lower threshold.', 'warning');
            return;
        }

        this._saveHistory();
        this.segments = [];
        let prev = 0;
        for (const t of timestamps) {
            if (t - prev > 0.5) {
                this.segments.push(new CutSegment(prev, t));
            }
            prev = t;
        }
        if (this.videoDuration - prev > 0.5) {
            this.segments.push(new CutSegment(prev, this.videoDuration));
        }
        this.render();
        eventBus.emit('cutter:updated', this.getSegments());
        showToast(`Detected ${this.segments.length} scenes`, 'success');
    }

    /* ─── Undo/Redo ─── */

    undo() {
        if (this._historyIndex < 0) return;
        const state = this._history[this._historyIndex];
        this._historyIndex--;
        this.segments = state.map(s => {
            const seg = new CutSegment(s.start, s.end, s.id);
            seg.status = s.status;
            return seg;
        });
        this.render();
        this._updateUndoRedoButtons();
        eventBus.emit('cutter:updated', this.getSegments());
    }

    redo() {
        if (this._historyIndex >= this._history.length - 2) return;
        this._historyIndex += 2;
        const state = this._history[this._historyIndex];
        if (!state) return;
        this._historyIndex--;
        this.segments = state.map(s => {
            const seg = new CutSegment(s.start, s.end, s.id);
            seg.status = s.status;
            return seg;
        });
        this.render();
        this._updateUndoRedoButtons();
        eventBus.emit('cutter:updated', this.getSegments());
    }

    _saveHistory() {
        // Remove any future states if we branched
        this._history = this._history.slice(0, this._historyIndex + 1);
        this._history.push(this.segments.map(s => ({ start: s.start, end: s.end, id: s.id, status: s.status })));
        if (this._history.length > this._maxHistory) this._history.shift();
        this._historyIndex = this._history.length - 1;
        this._updateUndoRedoButtons();
    }

    _updateUndoRedoButtons() {
        if (this.els.undoBtn) this.els.undoBtn.disabled = this._historyIndex < 0;
        if (this.els.redoBtn) this.els.redoBtn.disabled = this._historyIndex >= this._history.length - 1;
    }

    /* ─── Rendering ─── */

    render() {
        const tbody = this.els.tableBody;
        tbody.innerHTML = '';

        if (this.segments.length === 0) {
            this.els.empty.classList.remove('hidden');
            this.els.segmentCount.textContent = '0 segments';
            this.els.totalDuration.textContent = 'Total: 00:00:00';
            this._updateUndoRedoButtons();
            return;
        }

        this.els.empty.classList.add('hidden');

        this.segments.forEach((seg, idx) => {
            const tr = document.createElement('tr');
            tr.className = `cl-row cl-status-${seg.status}`;
            tr.dataset.id = seg.id;
            tr.draggable = true;

            const statusBadge = this._getStatusBadge(seg.status);

            tr.innerHTML = `
                <td class="cl-col-drag"><span class="cl-drag-handle">${Icons.grip}</span></td>
                <td class="cl-col-no">${idx + 1}</td>
                <td class="cl-col-start">
                    <input type="text" class="cl-time-input" value="${seg.startStr}" data-field="start" data-id="${seg.id}">
                </td>
                <td class="cl-col-end">
                    <input type="text" class="cl-time-input" value="${seg.endStr}" data-field="end" data-id="${seg.id}">
                </td>
                <td class="cl-col-dur">${formatDuration(seg.duration)}</td>
                <td class="cl-col-status">${statusBadge}</td>
                <td class="cl-col-actions">
                    <div class="cl-action-btns">
                        <button class="cl-act-btn" title="Preview" data-action="preview" data-id="${seg.id}">${Icons.play}</button>
                        <button class="cl-act-btn" title="Duplicate" data-action="duplicate" data-id="${seg.id}">${Icons.copy}</button>
                        <button class="cl-act-btn" title="Move Up" data-action="up" data-id="${seg.id}">${Icons.chevronUp}</button>
                        <button class="cl-act-btn" title="Move Down" data-action="down" data-id="${seg.id}">${Icons.chevronDown}</button>
                        <button class="cl-act-btn cl-act-delete" title="Delete" data-action="delete" data-id="${seg.id}">${Icons.trash}</button>
                    </div>
                </td>
            `;

            // Inline time editing
            tr.querySelectorAll('.cl-time-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const field = e.target.dataset.field;
                    const segId = e.target.dataset.id;
                    const newTime = timeToSeconds(e.target.value);
                    if (newTime < 0) {
                        showToast('Invalid time format', 'error');
                        return;
                    }
                    const s = this.segments.find(x => x.id === segId);
                    if (!s) return;
                    if (field === 'start') {
                        this.editSegment(segId, newTime, s.end);
                    } else {
                        this.editSegment(segId, s.start, newTime);
                    }
                });
            });

            // Action buttons
            tr.querySelectorAll('.cl-act-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.currentTarget.dataset.action;
                    const segId = e.currentTarget.dataset.id;
                    switch (action) {
                        case 'preview':
                            const s = this.segments.find(x => x.id === segId);
                            if (s) eventBus.emit('player:seekTo', s.start);
                            break;
                        case 'duplicate':
                            this.duplicateSegment(segId);
                            break;
                        case 'up':
                            this.moveSegment(segId, -1);
                            break;
                        case 'down':
                            this.moveSegment(segId, 1);
                            break;
                        case 'delete':
                            this.removeSegment(segId);
                            break;
                    }
                });
            });

            // Drag & drop
            tr.addEventListener('dragstart', (e) => {
                this._draggedRow = tr;
                tr.classList.add('cl-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', seg.id);
            });

            tr.addEventListener('dragend', () => {
                tr.classList.remove('cl-dragging');
                this._draggedRow = null;
                tbody.querySelectorAll('.cl-drag-over').forEach(el => el.classList.remove('cl-drag-over'));
            });

            tr.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (this._draggedRow && this._draggedRow !== tr) {
                    tr.classList.add('cl-drag-over');
                }
            });

            tr.addEventListener('dragleave', () => {
                tr.classList.remove('cl-drag-over');
            });

            tr.addEventListener('drop', (e) => {
                e.preventDefault();
                tr.classList.remove('cl-drag-over');
                if (!this._draggedRow || this._draggedRow === tr) return;

                const dragId = this._draggedRow.dataset.id;
                const dropId = tr.dataset.id;
                const dragIdx = this.segments.findIndex(s => s.id === dragId);
                const dropIdx = this.segments.findIndex(s => s.id === dropId);

                if (dragIdx < 0 || dropIdx < 0) return;
                this._saveHistory();
                const [moved] = this.segments.splice(dragIdx, 1);
                this.segments.splice(dropIdx, 0, moved);
                this.render();
                eventBus.emit('cutter:updated', this.getSegments());
            });

            tbody.appendChild(tr);
        });

        // Update summary
        const totalDur = this.segments.reduce((sum, s) => sum + s.duration, 0);
        this.els.segmentCount.textContent = `${this.segments.length} segment${this.segments.length !== 1 ? 's' : ''}`;
        this.els.totalDuration.textContent = `Total: ${formatTimeFull(totalDur)}`;
        this._updateUndoRedoButtons();
    }

    _getStatusBadge(status) {
        const map = {
            pending: '<span class="badge badge-waiting">Pending</span>',
            processing: '<span class="badge badge-processing">Processing</span>',
            completed: '<span class="badge badge-completed">Completed</span>',
            failed: '<span class="badge badge-failed">Failed</span>'
        };
        return map[status] || map.pending;
    }

    /* ─── Import/Export ─── */

    _parseTimestampText(text) {
        const lines = text.split('\n').filter(l => l.trim());
        const items = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('#') || line.startsWith('//')) continue;
            const parts = line.split('-').map(p => p.trim());
            if (parts.length !== 2) {
                return { error: `Line ${i + 1}: Invalid format. Use "Start - End"`, items: [] };
            }
            const start = timeToSeconds(parts[0]);
            const end = timeToSeconds(parts[1]);
            if (start < 0 || end < 0) {
                return { error: `Line ${i + 1}: Invalid time format (use HH:MM:SS or MM:SS)`, items: [] };
            }
            if (start >= end) {
                return { error: `Line ${i + 1}: End time must be greater than start time`, items: [] };
            }
            items.push({ start, end });
        }

        return { items, error: null };
    }

    _importFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;

            // Try JSON first
            try {
                const json = JSON.parse(text);
                if (Array.isArray(json)) {
                    this._saveHistory();
                    this.segments = json.map(item => {
                        const start = typeof item.start === 'number' ? item.start : timeToSeconds(item.start);
                        const end = typeof item.end === 'number' ? item.end : timeToSeconds(item.end);
                        return new CutSegment(start, end);
                    }).filter(s => s.start >= 0 && s.end > s.start);
                    this.render();
                    eventBus.emit('cutter:updated', this.getSegments());
                    showToast(`Imported ${this.segments.length} segments from JSON`, 'success');
                    return;
                }
            } catch (e) {
                // Not JSON, try text format
            }

            const parsed = this._parseTimestampText(text);
            if (parsed.error) {
                showToast(parsed.error, 'error');
                return;
            }

            this._saveHistory();
            this.segments = parsed.items.map(p => new CutSegment(p.start, p.end));
            this.render();
            eventBus.emit('cutter:updated', this.getSegments());
            showToast(`Imported ${this.segments.length} segments`, 'success');
        };
        reader.readAsText(file);
        this.els.importFile.value = '';
    }

    _exportFile() {
        if (this.segments.length === 0) {
            showToast('No segments to export', 'warning');
            return;
        }

        const lines = this.segments.map(s => `${s.startStr} - ${s.endStr}`);
        const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CutList_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Cut list exported', 'success');
    }
}
