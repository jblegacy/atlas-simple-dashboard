const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');
const chokidar = require('chokidar');
const si = require('systeminformation');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// System metrics cache
let systemMetrics = {};
let gitLogs = [];
let fileTree = {};
let workQueue = [];
let openclawStatus = 'checking...';
let currentModel = {
    name: 'Haiku',
    version: 'claude-3-haiku-20240307',
    badge: 'haiku',
    costSavings: '80%'
};
let backupMetrics = {
    size: '275MB',
    files: 15338,
    folders: 2294,
    lastBackup: new Date(),
    growth: '+8MB, +1,038 files, +237 folders'
};
let projectInfo = {
    name: path.basename(process.cwd()),
    path: process.cwd()
};

// WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected');
  
  // Send initial data
  ws.send(JSON.stringify({
    type: 'initial',
    data: {
      systemMetrics,
      gitLogs,
      fileTree,
      workQueue,
      openclawStatus,
      currentModel,
      backupMetrics,
      projectInfo
    }
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

// Broadcast to all clients
function broadcast(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Get system metrics
async function updateSystemMetrics() {
  try {
    const cpu = await si.currentLoad();
    const memory = await si.mem();
    const disk = await si.fsSize();
    const uptime = await si.time();
    
    systemMetrics = {
      cpu: Math.round(cpu.currentLoad),
      memory: {
        used: Math.round(memory.used / 1024 / 1024 / 1024 * 10) / 10,
        total: Math.round(memory.total / 1024 / 1024 / 1024),
        percentage: Math.round(memory.used / memory.total * 100)
      },
      disk: {
        used: disk[0] ? Math.round(disk[0].used / 1024 / 1024 / 1024) : 0,
        total: disk[0] ? Math.round(disk[0].size / 1024 / 1024 / 1024) : 0,
        percentage: disk[0] ? Math.round(disk[0].use) : 0
      },
      uptime: {
        days: Math.floor(uptime.uptime / 86400),
        hours: Math.floor((uptime.uptime % 86400) / 3600),
        minutes: Math.floor((uptime.uptime % 3600) / 60)
      },
      timestamp: new Date().toISOString()
    };

    broadcast({ type: 'systemMetrics', data: systemMetrics });
  } catch (error) {
    console.error('Error getting system metrics:', error);
  }
}

// Get git logs
function updateGitLogs() {
  exec('git log --oneline -20 --pretty=format:"%h %s" --since="1 week ago"', 
    { cwd: process.cwd() }, 
    (error, stdout, stderr) => {
      if (error) {
        console.error('Git log error:', error);
        return;
      }
      
      gitLogs = stdout.split('\n').filter(line => line.trim()).map(line => {
        const [hash, ...messageParts] = line.split(' ');
        return {
          hash: hash,
          message: messageParts.join(' '),
          type: getCommitType(messageParts.join(' '))
        };
      });

      broadcast({ type: 'gitLogs', data: gitLogs });
    });
}

// Get commit type from message
function getCommitType(message) {
  const msg = message.toLowerCase();
  if (msg.includes('feat:') || msg.includes('feature')) return 'feat';
  if (msg.includes('fix:') || msg.includes('bug')) return 'fix';
  if (msg.includes('docs:') || msg.includes('doc')) return 'docs';
  if (msg.includes('refactor')) return 'refactor';
  if (msg.includes('test')) return 'test';
  return 'commit';
}

// Get file tree
function updateFileTree() {
  const basePath = process.cwd();
  
  function buildTree(dirPath, depth = 0) {
    if (depth > 3) return null; // Limit depth
    
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const tree = {};
      
      items
        .filter(item => !item.name.startsWith('.') && item.name !== 'node_modules')
        .forEach(item => {
          const itemPath = path.join(dirPath, item.name);
          
          if (item.isDirectory()) {
            const subTree = buildTree(itemPath, depth + 1);
            if (subTree) tree[item.name] = subTree;
          } else {
            tree[item.name] = 'file';
          }
        });
      
      return tree;
    } catch (error) {
      return null;
    }
  }
  
  fileTree = buildTree(basePath);
  broadcast({ type: 'fileTree', data: fileTree });
}

// Check OpenClaw status
function checkOpenClawStatus() {
  exec('ps aux | grep openclaw | grep -v grep', (error, stdout, stderr) => {
    openclawStatus = stdout ? 'active' : 'inactive';
    broadcast({ type: 'openclawStatus', data: openclawStatus });
  });
}

// Mock work queue (replace with real implementation)
function updateWorkQueue() {
  workQueue = [
    {
      id: 1,
      title: "Development Work in Progress",
      description: "Active development session with multiple OpenClaw processes running. Working on Nope project features and improvements.",
      status: "IN_PROGRESS",
      progress: 65,
      eta: "Ongoing"
    },
    {
      id: 2,
      title: "Backend Health Check Endpoints",
      description: "Creating Express server health endpoints, error handling middleware, and basic API structure with logging and CORS setup",
      status: "QUEUE",
      progress: 0,
      eta: "25-40 minutes"
    },
    {
      id: 3,
      title: "RevenueCat Integration Setup",
      description: "Implementing subscription management with RevenueCat SDK, test keys configuration, and basic subscription state management",
      status: "QUEUE",
      progress: 0,
      eta: "Est: TBD"
    }
  ];
  
  broadcast({ type: 'workQueue', data: workQueue });
}

// Update all data periodically
setInterval(updateSystemMetrics, 5000);
setInterval(updateGitLogs, 30000);
setInterval(updateFileTree, 60000);
setInterval(checkOpenClawStatus, 10000);
setInterval(updateWorkQueue, 30000);

// Initial updates
updateSystemMetrics();
updateGitLogs();
updateFileTree();
checkOpenClawStatus();
updateWorkQueue();

// Watch for file changes
const watcher = chokidar.watch('.', {
  ignored: /(^|[\/\\])\..|node_modules/,
  persistent: true
});

watcher.on('change', () => {
  setTimeout(updateFileTree, 1000); // Debounce
});

// Update current model
app.post('/api/model/switch', (req, res) => {
  const { model } = req.body;
  
  const modelConfig = {
    'haiku': {
      name: 'Haiku',
      version: 'claude-3-haiku-20240307',
      badge: 'haiku',
      costSavings: '80%'
    },
    'sonnet': {
      name: 'Sonnet',
      version: 'claude-sonnet-4-20250514',
      badge: 'sonnet',
      costSavings: '0%'
    },
    'opus': {
      name: 'Opus',
      version: 'claude-opus-4-6',
      badge: 'opus',
      costSavings: '-50%'
    }
  };
  
  if (modelConfig[model]) {
    currentModel = modelConfig[model];
    broadcast({ type: 'modelUpdate', data: currentModel });
    res.json({ success: true, model: currentModel });
  } else {
    res.status(400).json({ error: 'Invalid model' });
  }
});

// Update backup metrics
app.post('/api/backup/metrics', (req, res) => {
  const { size, files, folders, growth } = req.body;
  
  backupMetrics = {
    size: size || backupMetrics.size,
    files: files || backupMetrics.files,
    folders: folders || backupMetrics.folders,
    lastBackup: new Date(),
    growth: growth || backupMetrics.growth
  };
  
  broadcast({ type: 'backupMetrics', data: backupMetrics });
  res.json({ success: true, metrics: backupMetrics });
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connected_clients: clients.size,
    currentModel,
    backupMetrics,
    projectInfo
  });
});

app.get('/api/metrics', (req, res) => {
  res.json(systemMetrics);
});

app.get('/api/logs', (req, res) => {
  // Mock live logs (replace with real OpenClaw log reading)
  const logs = [
    { level: 'info', message: 'OpenClaw gateway running on port 18789', timestamp: new Date().toISOString() },
    { level: 'info', message: 'Atlas agent session active', timestamp: new Date().toISOString() },
    { level: 'debug', message: 'Token usage: Haiku vs Sonnet optimization active', timestamp: new Date().toISOString() }
  ];
  res.json(logs);
});

const PORT = process.env.PORT || 4002;
server.listen(PORT, () => {
  console.log(`🚀 Atlas Simple Dashboard running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
});