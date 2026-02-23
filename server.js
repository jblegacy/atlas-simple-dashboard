require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const cors = require('cors');
const chokidar = require('chokidar');
const si = require('systeminformation');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── Supabase Client ────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;
let supabaseReady = false;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase client initialized:', supabaseUrl);
} else {
    console.log('⚠️  Supabase not configured - falling back to file-based persistence');
    console.log('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
}

// ─── Config file for persistent API settings ────────────────────────────────
const CONFIG_DIR = path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'anthropic.json');
const TASKS_FILE = path.join(CONFIG_DIR, 'tasks.json');
const MODEL_HISTORY_FILE = path.join(CONFIG_DIR, 'model-history.json');
const AGENTS_CONFIG_FILE = path.join(CONFIG_DIR, 'agents.json');

// Default agent configuration with colors
const DEFAULT_AGENT_CONFIG = {
    'atlas': { name: 'Atlas', color: '#4ec9b0', bg: 'rgba(78, 201, 176, 0.1)' },
    'nate': { name: 'Nate', color: '#d4534f', bg: 'rgba(212, 83, 79, 0.1)' },
    'alex': { name: 'Alex', color: '#6a9955', bg: 'rgba(106, 153, 85, 0.1)' }
};

// Dynamic AGENT_CONFIG (merges defaults with configured agents)
let AGENT_CONFIG = { ...DEFAULT_AGENT_CONFIG };

// Ensure config directory exists (still needed for anthropic.json)
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// ─── Anthropic Config (stays file-based - sensitive) ────────────────────────
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

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('✅ Saved Anthropic config to file');
    } catch (error) {
        console.log('⚠️  Error saving config file:', error.message);
    }
}

// ─── Agents Config (multi-agent API key management) ─────────────────────────
let agentsConfig = { adminApiKey: null, agents: [] };
let apiKeyIdToAgent = new Map();

function loadAgentsConfig() {
    try {
        if (fs.existsSync(AGENTS_CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(AGENTS_CONFIG_FILE, 'utf8'));
            console.log(`✅ Loaded agents config: ${(config.agents || []).length} agents, admin key: ${config.adminApiKey ? 'set' : 'not set'}`);
            return config;
        }
    } catch (error) {
        console.log('⚠️  Error loading agents config:', error.message);
    }
    return { adminApiKey: null, agents: [] };
}

