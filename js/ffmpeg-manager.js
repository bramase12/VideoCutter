/**
 * FFmpeg Manager — FFmpeg WASM wrapper with memory management
 * Handles initialization, video cutting, scene detection, and resource cleanup
 */

import { eventBus, showToast, formatFileSize } from './utils.js';

export class FFmpegManager {
    constructor() {
        this.ffmpeg = null;
        this.isLoaded = false;
        this.isProcessing = false;
        this._objectUrls = new Set();
        this._writtenFiles = new Set();
    }

    async init() {
        try {
            if (!window.FFmpegWASM) {
                throw new Error('FFmpeg WASM library not loaded. Check ffmpeg/ffmpeg.js');
            }

            const { FFmpeg } = window.FFmpegWASM;
            this.ffmpeg = new FFmpeg();

            this.ffmpeg.on('progress', ({ progress, time }) => {
                if (this.isProcessing && progress >= 0 && progress <= 1) {
                    eventBus.emit('ffmpeg:progress', {
                        progress: Math.min(progress, 1),
                        percent: Math.round(Math.min(progress, 1) * 100),
                        time
                    });
                }
            });

            this.ffmpeg.on('log', ({ type, message }) => {
                eventBus.emit('ffmpeg:log', { type, message });
            });

            eventBus.emit('ffmpeg:status', { status: 'loading', text: 'Loading WASM Core...' });

            await this.ffmpeg.load({
                coreURL: '/ffmpeg/ffmpeg-core.js',
                wasmURL: '/ffmpeg/ffmpeg-core.wasm',
                classWorkerURL: '/ffmpeg/814.ffmpeg.js'
            });

            this.isLoaded = true;
            eventBus.emit('ffmpeg:status', { status: 'ready', text: 'Ready (WASM Active)' });
            showToast('FFmpeg engine loaded successfully', 'success');
            return true;
        } catch (error) {
            console.error('FFmpeg Load Error:', error);
            eventBus.emit('ffmpeg:status', { status: 'error', text: 'Failed to Load FFmpeg' });
            showToast('Failed to load FFmpeg engine. Check console for details.', 'error');
            return false;
        }
    }

    /** Write a File object to FFmpeg virtual filesystem */
    async writeInputFile(file, inputName) {
        if (!this.isLoaded) throw new Error('FFmpeg not loaded');
        const data = await file.arrayBuffer();
        await this.ffmpeg.writeFile(inputName, new Uint8Array(data));
        this._writtenFiles.add(inputName);
    }

    /** Write raw Uint8Array data to FFmpeg virtual filesystem */
    async writeRawFile(name, data) {
        if (!this.isLoaded) throw new Error('FFmpeg not loaded');
        await this.ffmpeg.writeFile(name, data instanceof Uint8Array ? data : new Uint8Array(data));
        this._writtenFiles.add(name);
    }

