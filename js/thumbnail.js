/**
 * Thumbnail Module — Generate, select, and export video thumbnails
 */

import { eventBus, showToast, downloadFile, generateId, Icons } from './utils.js';

export class ThumbnailGenerator {
    constructor(ffmpegManager) {
        this.ffmpeg = ffmpegManager;
        this._thumbnails = new Map(); // clipId -> { blob, url }
    }

    /** Generate thumbnail from a video element at a specific time */
    async fromVideoElement(video, time = null, options = {}) {
        const {
            format = 'image/jpeg',
            quality = 0.92,
            width = null,
            height = null
        } = options;

        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const w = width || video.videoWidth;
            const h = height || video.videoHeight;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');

            const wasPlaying = !video.paused;
            if (wasPlaying) video.pause();

            const generateFrame = () => {
                ctx.drawImage(video, 0, 0, w, h);
                canvas.toBlob(blob => {
                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        resolve({ blob, url, width: w, height: h });
                    } else {
                        reject(new Error('Failed to generate thumbnail'));
                    }
                }, format, quality);
            };

            if (time !== null && time !== video.currentTime) {
                video.currentTime = time;
                video.addEventListener('seeked', generateFrame, { once: true });
            } else {
                generateFrame();
            }
        });
    }

    /** Generate thumbnail using FFmpeg (for files in FFmpeg FS) */
    async fromFFmpeg(inputName, timestamp, options = {}) {
        const outputName = `thumb_${Date.now()}.jpg`;
        const result = await this.ffmpeg.extractFrame(inputName, timestamp, outputName);
        return result;
    }

    /** Generate thumbnail from a Blob URL */
    async fromBlobUrl(blobUrl, time = 0, options = {}) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.muted = true;
            video.preload = 'metadata';

            video.addEventListener('loadedmetadata', () => {
                video.currentTime = Math.min(time, video.duration);
            }, { once: true });

            video.addEventListener('seeked', () => {
                const canvas = document.createElement('canvas');
                canvas.width = options.width || video.videoWidth;
                canvas.height = options.height || video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                const format = options.format || 'image/jpeg';
                const quality = options.quality || 0.92;

                canvas.toBlob(blob => {
                    const url = URL.createObjectURL(blob);
                    video.src = '';
                    resolve({ blob, url, width: canvas.width, height: canvas.height });
                }, format, quality);
            }, { once: true });

            video.addEventListener('error', () => {
                reject(new Error('Failed to load video for thumbnail'));
            }, { once: true });

            video.src = blobUrl;
        });
    }

    /** Store a thumbnail for a clip */
    setThumbnail(clipId, thumbnailData) {
        // Revoke old one if exists
        const old = this._thumbnails.get(clipId);
        if (old && old.url) URL.revokeObjectURL(old.url);
        this._thumbnails.set(clipId, thumbnailData);
    }

    /** Get stored thumbnail */
    getThumbnail(clipId) {
        return this._thumbnails.get(clipId) || null;
    }

    /** Generate thumbnails for all completed results */
    async generateBatch(results) {
        const generated = [];
        for (const result of results) {
            if (!result.url) continue;
            try {
                const thumb = await this.fromBlobUrl(result.url, 0);
                this.setThumbnail(result.id, thumb);
                generated.push({ id: result.id, ...thumb });
            } catch (err) {
                console.warn(`Thumbnail generation failed for ${result.id}:`, err);
            }
        }
        return generated;
    }

    /** Download a thumbnail */
    downloadThumbnail(clipId, filename = 'thumbnail', format = 'image/jpeg') {
        const thumb = this._thumbnails.get(clipId);
        if (!thumb || !thumb.blob) {
            showToast('Thumbnail not found', 'error');
            return;
        }

        const ext = format.includes('png') ? 'png' : format.includes('webp') ? 'webp' : 'jpg';
        downloadFile(thumb.blob, `${filename}.${ext}`);
    }

    /** Convert a thumbnail blob to a different format */
    async convertFormat(blob, targetFormat = 'image/png', quality = 0.92) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const srcUrl = URL.createObjectURL(blob);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(srcUrl);
                canvas.toBlob(newBlob => {
                    const url = URL.createObjectURL(newBlob);
                    resolve({ blob: newBlob, url });
                }, targetFormat, quality);
            };
            img.onerror = () => {
                URL.revokeObjectURL(srcUrl);
                reject(new Error('Failed to convert thumbnail format'));
            };
            img.src = srcUrl;
        });
    }

    /** Cleanup all stored thumbnails */
    cleanup() {
        for (const [, thumb] of this._thumbnails) {
            if (thumb && thumb.url) URL.revokeObjectURL(thumb.url);
        }
        this._thumbnails.clear();
    }

    /** Get count of stored thumbnails */
    get count() {
        return this._thumbnails.size;
    }
}
