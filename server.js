const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');
const chokidar = require('chokidar');
const si = require('systeminformation');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Config file for persistent API settings & tasks
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'anthropic.json');
const TASKS_FILE = path.join(CONFIG_DIR, 'tasks.json');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Load config from file
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            console.log('✅ Loaded Anthropic config from file');
            return config;
        }
    } catch (error) {
        console.log('⚠️  Error loading config file:', error.message);
    }
    return null;
}

// Save config to file
function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('✅ Saved Anthropic config to file');
    } catch (error) {
        console.log('⚠️  Error saving config file:', error.message);
    }
}

// Load tasks from file
function loadTasks() {
    try {
        if (fs.existsSync(TASKS_FILE)) {
            const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
            console.log(`✅ Loaded ${tasks.length} tasks from file`);
            return tasks;
        }
    } catch (error) {
        console.log('⚠️  Error loading tasks file:', error.message);
    }
    return [];
}

// Save tasks to file
function saveTasks(tasks) {
    try {
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    } catch (error) {
        console.log('⚠️  Error saving tasks file:', error.message);
    }
}

// Load config on startup
const savedConfig = loadConfig();
if (savedConfig && savedConfig.apiKey) {
    process.env.ANTHROPIC_API_KEY = savedConfig.apiKey;
    console.log('✅ Loaded API key from saved config');
}
if (savedConfig && savedConfig.endpoint) {
    process.env.ANTHROPIC_API_ENDPOINT = savedConfig.endpoint;
    console.log('✅ Loaded custom endpoint from saved config');
}

// Load tasks on startup
manualTasks = loadTasks();

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// System metrics cache
let systemMetrics = {};
let gitLogs = [];
let fileTree = {};
let workQueue = [];
let manualTasks = []; // User-created tasks
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
    today: {
        tokens: 0,
        cost: 0
    },
    session: {
        haiku: { input: 0, output: 0, total: 0, cost: 0 },
        sonnet: { input: 0, output: 0, total: 0, cost: 0 },
        total: { tokens: 0, cost: 0 }
    },
    allTime: {
        haiku: { input: 0, output: 0, total: 0, cost: 0 },
        sonnet: { input: 0, output: 0, total: 0, cost: 0 },
        total: { tokens: 0, cost: 0 }
    },
    lastUpdated: new Date()
};

// Token costs (per million tokens)
const tokenCosts = {
    'haiku': { input: 0.80, output: 4.00 },
    'sonnet': { input: 3.00, output: 15.00 },
    'opus': { input: 15.00, output: 75.00 }
};

// Calculate cost from tokens (blended average of models)
function calculateCost(tokens) {
    // Blended average: (Haiku + Sonnet) / 2 ≈ $0.0018 per token
    // More precisely: ~20% input, 80% output
    const inputRate = (0.80 + 3.00) / 2 / 1000000; // ~$0.0000019 per input token
    const outputRate = (4.00 + 15.00) / 2 / 1000000; // ~$0.0000095 per output token
    // Assume 20% input, 80% output ratio
    const estimatedCost = (tokens * 0.2 * inputRate) + (tokens * 0.8 * outputRate);
    
    // Debug: log if tokens are 0
    if (tokens === 0) {
        console.log('⚠️  DEBUG: calculateCost called with 0 tokens');
    }
    
    return estimatedCost;
}

// Extract and breakdown tokens/cost by day from API response
function extractDailyBreakdown(usageData) {
    const dailyBreakdown = [];
    let totalTokens = 0;
    let totalCost = 0;
    
    console.log(`   🔍 DEBUG: usageData.data exists? ${!!usageData.data}, length: ${usageData.data?.length || 0}`);
    
    if (usageData.data && Array.isArray(usageData.data)) {
        let bucketsWithResults = 0;
        let bucketsWithoutResults = 0;
        
        usageData.data.forEach((bucket, idx) => {
            const hasResults = bucket.results && bucket.results.length > 0;
            if (hasResults) bucketsWithResults++;
            else bucketsWithoutResults++;
            
            if (bucket.results && Array.isArray(bucket.results)) {
                bucket.results.forEach(result => {
                    const dayTokens = (result.uncached_input_tokens || 0) +
                                     (result.cache_read_input_tokens || 0) +
                                     (result.output_tokens || 0);
                    const dayCost = calculateCost(dayTokens);
                    
                    totalTokens += dayTokens;
                    totalCost += dayCost;
                    
                    console.log(`   🔍 DEBUG: Bucket ${idx} (${bucket.starting_at}): ${dayTokens} tokens = $${dayCost.toFixed(4)}`);
                    
                    if (dayTokens > 0) { // Only log days with usage
                        dailyBreakdown.push({
                            date: bucket.starting_at.split('T')[0],
                            tokens: dayTokens,
                            cost: dayCost,
                            uncached_input: result.uncached_input_tokens || 0,
                            cache_read: result.cache_read_input_tokens || 0,
                            output: result.output_tokens || 0
                        });
                    }
                });
            }
        });
        
        console.log(`   🔍 DEBUG: Buckets with results: ${bucketsWithResults}, without: ${bucketsWithoutResults}`);
        console.log(`   🔍 DEBUG: Total extracted: ${totalTokens} tokens = $${totalCost.toFixed(4)}`);
    }
    
    return { dailyBreakdown, totalTokens, totalCost };
}

