/**
 * Project Module — Save/Load/Export/Import project state as JSON
 * Never stores passwords, credentials, or sensitive tokens
 */

import { eventBus, showToast, generateId, formatDate, formatDateTime, escapeHTML, downloadFile, Icons } from './utils.js';
import { StorageManager } from './storage.js';

export class ProjectManager {
    constructor(storageManager, containerId) {
        this.storage = storageManager;
        this.container = document.getElementById(containerId);
        this.currentProject = null;
        this._autoSaveTimer = null;
    }

    build() {
        this.container.innerHTML = `
            <div class="proj-page">
                <div class="proj-header">
                    <h2>${Icons.project} Project Manager</h2>
                    <div class="proj-header-actions">
                        <button class="btn btn-primary" id="projNew">${Icons.project} New Project</button>
                        <button class="btn btn-secondary" id="projImportFile">${Icons.upload} Import JSON</button>
                        <input type="file" id="projFileInput" accept=".json" hidden>
                    </div>
                </div>

                <div class="proj-current glass-panel" id="projCurrentSection">
                    <h3>Current Project</h3>
                    <div class="proj-current-info" id="projCurrentInfo">
                        <p class="proj-no-project">No project loaded. Create a new project or open a saved one.</p>
                    </div>
                    <div class="proj-current-actions hidden" id="projCurrentActions">
                        <button class="btn btn-sm btn-primary" id="projSave">${Icons.save} Save</button>
                        <button class="btn btn-sm btn-secondary" id="projSaveAs">${Icons.save} Save As</button>
                        <button class="btn btn-sm btn-secondary" id="projExport">${Icons.download} Export JSON</button>
                    </div>
                </div>

                <div class="proj-list glass-panel">
                    <h3>Saved Projects</h3>
                    <div class="proj-items" id="projItems">
                        <div class="proj-empty" id="projEmpty">
                            <p>No saved projects yet.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._cacheElements();
        this._bindEvents();
        this._loadProjectList();
    }

    _cacheElements() {
        this.els = {
            newBtn: document.getElementById('projNew'),
            importBtn: document.getElementById('projImportFile'),
            fileInput: document.getElementById('projFileInput'),
            currentSection: document.getElementById('projCurrentSection'),
            currentInfo: document.getElementById('projCurrentInfo'),
            currentActions: document.getElementById('projCurrentActions'),
            saveBtn: document.getElementById('projSave'),
            saveAsBtn: document.getElementById('projSaveAs'),
            exportBtn: document.getElementById('projExport'),
            items: document.getElementById('projItems'),
            empty: document.getElementById('projEmpty')
        };
    }

    _bindEvents() {
        this.els.newBtn.addEventListener('click', () => this.createNew());
        this.els.importBtn.addEventListener('click', () => this.els.fileInput.click());
        this.els.fileInput.addEventListener('change', (e) => this._importFromFile(e));
        this.els.saveBtn.addEventListener('click', () => this.save());
        this.els.saveAsBtn.addEventListener('click', () => this.saveAs());
        this.els.exportBtn.addEventListener('click', () => this.exportToFile());
    }

    /* ─── Public API ─── */

    /** Create a new project */
    createNew(name = null) {
        const projectName = name || `Project_${formatDate()}`;
        this.currentProject = {
            id: generateId('proj'),
            name: projectName,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: null,
            cutList: [],
            outputSettings: {},
            captionSettings: {},
            queue: [],
            preferences: {}
        };

        this._updateCurrentProjectUI();
        eventBus.emit('project:created', this.currentProject);
        showToast(`New project "${projectName}" created`, 'success');
        return this.currentProject;
    }

    /** Save current project */
    async save() {
        if (!this.currentProject) {
            showToast('No project to save', 'warning');
            return;
        }

        this._collectCurrentState();
        this.currentProject.updatedAt = Date.now();

        await this.storage.saveProject(this.currentProject);
        this._loadProjectList();
        showToast(`Project "${this.currentProject.name}" saved`, 'success');
        eventBus.emit('project:saved', this.currentProject);
    }

    /** Save as a new project */
    async saveAs() {
        if (!this.currentProject) {
            this.createNew();
            return;
        }

        const newName = prompt('Enter project name:', this.currentProject.name + ' (Copy)');
        if (!newName) return;

        this.currentProject.id = generateId('proj');
        this.currentProject.name = newName;
        this.currentProject.createdAt = Date.now();

        await this.save();
    }

    /** Load a project */
    async load(projectId) {
        const project = await this.storage.getProject(projectId);
        if (!project) {
            showToast('Project not found', 'error');
            return;
        }

        this.currentProject = project;
        this._updateCurrentProjectUI();
        this._applyProjectState();
        eventBus.emit('project:loaded', this.currentProject);
        showToast(`Project "${project.name}" loaded`, 'success');
    }

    /** Delete a project */
    async deleteProject(projectId) {
        await this.storage.deleteProject(projectId);
        if (this.currentProject && this.currentProject.id === projectId) {
            this.currentProject = null;
            this._updateCurrentProjectUI();
        }
        this._loadProjectList();
        showToast('Project deleted', 'info');
    }

    /** Export current project to JSON file */
    exportToFile() {
        if (!this.currentProject) {
            showToast('No project to export', 'warning');
            return;
        }

        this._collectCurrentState();

        // Create a clean export (no blobs, no credentials)
        const exportData = {
            ...this.currentProject,
            _exportedAt: new Date().toISOString(),
            _version: '1.0'
        };

        // Remove any blob references
        delete exportData.videoBlob;

        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        downloadFile(blob, `${this.currentProject.name}.json`);
        showToast('Project exported', 'success');
    }

    /** Import project from JSON file */
    async _importFromFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.name || !data.cutList) {
                throw new Error('Invalid project file format');
            }

            // Assign new ID to avoid conflicts
            data.id = generateId('proj');
            data.updatedAt = Date.now();

            this.currentProject = data;
            await this.storage.saveProject(data);

            this._updateCurrentProjectUI();
            this._applyProjectState();
            this._loadProjectList();

            eventBus.emit('project:loaded', this.currentProject);
            showToast(`Project "${data.name}" imported successfully`, 'success');
        } catch (err) {
            console.error('Import error:', err);
            showToast(`Failed to import project: ${err.message}`, 'error');
        }

        this.els.fileInput.value = '';
    }

    /** Get current project data */
    getCurrentProject() {
        if (this.currentProject) {
            this._collectCurrentState();
        }
        return this.currentProject;
    }

    /** Start auto-save (every 60 seconds) */
    startAutoSave(intervalMs = 60000) {
        this.stopAutoSave();
        this._autoSaveTimer = setInterval(() => {
            if (this.currentProject) {
                this.save().catch(() => {});
            }
        }, intervalMs);
    }

    stopAutoSave() {
        if (this._autoSaveTimer) {
            clearInterval(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    /* ─── Private ─── */

    _collectCurrentState() {
        if (!this.currentProject) return;

        // Collect cut list from the cutter module
        eventBus.emit('project:collectState', (state) => {
            if (state.cutList) this.currentProject.cutList = state.cutList;
            if (state.outputSettings) this.currentProject.outputSettings = state.outputSettings;
            if (state.captionSettings) this.currentProject.captionSettings = state.captionSettings;
            if (state.source) this.currentProject.source = state.source;
        });

        // Also collect from localStorage
        try {
            const outputSettings = JSON.parse(localStorage.getItem('vas_outputSettings') || '{}');
            const captionSettings = JSON.parse(localStorage.getItem('vas_captionSettings') || '{}');
            this.currentProject.outputSettings = outputSettings;
            this.currentProject.captionSettings = captionSettings;
        } catch (e) {
            // Ignore
        }
    }

    _applyProjectState() {
        if (!this.currentProject) return;
        eventBus.emit('project:applyState', {
            cutList: this.currentProject.cutList,
            outputSettings: this.currentProject.outputSettings,
            captionSettings: this.currentProject.captionSettings,
            source: this.currentProject.source
        });
    }

    _updateCurrentProjectUI() {
        if (!this.currentProject) {
            this.els.currentInfo.innerHTML = '<p class="proj-no-project">No project loaded.</p>';
            this.els.currentActions.classList.add('hidden');
            return;
        }

        this.els.currentInfo.innerHTML = `
            <div class="proj-current-card">
                <div class="proj-current-name">${escapeHTML(this.currentProject.name)}</div>
                <div class="proj-current-meta">
                    <span>Created: ${formatDateTime(this.currentProject.createdAt)}</span>
                    <span>Updated: ${formatDateTime(this.currentProject.updatedAt)}</span>
                    <span>Segments: ${(this.currentProject.cutList || []).length}</span>
                </div>
            </div>
        `;
        this.els.currentActions.classList.remove('hidden');
    }

    async _loadProjectList() {
        try {
            const projects = await this.storage.getAllProjects();
            const sortedProjects = projects.sort((a, b) => b.updatedAt - a.updatedAt);

            if (sortedProjects.length === 0) {
                this.els.items.innerHTML = '';
                this.els.empty.classList.remove('hidden');
                this.els.items.appendChild(this.els.empty);
                return;
            }

            this.els.empty.classList.add('hidden');
            this.els.items.innerHTML = '';

            sortedProjects.forEach(proj => {
                const card = document.createElement('div');
                card.className = 'proj-card';

                const isCurrentClass = this.currentProject && this.currentProject.id === proj.id ? 'proj-card-current' : '';
                card.classList.add(isCurrentClass || 'proj-card-default');

                card.innerHTML = `
                    <div class="proj-card-info">
                        <span class="proj-card-name">${escapeHTML(proj.name)}</span>
                        <span class="proj-card-meta">${formatDateTime(proj.updatedAt)} • ${(proj.cutList || []).length} segments</span>
                    </div>
                    <div class="proj-card-actions">
                        <button class="btn btn-xs btn-primary" data-action="load" data-id="${proj.id}">Open</button>
                        <button class="btn btn-xs btn-danger" data-action="delete" data-id="${proj.id}">${Icons.trash}</button>
                    </div>
                `;

                card.querySelectorAll('[data-action]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const action = e.currentTarget.dataset.action;
                        const id = e.currentTarget.dataset.id;
                        if (action === 'load') this.load(id);
                        if (action === 'delete') {
                            if (confirm('Delete this project?')) this.deleteProject(id);
                        }
                    });
                });

                this.els.items.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load project list:', err);
        }
    }
}