function saveAgentsConfig(config) {
    try {
        fs.writeFileSync(AGENTS_CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('✅ Saved agents config to file');
    } catch (error) {
        console.log('⚠️  Error saving agents config:', error.message);
    }
}

function rebuildApiKeyIdMap() {
    apiKeyIdToAgent = new Map();
    (agentsConfig.agents || []).forEach(agent => {
        apiKeyIdToAgent.set(agent.apiKeyId, agent);
    });
    // Also rebuild dynamic AGENT_CONFIG
    AGENT_CONFIG = { ...DEFAULT_AGENT_CONFIG };
    (agentsConfig.agents || []).forEach(agent => {
        const slug = agent.slug || agent.name.toLowerCase();
        if (!AGENT_CONFIG[slug]) {
            const color = agent.color || '#007acc';
            AGENT_CONFIG[slug] = {
                name: agent.name,
                color: color,
                bg: `rgba(${hexToRgb(color)}, 0.1)`
            };
        }
    });
    console.log(`🔑 API key map rebuilt: ${apiKeyIdToAgent.size} agents mapped`);
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
        : '0, 122, 204';
}

function getEffectiveApiKey() {
    // Prefer admin key from agents config, fall back to legacy API key
    return agentsConfig.adminApiKey || process.env.ANTHROPIC_API_KEY;
}

// Load agents config on startup
agentsConfig = loadAgentsConfig();
rebuildApiKeyIdMap();

// ─── Legacy file-based functions (fallback when Supabase unavailable) ───────
function loadTasksFromFile() {
    try {
        if (fs.existsSync(TASKS_FILE)) {
            const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
            console.log(`✅ Loaded ${tasks.length} tasks from file (fallback)`);
            return tasks;
        }
    } catch (error) {
        console.log('⚠️  Error loading tasks file:', error.message);
    }
    return [];
}

function loadModelHistoryFromFile() {
    try {
        if (fs.existsSync(MODEL_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(MODEL_HISTORY_FILE, 'utf8'));
        }
    } catch (error) {
        console.log('⚠️  Error loading model history file:', error.message);
    }
    return [];
}

// ─── Supabase-backed persistence ────────────────────────────────────────────

// Test Supabase connection and verify tables exist
async function testSupabaseConnection() {
    if (!supabase) return false;

    try {
        const { data, error } = await supabase.from('tasks').select('id').limit(1);
        if (error) {
            // Table doesn't exist yet - that's OK, we'll tell the user
            if (error.code === '42P01' || error.message?.includes('relation') || error.message?.includes('does not exist')) {
                console.log('⚠️  Supabase connected but tables not created yet.');
                console.log('   Run the SQL schema from the plan in Supabase SQL Editor.');
                console.log('   Falling back to file-based persistence for now.');
                return false;
            }
            console.log('⚠️  Supabase connection test failed:', error.message);
            return false;
        }
        console.log('✅ Supabase connection verified - tables exist');
        return true;
    } catch (err) {
        console.log('⚠️  Supabase connection error:', err.message);
        return false;
    }
}

// Load tasks from Supabase
async function loadTasks() {
    if (supabaseReady) {
        try {
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Map Supabase rows to frontend-compatible format
            const tasks = (data || []).map(row => ({
                id: row.id,
                title: row.title,
                description: row.description,
                status: row.status,
                progress: row.progress,
                eta: row.eta,
                agent: row.agent,
                machine: row.machine,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }));

            console.log(`✅ Loaded ${tasks.length} tasks from Supabase`);
            return tasks;
        } catch (error) {
            console.log('⚠️  Supabase loadTasks error, falling back to file:', error.message);
        }
    }
    return loadTasksFromFile();
}

// Load model history from Supabase
async function loadModelHistory() {
    if (supabaseReady) {
        try {
            const { data, error } = await supabase
                .from('model_history')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const history = (data || []).map(row => ({
                timestamp: row.created_at,
                agent: row.agent,
                model: row.model,
                tokens: row.tokens,
                cost: parseFloat(row.cost) || 0
            }));

            console.log(`✅ Loaded ${history.length} model history entries from Supabase`);
            return history;
        } catch (error) {
            console.log('⚠️  Supabase loadModelHistory error, falling back to file:', error.message);
        }
    }
    return loadModelHistoryFromFile();
}

// Track model usage → Supabase insert + in-memory cache
async function trackModelUsage(agent, model, tokens, cost) {
    const entry = {
        timestamp: new Date().toISOString(),
        agent,
        model,
        tokens,
        cost
    };

    // Always update in-memory cache
    modelHistory.push(entry);

    // Persist to Supabase
    if (supabaseReady) {
        try {
            const { error } = await supabase.from('model_history').insert({
                agent,
                model,
                tokens,
                cost,
                created_at: entry.timestamp
            });
            if (error) console.log('⚠️  Supabase model_history insert error:', error.message);
        } catch (err) {
            console.log('⚠️  Supabase model_history error:', err.message);
        }
    }

    console.log(`✅ Model usage tracked: ${agent} used ${model} (${tokens} tokens)`);
}

// Log task event to audit trail (perpetual history)
async function logTaskEvent(taskId, agent, eventType, details = {}) {
    if (!supabaseReady) return;

    try {
        const { error } = await supabase.from('task_events').insert({
            task_id: taskId,
            agent: agent || projectInfo.agentName,
            event_type: eventType,
            details
        });
        if (error) console.log('⚠️  Supabase task_events insert error:', error.message);
        else console.log(`📝 Task event logged: ${eventType} for task ${taskId}`);
    } catch (err) {
        console.log('⚠️  Task event logging error:', err.message);
    }
}

// ─── Aggregation functions (work from in-memory cache) ──────────────────────

// Calculate model usage percentages (all-time)
function getModelUsagePercents() {
    const modelCounts = {};
    let totalTokens = 0;

    modelHistory.forEach(entry => {
        const modelName = entry.model.split('/').pop().split('-')[0];
        modelCounts[modelName] = (modelCounts[modelName] || 0) + entry.tokens;
        totalTokens += entry.tokens;
    });

    const percents = {};
    Object.entries(modelCounts).forEach(([model, tokens]) => {
        percents[model] = totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0;
    });

    return percents;
}

// Calculate per-agent costs (all-time)
function getAgentCosts() {
    const agentCosts = {};
    let totalCost = 0;

    modelHistory.forEach(entry => {
        agentCosts[entry.agent] = (agentCosts[entry.agent] || 0) + entry.cost;
        totalCost += entry.cost;
    });

    const percents = {};
    Object.entries(agentCosts).forEach(([agent, cost]) => {
        percents[agent] = {
            cost,
            percent: totalCost > 0 ? Math.round((cost / totalCost) * 100) : 0
        };
    });

    return { agents: percents, total: totalCost };
}

// ─── One-time data migration (file → Supabase) ─────────────────────────────
async function migrateFileDataToSupabase() {
    if (!supabaseReady) return;

    // Check if Supabase tasks table is empty
    const { data: existingTasks } = await supabase.from('tasks').select('id').limit(1);

    if (!existingTasks || existingTasks.length === 0) {
        // Migrate tasks.json if it has data
        const fileTasks = loadTasksFromFile();
        if (fileTasks.length > 0) {
            console.log(`📦 Migrating ${fileTasks.length} tasks from file to Supabase...`);
            for (const task of fileTasks) {
                const { error } = await supabase.from('tasks').insert({
                    title: task.title,
                    description: task.description,
                    status: task.status,
                    progress: task.progress || 0,
                    eta: task.eta || 'Migrated',
                    agent: task.agent || projectInfo.agentName,
                    machine: os.hostname(),
                    created_at: task.createdAt || new Date().toISOString()
                });
                if (error) console.log('⚠️  Task migration error:', error.message);
            }
            console.log('✅ Tasks migrated to Supabase');
        }
    }

    // Check if Supabase model_history table is empty
    const { data: existingHistory } = await supabase.from('model_history').select('id').limit(1);

    if (!existingHistory || existingHistory.length === 0) {
        // Migrate model-history.json if it has data
        const fileHistory = loadModelHistoryFromFile();
        if (fileHistory.length > 0) {
            console.log(`📦 Migrating ${fileHistory.length} model history entries to Supabase...`);

            // Batch insert in chunks of 50
            for (let i = 0; i < fileHistory.length; i += 50) {
                const batch = fileHistory.slice(i, i + 50).map(entry => ({
                    agent: entry.agent,
                    model: entry.model,
                    tokens: entry.tokens,
                    cost: entry.cost || 0,
                    created_at: entry.timestamp || new Date().toISOString()
                }));

                const { error } = await supabase.from('model_history').insert(batch);
                if (error) console.log('⚠️  Model history migration error:', error.message);
            }
            console.log('✅ Model history migrated to Supabase');
        }
    }
}

// ─── Supabase Realtime Subscription ─────────────────────────────────────────
function setupRealtimeSubscription() {
    if (!supabaseReady) return;

    console.log('📡 Setting up Supabase Realtime subscription for tasks...');

    supabase
        .channel('dashboard-tasks')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async (payload) => {
            console.log(`📡 Realtime: ${payload.eventType} on tasks table`);

            if (payload.eventType === 'INSERT') {
                const row = payload.new;
                const task = {
                    id: row.id,
                    title: row.title,
                    description: row.description,
                    status: row.status,
                    progress: row.progress,
                    eta: row.eta,
                    agent: row.agent,
                    machine: row.machine,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };
                // Add to cache if not already there (avoid duplicates from our own inserts)
                if (!manualTasks.find(t => t.id === task.id)) {
                    manualTasks.unshift(task);
                    console.log(`📡 Realtime: Added task "${task.title}" from ${task.machine || 'unknown'}`);
                }
            } else if (payload.eventType === 'UPDATE') {
                const row = payload.new;
                const idx = manualTasks.findIndex(t => t.id === row.id);
                if (idx !== -1) {
                    manualTasks[idx] = {
                        ...manualTasks[idx],
                        title: row.title,
                        description: row.description,
                        status: row.status,
                        progress: row.progress,
                        eta: row.eta,
                        agent: row.agent,
                        machine: row.machine,
                        updatedAt: row.updated_at
                    };
                    console.log(`📡 Realtime: Updated task "${row.title}" → ${row.status}`);
                }
            } else if (payload.eventType === 'DELETE') {
                const row = payload.old;
                const idx = manualTasks.findIndex(t => t.id === row.id);
                if (idx !== -1) {
                    manualTasks.splice(idx, 1);
                    console.log(`📡 Realtime: Deleted task ${row.id}`);
                }
            }

            // Broadcast updated work queue to all dashboard clients
            updateWorkQueueFromCache();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_sessions' }, (payload) => {
            console.log(`📡 Realtime: Agent session ${payload.eventType} - ${payload.new?.agent || payload.old?.agent}`);
            // Could broadcast agent session updates to dashboard here
        })
        .subscribe((status) => {
            console.log(`📡 Realtime subscription status: ${status}`);
        });
}

// ─── Agent Session Heartbeat ────────────────────────────────────────────────
async function sendHeartbeat() {
    if (!supabaseReady) return;

    try {
        const { error } = await supabase.from('agent_sessions').upsert({
            agent: projectInfo.agentName,
            machine: os.hostname(),
            status: 'active',
            last_heartbeat: new Date().toISOString()
        }, { onConflict: 'agent,machine' });

        if (error) console.log('⚠️  Heartbeat error:', error.message);
    } catch (err) {
        console.log('⚠️  Heartbeat error:', err.message);
    }
}

