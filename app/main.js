const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false // Allow loading local resources (e.g. models)
        }
    });

    win.loadFile('index.html');
    // win.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Optimization Handler
ipcMain.handle('optimise-model', async (event, filePath) => {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const outputPath = path.join(tempDir, `optimised_${Date.now()}.glb`);

        // Command to run gltf-transform
        // We assume gltf-transform is available in node_modules/.bin/gltf-transform
        const gltfTransformPath = path.resolve(__dirname, 'node_modules', '.bin', 'gltf-transform');

        // Construct args: optimize input output --compress draco --texture-compress ktx2
        const args = [
            'optimize',
            filePath,
            outputPath,
            '--compress', 'draco',
            '--texture-compress', 'ktx2'
        ];

        console.log(`Running: ${gltfTransformPath} ${args.join(' ')}`);

        const child = spawn(gltfTransformPath, args);

        let stderr = '';

        child.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(outputPath);
            } else {
                reject(new Error(`Optimization failed with code ${code}: ${stderr}`));
            }
        });
    });
});

// Save Handler
ipcMain.handle('save-file', async (event, tempFilePath) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: 'optimised_model.glb',
        filters: [{ name: 'GLB Models', extensions: ['glb'] }]
    });

    if (canceled || !filePath) {
        return false;
    }

    try {
        fs.copyFileSync(tempFilePath, filePath);
        return true;
    } catch (err) {
        console.error('Failed to save file:', err);
        throw err;
    }
});
