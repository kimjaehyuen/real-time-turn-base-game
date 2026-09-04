const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_SERVER_URL = 'http://localhost:5173';
const APP_SCHEME = 'app';

// 패키징된 앱은 dist/index.html을 file://로 직접 열지 않는다: 브라우저가 file:// 위의
// crossorigin 스크립트/스타일시트 요청을 CORS 위반으로 막아버려 화면이 빈 채로 뜬다.
// 대신 https://처럼 동작하는 전용 프로토콜(app://)로 등록해 dist/ 폴더를 서빙한다.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    win.loadURL(`${APP_SCHEME}:///index.html`);
  } else {
    win.loadURL(DEV_SERVER_URL);
  }
}

app.whenReady().then(() => {
  if (app.isPackaged) {
    const distDir = path.join(__dirname, '../dist');
    protocol.handle(APP_SCHEME, (request) => {
      const { pathname } = new URL(request.url);
      const relativePath = decodeURIComponent(pathname === '/' || pathname === '' ? '/index.html' : pathname);
      const filePath = path.join(distDir, relativePath);
      return net.fetch(pathToFileURL(filePath).toString());
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