// Extract total tokens from API response (legacy function)
function extractTokensFromResponse(usageData) {
    const { totalTokens } = extractDailyBreakdown(usageData);
    return totalTokens;
}

// Get today's usage (minute-by-minute, updates every minute)
function fetchTodaysUsage() {
    return new Promise((resolve) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
            resolve(null);
            return;
        }
        
        try {
            // Today from 00:00 UTC to 23:59:59 UTC
            const now = new Date();
            const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
            const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
            
            const startingAt = startOfDay.toISOString();
            const endingAt = endOfDay.toISOString();
            
            const endpoint = process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com/v1/organizations/usage_report/messages';
            const url = new URL(endpoint);
            url.searchParams.append('starting_at', startingAt);
            url.searchParams.append('ending_at', endingAt);
            url.searchParams.append('bucket_width', '1m'); // minute-level granularity
            
            console.log('📊 Fetching today\'s usage (minute buckets)...');
            
            const curlCmd = `curl -s -X GET "${url.toString()}" \
              -H "anthropic-version: 2023-06-01" \
              -H "x-api-key: ${apiKey}"`;
            
            exec(curlCmd, (error, stdout, stderr) => {
                if (error) {
                    console.log('⚠️  Error fetching today\'s usage:', error.message);
                    resolve(null);
                    return;
                }
                
                // DEBUG: Check if response is empty or error
                if (!stdout || stdout.length === 0) {
                    console.log('⚠️  DEBUG: Empty response from today\'s usage API');
                    resolve(null);
                    return;
                }
                
                if (stdout.includes('error') || stdout.includes('message')) {
                    console.log('⚠️  DEBUG: Error response from today\'s usage:', stdout.substring(0, 200));
                    resolve(null);
                    return;
                }
                
                try {
                    const usageData = JSON.parse(stdout);
                    
                    // DEBUG: Log raw today response
                    console.log('   🔍 Today Raw API Response:', {
                        hasData: !!usageData.data,
                        keys: Object.keys(usageData).slice(0, 10),
                        error: usageData.error,
                        dataLength: usageData.data?.length
                    });
                    
                    const { dailyBreakdown, totalTokens, totalCost: cost } = extractDailyBreakdown(usageData);
                    
                    // Show minute-by-minute breakdown for today (if available)
                    if (dailyBreakdown.length > 0) {
                        console.log('✅ Today\'s usage (minute buckets):', {
                            totalTokens: totalTokens.toLocaleString(),
                            cost: cost.toFixed(4),
                            minutes: dailyBreakdown.length
                        });
                    } else {
                        console.log('✅ Today\'s usage: 0 tokens, $0.00 (no usage yet)');
                    }
                    
                    resolve({ totalTokens, cost });
                } catch (parseError) {
                    console.log('⚠️  Error parsing today\'s usage:', parseError.message);
                    resolve(null);
                }
            });
        } catch (error) {
            console.log('⚠️  Error setting up today\'s usage request:', error.message);
            resolve(null);
        }
    });
}

