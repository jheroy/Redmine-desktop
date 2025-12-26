import React, { useState, useEffect, useCallback } from 'react';
import type { UpdateInfo, DownloadProgress, UpdateStatus, UpdateError } from '../types/updater';

interface UpdaterModalProps {
    isOpen: boolean;
    onClose: () => void;
    isDark: boolean;
}

const UpdaterModal: React.FC<UpdaterModalProps> = ({ isOpen, onClose, isDark }) => {
    const [status, setStatus] = useState<UpdateStatus>('idle');
    const [currentVersion, setCurrentVersion] = useState<string>('');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
    const [error, setError] = useState<UpdateError | null>(null);
    const [isDevMode, setIsDevMode] = useState(false);

    // Get current app version
    useEffect(() => {
        window.updater?.getAppVersion().then(setCurrentVersion);
    }, []);

    // Setup event listeners
    useEffect(() => {
        if (!window.updater) return;

        const unsubscribers = [
            window.updater.onCheckingForUpdate(() => {
                setStatus('checking');
                setError(null);
            }),
            window.updater.onUpdateAvailable((info) => {
                setStatus('available');
                setUpdateInfo(info);
            }),
            window.updater.onUpdateNotAvailable((info: any) => {
                setStatus('not-available');
                setUpdateInfo(info);
                if (info?.devMode) {
                    setIsDevMode(true);
                }
            }),
            window.updater.onDownloadProgress((progress) => {
                setStatus('downloading');
                setDownloadProgress(progress);
            }),
            window.updater.onUpdateDownloaded((info) => {
                setStatus('downloaded');
                setUpdateInfo(info);
            }),
            window.updater.onUpdateError((err) => {
                setStatus('error');
                setError(err);
            }),
        ];

        return () => {
            unsubscribers.forEach(unsub => unsub?.());
        };
    }, []);

    const handleCheckForUpdates = useCallback(async () => {
        setStatus('checking');
        setError(null);
        setUpdateInfo(null);
        setDownloadProgress(null);
        await window.updater?.checkForUpdates();
    }, []);

    const handleDownloadUpdate = useCallback(async () => {
        setStatus('downloading');
        setDownloadProgress({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
        await window.updater?.downloadUpdate();
    }, []);

    const handleInstallUpdate = useCallback(async () => {
        // 延迟一小段时间确保 UI 更新后再执行
        setTimeout(async () => {
            try {
                await window.updater?.installUpdate();
            } catch (e) {
                console.error('Install failed:', e);
            }
        }, 100);
    }, []);

    const handleOpenReleasePage = useCallback(async () => {
        await window.updater?.openReleasePage();
    }, []);

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatReleaseNotes = (notes: string | { version: string; note: string }[] | undefined): string => {
        if (!notes) return '';
        let text = '';
        if (typeof notes === 'string') {
            text = notes;
        } else {
            text = notes.map(n => `${n.version}: ${n.note}`).join('\n');
        }
        // 移除 HTML 标签
        text = text.replace(/<[^>]*>/g, '');
        // 解码 HTML 实体
        text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        // 清理多余空白
        text = text.replace(/\s+/g, ' ').trim();
        // 如果内容太长，截断
        if (text.length > 200) {
            text = text.substring(0, 200) + '...';
        }
        return text || '查看发布页了解详情';
    };

    if (!isOpen) return null;

    const modalStyles: React.CSSProperties = {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(10px)',
    };

    const contentStyles: React.CSSProperties = {
        backgroundColor: isDark ? '#1a1a1a' : '#ffffff',
        borderRadius: 16,
        padding: 24,
        width: 420,
        maxWidth: '90vw',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    };

    const titleStyles: React.CSSProperties = {
        fontSize: 20,
        fontWeight: 700,
        marginBottom: 8,
        color: isDark ? '#fff' : '#1c1c1e',
    };

    const subtitleStyles: React.CSSProperties = {
        fontSize: 13,
        color: isDark ? '#888' : '#666',
        marginBottom: 20,
    };

    const buttonStyles = (primary = false): React.CSSProperties => ({
        padding: '10px 20px',
        borderRadius: 10,
        border: 'none',
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 600,
        transition: 'all 0.2s',
        backgroundColor: primary
            ? (isDark ? '#0c66ff' : '#6750a4')
            : (isDark ? '#333' : '#f0f0f0'),
        color: primary ? '#fff' : (isDark ? '#fff' : '#1c1c1e'),
    });

    const progressBarContainerStyles: React.CSSProperties = {
        height: 8,
        backgroundColor: isDark ? '#333' : '#e0e0e0',
        borderRadius: 4,
        overflow: 'hidden',
        marginTop: 12,
        marginBottom: 8,
    };

    const progressBarStyles: React.CSSProperties = {
        height: '100%',
        backgroundColor: isDark ? '#0c66ff' : '#6750a4',
        borderRadius: 4,
        transition: 'width 0.3s ease',
        width: `${downloadProgress?.percent || 0}%`,
    };

    const statusCardStyles: React.CSSProperties = {
        backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
    };

    return (
        <div style={modalStyles} onClick={onClose}>
            <div style={contentStyles} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                        <h2 style={titleStyles}>软件更新</h2>
                        <p style={subtitleStyles}>当前版本: v{currentVersion}</p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            fontSize: 20,
                            cursor: 'pointer',
                            color: isDark ? '#666' : '#999',
                            padding: 4,
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Status Display */}
                <div style={statusCardStyles}>
                    {status === 'idle' && (
                        <div style={{ textAlign: 'center', padding: 20 }}>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
                            <p style={{ color: isDark ? '#888' : '#666' }}>
                                点击下方按钮检查更新
                            </p>
                        </div>
                    )}

                    {status === 'checking' && (
                        <div style={{ textAlign: 'center', padding: 20 }}>
                            <div style={{
                                width: 32,
                                height: 32,
                                border: `3px solid ${isDark ? '#333' : '#e0e0e0'}`,
                                borderTopColor: isDark ? '#0c66ff' : '#6750a4',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                margin: '0 auto 12px',
                            }} />
                            <p style={{ color: isDark ? '#fff' : '#1c1c1e' }}>
                                正在检查更新...
                            </p>
                        </div>
                    )}

                    {status === 'not-available' && (
                        <div style={{ textAlign: 'center', padding: 20 }}>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                            <p style={{ color: isDark ? '#4ade80' : '#22c55e', fontWeight: 600, marginBottom: 4 }}>
                                {isDevMode ? '开发模式' : '已是最新版本'}
                            </p>
                            <p style={{ color: isDark ? '#888' : '#666', fontSize: 13 }}>
                                v{updateInfo?.version || currentVersion}
                            </p>
                            {isDevMode && (
                                <p style={{ color: isDark ? '#888' : '#666', fontSize: 12, marginTop: 8 }}>
                                    开发模式下无法检查更新<br />
                                    请点击"查看发布页"查看最新版本
                                </p>
                            )}
                        </div>
                    )}

                    {status === 'available' && updateInfo && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                <div style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: 12,
                                    backgroundColor: isDark ? 'rgba(12, 102, 255, 0.2)' : 'rgba(103, 80, 164, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 24,
                                }}>
                                    📦
                                </div>
                                <div>
                                    <p style={{ fontWeight: 700, color: isDark ? '#fff' : '#1c1c1e', marginBottom: 2 }}>
                                        新版本可用: v{updateInfo.version}
                                    </p>
                                    {updateInfo.releaseDate && (
                                        <p style={{ fontSize: 12, color: isDark ? '#888' : '#666' }}>
                                            发布时间: {new Date(updateInfo.releaseDate).toLocaleDateString()}
                                        </p>
                                    )}
                                </div>
                            </div>
                            {updateInfo.releaseNotes && (
                                <div style={{
                                    backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.05)',
                                    borderRadius: 8,
                                    padding: 12,
                                    maxHeight: 120,
                                    overflow: 'auto',
                                    fontSize: 13,
                                    color: isDark ? '#aaa' : '#555',
                                    whiteSpace: 'pre-wrap',
                                }}>
                                    {formatReleaseNotes(updateInfo.releaseNotes)}
                                </div>
                            )}
                        </div>
                    )}

                    {status === 'downloading' && downloadProgress && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ color: isDark ? '#fff' : '#1c1c1e', fontWeight: 600 }}>
                                    正在下载更新...
                                </span>
                                <span style={{ color: isDark ? '#888' : '#666', fontSize: 13 }}>
                                    {downloadProgress.percent.toFixed(1)}%
                                </span>
                            </div>
                            <div style={progressBarContainerStyles}>
                                <div style={progressBarStyles} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: isDark ? '#666' : '#888' }}>
                                <span>{formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}</span>
                                <span>{formatBytes(downloadProgress.bytesPerSecond)}/s</span>
                            </div>
                        </div>
                    )}

                    {status === 'downloaded' && (
                        <div style={{ textAlign: 'center', padding: 20 }}>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                            <p style={{ color: isDark ? '#4ade80' : '#22c55e', fontWeight: 600, marginBottom: 4 }}>
                                更新已下载完成
                            </p>
                            <p style={{ color: isDark ? '#888' : '#666', fontSize: 13 }}>
                                点击 "立即安装" 重启应用完成更新
                            </p>
                        </div>
                    )}

                    {status === 'error' && error && (
                        <div style={{ textAlign: 'center', padding: 20 }}>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
                            <p style={{ color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>
                                更新失败
                            </p>
                            <p style={{ color: isDark ? '#888' : '#666', fontSize: 13, wordBreak: 'break-word' }}>
                                {error.message}
                            </p>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                    <button
                        style={buttonStyles(false)}
                        onClick={handleOpenReleasePage}
                    >
                        查看发布页
                    </button>

                    {(status === 'idle' || status === 'not-available' || status === 'error') && (
                        <button
                            style={buttonStyles(true)}
                            onClick={handleCheckForUpdates}
                        >
                            检查更新
                        </button>
                    )}

                    {status === 'available' && (
                        <button
                            style={buttonStyles(true)}
                            onClick={handleDownloadUpdate}
                        >
                            下载更新
                        </button>
                    )}

                    {status === 'downloaded' && (
                        <button
                            style={buttonStyles(true)}
                            onClick={handleInstallUpdate}
                        >
                            立即安装
                        </button>
                    )}

                    {status === 'checking' && (
                        <button
                            style={{ ...buttonStyles(true), opacity: 0.5, cursor: 'not-allowed' }}
                            disabled
                        >
                            检查中...
                        </button>
                    )}

                    {status === 'downloading' && (
                        <button
                            style={{ ...buttonStyles(true), opacity: 0.5, cursor: 'not-allowed' }}
                            disabled
                        >
                            下载中...
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdaterModal;
