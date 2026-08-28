/* Planer desktop shell (Electron main process).
   The app itself is the same vanilla HTML/CSS/JS — this file only opens the
   window. No Node APIs are exposed to the renderer; localStorage persists in
   the app's own user-data folder automatically. */
const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 9876;
let server = null;

function startLocalServer() {
  return new Promise((resolve) => {
    if (server) { resolve(); return; }
    server = http.createServer((req, res) => {
      let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html', '.js': 'application/javascript',
        '.css': 'text/css', '.json': 'application/json',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
      };
      fs.readFile(filePath, (err, content) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(content);
      });
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[Planer] Local server running on http://127.0.0.1:${PORT}`);
      resolve();
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 560,
    autoHideMenuBar: true,          // menu hidden; Alt still reveals it
    backgroundColor: '#eef0fb',
    title: 'Planer',
    webPreferences: {
      contextIsolation: true,       // default hardening; renderer needs nothing from Node
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://127.0.0.1:${PORT}/`);

  // Open DevTools with F12
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(async () => {
  await startLocalServer();
  createWindow();
  app.on('activate', () => {        // macOS dock re-open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});
