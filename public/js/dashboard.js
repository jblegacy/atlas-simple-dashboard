// Dashboard WebSocket connection
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let allTasks = [];
let currentTab = 'ACTIVE';

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    setupTabButtons();
    setupApiModal();
    checkApiStatus();
});

// Setup tab buttons
function setupTabButtons() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active button
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update current tab and rerender
            currentTab = btn.dataset.tab;
            filterAndRenderWorkQueue();
        });
    });
}

// Setup API Modal (tabbed: Admin Key + Agent Keys)
function setupApiModal() {
    const modal = document.getElementById('api-modal');
    const apiStatus = document.getElementById('api-status');
    const closeBtn = document.getElementById('modal-close');
    const cancelBtn = document.getElementById('btn-cancel');
    const saveBtn = document.getElementById('btn-save-api');
    const addAgentBtn = document.getElementById('btn-add-agent');
    const lookupBtn = document.getElementById('btn-lookup-keys');

    // Modal tab switching
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.modalTab}`).classList.add('active');
        });
    });

    // Open modal
    apiStatus?.addEventListener('click', async () => {
        modal.style.display = 'flex';
        await loadAgentsConfigIntoModal();
        document.getElementById('admin-key-input')?.focus();
    });

    // Close modal
    const closeModal = () => {
        modal.style.display = 'none';
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Save admin key + endpoint
    saveBtn?.addEventListener('click', async () => {
        const adminKey = document.getElementById('admin-key-input').value.trim();
        const endpoint = document.getElementById('api-endpoint-input').value.trim();

        if (!adminKey) {
            alert('Please enter an admin API key');
            return;
        }

        try {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            // Save to agents config
            await fetch('/api/agents/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminApiKey: adminKey })
            });

            // Also save to legacy endpoint for backward compat
            await fetch('/api/anthropic/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: adminKey,
                    endpoint: endpoint || undefined
                })
            });

            console.log('✅ Admin key saved');
            closeModal();
            checkApiStatus();
            setTimeout(() => alert('Admin key saved! Cost metrics will refresh shortly.'), 300);
        } catch (error) {
            console.error('Error saving admin key:', error);
            alert('Error saving admin key');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Configuration';
        }
    });

    // Add agent
    addAgentBtn?.addEventListener('click', async () => {
        const name = document.getElementById('new-agent-name').value.trim();
        const apiKeyId = document.getElementById('new-agent-keyid').value.trim();

        if (!name || !apiKeyId) {
            alert('Both agent name and API key ID are required');
            return;
        }

        try {
            const resp = await fetch('/api/agents/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, apiKeyId })
            });

            if (resp.ok) {
                document.getElementById('new-agent-name').value = '';
                document.getElementById('new-agent-keyid').value = '';
                await loadAgentsConfigIntoModal();
            } else {
                const err = await resp.json();
                alert(err.error || 'Failed to add agent');
            }
        } catch (error) {
            console.error('Error adding agent:', error);
            alert('Error adding agent');
        }
    });

    // Lookup org keys
    lookupBtn?.addEventListener('click', async () => {
        lookupBtn.textContent = 'Loading...';
        lookupBtn.disabled = true;
        try {
            const resp = await fetch('/api/agents/list-org-keys');
            if (resp.ok) {
                const data = await resp.json();
                renderOrgKeysDropdown(data.keys);
            } else {
                const err = await resp.json();
                alert(err.error || 'Failed to fetch org keys');
            }
        } catch (error) {
            alert('Error fetching org keys');
        } finally {
            lookupBtn.textContent = 'Lookup Org Keys (via Admin API)';
            lookupBtn.disabled = false;
        }
    });

    // Enter key support
    document.getElementById('admin-key-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveBtn?.click();
    });
    document.getElementById('new-agent-keyid')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addAgentBtn?.click();
    });
}

// Load agents config into modal
async function loadAgentsConfigIntoModal() {
    try {
        const resp = await fetch('/api/agents/config');
        const config = await resp.json();

        // Admin key status
        const statusEl = document.getElementById('admin-key-status');
        if (statusEl) {
            if (config.adminKeySet) {
                statusEl.innerHTML = `<span style="color: var(--accent-green);">Admin key configured (${config.adminKeyMasked})</span>`;
            } else {
                statusEl.innerHTML = `<span style="color: var(--accent-red);">No admin key configured</span>`;
            }
        }

        // Show/hide lookup section
        const lookupSection = document.getElementById('agent-lookup-section');
        if (lookupSection) {
            lookupSection.style.display = config.adminKeySet ? 'block' : 'none';
        }

        // Render agent entries
        const listEl = document.getElementById('agent-entries-list');
        if (!listEl) return;

        let html = '';
        (config.agents || []).forEach(agent => {
            html += `
                <div class="agent-entry">
                    <span class="agent-dot" style="background: ${agent.color || '#007acc'};"></span>
                    <span class="agent-entry-name">${escapeHtml(agent.name)}</span>
                    <span class="agent-entry-keyid">${escapeHtml(agent.apiKeyId)}</span>
                    <button class="btn-remove-agent" data-keyid="${escapeHtml(agent.apiKeyId)}">&times;</button>
                </div>
            `;
        });
        listEl.innerHTML = html || '<div class="help-text">No agents configured. Add agents below.</div>';

        // Bind remove buttons
        listEl.querySelectorAll('.btn-remove-agent').forEach(btn => {
            btn.addEventListener('click', async () => {
                const keyId = btn.dataset.keyid;
                try {
                    await fetch('/api/agents/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ apiKeyId: keyId })
                    });
                    await loadAgentsConfigIntoModal();
                } catch (error) {
                    console.error('Error removing agent:', error);
                }
            });
        });
    } catch (error) {
        console.error('Error loading agents config:', error);
    }
}

// Render org keys dropdown for selection
function renderOrgKeysDropdown(keys) {
    const dropdown = document.getElementById('org-keys-dropdown');
    if (!dropdown) return;

    if (!keys || keys.length === 0) {
        dropdown.innerHTML = '<div class="help-text">No API keys found in organization</div>';
        dropdown.style.display = 'block';
        return;
    }

    let html = '';
    keys.forEach(key => {
        html += `
            <div class="org-key-item" data-keyid="${escapeHtml(key.id)}" data-keyname="${escapeHtml(key.name || 'Unnamed')}">
                <span class="org-key-name">${escapeHtml(key.name || 'Unnamed')}</span>
                <span class="org-key-id">${escapeHtml(key.id)}</span>
            </div>
        `;
    });
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    // Click to populate fields
    dropdown.querySelectorAll('.org-key-item').forEach(item => {
        item.addEventListener('click', () => {
            document.getElementById('new-agent-name').value = item.dataset.keyname;
            document.getElementById('new-agent-keyid').value = item.dataset.keyid;
            dropdown.style.display = 'none';
        });
    });
}

// Check if API is configured
async function checkApiStatus() {
    try {
        const response = await fetch('/api/anthropic/config');
        const config = await response.json();
        
        console.log('📡 API Status:', config);
        
        if (config.apiKeySet) {
            updateApiStatus(true);
        } else {
            updateApiStatus(false);
        }
    } catch (error) {
        console.error('Error checking API status:', error);
        updateApiStatus(false);
    }
}

// Update API status indicator
function updateApiStatus(isActive) {
    const apiStatus = document.getElementById('api-status');
    const setupBtn = document.getElementById('api-setup-btn');
    const statusSpan = apiStatus?.querySelector('span');
    
    if (isActive) {
        console.log('✅ API is now ACTIVE');
        if (apiStatus) apiStatus.classList.add('active');
        if (statusSpan) statusSpan.textContent = 'API Active';
        if (setupBtn) setupBtn.style.display = 'none';
    } else {
        console.log('⚠️  API is INACTIVE');
        if (apiStatus) apiStatus.classList.remove('active');
        if (statusSpan) statusSpan.textContent = 'API Inactive';
        if (setupBtn) setupBtn.style.display = 'block';
    }
}

// WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        updateConnectionStatus(true);
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus(false);
        
        // Attempt reconnection
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            setTimeout(() => {
                console.log(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);
                connectWebSocket();
            }, 3000);
        }
    };
}

// Handle WebSocket messages
function handleMessage(data) {
    console.log('📥 Received message type:', data.type);
    switch(data.type) {
        case 'initial':
            console.log('📋 Initial data received:', data.data);
            updateAllData(data.data);
            break;
        case 'systemMetrics':
            updateSystemMetrics(data.data);
            break;
        case 'gitLogs':
            updateGitLogs(data.data);
            break;
        case 'fileTree':
            updateFileTreeUI(data.data);
            break;
        case 'workQueue':
            updateWorkQueueUI(data.data);
            break;
        case 'openclawStatus':
            updateOpenClawStatus(data.data);
            break;
        case 'openclawStats':
            updateOpenClawStatus(data.data);
            break;
        case 'modelUpdate':
            updateModelDisplay(data.data);
            break;
        case 'backupMetrics':
            updateBackupMetrics(data.data);
            break;
        case 'liveLogs':
            updateLiveLogsDisplay(data.data);
            break;
        case 'gatewayStatus':
            updateGatewayStatus(data.data);
            break;
        case 'tokenMetrics':
            updateTokenMetricsDisplay(data.data);
            break;
        case 'apiStatus':
            updateApiStatus(data.data.apiKeySet);
            break;
        case 'agentConfigUpdate':
            if (data.data.agentConfig) {
                window.agentConfig = data.data.agentConfig;
            }
            break;
    }
}

// Update all data on initial connection
function updateAllData(data) {
    updateSystemMetrics(data.systemMetrics);
    updateGitLogs(data.gitLogs);
    updateFileTreeUI(data.fileTree, data.projectInfo);
    updateWorkQueueUI(data.workQueue);
    
    // Use openclawStats if available, otherwise fall back to openclawStatus
    if (data.openclawStats) {
        updateOpenClawStatus(data.openclawStats);
    } else {
        updateOpenClawStatus(data.openclawStatus);
    }
    
    updateModelDisplay(data.currentModel);
    updateProjectInfo(data.projectInfo);
    updateAgentName(data.projectInfo);
    updateLiveLogsDisplay(data.liveLogs);
    updateGatewayStatus(data.gatewayStatus);
    updateTokenMetricsDisplay(data.tokenMetrics);
    
    // Multi-agent analytics
    if (data.modelUsagePercents) {
        updateModelUsageDisplay(data.modelUsagePercents);
    }
    if (data.agentCosts) {
        updateAgentCostsDisplay(data.agentCosts);
    }
    
    // Store agent config globally
    if (data.agentConfig) {
        window.agentConfig = data.agentConfig;
    }

    // Store agents list for modal
    if (data.agentsList) {
        window.agentsList = data.agentsList;
    }
    
    // Check API status if provided
    if (data.apiStatus) {
        updateApiStatus(data.apiStatus.apiKeySet);
    } else {
        checkApiStatus();
    }
}

// Update system metrics display
function updateSystemMetrics(metrics) {
    if (!metrics) return;
    
    // CPU (2 decimal places)
    const cpuValue = `${parseFloat(metrics.cpu).toFixed(2)}% (${(parseFloat(metrics.cpu) / 4).toFixed(2)}%)`;
    document.getElementById('cpu-value').textContent = cpuValue;
    
    // Memory (2 decimal places)
    if (metrics.memory) {
        const memValue = `${parseFloat(metrics.memory.used).toFixed(2)}GB (${parseFloat(metrics.memory.percentage).toFixed(2)}%)`;
        document.getElementById('memory-value').textContent = memValue;
        const memCard = document.querySelector('.stat-card.memory');
        if (memCard) {
            const memPercent = parseFloat(metrics.memory.percentage);
            memCard.style.borderLeftColor = memPercent > 80 ? '#ff6b6b' : '#dcdcaa';
        }
    }
    
    // Disk (2 decimal places)
    if (metrics.disk) {
        const diskValue = `${parseFloat(metrics.disk.used).toFixed(2)}GB (${parseFloat(metrics.disk.percentage).toFixed(2)}%)`;
        document.getElementById('disk-value').textContent = diskValue;
    }
    
    // Uptime
    if (metrics.uptime) {
        const uptimeValue = `${metrics.uptime.days}d ${metrics.uptime.hours}h${metrics.uptime.minutes}m`;
        document.getElementById('uptime-value').textContent = uptimeValue;
    }
}

// Update git logs display
function updateGitLogs(logs) {
    const gitLogDiv = document.getElementById('git-log');
    
    if (!logs || logs.length === 0) {
        gitLogDiv.innerHTML = '<div class="loading">No commits found</div>';
        return;
    }
    
    let html = '';
    logs.forEach(log => {
        html += `
            <div class="git-entry ${log.type}">
                <div class="git-hash">${log.hash}</div>
                <div class="git-message">${escapeHtml(log.message)}</div>
            </div>
        `;
    });
    
    gitLogDiv.innerHTML = html;
}

// Update file tree display
function updateFileTreeUI(tree, projectInfo) {
    const fileTreeDiv = document.getElementById('file-tree');
    
    if (!tree || Object.keys(tree).length === 0) {
        fileTreeDiv.innerHTML = '<div class="loading">No files</div>';
        return;
    }
    
    const html = renderFileTree(tree, 0);
    fileTreeDiv.innerHTML = html;
    
    // Update the file tree path header
    if (projectInfo) {
        updateProjectInfo(projectInfo);
    }
}

// Render file tree recursively
function renderFileTree(tree, depth) {
    if (depth > 3) return '';
    
    let html = '';
    for (const [name, value] of Object.entries(tree)) {
        if (value === 'file') {
            html += `<div class="file-tree-item file indent-${depth}">${escapeHtml(name)}</div>`;
        } else if (typeof value === 'object') {
            html += `<div class="file-tree-item dir indent-${depth}">📁 ${escapeHtml(name)}</div>`;
            html += renderFileTree(value, depth + 1);
        }
    }
    return html;
}

// Update work queue display - store all tasks
function updateWorkQueueUI(queue) {
    allTasks = queue || [];
    filterAndRenderWorkQueue();
    updateQueueStatus();
}

// Update queue status indicator (thinking vs resting)
function updateQueueStatus() {
    const statusEl = document.getElementById('queue-status');
    if (!statusEl) return;
    
    // Check if there are any active/in-progress tasks
    const hasActiveTasks = allTasks.some(task => 
        task.status === 'ACTIVE' || task.status === 'IN_PROGRESS'
    );
    
    if (hasActiveTasks) {
        statusEl.textContent = 'Atlas thinking...';
    } else {
        statusEl.textContent = 'Atlas resting';
    }
}

// Filter tasks by current tab and render with smooth updates
function filterAndRenderWorkQueue() {
    const workQueueDiv = document.getElementById('work-queue');
    
    if (!allTasks || allTasks.length === 0) {
        smoothSetHTML(workQueueDiv, '<div class="loading">No tasks</div>');
        return;
    }
    
    // Filter tasks by current tab
    const filteredTasks = allTasks.filter(item => item.status === currentTab);
    
    if (filteredTasks.length === 0) {
        smoothSetHTML(workQueueDiv, `<div class="loading">No ${currentTab.toLowerCase()} tasks</div>`);
        return;
    }
    
    let html = '';
    filteredTasks.forEach(item => {
        const isManualTask = item.createdAt; // Manual tasks have createdAt
        const statusClass = item.status.toLowerCase();
        
        // Extract agent from eta or metadata (currently shows "Atlas-generated")
        let agentClass = 'agent-atlas'; // default
        let agentBadge = '';
        
        if (item.eta && item.eta.includes('generated')) {
            // Extract agent from task (if stored in metadata)
            if (item.agent) {
                const agentName = item.agent.toLowerCase();
                agentClass = `agent-${agentName}`;
                agentBadge = `<span class="agent-badge ${agentName}">${item.agent}</span>`;
            } else {
                agentBadge = `<span class="agent-badge atlas">Atlas</span>`;
            }
        }
        
        html += `
            <div class="work-item ${agentClass}">
                ${agentBadge}
                <div class="work-title">${escapeHtml(item.title)}</div>
                <div class="work-description">${escapeHtml(item.description)}</div>
                ${item.progress > 0 ? `
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${item.progress}%"></div>
                    </div>
                ` : ''}
                <div class="work-status">
                    <span class="status-badge ${statusClass}">${item.status}</span>
                    <span>${item.eta}</span>
                </div>
            </div>
        `;
    });
    
    smoothSetHTML(workQueueDiv, html);
}

// Smooth HTML update with fade transitions (no hard reset)
function smoothSetHTML(element, newHTML) {
    if (!element) return;
    
    // If content is the same, don't update
    if (element.innerHTML === newHTML) return;
    
    // Fade out slightly
    element.style.opacity = '0.7';
    element.style.transition = 'opacity 0.15s ease-in-out';
    
    // Update content after fade
    setTimeout(() => {
        element.innerHTML = newHTML;
        element.style.opacity = '1';
    }, 75);
}

// Update OpenClaw status
function updateOpenClawStatus(stats) {
    const indicator = document.querySelector('.status-indicator');
    const label = document.querySelector('.stat-card.openclaw .stat-label');
    const detail = document.querySelector('.stat-card.openclaw .service-detail');
    
    if (indicator) {
        // Handle both old format (string) and new format (object)
        const isActive = typeof stats === 'string' ? stats === 'active' : stats.status === 'active';
        indicator.style.backgroundColor = isActive ? '#4ec9b0' : '#858585';
    }
    
    if (label && typeof stats === 'object') {
        const procCount = stats.processCount || 0;
        const cpuUsage = stats.cpuUsage || '0';
        const memUsage = stats.memUsage || '0';
        label.textContent = `OpenClaw ${stats.status}\n${procCount} processes | CPU: ${cpuUsage}% | Mem: ${memUsage}%`;
    } else if (label && typeof stats === 'string') {
        label.textContent = `OpenClaw ${stats}\n74 processes + 4k TUI 3.4k CPU`;
    }
    
    if (detail && typeof stats === 'object') {
        detail.textContent = stats.gatewayRunning ? 'Gateway Running ✅' : 'Gateway Stopped ⚠️';
    }
}

// Update model display (badge + name in combined card)
function updateModelDisplay(model) {
    if (!model) return;

    const modelValue = document.getElementById('model-value');
    const modelBadge = document.getElementById('model-badge');

    if (modelValue) {
        modelValue.textContent = model.name;
    }

    if (modelBadge) {
        modelBadge.className = `model-badge ${model.badge}`;
        modelBadge.textContent = `${model.badge} (${model.costSavings})`;
    }
}

// Update combined model + agent display (overall breakdown + per-agent model %)
function updateModelAgentDisplay(metrics) {
    if (!metrics) return;

    const breakdownEl = document.getElementById('model-breakdown');
    const perAgentEl = document.getElementById('model-per-agent');

    // Overall model breakdown from API data
    if (breakdownEl && metrics.modelBreakdown) {
        const breakdown = Object.entries(metrics.modelBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([model, pct]) => {
                const cap = model.charAt(0).toUpperCase() + model.slice(1);
                return `<span class="model-pct-${model}">${cap}: ${pct}%</span>`;
            })
            .join(' | ');
        breakdownEl.innerHTML = breakdown || 'No data yet';
        window._modelBreakdownFromAPI = true;
    }

    // Per-agent model rows
    if (perAgentEl && metrics.perAgent) {
        const agents = Object.entries(metrics.perAgent);
        if (agents.length === 0) {
            perAgentEl.innerHTML = '';
            return;
        }

        let html = '';
        agents.forEach(([slug, data]) => {
            if (!data.models || Object.keys(data.models).length === 0) return;

            const dotColor = data.color || '#007acc';
            const modelPcts = Object.entries(data.models)
                .sort((a, b) => b[1] - a[1])
                .map(([model, pct]) => {
                    const cap = model.charAt(0).toUpperCase() + model.slice(1);
                    return `<span class="model-pct-${model}">${cap} ${pct}%</span>`;
                })
                .join(' <span style="opacity:0.4">\u00b7</span> ');

            html += `
                <div class="model-agent-row">
                    <span class="model-agent-name">
                        <span class="agent-dot" style="background: ${dotColor};"></span>
                        ${escapeHtml(data.name)}
                    </span>
                    <span class="model-agent-models">${modelPcts}</span>
                </div>
            `;
        });

        perAgentEl.innerHTML = html;
    }

    console.log('📊 Model+Agent Display updated:', {
        modelBreakdown: metrics.modelBreakdown,
        agentModels: metrics.perAgent ? Object.entries(metrics.perAgent).map(([s, d]) =>
            `${d.name}: ${JSON.stringify(d.models || {})}`
        ) : 'N/A'
    });
}

// Update connection status
function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    if (connected) {
        statusEl.classList.remove('disconnected');
        statusEl.innerHTML = '<div class="status-dot"></div><span>Connected</span>';
    } else {
        statusEl.classList.add('disconnected');
        statusEl.innerHTML = '<div class="status-dot"></div><span>Disconnected</span>';
    }
}

// Update project info
function updateProjectInfo(projectInfo) {
    if (!projectInfo) return;
    
    const projectPath = document.getElementById('file-tree-path');
    if (projectPath) {
        projectPath.textContent = `(~/${projectInfo.name})`;
    }
}

// Update agent name in header
function updateAgentName(projectInfo) {
    console.log('🤖 updateAgentName called with:', projectInfo);
    
    if (!projectInfo) {
        console.warn('⚠️  projectInfo is undefined');
        return;
    }
    
    const agentName = projectInfo.agentName || projectInfo.name || 'Unknown';
    console.log('✅ Agent name resolved to:', agentName);
    
    const agentBadge = document.getElementById('agent-name');
    const pageTitle = document.getElementById('page-title');
    
    if (agentBadge) {
        agentBadge.textContent = agentName;
        console.log('✅ Agent badge updated');
    } else {
        console.warn('⚠️  Could not find agent-name element');
    }
    
    if (pageTitle) {
        pageTitle.textContent = `${agentName} - System Stats & OpenClaw Monitor`;
    }
}

// Update live logs display - newest at top, waterfall down
function updateLiveLogsDisplay(logs) {
    if (!logs) return;
    
    const logDiv = document.getElementById('live-logs');
    if (!logDiv) return;
    
    // Build log entries
    let html = '';
    if (logs && logs.length > 0) {
        logs.forEach(log => {
            html += `
                <div class="log-entry ${log.level}">
                    <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                    ${escapeHtml(log.message)}
                </div>
            `;
        });
    } else {
        html = '<div class="loading">No recent activity</div>';
    }
    
    // Use smooth update instead of hard reset
    if (logDiv.innerHTML !== html) {
        smoothSetHTML(logDiv, html);
    }
}

// Update gateway connection status in header
function updateGatewayStatus(status) {
    const statusEl = document.getElementById('connection-status');
    if (!statusEl) return;
    
    if (status === 'connected') {
        statusEl.classList.remove('disconnected');
        statusEl.innerHTML = '<div class="status-dot"></div><span>Gateway Active</span>';
    } else {
        statusEl.classList.add('disconnected');
        statusEl.innerHTML = '<div class="status-dot"></div><span>Gateway Offline</span>';
    }
}

// Update token metrics display
function updateTokenMetricsDisplay(metrics) {
    if (!metrics) return;

    // Today's live usage - big number at top
    const todayCost = document.getElementById('today-cost');
    if (todayCost && metrics.today) {
        const cost = metrics.today.cost || 0;
        todayCost.textContent = `$${cost.toFixed(4)}`;
    }

    // All-Time: yesterday (cumulative through yesterday) + today (live)
    const alltimeCost = document.getElementById('alltime-cost');
    if (alltimeCost && metrics.allTime && metrics.today) {
        const yesterdayTotal = metrics.allTime.total?.cost || 0;
        const todayTotal = metrics.today.cost || 0;
        const allTimeTotal = yesterdayTotal + todayTotal;
        alltimeCost.textContent = `All-Time: $${allTimeTotal.toFixed(2)}`;
    }

    // Per-agent cost breakdown (from Usage Report API group_by api_key_id)
    if (metrics.perAgent) {
        updatePerAgentCostsDisplay(metrics.perAgent);
    }

    // Combined model + agent breakdown display
    if (metrics.modelBreakdown || metrics.perAgent) {
        updateModelAgentDisplay(metrics);
    }

    console.log('💰 Token Metrics:', {
        today_live: metrics.today ? `$${metrics.today.cost.toFixed(4)}` : 'N/A',
        yesterday_cumulative: `$${(metrics.allTime.total?.cost || 0).toFixed(2)}`,
        all_time_total: `$${((metrics.allTime.total?.cost || 0) + (metrics.today?.cost || 0)).toFixed(2)}`,
        perAgentKeys: metrics.perAgent ? Object.keys(metrics.perAgent).length : 0
    });
}

// Display model usage percentages (all-time) - legacy fallback for when API modelBreakdown unavailable
function updateModelUsageDisplay(modelUsage) {
    // Skip if API-based modelBreakdown has already been rendered
    if (window._modelBreakdownFromAPI) return;

    const breakdownEl = document.getElementById('model-breakdown');
    if (!breakdownEl) return;

    // Build breakdown string
    const breakdown = Object.entries(modelUsage)
        .map(([model, percent]) => `${model.charAt(0).toUpperCase() + model.slice(1)}: ${percent}%`)
        .join(' | ');

    breakdownEl.textContent = breakdown || 'No data yet';

    console.log('📊 Model Usage % (legacy):', modelUsage);
}

// Display agent costs breakdown (all-time) - legacy from model history
function updateAgentCostsDisplay(agentCosts) {
    // If per-agent API costs are already displayed, skip legacy display
    if (window._perAgentDisplayed) return;

    const totalEl = document.getElementById('cost-by-bot-total');
    const breakdownEl = document.getElementById('bot-breakdown');

    if (!totalEl || !breakdownEl) return;

    const total = agentCosts.total || 0;
    totalEl.textContent = `$${total.toFixed(2)}`;

    // Build breakdown HTML
    let html = '';
    const agentIcons = { atlas: '🔵', nate: '🔴', alex: '🟢' };

    Object.entries(agentCosts.agents || {}).forEach(([agent, data]) => {
        const icon = agentIcons[agent] || '⚪';
        const percent = data.percent || 0;
        html += `<div>${icon} ${agent.charAt(0).toUpperCase() + agent.slice(1)}: $${data.cost.toFixed(2)} (${percent}%)</div>`;
    });

    breakdownEl.innerHTML = html || '<div>No data yet</div>';

    console.log('💳 Agent Costs (legacy):', agentCosts);
}

// Display per-agent costs from Usage Report API (group_by api_key_id)
function updatePerAgentCostsDisplay(perAgent) {
    const totalEl = document.getElementById('cost-by-bot-total');
    const breakdownEl = document.getElementById('bot-breakdown');

    if (!totalEl || !breakdownEl) return;

    const agents = Object.entries(perAgent);
    if (agents.length === 0) return;

    window._perAgentDisplayed = true;

    let totalAllTime = 0;
    let html = `
        <div class="agent-cost-header">
            <span></span>
            <span>today</span>
            <span>all-time</span>
            <span>est/day</span>
        </div>
    `;

    agents.forEach(([slug, data]) => {
        totalAllTime += data.allTime || 0;
        const dotColor = data.color || '#007acc';

        html += `
            <div class="agent-cost-row">
                <span class="agent-cost-name">
                    <span class="agent-dot" style="background: ${dotColor};"></span>
                    ${escapeHtml(data.name)}
                </span>
                <span class="agent-cost-today">$${(data.today || 0).toFixed(2)}</span>
                <span class="agent-cost-alltime">$${(data.allTime || 0).toFixed(2)}</span>
                <span class="agent-cost-daily">~$${(data.estimatedDaily || 0).toFixed(2)}</span>
            </div>
        `;
    });

    totalEl.textContent = `$${totalAllTime.toFixed(2)}`;
    breakdownEl.innerHTML = html;

    console.log('💳 Per-Agent Costs (API):', perAgent);
}

// Format large token numbers
function formatTokens(tokens) {
    if (tokens >= 1000000) {
        return (tokens / 1000000).toFixed(1) + 'M';
    } else if (tokens >= 1000) {
        return (tokens / 1000).toFixed(1) + 'K';
    } else {
        return tokens.toString();
    }
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Poll for updates if WebSocket is unavailable
function setupPolling() {
    setInterval(() => {
        fetch('/api/metrics')
            .then(r => r.json())
            .then(data => updateSystemMetrics(data))
            .catch(err => console.error('Polling error:', err));
    }, 5000);
    
    setInterval(() => {
        fetch('/api/logs')
            .then(r => r.json())
            .then(data => {
                const logDiv = document.getElementById('live-logs');
                let html = '';
                data.forEach(log => {
                    html += `
                        <div class="log-entry ${log.level}">
                            <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                            ${escapeHtml(log.message)}
                        </div>
                    `;
                });
                logDiv.innerHTML = html;
            })
            .catch(err => console.error('Logs polling error:', err));
    }, 3000);
}

// Initialize polling as fallback
setTimeout(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        setupPolling();
    }
}, 5000);