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

let tokenMetrics = {
    haiku: {
        input: 0,
        output: 0,
        total: 0,
        cost: 0
    },
    sonnet: {
        input: 0,
        output: 0,
        total: 0,
        cost: 0
    },
    total: {
        tokens: 0,
        cost: 0,
        lastUpdated: new Date()
    }
};

// Token costs (per million tokens)
const tokenCosts = {
    'haiku': { input: 0.80, output: 4.00 },
    'sonnet': { input: 3.00, output: 15.00 },
    'opus': { input: 15.00, output: 75.00 }
};
let projectInfo = {
    name: path.basename(process.cwd()),
    path: process.cwd(),
    agentName: getAgentName()
};

// Get OpenClaw agent/bot name
function getAgentName() {
    // Try environment variable first
    if (process.env.OPENCLAW_AGENT) {
        console.log('✅ Agent name from ENV:', process.env.OPENCLAW_AGENT);
        return process.env.OPENCLAW_AGENT;
    }
    
    // Try to read from OpenClaw config
    try {
        const configPath = path.join(process.env.HOME || '/Users/openclaw', '.openclaw/openclaw.json');
        
        if (!fs.existsSync(configPath)) {
            console.log('⚠️  Config not found at:', configPath);
            return path.basename(process.cwd());
        }
        
        const configFile = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configFile);
        
        // Get current agent from bindings or use workspace name
        const workspaceName = path.basename(process.cwd());
        const agentFromConfig = config.agents?.list?.find(a => 
            a.workspace?.includes(workspaceName) || a.id === workspaceName
        );
        
        if (agentFromConfig?.name) {
            console.log('✅ Agent name from config:', agentFromConfig.name);
            return agentFromConfig.name;
        }
        
        // Try to match by agentDir
        const currentDir = process.cwd();
        const matchedAgent = config.agents?.list?.find(a =>
            currentDir.includes(a.id || a.name)
        );
        
        if (matchedAgent?.name) {
            console.log('✅ Agent name from agentDir match:', matchedAgent.name);
            return matchedAgent.name;
        }
    } catch (error) {
        console.log('⚠️  Could not read OpenClaw config:', error.message);
    }
    
    // Fallback: use workspace/project name
    const fallback = path.basename(process.cwd());
    console.log('ℹ️  Using fallback agent name:', fallback);
    return fallback;
}

// WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('✅ Client connected. Total clients:', clients.size);
  console.log('📤 Sending initial data:');
  console.log('  - projectInfo:', projectInfo);
  console.log('  - fileTree items:', Object.keys(fileTree).length);
  console.log('  - gitLogs:', gitLogs.length);
  console.log('  - systemMetrics:', !!systemMetrics.cpu);
  
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
      projectInfo,
      liveLogs,
      tokenMetrics,
      gatewayStatus: 'connected'
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
      cpu: (cpu.currentLoad).toFixed(2),
      memory: {
        used: (memory.used / 1024 / 1024 / 1024).toFixed(2),
        total: Math.round(memory.total / 1024 / 1024 / 1024),
        percentage: (memory.used / memory.total * 100).toFixed(2)
      },
      disk: {
        used: disk[0] ? (disk[0].used / 1024 / 1024 / 1024).toFixed(2) : 0,
        total: disk[0] ? Math.round(disk[0].size / 1024 / 1024 / 1024) : 0,
        percentage: disk[0] ? (disk[0].use).toFixed(2) : 0
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
  console.log('🌳 Building file tree for:', basePath);
  
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
      console.error('Error building tree:', error.message);
      return null;
    }
  }
  
  fileTree = buildTree(basePath);
  console.log('✅ File tree built with', Object.keys(fileTree).length, 'items');
  broadcast({ type: 'fileTree', data: fileTree });
}

// Check OpenClaw status
function checkOpenClawStatus() {
  exec('ps aux | grep openclaw | grep -v grep', (error, stdout, stderr) => {
    openclawStatus = stdout ? 'active' : 'inactive';
    broadcast({ type: 'openclawStatus', data: openclawStatus });
  });
}

// Get actual OpenClaw work queue and tasks
function updateWorkQueue() {
  // Fetch OpenClaw cron jobs
  exec('openclaw cron list 2>/dev/null || echo ""', (error, stdout, stderr) => {
    const tasks = [];
    
    if (!error && stdout && stdout.trim()) {
      const lines = stdout.split('\n').filter(line => line.trim());
      
      // Parse cron job output
      lines.forEach((line, index) => {
        if (index === 0 || !line.trim()) return; // Skip header
        
        const parts = line.split(/\s+/);
        if (parts.length > 4) {
          tasks.push({
            id: index,
            title: parts.slice(1, 4).join(' '),
            description: `Scheduled cron job: ${parts.slice(4).join(' ')}`,
            status: parts[parts.length - 2] === 'ok' ? 'ACTIVE' : 'QUEUE',
            progress: parts[parts.length - 2] === 'ok' ? 100 : 0,
            eta: 'Scheduled'
          });
        }
      });
    }
    
      // Only show actual cron jobs, not infrastructure
      workQueue = tasks.length > 0 ? tasks : getDefaultWorkQueue();
      console.log('📋 Work queue updated:', tasks.length, 'cron jobs');
      broadcast({ type: 'workQueue', data: workQueue });
  });
}