// Get all-time usage (daily buckets through yesterday - complete data only)
function fetchAllTimeUsage(nextPage = null) {
    return new Promise((resolve) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
            resolve(null);
            return;
        }
        
        try {
            // Date range: 2026-01-01 to yesterday (all complete days)
            const now = new Date();
            const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
            const yesterday = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
            const endOfYesterday = new Date(yesterday.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000);
            
            const startOfYear = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
            
            const startingAt = startOfYear.toISOString();
            const endingAt = endOfYesterday.toISOString();
            
            const endpoint = process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com/v1/organizations/usage_report/messages';
            const url = new URL(endpoint);
            url.searchParams.append('starting_at', startingAt);
            url.searchParams.append('ending_at', endingAt);
            url.searchParams.append('bucket_width', '1d'); // daily buckets
            url.searchParams.append('limit', '31'); // max 31 days per request
            
            // Add pagination if provided
            if (nextPage) {
                url.searchParams.append('page', nextPage);
            }
            
            console.log(`📊 Fetching all-time usage (2026-01-01 through yesterday)${nextPage ? ' (page: ' + nextPage + ')' : ''}...`);
            console.log(`   Date range: ${startingAt} to ${endingAt}`);
            
            const curlCmd = `curl -s -X GET "${url.toString()}" \
              -H "anthropic-version: 2023-06-01" \
              -H "x-api-key: ${apiKey}"`;
            
            exec(curlCmd, (error, stdout, stderr) => {
                if (error) {
                    console.log('⚠️  Error fetching all-time usage:', error.message);
                    resolve(null);
                    return;
                }
                
                // DEBUG: Check if response is empty or error
                if (!stdout || stdout.length === 0) {
                    console.log('⚠️  DEBUG: Empty response from all-time usage API');
                    resolve(null);
                    return;
                }
                
                if (stdout.includes('error') || stdout.includes('message')) {
                    console.log('⚠️  DEBUG: Error response from all-time:', stdout.substring(0, 300));
                    resolve(null);
                    return;
                }
                
                try {
                    const usageData = JSON.parse(stdout);
                    
                    // DEBUG: Log raw response structure
                    console.log('   🔍 Raw API Response:', {
                        hasData: !!usageData.data,
                        keys: Object.keys(usageData).slice(0, 10),
                        error: usageData.error,
                        message: usageData.message,
                        dataLength: usageData.data?.length
                    });
                    
                    const { dailyBreakdown, totalTokens: pageTokens, totalCost: pageCost } = extractDailyBreakdown(usageData);
                    
                    // Debug: show raw response structure
                    console.log(`   API returned ${usageData.data?.length || 0} buckets`);
                    
                    // Show daily breakdown table for this page
                    if (dailyBreakdown.length > 0) {
                        console.log('\n   📊 Daily Breakdown:');
                        console.log('   ─────────────────────────────────────────────────────────');
                        console.log('   Date       │  Tokens  │  Cost  │ Uncached │ Cached │ Output');
                        console.log('   ─────────────────────────────────────────────────────────');
                        
                        dailyBreakdown.forEach(day => {
                            const tokenStr = day.tokens.toString().padEnd(8);
                            const costStr = `$${day.cost.toFixed(2)}`.padEnd(7);
                            const uncachedStr = day.uncached_input.toString().padEnd(8);
                            const cachedStr = day.cache_read.toString().padEnd(7);
                            const outputStr = day.output.toString();
                            
                            console.log(`   ${day.date} │ ${tokenStr}│ ${costStr}│ ${uncachedStr}│ ${cachedStr}│ ${outputStr}`);
                        });
                        console.log('   ─────────────────────────────────────────────────────────');
                        console.log(`   Page Total: ${pageTokens.toLocaleString()} tokens = $${pageCost.toFixed(2)}\n`);
                    }
                    
                    // Handle pagination recursively
                    if (usageData.has_more && usageData.next_page) {
                        console.log(`📄 Paginating all-time usage (next_page: ${usageData.next_page})...`);
                        // Recursively fetch next page and accumulate
                        fetchAllTimeUsage(usageData.next_page).then((nextPageData) => {
                            if (nextPageData) {
                                const totalTokens = pageTokens + nextPageData.totalTokens;
                                const cost = pageCost + nextPageData.cost;
                                
                                console.log('✅ All-time usage (complete):', {
                                    tokens: totalTokens.toLocaleString(),
                                    cost: cost.toFixed(2),
                                    pages: 'multiple'
                                });
                                
                                resolve({ totalTokens, cost });
                            }
                        });
                    } else {
                        console.log('✅ All-time usage:', {
                            tokens: pageTokens.toLocaleString(),
                            cost: pageCost.toFixed(2),
                            days: dailyBreakdown.length,
                            hasMore: usageData.has_more
                        });
                        
                        resolve({ totalTokens: pageTokens, cost: pageCost });
                    }
                } catch (parseError) {
                    console.log('⚠️  Error parsing all-time usage:', parseError.message);
                    console.log('   Raw response:', stdout.substring(0, 500));
                    resolve(null);
                }
            });
        } catch (error) {
            console.log('⚠️  Error setting up all-time usage request:', error.message);
            resolve(null);
        }
    });
}
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
  
  // Check if API is configured
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiKeySet = apiKey && apiKey !== 'your_anthropic_api_key_here' && apiKey.length > 10;
  
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
      gatewayStatus: 'connected',
      apiStatus: {
        apiKeySet: apiKeySet,
        endpoint: process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com/v1/usage'
      }
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
    
      // Combine manual tasks with cron jobs (manual tasks first)
      workQueue = [...manualTasks, ...tasks];
      
      // If no tasks at all, show default message
      if (workQueue.length === 0) {
        workQueue = getDefaultWorkQueue();
      }
      
      console.log('📋 Work queue updated:', tasks.length, 'cron jobs,', manualTasks.length, 'manual tasks');
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

