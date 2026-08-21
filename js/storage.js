/**
 * Storage Module — localStorage + IndexedDB manager
 * localStorage: settings, preferences, recent project list
 * IndexedDB: video blobs, thumbnails, large project data
 */

const DB_NAME = 'VideoAutomationStudio';
const DB_VERSION = 1;
const STORES = {
    videos: 'videos',
    thumbnails: 'thumbnails',
    projects: 'projects',
    results: 'results'
};

export class StorageManager {
    constructor() {
        this.db = null;
        this._ready = this._initDB();
    }

    async _initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('IndexedDB failed to open:', request.error);
                reject(request.error);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORES.videos)) {
                    db.createObjectStore(STORES.videos, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.thumbnails)) {
                    db.createObjectStore(STORES.thumbnails, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.projects)) {
                    const projectStore = db.createObjectStore(STORES.projects, { keyPath: 'id' });
                    projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORES.results)) {
                    db.createObjectStore(STORES.results, { keyPath: 'id' });
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
        });
    }

    async ready() {
        await this._ready;
    }

    /* ─── Generic IndexedDB Operations ─── */

    async _put(storeName, data) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async _get(storeName, id) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async _getAll(storeName) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async _delete(storeName, id) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _clear(storeName) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _count(storeName) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /* ─── Video Operations ─── */

    async saveVideoBlob(id, blob, metadata = {}) {
        return this._put(STORES.videos, {
            id,
            blob,
            ...metadata,
            savedAt: Date.now()
        });
    }

    async getVideoBlob(id) {
        return this._get(STORES.videos, id);
    }

    async deleteVideoBlob(id) {
        return this._delete(STORES.videos, id);
    }

    async getAllVideos() {
        return this._getAll(STORES.videos);
    }

    /* ─── Thumbnail Operations ─── */

    async saveThumbnail(id, blob, metadata = {}) {
        return this._put(STORES.thumbnails, {
            id,
            blob,
            ...metadata,
            savedAt: Date.now()
        });
    }

    async getThumbnail(id) {
        return this._get(STORES.thumbnails, id);
    }

    async deleteThumbnail(id) {
        return this._delete(STORES.thumbnails, id);
    }

    async getAllThumbnails() {
        return this._getAll(STORES.thumbnails);
    }

    /* ─── Project Operations (IndexedDB) ─── */

    async saveProject(project) {
        const data = {
            ...project,
            id: project.id || `proj_${Date.now()}`,
            updatedAt: Date.now()
        };
        await this._put(STORES.projects, data);
        this._updateRecentProjectsList(data.id, data.name || 'Untitled');
        return data.id;
    }

    async getProject(id) {
        return this._get(STORES.projects, id);
    }

    async getAllProjects() {
        return this._getAll(STORES.projects);
    }

    async deleteProject(id) {
        await this._delete(STORES.projects, id);
        this._removeFromRecentProjects(id);
    }

    /* ─── Result Operations ─── */

    async saveResult(id, blob, metadata = {}) {
        return this._put(STORES.results, {
            id,
            blob,
            ...metadata,
            savedAt: Date.now()
        });
    }

    async getResult(id) {
        return this._get(STORES.results, id);
    }

    async deleteResult(id) {
        return this._delete(STORES.results, id);
    }

    async getAllResults() {
        return this._getAll(STORES.results);
    }

    async clearResults() {
        return this._clear(STORES.results);
    }

    /* ─── localStorage Operations ─── */

    setSetting(key, value) {
        try {
            localStorage.setItem(`vas_${key}`, JSON.stringify(value));
        } catch (err) {
            console.warn('localStorage write error:', err);
        }
    }

    getSetting(key, defaultValue = null) {
        try {
            const raw = localStorage.getItem(`vas_${key}`);
            return raw !== null ? JSON.parse(raw) : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    removeSetting(key) {
        localStorage.removeItem(`vas_${key}`);
    }

    /* ─── Recent Projects (localStorage list) ─── */

    _updateRecentProjectsList(id, name) {
        const list = this.getRecentProjects();
        const filtered = list.filter(p => p.id !== id);
        filtered.unshift({ id, name, lastOpened: Date.now() });
        if (filtered.length > 20) filtered.length = 20;
        this.setSetting('recentProjects', filtered);
    }

    _removeFromRecentProjects(id) {
        const list = this.getRecentProjects();
        this.setSetting('recentProjects', list.filter(p => p.id !== id));
    }

    getRecentProjects() {
        return this.getSetting('recentProjects', []);
    }

    /* ─── Output Settings ─── */

    saveOutputSettings(settings) {
        this.setSetting('outputSettings', settings);
    }

    getOutputSettings() {
        return this.getSetting('outputSettings', {
            format: 'mp4',
            videoCodec: 'copy',
            quality: 'medium',
            crf: 23,
            audio: 'copy',
            resolution: 'original',
            customWidth: 1920,
            customHeight: 1080,
            aspectRatio: 'original',
            shortVideoMode: false,
            shortVideoFit: 'center-crop',
            namingTemplate: '{prefix}{number}',
            prefix: 'Video_'
        });
    }

    /* ─── Caption & Hashtag Settings ─── */

    saveCaptionSettings(settings) {
        this.setSetting('captionSettings', settings);
    }

    getCaptionSettings() {
        return this.getSetting('captionSettings', {
            template: '{title} — Part {number}',
            hashtags: ['#fyp', '#viral', '#shortvideo']
        });
    }

    /* ─── Storage Usage Estimation ─── */

    async estimateUsage() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage || 0,
                quota: estimate.quota || 0,
                percentUsed: estimate.quota ? ((estimate.usage / estimate.quota) * 100).toFixed(1) : 0
            };
        }
        return { used: 0, quota: 0, percentUsed: 0 };
    }

    /* ─── Cleanup ─── */

    async clearAllData() {
        await this._clear(STORES.videos);
        await this._clear(STORES.thumbnails);
        await this._clear(STORES.projects);
        await this._clear(STORES.results);
        const keys = Object.keys(localStorage).filter(k => k.startsWith('vas_'));
        keys.forEach(k => localStorage.removeItem(k));
    }
}
