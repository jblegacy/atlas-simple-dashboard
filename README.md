# Atlas Simple Dashboard

**Streamlined AI portfolio monitoring dashboard for OpenClaw instances**

A lightweight, terminal-aesthetic dashboard for real-time monitoring of system metrics, git activity, file structure, work queue, and OpenClaw status.

## 🎯 Features

- **Real-time System Metrics**: CPU, Memory, Disk usage, System uptime
- **Git Integration**: Recent commits with type categorization (feat, fix, docs, etc.)
- **File Tree Navigation**: Live project structure updates
- **Work Queue Management**: Track active tasks, progress, and ETAs
- **Live Logs**: Stream OpenClaw system activity
- **WebSocket-based Real-time Updates**: Instant metric refresh
- **Terminal Aesthetic**: Dark theme inspired by VS Code/terminal UIs
- **Connection Status Indicator**: WebSocket connection monitoring

## 📋 Requirements

- Node.js 14+
- npm or yarn

## 🚀 Quick Start

### Installation

```bash
git clone https://github.com/jblegacy/atlas-simple-dashboard.git
cd atlas-simple-dashboard
npm install
```

### Running the Dashboard

```bash
npm start
```

The dashboard will be available at: **http://localhost:4002**

### Development Mode

```bash
npm run dev
```

(Requires nodemon for auto-restart on file changes)

## 🏗️ Architecture

### Backend (Node.js + Express)

- **server.js**: Express server with WebSocket support
- Real-time data collection from system and git
- Automatic metric updates every 5-60 seconds
- File system watcher for live updates

### Frontend (Vanilla JavaScript)

- **index.html**: Dashboard layout
- **styles.css**: Terminal-aesthetic dark theme
- **dashboard.js**: WebSocket client and UI updates
- Real-time data rendering without external frameworks

## 📊 Dashboard Sections

### Top Stats Bar
- CPU Load Average (23%)
- Memory Usage (15.6GB / 98%)
- Disk Usage (11GB / 2%)
- System Uptime (10h 30m)
- OpenClaw Status (Active/Inactive)
- Token Usage (Haiku vs Sonnet)
- Model Usage

### Left Panel
- **File Tree**: Project structure with real-time updates

### Right Panels
- **Git Log**: Recent commits with type categorization
- **Work Queue**: Current tasks with progress indicators

### Bottom Panel
- **Live Logs**: Real-time OpenClaw system logs

## 🔌 API Endpoints

### WebSocket
- Primary: Real-time updates for all metrics

### REST API (Fallback)
- `GET /api/status` - Server status
- `GET /api/metrics` - Current system metrics
- `GET /api/logs` - Recent system logs

## 🎨 Customization

### Colors
Edit CSS variables in `public/css/styles.css`:
```css
:root {
    --bg-primary: #1e1e1e;
    --accent-blue: #007acc;
    --accent-green: #4ec9b0;
    --accent-yellow: #dcdcaa;
    /* ... more variables ... */
}
```

### Update Frequencies
Modify intervals in `server.js`:
```javascript
setInterval(updateSystemMetrics, 5000);  // 5 seconds
setInterval(updateGitLogs, 30000);       // 30 seconds
setInterval(updateFileTree, 60000);      // 60 seconds
```

### Port Configuration
Set custom port:
```bash
PORT=3000 npm start
```

## 📦 Dependencies

- **express**: Web framework
- **ws**: WebSocket server
- **cors**: Cross-origin support
- **chokidar**: File system monitoring
- **systeminformation**: System metrics collection

## 🔧 Troubleshooting

### Dashboard not loading?
1. Check if server is running: `npm start`
2. Verify port 4002 is available
3. Check browser console for errors

### Metrics not updating?
1. Verify WebSocket connection in DevTools
2. Check system permissions for metrics collection
3. Try fallback REST API by waiting 5 seconds

### Git log not showing?
1. Ensure dashboard is running in a git repository
2. Check git is installed and accessible
3. Verify commit history with `git log`

## 🚀 Deployment

### Local Development
```bash
npm install
npm start
```

### Production
```bash
PORT=80 npm start
```

Or use a process manager like PM2:
```bash
pm2 start server.js --name "atlas-dashboard"
```

## 📝 License

MIT

## 👤 Author

James - [GitHub](https://github.com/jblegacy)

## 🔗 Links

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [GitHub Repository](https://github.com/jblegacy/atlas-simple-dashboard)

---

**Made for efficient AI portfolio monitoring** ⚡