// Get token usage from Anthropic API
async function updateTokenMetrics() {
  console.log('🔄 Updating token metrics from Anthropic API...');
  
  const todaysData = await fetchTodaysUsage();
  const allTimeData = await fetchAllTimeUsage();
  
  if (todaysData) {
    tokenMetrics.today = {
      tokens: todaysData.totalTokens,
      cost: todaysData.cost
    };
  }
  
  if (allTimeData) {
    tokenMetrics.allTime.total.tokens = allTimeData.totalTokens;
    tokenMetrics.allTime.total.cost = allTimeData.cost;
  }
  
  if (todaysData || allTimeData) {
    console.log('💰 Real token usage (Anthropic Admin API):', {
      today: todaysData ? `$${todaysData.cost.toFixed(4)}` : 'N/A',
      allTime: allTimeData ? `$${allTimeData.cost.toFixed(2)}` : 'N/A'
    });
  } else {
    console.log('💰 Token metrics updated (Anthropic API unavailable)');
  }
  
  tokenMetrics.lastUpdated = new Date();
  broadcast({ type: 'tokenMetrics', data: tokenMetrics });
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

// Configure Anthropic API endpoint
app.post('/api/anthropic/configure', (req, res) => {
  const { apiKey, endpoint } = req.body;
  
  // Prepare config to save
  const configToSave = {};
  
  if (apiKey) {
    process.env.ANTHROPIC_API_KEY = apiKey;
    configToSave.apiKey = apiKey;
    console.log('✅ Anthropic API key updated');
  }
  
  if (endpoint) {
    process.env.ANTHROPIC_API_ENDPOINT = endpoint;
    configToSave.endpoint = endpoint;
    console.log('✅ Anthropic API endpoint updated to:', endpoint);
  }
  
  // Save to persistent config file
  if (Object.keys(configToSave).length > 0) {
    const currentConfig = loadConfig() || {};
    const updatedConfig = { ...currentConfig, ...configToSave };
    saveConfig(updatedConfig);
  }
  
  const isConfigured = process.env.ANTHROPIC_API_KEY && 
                       process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here' &&
                       process.env.ANTHROPIC_API_KEY.length > 10;
  
  // Broadcast API status to all clients
  broadcast({ 
    type: 'apiStatus', 
    data: { 
      apiKeySet: isConfigured,
      endpoint: process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com/v1/organizations/usage_report/messages'
    } 
  });
  
  res.json({ 
    success: true, 
    config: {
      endpoint: process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com/v1/organizations/usage_report/messages',
      apiKeySet: isConfigured
    }
  });
});

// Get Anthropic configuration
app.get('/api/anthropic/config', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isConfigured = apiKey && apiKey !== 'your_anthropic_api_key_here' && apiKey.length > 10;
  
  res.json({
    endpoint: process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com/v1/usage',
    apiKeySet: isConfigured
  });
});

// Task Management API
app.post('/api/tasks/add', (req, res) => {
  const { title, description, status } = req.body;
  
  if (!title || !description || !status) {
    return res.status(400).json({ error: 'Missing required fields: title, description, status' });
  }
  
  const newTask = {
    id: Date.now(),
    title,
    description,
    status: status.toUpperCase(),
    progress: status.toUpperCase() === 'IN_PROGRESS' ? 50 : 0,
    eta: 'Atlas-generated',
    createdAt: new Date()
  };
  
  manualTasks.unshift(newTask);
  console.log('✅ Task added:', title);
  
  // Save to disk and broadcast
  saveTasks(manualTasks);
  updateWorkQueue();
  
  res.json({ success: true, task: newTask });
});

app.post('/api/tasks/update/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, status, progress } = req.body;
  
  const task = manualTasks.find(t => t.id == id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  if (title) task.title = title;
  if (description) task.description = description;
  if (status) task.status = status.toUpperCase();
  if (progress !== undefined) task.progress = progress;
  
  console.log('✅ Task updated:', id);
  
  // Save to disk and broadcast
  saveTasks(manualTasks);
  updateWorkQueue();
  
  res.json({ success: true, task });
});

app.post('/api/tasks/delete/:id', (req, res) => {
  const { id } = req.params;
  
  const index = manualTasks.findIndex(t => t.id == id);
  if (index === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  const removed = manualTasks.splice(index, 1);
  console.log('✅ Task deleted:', id);
  
  // Save to disk and broadcast
  saveTasks(manualTasks);
  updateWorkQueue();
  
  res.json({ success: true, removed: removed[0] });
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