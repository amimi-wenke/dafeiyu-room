import { app, BrowserWindow, session } from 'electron';
import { startConnector } from '../connector/server.mjs';
let connector;
const windows = new Set();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const win = [...windows][0]; if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    connector = await startConnector({ port: 0 });
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    function open(route = '/') {
      const win = new BrowserWindow({ width: 1440, height: 920, minWidth: 960, minHeight: 620,
        backgroundColor: '#a8bee7', title: '大肥鱼的小屋', autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      windows.add(win); win.on('closed', () => windows.delete(win));
      win.webContents.on('will-navigate', (event, url) => { if (![connector.origin + '/', connector.origin + '/chat'].includes(url)) event.preventDefault(); });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (url === connector.origin + '/chat') open('/chat');
        return { action: 'deny' };
      });
      void win.loadURL(connector.origin + route);
    }
    open();
    app.on('activate', () => { if (!windows.size) open(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { connector?.server.close(); connector?.server.closeAllConnections(); });
}