// Fallback default work queue
function getDefaultWorkQueue() {
  return [
    {
      id: 1,
      title: "No Active Cron Jobs",
      description: "No scheduled tasks currently configured. Work queue shows actual scheduled tasks and background operations.",
      status: "IDLE",
      progress: 0,
      eta: "Waiting"
    }
  ];
}

// Get token usage from OpenClaw gateway logs
function updateTokenMetrics() {
  // Read gateway logs for token usage patterns
  exec('grep -i "tokens" /Users/openclaw/.openclaw/logs/gateway.log 2>/dev/null | tail -100 || echo ""', 
    (error, stdout, stderr) => {
      if (stdout && stdout.trim()) {
        const lines = stdout.split('\n');
        
        // Parse token usage from logs (example pattern: "tokens: 1500 input, 300 output")
        lines.forEach(line => {
          // Look for token patterns in logs
          const haikusMatch = line.match(/haiku.*?(\d+)\s+input.*?(\d+)\s+output/i);
          const sonnetMatch = line.match(/sonnet.*?(\d+)\s+input.*?(\d+)\s+output/i);
          
          if (haikusMatch) {
            tokenMetrics.haiku.input += parseInt(haikusMatch[1]) || 0;
            tokenMetrics.haiku.output += parseInt(haikusMatch[2]) || 0;
          }
          if (sonnetMatch) {
            tokenMetrics.sonnet.input += parseInt(sonnetMatch[1]) || 0;
            tokenMetrics.sonnet.output += parseInt(sonnetMatch[2]) || 0;
          }
        });
        
        // Calculate costs
        tokenMetrics.haiku.total = tokenMetrics.haiku.input + tokenMetrics.haiku.output;
        tokenMetrics.haiku.cost = 
          (tokenMetrics.haiku.input * tokenCosts.haiku.input / 1000000) +
          (tokenMetrics.haiku.output * tokenCosts.haiku.output / 1000000);
        
        tokenMetrics.sonnet.total = tokenMetrics.sonnet.input + tokenMetrics.sonnet.output;
        tokenMetrics.sonnet.cost = 
          (tokenMetrics.sonnet.input * tokenCosts.sonnet.input / 1000000) +
          (tokenMetrics.sonnet.output * tokenCosts.sonnet.output / 1000000);
        
        tokenMetrics.total.tokens = tokenMetrics.haiku.total + tokenMetrics.sonnet.total;
        tokenMetrics.total.cost = tokenMetrics.haiku.cost + tokenMetrics.sonnet.cost;
        tokenMetrics.total.lastUpdated = new Date();
        
        console.log('💰 Token metrics updated:', {
          haiku: `${tokenMetrics.haiku.total} tokens ($${tokenMetrics.haiku.cost.toFixed(2)})`,
          sonnet: `${tokenMetrics.sonnet.total} tokens ($${tokenMetrics.sonnet.cost.toFixed(2)})`,
          total: `${tokenMetrics.total.tokens} tokens ($${tokenMetrics.total.cost.toFixed(2)})`
        });
        
        broadcast({ type: 'tokenMetrics', data: tokenMetrics });
      }
    });
}

// Get live logs from OpenClaw gateway
let liveLogs = [];
function updateLiveLogs() {
  exec('tail -30 /Users/openclaw/.openclaw/logs/gateway.log 2>/dev/null || tail -30 /tmp/openclaw/openclaw-*.log 2>/dev/null || echo ""', 
    (error, stdout, stderr) => {
      if (stdout && stdout.trim()) {
        liveLogs = stdout.split('\n')
          .filter(line => line.trim())
          .map((line, index) => {
            // Parse log line for level
            let level = 'info';
            if (line.includes('ERROR') || line.includes('error')) level = 'error';
            else if (line.includes('WARN') || line.includes('warn')) level = 'warning';
            else if (line.includes('DEBUG') || line.includes('debug')) level = 'debug';
            
            return {
              level,
              message: line,
              timestamp: new Date().toISOString()
            };
          })
          .reverse() // Show newest first
          .slice(0, 20); // Keep last 20 entries
        
        console.log('📋 Live logs updated:', liveLogs.length, 'entries');
        broadcast({ type: 'liveLogs', data: liveLogs });
      }
    });
}

// Update all data periodically
setInterval(updateSystemMetrics, 1000);      // Every 1 second (REAL-TIME)
setInterval(updateGitLogs, 30000);           // Every 30 seconds
setInterval(updateFileTree, 60000);          // Every 60 seconds
setInterval(checkOpenClawStatus, 10000);     // Every 10 seconds
setInterval(updateWorkQueue, 5000);          // Every 5 seconds (ACTIVE UPDATES)
setInterval(updateLiveLogs, 3000);           // Every 3 seconds (LIVE LOGS)
setInterval(updateTokenMetrics, 10000);      // Every 10 seconds (TOKEN USAGE)

// Initial updates
console.log('📊 Running initial updates...');
updateSystemMetrics();
updateGitLogs();
updateFileTree();
checkOpenClawStatus();
updateWorkQueue();
updateTokenMetrics();

console.log('🎯 Server startup complete');
console.log('Project Info:', projectInfo);
console.log('Initial fileTree items:', Object.keys(fileTree).length);

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