import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'

// The built directory structure
//
// ├─┬─┬─ dist
// │ │ └── index.html
// │ │
// │ ├─┬─ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

// Disable CORS and certificate errors for internal Redmine servers
app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('disable-site-isolation-trials')

// Enable GPU hardware acceleration for better rendering performance
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay')
// Reduce frame drops during animations
app.commandLine.appendSwitch('disable-frame-rate-limit')
// Better scrolling performance
app.commandLine.appendSwitch('enable-smooth-scrolling')
// Optimize for large windows
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopRasterization')


let win: BrowserWindow | null
let tray: Tray | null = null

// 🚧 Use ['ENV_NAME'] avoid vite:define dev replacement
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createTray() {
    // Load tray icon from file
    // macOS will automatically use @2x version for Retina displays
    const iconPath = path.join(process.env.VITE_PUBLIC || path.join(__dirname, '../public'), 'trayTemplate.png');

    console.log('Loading tray icon from:', iconPath);

    const icon = nativeImage.createFromPath(iconPath);

    console.log('Tray icon loaded, size:', icon.getSize(), 'isEmpty:', icon.isEmpty());

    if (icon.isEmpty()) {
        console.error('Failed to load tray icon from:', iconPath);
        // Fallback: create tray without icon (will only show title)
        tray = new Tray(nativeImage.createEmpty());
    } else {
        icon.setTemplateImage(true);
        tray = new Tray(icon);
    }

    tray.setToolTip('Redmine');
    console.log('Tray created successfully');

    tray.on('click', () => {
        // Check if window exists and is not destroyed
        if (!win || win.isDestroyed()) {
            createWindow();
            return;
        }
        if (win.isVisible()) {
            win.hide()
        } else {
            win.show()
        }
    })
}


function createMenu() {
    const template: any[] = [
        {
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                {
                    label: 'Settings...',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        win?.webContents.send('show-settings')
                    }
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                { type: 'separator' },
                { role: 'front' },
                { type: 'separator' },
                { role: 'window' }
            ]
        }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}


function createWindow() {
    const isMac = process.platform === 'darwin'

    win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1000,
        minHeight: 700,
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        backgroundColor: isMac ? '#00000000' : '#000000',
        transparent: isMac,
        // Re-enable vibrancy for macOS but with performance-conscious settings
        vibrancy: isMac ? 'under-window' : undefined,
        visualEffectState: isMac ? 'active' : undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false,
            backgroundThrottling: false,
        },
    })

    createMenu()

    // Test active push message to Renderer-process.
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    console.log('VITE_DEV_SERVER_URL:', VITE_DEV_SERVER_URL)
    console.log('process.env.DIST:', process.env.DIST)

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
    } else {
        // win.loadFile('dist/index.html')
        const indexPath = path.join(process.env.DIST || '', 'index.html')
        console.log('Loading local file:', indexPath)
        win.loadFile(indexPath)
    }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(() => {
    createWindow()
    if (process.platform === 'darwin' || process.platform === 'win32') {
        createTray()
    }
})

ipcMain.on('update-badge', (_, count: number) => {
    console.log('Received update-badge:', count);
    if (count > 0) {
        app.setBadgeCount(count)
        if (tray && !tray.isDestroyed()) {
            tray.setTitle(count.toString())
            tray.setToolTip(`Redmine: ${count} unfinished issues`)
        }
    } else {
        app.setBadgeCount(0)
        if (tray && !tray.isDestroyed()) {
            tray.setTitle('')
            tray.setToolTip('Redmine')
        }
    }
})

ipcMain.on('open-external', (_, url) => {
    const { shell } = require('electron');
    shell.openExternal(url);
});

ipcMain.handle('save-file', async (_, { data, filename }) => {
    const { dialog } = require('electron');
    const fs = require('node:fs');
    const { filePath } = await dialog.showSaveDialog({
        defaultPath: filename,
    });
    if (filePath) {
        fs.writeFileSync(filePath, Buffer.from(data));
        return true;
    }
    return false;
});