// ─── Load Anthropic config on startup ───────────────────────────────────────
const savedConfig = loadConfig();
if (savedConfig && savedConfig.apiKey) {
    process.env.ANTHROPIC_API_KEY = savedConfig.apiKey;
    console.log('✅ Loaded API key from saved config');
}
if (savedConfig && savedConfig.endpoint) {
    process.env.ANTHROPIC_API_ENDPOINT = savedConfig.endpoint;
    console.log('✅ Loaded custom endpoint from saved config');
}

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// ─── In-memory state ────────────────────────────────────────────────────────
let systemMetrics = {};
let gitLogs = [];
let fileTree = {};
let workQueue = [];
let manualTasks = [];
let modelHistory = [];
let openclawStatus = 'checking...';
let openclawStats = {
  status: 'inactive',
  processCount: 0,
  cpuUsage: 0,
  memUsage: 0,
  gatewayRunning: false
};
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

// Rate limit tracking
let rateLimitHitCount = 0;
let rateLimitBackoffMs = 0;

// Token costs (per million tokens)
const tokenCosts = {
    'haiku': { input: 0.80, output: 4.00 },
    'sonnet': { input: 3.00, output: 15.00 },
    'opus': { input: 15.00, output: 75.00 }
};

// Usage API returns tokens only - we calculate cost using token pricing
// Cost API could return actual USD, but we use token-based calculation for today's usage

// Resolve model name to pricing tier ('haiku', 'sonnet', 'opus')
function resolveModelTier(modelName) {
    if (modelName) {
        const name = modelName.toLowerCase();
        if (name.includes('opus')) return 'opus';
        if (name.includes('sonnet')) return 'sonnet';
        if (name.includes('haiku')) return 'haiku';
    }
    if (currentModel && currentModel.badge) return currentModel.badge;
    return 'haiku';
}

// Calculate cost from separate input and output token counts
// Uses per-model pricing when model is known, defaults to current model pricing
function calculateCost(inputTokens, outputTokens, modelName) {
    // Resolve which pricing tier to use
    const tier = resolveModelTier(modelName);

    const pricing = tokenCosts[tier] || tokenCosts['haiku'];
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
}

// Extract and breakdown tokens/cost by day from API response
// When groupByAgent=true, also accumulates per-agent breakdowns using api_key_id
function extractDailyBreakdown(usageData, groupByAgent = false) {
    const dailyBreakdown = [];
    let totalTokens = 0;
    let totalCost = 0;
    const perAgent = {}; // apiKeyId -> { tokens, cost, dailyCosts, modelTokens }
    const perModel = {}; // modelTier -> totalTokens (global model breakdown)

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
                    const inputTokens = (result.uncached_input_tokens || 0) +
                                        (result.cache_read_input_tokens || 0);
                    const outputTokens = (result.output_tokens || 0);
                    const dayTokens = inputTokens + outputTokens;
                    const dayCost = calculateCost(inputTokens, outputTokens, result.model);
                    const modelTier = resolveModelTier(result.model);

                    totalTokens += dayTokens;
                    totalCost += dayCost;

                    // Global per-model token accumulation
                    perModel[modelTier] = (perModel[modelTier] || 0) + dayTokens;

                    console.log(`   🔍 DEBUG: Bucket ${idx} (${bucket.starting_at}): ${dayTokens} tokens (in:${inputTokens} out:${outputTokens}) = $${dayCost.toFixed(4)}${result.model ? ' [' + result.model + ']' : ''}${result.api_key_id ? ' key:' + result.api_key_id.slice(-8) : ''}`);

                    // Per-agent accumulation when grouping by api_key_id
                    if (groupByAgent && result.api_key_id) {
                        const keyId = result.api_key_id;
                        if (!perAgent[keyId]) {
                            perAgent[keyId] = { tokens: 0, cost: 0, dailyCosts: {}, modelTokens: {} };
                        }
                        perAgent[keyId].tokens += dayTokens;
                        perAgent[keyId].cost += dayCost;
                        perAgent[keyId].modelTokens[modelTier] = (perAgent[keyId].modelTokens[modelTier] || 0) + dayTokens;

                        const date = bucket.starting_at.split('T')[0];
                        perAgent[keyId].dailyCosts[date] =
                            (perAgent[keyId].dailyCosts[date] || 0) + dayCost;
                    }

                    if (dayTokens > 0) { // Only log days with usage
                        dailyBreakdown.push({
                            date: bucket.starting_at.split('T')[0],
                            tokens: dayTokens,
                            cost: dayCost,
                            uncached_input: result.uncached_input_tokens || 0,
                            cache_read: result.cache_read_input_tokens || 0,
                            output: result.output_tokens || 0,
                            model: result.model || null,
                            api_key_id: result.api_key_id || null
                        });
                    }
                });
            }
        });

        console.log(`   🔍 DEBUG: Buckets with results: ${bucketsWithResults}, without: ${bucketsWithoutResults}`);
        console.log(`   🔍 DEBUG: Total extracted: ${totalTokens} tokens = $${totalCost.toFixed(4)}`);
        if (groupByAgent && Object.keys(perAgent).length > 0) {
            console.log(`   🔍 DEBUG: Per-agent keys found: ${Object.keys(perAgent).length}`);
        }
        if (Object.keys(perModel).length > 0) {
            console.log(`   🔍 DEBUG: Per-model tokens: ${Object.entries(perModel).map(([m, t]) => `${m}:${t}`).join(', ')}`);
        }
    }

    return { dailyBreakdown, totalTokens, totalCost, perAgent, perModel };
}

// Extract total tokens from API response (legacy function)
function extractTokensFromResponse(usageData) {
    const { totalTokens } = extractDailyBreakdown(usageData);
    return totalTokens;
}

