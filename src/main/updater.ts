import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { BrowserWindow, ipcMain, dialog, shell, app, net } from 'electron';
import log from 'electron-log';

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// GitHub Release configuration
autoUpdater.autoDownload = false; // Don't auto-download, let user decide
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow: BrowserWindow | null = null;

// Check if running in development mode
const isDev = !app.isPackaged;

/**
 * Initialize the auto-updater with the main window reference
 */
export function initUpdater(win: BrowserWindow) {
    mainWindow = win;
    setupAutoUpdaterEvents();
    setupIpcHandlers();
}

/**
 * Setup auto-updater event listeners
 */
function setupAutoUpdaterEvents() {
    // Check for updates error
    autoUpdater.on('error', (error: Error) => {
        log.error('Update error:', error);
        sendToRenderer('update-error', {
            message: error.message,
            stack: error.stack
        });
    });

    // Checking for updates
    autoUpdater.on('checking-for-update', () => {
        log.info('Checking for updates...');
        sendToRenderer('checking-for-update', null);
    });

    // Update available
    autoUpdater.on('update-available', (info: UpdateInfo) => {
        log.info('Update available:', info.version);
        sendToRenderer('update-available', {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
            releaseName: info.releaseName
        });
    });

    // No update available
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
        log.info('No update available, current version is latest:', info.version);
        sendToRenderer('update-not-available', {
            version: info.version
        });
    });

    // Download progress
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
        log.info(`Download progress: ${progress.percent.toFixed(1)}%`);
        sendToRenderer('download-progress', {
            percent: progress.percent,
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total
        });
    });

    // Update downloaded
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
        log.info('Update downloaded:', info.version);
        sendToRenderer('update-downloaded', {
            version: info.version,
            releaseNotes: info.releaseNotes,
            releaseName: info.releaseName
        });

        // Show dialog to prompt user to restart
        if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: '更新已就绪',
                message: `新版本 ${info.version} 已下载完成`,
                detail: '重启应用以完成更新。',
                buttons: ['立即重启', '稍后'],
                defaultId: 0,
                cancelId: 1
            }).then(({ response }) => {
                if (response === 0) {
                    autoUpdater.quitAndInstall(false, true);
                }
            });
        }
    });
}

/**
 * Fetch latest release info from GitHub API (for dev mode fallback)
 */
function fetchLatestReleaseFromGitHub(): Promise<{ version: string; releaseDate: string; releaseNotes: string; releaseName: string }> {
    return new Promise((resolve, reject) => {
        const request = net.request({
            method: 'GET',
            protocol: 'https:',
            hostname: 'api.github.com',
            path: '/repos/jheroy/Redmine-desktop/releases/latest',
        });

        request.setHeader('User-Agent', 'Redmine-Desktop-App/1.0');
        request.setHeader('Accept', 'application/vnd.github.v3+json');

        let data = '';
        let statusCode = 0;

        request.on('response', (response) => {
            statusCode = response.statusCode;

            response.on('data', (chunk: Buffer) => {
                data += chunk.toString();
            });

            response.on('end', () => {
                try {
                    if (statusCode === 200) {
                        const release = JSON.parse(data);
                        resolve({
                            version: release.tag_name?.replace(/^v/, '') || release.name,
                            releaseDate: release.published_at,
                            releaseNotes: release.body || '',
                            releaseName: release.name
                        });
                    } else if (statusCode === 404) {
                        reject(new Error('No releases found'));
                    } else {
                        log.error('GitHub API response:', statusCode, data.substring(0, 200));
                        reject(new Error(`GitHub API error: ${statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });

            response.on('error', (error: Error) => {
                reject(error);
            });
        });

        request.on('error', (error: Error) => {
            log.error('Request error:', error);
            reject(error);
        });

        // Set timeout
        setTimeout(() => {
            request.abort();
            reject(new Error('Request timeout'));
        }, 15000);

        request.end();
    });
}

/**
 * Compare version strings (returns true if latest > current)
 */
function isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
        const l = latestParts[i] || 0;
        const c = currentParts[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

/**
 * Setup IPC handlers for renderer process communication
 */
function setupIpcHandlers() {
    // Check for updates manually
    ipcMain.handle('check-for-updates', async () => {
        try {
            log.info('Manual update check triggered, isDev:', isDev);
            sendToRenderer('checking-for-update', null);

            if (isDev) {
                // In dev mode, show a friendly message and open releases page
                log.info('Dev mode: skipping API call, showing dev mode notice');
                const currentVersion = app.getVersion();

                // Simulate a brief check then show result
                setTimeout(() => {
                    sendToRenderer('update-not-available', {
                        version: currentVersion,
                        devMode: true
                    });
                }, 500);

                return {
                    success: true,
                    updateInfo: { version: currentVersion },
                    devMode: true
                };
            } else {
                // Production mode: use electron-updater
                const result = await autoUpdater.checkForUpdates();
                return {
                    success: true,
                    updateInfo: result?.updateInfo
                };
            }
        } catch (error: any) {
            log.error('Failed to check for updates:', error);
            sendToRenderer('update-error', { message: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Start downloading update
    ipcMain.handle('download-update', async () => {
        try {
            if (isDev) {
                // In dev mode, just open the releases page
                log.info('Dev mode: opening releases page instead of downloading');
                await shell.openExternal('https://github.com/jheroy/Redmine-desktop/releases');
                sendToRenderer('update-error', {
                    message: '开发模式下无法自动下载，已打开 GitHub Releases 页面'
                });
                return { success: false, error: 'Dev mode - opened releases page' };
            }

            log.info('Starting update download...');
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (error: any) {
            log.error('Failed to download update:', error);
            sendToRenderer('update-error', { message: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Install update and restart
    ipcMain.handle('install-update', async () => {
        try {
            if (isDev) {
                sendToRenderer('update-error', { message: '开发模式下无法安装更新' });
                return { success: false, error: 'Cannot install in dev mode' };
            }

            log.info('Installing update and restarting...');

            // 延迟执行以确保 IPC 响应返回
            setTimeout(() => {
                log.info('Calling quitAndInstall...');
                try {
                    // 设置 autoUpdater 在退出时自动安装
                    autoUpdater.quitAndInstall(false, true);
                } catch (e) {
                    log.error('quitAndInstall error:', e);
                    // 如果 quitAndInstall 失败，强制退出
                    app.quit();
                }
            }, 500);

            return { success: true };
        } catch (error: any) {
            log.error('Failed to install update:', error);
            sendToRenderer('update-error', { message: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Get current app version
    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });

    // Open release page in browser
    ipcMain.handle('open-release-page', async () => {
        try {
            await shell.openExternal('https://github.com/jheroy/Redmine-desktop/releases');
            return { success: true };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    });
}

/**
 * Send message to renderer process
 */
function sendToRenderer(channel: string, data: any) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

/**
 * Trigger update check (can be called from outside)
 */
export function checkForUpdates() {
    if (isDev) {
        log.info('Skipping auto update check in dev mode');
        return;
    }

    autoUpdater.checkForUpdates().catch((error) => {
        log.error('Background update check failed:', error);
    });
}