    /** Cut a single segment from a video */
    async cutSegment(inputName, outputName, startSec, endSec, settings = {}) {
        if (!this.isLoaded) throw new Error('FFmpeg not loaded');

        const {
            videoCodec = 'copy',
            audioCodec = 'copy',
            format = 'mp4',
            quality = 'medium',
            crf = 23,
            resolution = 'original',
            customWidth = null,
            customHeight = null,
            aspectRatio = 'original',
            shortVideoMode = false,
            shortVideoFit = 'center-crop'
        } = settings;

        const args = [];
        const duration = endSec - startSec;

        if (videoCodec === 'copy') {
            args.push('-ss', startSec.toString());
            args.push('-i', inputName);
            args.push('-to', duration.toString());
            args.push('-c', 'copy');
            args.push('-avoid_negative_ts', 'make_zero');
        } else {
            args.push('-i', inputName);
            args.push('-ss', startSec.toString());
            args.push('-to', endSec.toString());

            // Video codec
            if (videoCodec === 'libx264') {
                args.push('-c:v', 'libx264');
                const crfVal = quality === 'low' ? 28 : quality === 'high' ? 18 : quality === 'custom' ? crf : 23;
                args.push('-crf', crfVal.toString());
                args.push('-preset', 'fast');
            } else if (videoCodec === 'libvpx-vp9') {
                args.push('-c:v', 'libvpx-vp9');
                const crfVal = quality === 'low' ? 40 : quality === 'high' ? 20 : quality === 'custom' ? crf : 30;
                args.push('-crf', crfVal.toString());
                args.push('-b:v', '0');
            } else {
                args.push('-c:v', videoCodec);
            }

            // Filters
            const filters = [];

            // Resolution / Aspect ratio / Short video mode
            if (shortVideoMode) {
                if (shortVideoFit === 'center-crop') {
                    filters.push("crop=ih*9/16:ih");
                    filters.push("scale=1080:1920");
                } else if (shortVideoFit === 'fit') {
                    filters.push("scale=1080:1920:force_original_aspect_ratio=decrease");
                    filters.push("pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black");
                } else if (shortVideoFit === 'blur') {
                    // Blur background requires complex filter graph - use simple pad instead
                    filters.push("scale=1080:1920:force_original_aspect_ratio=decrease");
                    filters.push("pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black");
                }
            } else if (resolution !== 'original') {
                const resMap = {
                    '1080p': 'scale=-2:1080',
                    '720p': 'scale=-2:720',
                    '480p': 'scale=-2:480'
                };
                if (resolution === 'custom' && customWidth && customHeight) {
                    filters.push(`scale=${customWidth}:${customHeight}`);
                } else if (resMap[resolution]) {
                    filters.push(resMap[resolution]);
                }
            }

            if (aspectRatio !== 'original' && !shortVideoMode) {
                const ratioMap = {
                    '16:9': 'setdar=16/9',
                    '9:16': 'setdar=9/16',
                    '1:1': 'crop=min(iw\\,ih):min(iw\\,ih)'
                };
                if (ratioMap[aspectRatio]) {
                    filters.push(ratioMap[aspectRatio]);
                }
            }

            if (filters.length > 0) {
                args.push('-vf', filters.join(','));
            }

            // Audio codec
            if (audioCodec === 'none') {
                args.push('-an');
            } else if (audioCodec === 'aac') {
                args.push('-c:a', 'aac', '-b:a', '128k');
            } else {
                args.push('-c:a', 'copy');
            }
        }

        args.push('-y', outputName);

        this.isProcessing = true;
        try {
            await this.ffmpeg.exec(args);
            const fileData = await this.ffmpeg.readFile(outputName);
            const mimeMap = { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska' };
            const blob = new Blob([fileData.buffer], { type: mimeMap[format] || 'video/mp4' });
            const url = URL.createObjectURL(blob);
            this._objectUrls.add(url);

            // Cleanup output from virtual FS
            await this.ffmpeg.deleteFile(outputName);
            this._writtenFiles.delete(outputName);

            return { blob, url, size: blob.size };
        } finally {
            this.isProcessing = false;
        }
    }

    /** Extract a thumbnail frame at a specific timestamp */
    async extractFrame(inputName, timestamp, outputName = 'frame.jpg') {
        if (!this.isLoaded) throw new Error('FFmpeg not loaded');

        await this.ffmpeg.exec([
            '-ss', timestamp.toString(),
            '-i', inputName,
            '-frames:v', '1',
            '-q:v', '2',
            '-y', outputName
        ]);

        const data = await this.ffmpeg.readFile(outputName);
        const blob = new Blob([data.buffer], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        this._objectUrls.add(url);

        await this.ffmpeg.deleteFile(outputName);
        return { blob, url };
    }

    /** Detect scene changes in a video (returns timestamps) */
    async detectScenes(inputName, threshold = 0.3) {
        if (!this.isLoaded) throw new Error('FFmpeg not loaded');

        const sceneTimestamps = [];
        const logHandler = ({ type, message }) => {
            // Parse showinfo filter output for scene change timestamps
            const match = message.match(/pts_time:(\d+\.?\d*)/);
            if (match) {
                const time = parseFloat(match[1]);
                if (!isNaN(time) && time > 0) {
                    sceneTimestamps.push(time);
                }
            }
        };

        this.ffmpeg.on('log', logHandler);

        try {
            await this.ffmpeg.exec([
                '-i', inputName,
                '-vf', `select='gt(scene,${threshold})',showinfo`,
                '-f', 'null',
                '-'
            ]);
        } catch (e) {
            // FFmpeg may return non-zero for null output, that's expected
        }

        // Remove the log handler
        this.ffmpeg.off('log', logHandler);

        return sceneTimestamps.sort((a, b) => a - b);
    }

    /** Get video duration and metadata via probe-like approach */
    async getVideoDuration(inputName) {
        if (!this.isLoaded) throw new Error('FFmpeg not loaded');

        let duration = 0;
        const logHandler = ({ message }) => {
            const match = message.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
            if (match) {
                duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
            }
        };

        this.ffmpeg.on('log', logHandler);

        try {
            await this.ffmpeg.exec(['-i', inputName, '-f', 'null', '-t', '0', '-']);
        } catch (e) {
            // Expected
        }

        this.ffmpeg.off('log', logHandler);
        return duration;
    }

    /** Delete input file from virtual filesystem */
    async deleteInputFile(name) {
        try {
            await this.ffmpeg.deleteFile(name);
            this._writtenFiles.delete(name);
        } catch (e) {
            // File might already be deleted
        }
    }

    /** Revoke a specific Object URL */
    revokeUrl(url) {
        if (this._objectUrls.has(url)) {
            URL.revokeObjectURL(url);
            this._objectUrls.delete(url);
        }
    }

    /** Cleanup all tracked resources */
    async cleanup() {
        // Revoke all object URLs
        for (const url of this._objectUrls) {
            URL.revokeObjectURL(url);
        }
        this._objectUrls.clear();

        // Delete any remaining files from virtual FS
        for (const file of this._writtenFiles) {
            try {
                await this.ffmpeg.deleteFile(file);
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        this._writtenFiles.clear();
    }

    /** Get memory usage stats */
    getMemoryInfo() {
        return {
            trackedUrls: this._objectUrls.size,
            trackedFiles: this._writtenFiles.size,
            isProcessing: this.isProcessing
        };
    }
}