// Get today's usage (minute-by-minute, updates every minute)
function fetchTodaysUsage(groupByAgent = false) {
    return new Promise((resolve) => {
        const apiKey = getEffectiveApiKey();

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
            url.searchParams.append('bucket_width', '1m');
            url.searchParams.append('group_by[]', 'model');

            // When agents are configured, also group by api_key_id for per-agent tracking
            if (groupByAgent) {
                url.searchParams.append('group_by[]', 'api_key_id');
                // Filter to only configured agent keys
                agentsConfig.agents.forEach(a => {
                    url.searchParams.append('api_key_ids[]', a.apiKeyId);
                });
                console.log('📊 Fetching today\'s usage (minute buckets, grouped by model + api_key_id)...');
            } else {
                console.log('📊 Fetching today\'s usage (minute buckets, grouped by model)...');
            }

            const curlCmd = `curl -s -X GET "${url.toString()}" \
              -H "anthropic-version: 2023-06-01" \
              -H "x-api-key: ${apiKey}"`;

            exec(curlCmd, (error, stdout, stderr) => {
                if (error) {
                    console.log('⚠️  Error fetching today\'s usage:', error.message);
                    resolve(null);
                    return;
                }

                if (!stdout || stdout.length === 0) {
                    console.log('⚠️  DEBUG: Empty response from today\'s usage API');
                    resolve(null);
                    return;
                }

                try {
                    const parsed = JSON.parse(stdout);
                    if (parsed.error && parsed.error.type) {
                        if (parsed.error.type === 'rate_limit_error') {
                            console.log('⚠️  Rate limit hit on today\'s usage API');
                            rateLimitHitCount++;
                            rateLimitBackoffMs = Math.min(5 * 60 * 1000, 60 * 1000 * rateLimitHitCount);
                        } else {
                            console.log('⚠️  API error on today\'s usage:', parsed.error.type, parsed.error.message);
                        }
                        resolve(null);
                        return;
                    }

                    const usageData = parsed;

                    console.log('   🔍 Today Raw API Response:', {
                        hasData: !!usageData.data,
                        keys: Object.keys(usageData).slice(0, 10),
                        error: usageData.error,
                        dataLength: usageData.data?.length
                    });

                    const { dailyBreakdown, totalTokens, totalCost: cost, perAgent, perModel } = extractDailyBreakdown(usageData, groupByAgent);

                    if (dailyBreakdown.length > 0) {
                        console.log('✅ Today\'s usage (minute buckets):', {
                            totalTokens: totalTokens.toLocaleString(),
                            cost: cost.toFixed(4),
                            minutes: dailyBreakdown.length,
                            agentKeys: groupByAgent ? Object.keys(perAgent).length : 'N/A'
                        });
                    } else {
                        console.log('✅ Today\'s usage: 0 tokens, $0.00 (no usage yet)');
                    }

                    resolve({ totalTokens, cost, perAgent, perModel });
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

// Get all-time costs (token-based calculation with per-model pricing)
function fetchAllTimeCosts(nextPage = null, groupByAgent = false, accumulatedPerAgent = null, accumulatedPerModel = null) {
    return new Promise((resolve) => {
        const apiKey = getEffectiveApiKey();

        if (!apiKey) {
            resolve(null);
            return;
        }

        try {
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
            url.searchParams.append('bucket_width', '1d');
            url.searchParams.append('limit', '31');
            url.searchParams.append('group_by[]', 'model');

            // When agents are configured, also group by api_key_id
            if (groupByAgent) {
                url.searchParams.append('group_by[]', 'api_key_id');
                agentsConfig.agents.forEach(a => {
                    url.searchParams.append('api_key_ids[]', a.apiKeyId);
                });
            }

            if (nextPage) {
                url.searchParams.append('page', nextPage);
            }

            console.log(`📊 Fetching all-time usage (2026-01-01 through yesterday)${nextPage ? ' (page: ' + nextPage + ')' : ''}${groupByAgent ? ' [per-agent]' : ''}...`);
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

                if (!stdout || stdout.length === 0) {
                    console.log('⚠️  DEBUG: Empty response from all-time usage API');
                    resolve(null);
                    return;
                }

                try {
                    const parsed = JSON.parse(stdout);
                    if (parsed.error && parsed.error.type) {
                        if (parsed.error.type === 'rate_limit_error') {
                            console.log('⚠️  Rate limit hit on all-time usage API');
                            rateLimitHitCount++;
                            rateLimitBackoffMs = Math.min(5 * 60 * 1000, 60 * 1000 * rateLimitHitCount);
                        } else {
                            console.log('⚠️  API error on all-time usage:', parsed.error.type, parsed.error.message);
                        }
                        resolve(null);
                        return;
                    }

                    const usageData = parsed;

                    console.log('   🔍 Raw API Response:', {
                        hasData: !!usageData.data,
                        keys: Object.keys(usageData).slice(0, 10),
                        error: usageData.error,
                        message: usageData.message,
                        dataLength: usageData.data?.length
                    });

                    const { dailyBreakdown, totalTokens: pageTokens, totalCost: pageCost, perAgent: pagePerAgent, perModel: pagePerModel } = extractDailyBreakdown(usageData, groupByAgent);

                    // Merge per-agent data across pages
                    const mergedPerAgent = accumulatedPerAgent || {};
                    if (groupByAgent) {
                        Object.entries(pagePerAgent).forEach(([keyId, data]) => {
                            if (!mergedPerAgent[keyId]) {
                                mergedPerAgent[keyId] = { tokens: 0, cost: 0, dailyCosts: {}, modelTokens: {} };
                            }
                            mergedPerAgent[keyId].tokens += data.tokens;
                            mergedPerAgent[keyId].cost += data.cost;
                            Object.entries(data.dailyCosts).forEach(([date, cost]) => {
                                mergedPerAgent[keyId].dailyCosts[date] =
                                    (mergedPerAgent[keyId].dailyCosts[date] || 0) + cost;
                            });
                            // Merge modelTokens across pages
                            Object.entries(data.modelTokens || {}).forEach(([model, tokens]) => {
                                mergedPerAgent[keyId].modelTokens[model] =
                                    (mergedPerAgent[keyId].modelTokens[model] || 0) + tokens;
                            });
                        });
                    }

                    // Merge per-model data across pages
                    const mergedPerModel = accumulatedPerModel || {};
                    Object.entries(pagePerModel).forEach(([model, tokens]) => {
                        mergedPerModel[model] = (mergedPerModel[model] || 0) + tokens;
                    });

                    console.log(`   API returned ${usageData.data?.length || 0} buckets`);

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

                    if (usageData.has_more && usageData.next_page) {
                        console.log(`📄 Paginating all-time usage (next_page: ${usageData.next_page})...`);
                        fetchAllTimeCosts(usageData.next_page, groupByAgent, mergedPerAgent, mergedPerModel).then((nextPageData) => {
                            if (nextPageData) {
                                const totalTokens = pageTokens + nextPageData.totalTokens;
                                const cost = pageCost + nextPageData.cost;

                                console.log('✅ All-time usage (complete):', {
                                    tokens: totalTokens.toLocaleString(),
                                    cost: cost.toFixed(2),
                                    pages: 'multiple'
                                });

                                resolve({ totalTokens, cost, perAgent: nextPageData.perAgent || mergedPerAgent, perModel: nextPageData.perModel || mergedPerModel });
                            }
                        });
                    } else {
                        console.log('✅ All-time usage:', {
                            tokens: pageTokens.toLocaleString(),
                            cost: pageCost.toFixed(2),
                            days: dailyBreakdown.length,
                            hasMore: usageData.has_more,
                            agentKeys: groupByAgent ? Object.keys(mergedPerAgent).length : 'N/A'
                        });

                        resolve({ totalTokens: pageTokens, cost: pageCost, perAgent: mergedPerAgent, perModel: mergedPerModel });
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

// ─── Project & Agent Detection ──────────────────────────────────────────────
let projectInfo = {
    name: path.basename(process.cwd()),
    path: process.cwd(),
    agentName: getAgentName()
};

function getAgentName() {
    if (process.env.OPENCLAW_AGENT) {
        console.log('✅ Agent name from ENV:', process.env.OPENCLAW_AGENT);
        return process.env.OPENCLAW_AGENT;
    }

    try {
        const configPath = path.join(process.env.HOME || '/Users/openclaw', '.openclaw/openclaw.json');

        if (!fs.existsSync(configPath)) {
            console.log('⚠️  Config not found at:', configPath);
            return path.basename(process.cwd());
        }

        const configFile = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configFile);

        const workspaceName = path.basename(process.cwd());
        const agentFromConfig = config.agents?.list?.find(a =>
            a.workspace?.includes(workspaceName) || a.id === workspaceName
        );

        if (agentFromConfig?.name) {
            console.log('✅ Agent name from config:', agentFromConfig.name);
            return agentFromConfig.name;
        }

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

    const fallback = path.basename(process.cwd());
    console.log('ℹ️  Using fallback agent name:', fallback);
    return fallback;
}

function detectActualModel() {
    try {
        const configPath = path.join(process.env.HOME || '/Users/openclaw', '.openclaw/openclaw.json');

        if (!fs.existsSync(configPath)) {
            return null;
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        const defaultModel = config.agents?.defaults?.model?.default ||
                            config.runtime?.model?.default ||
                            config.model?.default;

        if (!defaultModel) {
            return null;
        }

        const modelMap = {
            'anthropic/claude-haiku-4-5-20251001': { name: 'Haiku', version: 'claude-haiku-4-5-20251001', badge: 'haiku', costSavings: '80%' },
            'anthropic/claude-3-haiku-20240307': { name: 'Haiku', version: 'claude-3-haiku-20240307', badge: 'haiku', costSavings: '80%' },
            'anthropic/claude-sonnet-4-20250514': { name: 'Sonnet', version: 'claude-sonnet-4-20250514', badge: 'sonnet', costSavings: '0%' },
            'anthropic/claude-opus-4-6': { name: 'Opus', version: 'claude-opus-4-6', badge: 'opus', costSavings: '-50%' }
        };

        if (modelMap[defaultModel]) {
            console.log(`✅ Detected OpenClaw model from config: ${modelMap[defaultModel].name}`);
            return modelMap[defaultModel];
        }
    } catch (error) {
        console.log('ℹ️  Could not detect model from config:', error.message);
    }

    return null;
}

const detectedModel = detectActualModel();
if (detectedModel) {
    currentModel = detectedModel;
    console.log(`✅ Using model: ${currentModel.name}`);
}

// Periodically check for model changes
setInterval(() => {
    const newModel = detectActualModel();
    if (newModel && newModel.name !== currentModel.name) {
        console.log(`✅ Model changed: ${currentModel.name} → ${newModel.name}`);
        currentModel = newModel;
        broadcast({ type: 'modelUpdate', data: currentModel });
    }
}, 30000);

// ─── WebSocket connections ──────────────────────────────────────────────────
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('✅ Client connected. Total clients:', clients.size);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const apiKeySet = apiKey && apiKey !== 'your_anthropic_api_key_here' && apiKey.length > 10;

  ws.send(JSON.stringify({
    type: 'initial',
    data: {
      systemMetrics,
      gitLogs,
      fileTree,
      workQueue,
      openclawStatus,
      openclawStats,
      currentModel,
      backupMetrics,
      projectInfo,
      liveLogs,
      multiAgentLogs,
      tokenMetrics,
      modelUsagePercents: getModelUsagePercents(),
      agentCosts: getAgentCosts(),
      agentConfig: AGENT_CONFIG,
      agentsConfigured: agentsConfig.agents.length > 0,
      agentsList: (agentsConfig.agents || []).map(a => ({
        name: a.name, slug: a.slug, color: a.color, apiKeyId: a.apiKeyId
      })),
      gatewayStatus: 'connected',
      supabaseStatus: supabaseReady ? 'connected' : 'disconnected',
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

function broadcast(data) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ─── System Metrics ─────────────────────────────────────────────────────────
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

// ─── Git Logs ───────────────────────────────────────────────────────────────
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

function getCommitType(message) {
  const msg = message.toLowerCase();
  if (msg.includes('feat:') || msg.includes('feature')) return 'feat';
  if (msg.includes('fix:') || msg.includes('bug')) return 'fix';
  if (msg.includes('docs:') || msg.includes('doc')) return 'docs';
  if (msg.includes('refactor')) return 'refactor';
  if (msg.includes('test')) return 'test';
  return 'commit';
}

// ─── File Tree ──────────────────────────────────────────────────────────────
function updateFileTree() {
  const basePath = process.cwd();
  console.log('🌳 Building file tree for:', basePath);

  function buildTree(dirPath, depth = 0) {
    if (depth > 3) return null;

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

// ─── OpenClaw Status ────────────────────────────────────────────────────────
function checkOpenClawStatus() {
  exec('ps aux | grep -E "(openclaw|node.*gateway)" | grep -v grep | wc -l', (error, procCount) => {
    const processCount = parseInt(procCount.trim()) || 0;

    exec('ps aux | grep "gateway" | grep -v grep | head -1', (error, gatewayLine) => {
      const gatewayRunning = gatewayLine && gatewayLine.trim().length > 0;

      exec('ps aux | grep -E "(openclaw|node.*gateway)" | grep -v grep | awk \'{cpu+=$3; mem+=$4} END {print cpu, mem}\'', (error, stats) => {
        const [cpuUsage, memUsage] = stats.trim().split(' ') || ['0', '0'];

        openclawStatus = processCount > 0 ? 'active' : 'inactive';
        openclawStats = {
          status: openclawStatus,
          processCount: processCount,
          cpuUsage: parseFloat(cpuUsage).toFixed(1),
          memUsage: parseFloat(memUsage).toFixed(1),
          gatewayRunning: gatewayRunning
        };

        console.log(`✅ OpenClaw status: ${processCount} processes, CPU: ${cpuUsage}%, Memory: ${memUsage}%, Gateway: ${gatewayRunning ? 'running' : 'stopped'}`);

        broadcast({ type: 'openclawStatus', data: openclawStats });
      });
    });
  });
}

// ─── Work Queue ─────────────────────────────────────────────────────────────

// Broadcast work queue from in-memory cache (used by Realtime handler)
function updateWorkQueueFromCache() {
    workQueue = [...manualTasks];
    if (workQueue.length === 0) {
        workQueue = getDefaultWorkQueue();
    }
    broadcast({ type: 'workQueue', data: workQueue });
}

// Full work queue update: fetch cron jobs + combine with Supabase tasks
function updateWorkQueue() {
  exec('openclaw cron list 2>/dev/null || echo ""', (error, stdout, stderr) => {
    const cronTasks = [];

    if (!error && stdout && stdout.trim()) {
      const lines = stdout.split('\n').filter(line => line.trim());

      lines.forEach((line, index) => {
        if (index === 0 || !line.trim()) return;

        const parts = line.split(/\s+/);
        if (parts.length > 4) {
          cronTasks.push({
            id: `cron-${index}`,
            title: parts.slice(1, 4).join(' '),
            description: `Scheduled cron job: ${parts.slice(4).join(' ')}`,
            status: parts[parts.length - 2] === 'ok' ? 'ACTIVE' : 'QUEUE',
            progress: parts[parts.length - 2] === 'ok' ? 100 : 0,
            eta: 'Scheduled'
          });
        }
      });
    }

      // Combine Supabase tasks with cron jobs
      workQueue = [...manualTasks, ...cronTasks];

      if (workQueue.length === 0) {
        workQueue = getDefaultWorkQueue();
      }

      console.log('📋 Work queue updated:', cronTasks.length, 'cron jobs,', manualTasks.length, 'manual tasks');
      broadcast({ type: 'workQueue', data: workQueue });
  });
}

function getDefaultWorkQueue() {
  return [
    {
      id: 1,
      title: "No Active Tasks",
      description: "No tasks currently configured. Work queue shows tasks from all agents across machines.",
      status: "IDLE",
      progress: 0,
      eta: "Waiting"
    }
  ];
}

// Periodic Supabase sync (safety net - refresh from DB every 30s)
let lastSupabaseSync = 0;
async function syncTasksFromSupabase() {
    if (!supabaseReady) return;
    if (Date.now() - lastSupabaseSync < 30000) return; // Max once per 30s

    try {
        const freshTasks = await loadTasks();
        manualTasks = freshTasks;
        lastSupabaseSync = Date.now();
        console.log(`🔄 Synced ${manualTasks.length} tasks from Supabase`);
    } catch (err) {
        console.log('⚠️  Supabase sync error:', err.message);
    }
}

// ─── Token Metrics ──────────────────────────────────────────────────────────
async function updateTokenMetrics() {
  if (rateLimitBackoffMs > 0) {
    console.log(`⏸️  Rate limit backoff active - waiting ${Math.ceil(rateLimitBackoffMs / 1000)}s before next API call`);
    rateLimitBackoffMs -= 5000;
    return;
  }

  console.log('🔄 Updating cost metrics from Anthropic APIs...');

  const hasAgents = agentsConfig.agents && agentsConfig.agents.length > 0;

  const todaysData = await fetchTodaysUsage(hasAgents);
  const allTimeCosts = await fetchAllTimeCosts(null, hasAgents);

  if (todaysData) {
    tokenMetrics.today = {
      tokens: todaysData.totalTokens,
      cost: todaysData.cost
    };
  }

  if (allTimeCosts) {
    tokenMetrics.allTime.total.cost = allTimeCosts.cost;
  }

  // Per-agent cost tracking
  if (hasAgents && (todaysData || allTimeCosts)) {
    const agentBreakdown = {};

    agentsConfig.agents.forEach(agent => {
      const keyId = agent.apiKeyId;
      const todayAgentData = todaysData?.perAgent?.[keyId];
      const allTimeAgentData = allTimeCosts?.perAgent?.[keyId];

      // Calculate estimated daily from 7-day rolling average
      const dailyCosts = allTimeAgentData?.dailyCosts || {};
      const costValues = Object.values(dailyCosts);
      const daysCount = Math.min(costValues.length, 7);
      const recentCosts = costValues.slice(-daysCount);
      const estimatedDaily = daysCount > 0
        ? recentCosts.reduce((a, b) => a + b, 0) / daysCount
        : 0;

      // Per-agent model breakdown: merge allTime + today modelTokens
      const agentModelTokens = { ...(allTimeAgentData?.modelTokens || {}) };
      Object.entries(todayAgentData?.modelTokens || {}).forEach(([m, t]) => {
        agentModelTokens[m] = (agentModelTokens[m] || 0) + t;
      });
      const agentTotalTokens = Object.values(agentModelTokens).reduce((a, b) => a + b, 0);
      const models = {};
      Object.entries(agentModelTokens).forEach(([model, tokens]) => {
        models[model] = agentTotalTokens > 0 ? Math.round((tokens / agentTotalTokens) * 100) : 0;
      });

      const slug = agent.slug || agent.name.toLowerCase();
      agentBreakdown[slug] = {
        name: agent.name,
        color: agent.color || AGENT_CONFIG[slug]?.color || '#007acc',
        today: todayAgentData?.cost || 0,
        allTime: (allTimeAgentData?.cost || 0) + (todayAgentData?.cost || 0),
        estimatedDaily: estimatedDaily,
        todayTokens: todayAgentData?.tokens || 0,
        models: models
      };
    });

    tokenMetrics.perAgent = agentBreakdown;
    console.log('👥 Per-agent costs:', Object.entries(agentBreakdown).map(([slug, d]) =>
      `${d.name}: today=$${d.today.toFixed(4)}, allTime=$${d.allTime.toFixed(2)}, est=$${d.estimatedDaily.toFixed(2)}/d, models=${JSON.stringify(d.models)}`
    ).join(', '));
  }

  // Global model breakdown from API data (replaces legacy getModelUsagePercents when available)
  const allTimePerModel = allTimeCosts?.perModel || {};
  const todayPerModel = todaysData?.perModel || {};
  const globalModelTokens = { ...allTimePerModel };
  Object.entries(todayPerModel).forEach(([model, tokens]) => {
    globalModelTokens[model] = (globalModelTokens[model] || 0) + tokens;
  });
  const globalTotalTokens = Object.values(globalModelTokens).reduce((a, b) => a + b, 0);
  if (globalTotalTokens > 0) {
    const modelBreakdown = {};
    Object.entries(globalModelTokens).forEach(([model, tokens]) => {
      modelBreakdown[model] = Math.round((tokens / globalTotalTokens) * 100);
    });
    tokenMetrics.modelBreakdown = modelBreakdown;
    console.log('📊 Global model breakdown:', Object.entries(modelBreakdown).map(([m, p]) => `${m}:${p}%`).join(', '));
  }

  if (todaysData && allTimeCosts) {
    rateLimitHitCount = 0;
    rateLimitBackoffMs = 0;
    console.log('✅ Rate limit counter reset - API calls successful');
  }

  if (todaysData || allTimeCosts) {
    console.log('💰 Real costs from Anthropic APIs:', {
      today: todaysData ? `$${todaysData.cost.toFixed(4)}` : 'N/A',
      allTime: allTimeCosts ? `$${allTimeCosts.cost.toFixed(2)}` : 'N/A'
    });
  } else {
    console.log('💰 Cost metrics updated (Anthropic APIs unavailable)');
  }

  tokenMetrics.lastUpdated = new Date();
  broadcast({ type: 'tokenMetrics', data: tokenMetrics });
}

// ─── Live Logs ──────────────────────────────────────────────────────────────
let liveLogs = [];
let multiAgentLogs = {};

function updateLiveLogs() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  exec('tail -100 /Users/openclaw/.openclaw/logs/gateway.log 2>/dev/null || tail -100 /tmp/openclaw/openclaw-*.log 2>/dev/null || echo ""',
    (error, stdout, stderr) => {
      if (stdout && stdout.trim()) {
        liveLogs = stdout.split('\n')
          .filter(line => line.trim())
          .map((line, index) => {
            let level = 'info';
            if (line.includes('ERROR') || line.includes('error')) level = 'error';
            else if (line.includes('WARN') || line.includes('warn')) level = 'warning';
            else if (line.includes('DEBUG') || line.includes('debug')) level = 'debug';

            let agent = 'unknown';
            const agentMatch = line.match(/\[(\w+)\]/);
            if (agentMatch) {
              const possibleAgent = agentMatch[1].toLowerCase();
              if (AGENT_CONFIG[possibleAgent]) {
                agent = possibleAgent;
              }
            }

            const isoMatch = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
            let logTime = new Date();
            if (isoMatch) {
              logTime = new Date(isoMatch[0]);
            }

            return {
              level,
              message: line,
              timestamp: logTime.toISOString(),
              agent,
              logTime
            };
          })
          .filter(log => log.logTime >= tenMinutesAgo)
          .reverse()
          .slice(0, 20);

        if (liveLogs.length === 0) {
          liveLogs = [{
            level: 'info',
            message: 'No activity in the last 10 minutes - all agents resting',
            timestamp: new Date().toISOString(),
            agent: 'system'
          }];
        }

        multiAgentLogs = {};
        liveLogs.forEach(log => {
          if (!multiAgentLogs[log.agent]) {
            multiAgentLogs[log.agent] = [];
          }
          multiAgentLogs[log.agent].push(log);
        });

        console.log('📋 Live logs updated:', liveLogs.length, 'entries (filtered to last 10 min)');
        broadcast({ type: 'liveLogs', data: liveLogs });
        broadcast({ type: 'multiAgentLogs', data: multiAgentLogs });
      }
    });
}

// ─── Periodic updates ───────────────────────────────────────────────────────
setInterval(updateSystemMetrics, 1000);
setInterval(updateGitLogs, 30000);
setInterval(updateFileTree, 60000);
setInterval(checkOpenClawStatus, 10000);
setInterval(updateWorkQueue, 5000);
setInterval(updateLiveLogs, 3000);
setInterval(updateTokenMetrics, 5 * 60 * 1000);
setInterval(sendHeartbeat, 30000);  // Agent heartbeat every 30s
setInterval(syncTasksFromSupabase, 30000);  // Safety sync from Supabase every 30s

// ─── File watcher ───────────────────────────────────────────────────────────
const watcher = chokidar.watch('.', {
  ignored: /(^|[\/\\])\..|node_modules/,
  persistent: true
});

watcher.on('change', () => {
  setTimeout(updateFileTree, 1000);
});

// ─── REST API Routes ────────────────────────────────────────────────────────

// Update current model
app.post('/api/model/switch', (req, res) => {
  const { model } = req.body;

  const modelConfig = {
    'haiku': { name: 'Haiku', version: 'claude-3-haiku-20240307', badge: 'haiku', costSavings: '80%' },
    'sonnet': { name: 'Sonnet', version: 'claude-sonnet-4-20250514', badge: 'sonnet', costSavings: '0%' },
    'opus': { name: 'Opus', version: 'claude-opus-4-6', badge: 'opus', costSavings: '-50%' }
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

  if (Object.keys(configToSave).length > 0) {
    const currentConfig = loadConfig() || {};
    const updatedConfig = { ...currentConfig, ...configToSave };
    saveConfig(updatedConfig);
  }

  const isConfigured = process.env.ANTHROPIC_API_KEY &&
                       process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here' &&
                       process.env.ANTHROPIC_API_KEY.length > 10;

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

app.get('/api/anthropic/config', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isConfigured = apiKey && apiKey !== 'your_anthropic_api_key_here' && apiKey.length > 10;

  res.json({
    endpoint: process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com/v1/usage',
    apiKeySet: isConfigured
  });
});

// ─── Agent Configuration API (Multi-Agent Key Management) ────────────────────

// Get current agents configuration
app.get('/api/agents/config', (req, res) => {
    const masked = agentsConfig.adminApiKey
        ? '****' + agentsConfig.adminApiKey.slice(-8)
        : null;

    res.json({
        adminKeySet: !!agentsConfig.adminApiKey,
        adminKeyMasked: masked,
        agents: (agentsConfig.agents || []).map(a => ({
            name: a.name,
            slug: a.slug,
            apiKeyId: a.apiKeyId,
            color: a.color,
            addedAt: a.addedAt
        }))
    });
});

// Save admin key and/or full agents list
app.post('/api/agents/configure', (req, res) => {
    const { adminApiKey, agents } = req.body;

    if (adminApiKey) {
        agentsConfig.adminApiKey = adminApiKey;
        // Also set as legacy API key for backward compat
        process.env.ANTHROPIC_API_KEY = adminApiKey;
        console.log('✅ Admin API key updated');
    }

    if (agents && Array.isArray(agents)) {
        agentsConfig.agents = agents.map(a => ({
            name: a.name,
            slug: (a.slug || a.name.toLowerCase()).replace(/[^a-z0-9]/g, ''),
            apiKeyId: a.apiKeyId,
            color: a.color || DEFAULT_AGENT_CONFIG[a.name?.toLowerCase()]?.color || '#007acc',
            addedAt: a.addedAt || new Date().toISOString()
        }));
    }

    saveAgentsConfig(agentsConfig);
    rebuildApiKeyIdMap();

    // Broadcast updated agent config
    broadcast({
        type: 'agentConfigUpdate',
        data: {
            agentConfig: AGENT_CONFIG,
            agentCount: agentsConfig.agents.length
        }
    });

    // Trigger immediate cost refresh
    setTimeout(updateTokenMetrics, 2000);

    res.json({ success: true, agentCount: agentsConfig.agents.length });
});

// Add a single agent
app.post('/api/agents/add', (req, res) => {
    const { name, apiKeyId, color } = req.body;

    if (!name || !apiKeyId) {
        return res.status(400).json({ error: 'name and apiKeyId are required' });
    }

    // Check for duplicate
    if (agentsConfig.agents.find(a => a.apiKeyId === apiKeyId)) {
        return res.status(409).json({ error: 'Agent with this API key ID already exists' });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const agent = {
        name,
        slug,
        apiKeyId,
        color: color || DEFAULT_AGENT_CONFIG[slug]?.color || '#007acc',
        addedAt: new Date().toISOString()
    };

    agentsConfig.agents.push(agent);
    saveAgentsConfig(agentsConfig);
    rebuildApiKeyIdMap();

    console.log(`✅ Agent added: ${name} (key: ${apiKeyId.slice(0, 12)}...)`);

    // Trigger cost refresh
    setTimeout(updateTokenMetrics, 2000);

    res.json({ success: true, agent });
});

// Remove an agent by apiKeyId
app.post('/api/agents/remove', (req, res) => {
    const { apiKeyId } = req.body;
    const idx = agentsConfig.agents.findIndex(a => a.apiKeyId === apiKeyId);

    if (idx === -1) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const removed = agentsConfig.agents.splice(idx, 1)[0];
    saveAgentsConfig(agentsConfig);
    rebuildApiKeyIdMap();

    console.log(`✅ Agent removed: ${removed.name}`);

    res.json({ success: true, removed });
});

// Lookup org API keys via Anthropic Admin API
app.get('/api/agents/list-org-keys', (req, res) => {
    const adminKey = agentsConfig.adminApiKey;
    if (!adminKey) {
        return res.status(400).json({ error: 'Admin API key not configured' });
    }

    exec(`curl -s -X GET "https://api.anthropic.com/v1/organizations/api_keys" \
        -H "anthropic-version: 2023-06-01" \
        -H "x-api-key: ${adminKey}"`, (error, stdout) => {
        if (error) {
            return res.status(500).json({ error: 'Failed to fetch org keys' });
        }
        try {
            const data = JSON.parse(stdout);
            if (data.error) {
                return res.status(400).json({ error: data.error.message || 'API error' });
            }
            // Return only ID and name (never expose full key values)
            const keys = (data.data || []).map(k => ({
                id: k.id,
                name: k.name,
                status: k.status,
                created_at: k.created_at
            }));
            res.json({ success: true, keys });
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse response' });
        }
    });
});

// ─── Task Management API (Supabase-backed) ──────────────────────────────────

app.post('/api/tasks/add', async (req, res) => {
  const { title, description, status, agent } = req.body;

  if (!title || !description || !status) {
    return res.status(400).json({ error: 'Missing required fields: title, description, status' });
  }

  const taskAgent = agent || projectInfo.agentName;
  const taskMachine = os.hostname();

  if (supabaseReady) {
    try {
      const { data, error } = await supabase.from('tasks').insert({
        title,
        description,
        status: status.toUpperCase(),
        progress: status.toUpperCase() === 'IN_PROGRESS' ? 50 : 0,
        eta: 'Agent-generated',
        agent: taskAgent,
        machine: taskMachine
      }).select().single();

      if (error) throw error;

      const newTask = {
        id: data.id,
        title: data.title,
        description: data.description,
        status: data.status,
        progress: data.progress,
        eta: data.eta,
        agent: data.agent,
        machine: data.machine,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      };

      manualTasks.unshift(newTask);
      console.log(`✅ Task added to Supabase: "${title}" by ${taskAgent}@${taskMachine}`);

      // Log audit event
      logTaskEvent(data.id, taskAgent, 'created', { title, status: data.status });

      updateWorkQueue();
      return res.json({ success: true, task: newTask });
    } catch (err) {
      console.log('⚠️  Supabase task insert error, falling back to memory:', err.message);
    }
  }

  // Fallback: in-memory only
  const newTask = {
    id: Date.now(),
    title,
    description,
    status: status.toUpperCase(),
    progress: status.toUpperCase() === 'IN_PROGRESS' ? 50 : 0,
    eta: 'Agent-generated',
    agent: taskAgent,
    machine: taskMachine,
    createdAt: new Date().toISOString()
  };

  manualTasks.unshift(newTask);
  console.log('✅ Task added (in-memory):', title);
  updateWorkQueue();

  res.json({ success: true, task: newTask });
});

app.post('/api/tasks/update/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, status, progress } = req.body;

  if (supabaseReady) {
    try {
      const updates = {};
      if (title) updates.title = title;
      if (description) updates.description = description;
      if (status) updates.status = status.toUpperCase();
      if (progress !== undefined) updates.progress = progress;

      const { data, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Update in-memory cache
      const idx = manualTasks.findIndex(t => t.id == id);
      if (idx !== -1) {
        if (title) manualTasks[idx].title = title;
        if (description) manualTasks[idx].description = description;
        if (status) manualTasks[idx].status = status.toUpperCase();
        if (progress !== undefined) manualTasks[idx].progress = progress;
        manualTasks[idx].updatedAt = data.updated_at;
      }

      console.log(`✅ Task updated in Supabase: ${id}`);

      // Log audit event
      logTaskEvent(parseInt(id), null, 'updated', { changes: updates });

      updateWorkQueue();
      return res.json({ success: true, task: data });
    } catch (err) {
      console.log('⚠️  Supabase task update error:', err.message);
    }
  }

  // Fallback: in-memory
  const task = manualTasks.find(t => t.id == id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (title) task.title = title;
  if (description) task.description = description;
  if (status) task.status = status.toUpperCase();
  if (progress !== undefined) task.progress = progress;

  console.log('✅ Task updated (in-memory):', id);
  updateWorkQueue();

  res.json({ success: true, task });
});

app.post('/api/tasks/delete/:id', async (req, res) => {
  const { id } = req.params;

  if (supabaseReady) {
    try {
      // Log audit event before deletion
      logTaskEvent(parseInt(id), null, 'deleted', {});

      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id);

      if (error) throw error;

      const idx = manualTasks.findIndex(t => t.id == id);
      let removed = null;
      if (idx !== -1) {
        removed = manualTasks.splice(idx, 1)[0];
      }

      console.log(`✅ Task deleted from Supabase: ${id}`);
      updateWorkQueue();
      return res.json({ success: true, removed });
    } catch (err) {
      console.log('⚠️  Supabase task delete error:', err.message);
    }
  }

  // Fallback: in-memory
  const index = manualTasks.findIndex(t => t.id == id);
  if (index === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const removed = manualTasks.splice(index, 1);
  console.log('✅ Task deleted (in-memory):', id);
  updateWorkQueue();

  res.json({ success: true, removed: removed[0] });
});

// ─── Analytics API ──────────────────────────────────────────────────────────
app.get('/api/analytics/model-usage', (req, res) => {
  const usage = getModelUsagePercents();
  res.json({ success: true, data: usage });
});

app.get('/api/analytics/agent-costs', (req, res) => {
  const costs = getAgentCosts();
  res.json({ success: true, data: costs });
});

app.post('/api/analytics/track-model', (req, res) => {
  const { agent, model, tokens, cost } = req.body;

  if (!agent || !model || tokens === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  trackModelUsage(agent, model, tokens, cost || 0);
  res.json({ success: true, message: 'Model usage tracked' });
});

app.get('/api/analytics/history', (req, res) => {
  res.json({ success: true, data: modelHistory });
});

// Task events history (perpetual audit log)
app.get('/api/tasks/events', async (req, res) => {
  if (!supabaseReady) {
    return res.json({ success: true, data: [] });
  }

  try {
    const { data, error } = await supabase
      .from('task_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent sessions
app.get('/api/agents/sessions', async (req, res) => {
  if (!supabaseReady) {
    return res.json({ success: true, data: [] });
  }

  try {
    const { data, error } = await supabase
      .from('agent_sessions')
      .select('*')
      .order('last_heartbeat', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Status API ─────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connected_clients: clients.size,
    currentModel,
    backupMetrics,
    projectInfo,
    supabase: supabaseReady ? 'connected' : 'disconnected'
  });
});

app.get('/api/metrics', (req, res) => {
  res.json(systemMetrics);
});

app.get('/api/logs', (req, res) => {
  const logs = [
    { level: 'info', message: 'OpenClaw gateway running on port 18789', timestamp: new Date().toISOString() },
    { level: 'info', message: 'Atlas agent session active', timestamp: new Date().toISOString() },
    { level: 'debug', message: 'Token usage: Haiku vs Sonnet optimization active', timestamp: new Date().toISOString() }
  ];
  res.json(logs);
});

// ─── Async Startup ──────────────────────────────────────────────────────────
async function startServer() {
    console.log('📊 Running async initialization...');

    // Test Supabase connection
    if (supabase) {
        supabaseReady = await testSupabaseConnection();
    }

    // Load data from Supabase (or fallback to files)
    manualTasks = await loadTasks();
    modelHistory = await loadModelHistory();

    // Migrate file data to Supabase on first run
    if (supabaseReady) {
        await migrateFileDataToSupabase();
        setupRealtimeSubscription();
        sendHeartbeat(); // Initial heartbeat
    }

    // Run initial updates
    updateSystemMetrics();
    updateGitLogs();
    updateFileTree();
    checkOpenClawStatus();
    updateWorkQueue();
    updateTokenMetrics();

    console.log('🎯 Server startup complete');
    console.log('   Project Info:', projectInfo);
    console.log('   Supabase:', supabaseReady ? '✅ Connected' : '⚠️ Disconnected (using file fallback)');
    console.log('   Machine:', os.hostname());

    const PORT = process.env.PORT || 4002;
    server.listen(PORT, () => {
        console.log(`🚀 Atlas Simple Dashboard running on port ${PORT}`);
        console.log(`📊 Dashboard: http://localhost:${PORT}`);
    });
}

startServer();
