const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
// 强制开发模式
const isDev = !app.isPackaged;

let mainWindow;

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      devTools: true
    },
    titleBarStyle: 'default',
    show: false,
    icon: path.join(__dirname, '../public/app-icon.icns')
  });

  const staticDir = path.join(__dirname, '../out');

  if (isDev) {
    const startUrl = 'http://localhost:3000';
    console.log('Loading URL:', startUrl);
    mainWindow.loadURL(startUrl);
  } else {
    const http = require('http');
    const serveHandler = require('serve-handler');

    const server = http.createServer((req, res) =>
      serveHandler(req, res, { public: staticDir, cleanUrls: true })
    );

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const startUrl = `http://127.0.0.1:${port}`;
      console.log('Loading URL:', startUrl);
      mainWindow.loadURL(startUrl);
    });

    app.on('will-quit', () => server.close());
  }

  // 开发模式下打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // 当窗口关闭时
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 开发模式下打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

// 应用准备就绪时创建窗口
app.whenReady().then(createWindow);

// 当所有窗口关闭时退出应用 (macOS 除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS 上点击 dock 图标时重新创建窗口
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 创建应用菜单
function createMenu() {
  const template = [
    {
      label: '时间盒',
      submenu: [
        {
          label: '关于时间盒',
          role: 'about'
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Command+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'Command+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+Command+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'Command+X', role: 'cut' },
        { label: '复制', accelerator: 'Command+C', role: 'copy' },
        { label: '粘贴', accelerator: 'Command+V', role: 'paste' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'Command+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'Command+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'Command+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'Command+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'Command+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'Control+Command+F', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'Command+M', role: 'minimize' },
        { label: '关闭', accelerator: 'Command+W', role: 'close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createMenu();
  createWindow();
});