// Dashboard WebSocket connection
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
});

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
    }
}

// Update all data on initial connection
function updateAllData(data) {
    updateSystemMetrics(data.systemMetrics);
    updateGitLogs(data.gitLogs);
    updateFileTreeUI(data.fileTree, data.projectInfo);
    updateWorkQueueUI(data.workQueue);
    updateOpenClawStatus(data.openclawStatus);
    updateModelDisplay(data.currentModel);
    updateBackupMetrics(data.backupMetrics);
    updateProjectInfo(data.projectInfo);
    updateAgentName(data.projectInfo);
    updateLiveLogsDisplay(data.liveLogs);
    updateGatewayStatus(data.gatewayStatus);
    updateTokenMetricsDisplay(data.tokenMetrics);
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

// Update work queue display
function updateWorkQueueUI(queue) {
    const workQueueDiv = document.getElementById('work-queue');
    
    if (!queue || queue.length === 0) {
        workQueueDiv.innerHTML = '<div class="loading">No tasks</div>';
        return;
    }
    
    let html = '';
    queue.forEach(item => {
        html += `
            <div class="work-item">
                <div class="work-title">${escapeHtml(item.title)}</div>
                <div class="work-description">${escapeHtml(item.description)}</div>
                ${item.progress > 0 ? `
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${item.progress}%"></div>
                    </div>
                ` : ''}
                <div class="work-status">
                    <span class="status-badge ${item.status.toLowerCase().replace('_', '-')}">${item.status}</span>
                    <span>${item.eta}</span>
                </div>
            </div>
        `;
    });
    
    workQueueDiv.innerHTML = html;
}

// Update OpenClaw status
function updateOpenClawStatus(status) {
    const indicator = document.querySelector('.status-indicator');
    const label = document.querySelector('.stat-card.openclaw .stat-label');
    
    if (indicator) {
        indicator.style.backgroundColor = status === 'active' ? '#4ec9b0' : '#858585';
    }
    
    if (label) {
        label.textContent = `OpenClaw ${status}\n74 processes + 4k TUI 3.4k CPU`;
    }
}

// Update model display
function updateModelDisplay(model) {
    if (!model) return;
    
    const modelValue = document.getElementById('model-value');
    const modelLabel = document.querySelector('.stat-card.model-indicator .stat-label');
    const modelBadge = document.getElementById('model-badge');
    
    if (modelValue) {
        modelValue.textContent = model.name;
    }
    
    if (modelLabel) {
        modelLabel.textContent = `Current Model\n${model.version}`;
    }
    
    if (modelBadge) {
        modelBadge.className = `model-badge ${model.badge}`;
        modelBadge.textContent = `${model.badge} (${model.costSavings})`;
    }
}

// Update backup metrics
function updateBackupMetrics(metrics) {
    if (!metrics) return;
    
    const backupSize = document.getElementById('backup-size');
    const backupTime = document.getElementById('backup-time');
    
    if (backupSize) {
        backupSize.textContent = metrics.size;
    }
    
    if (backupTime) {
        const lastBackup = new Date(metrics.lastBackup);
        const now = new Date();
        const diffSeconds = Math.floor((now - lastBackup) / 1000);
        
        let timeStr = 'Just now';
        if (diffSeconds > 60) {
            timeStr = Math.floor(diffSeconds / 60) + 'm ago';
        } else if (diffSeconds > 3600) {
            timeStr = Math.floor(diffSeconds / 3600) + 'h ago';
        }
        
        backupTime.textContent = timeStr;
    }
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

// Update live logs display
function updateLiveLogsDisplay(logs) {
    if (!logs) return;
    
    const logDiv = document.getElementById('live-logs');
    if (!logDiv) return;
    
    let html = '';
    logs.forEach(log => {
        html += `
            <div class="log-entry ${log.level}">
                <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                ${escapeHtml(log.message)}
            </div>
        `;
    });
    
    logDiv.innerHTML = html || '<div class="loading">No logs available</div>';
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
    
    // Update token usage display
    const tokenValue = document.getElementById('token-value');
    if (tokenValue) {
        const haiku = metrics.haiku.total || 0;
        const sonnet = metrics.sonnet.total || 0;
        tokenValue.textContent = `${haiku}/${sonnet}`;
    }
    
    // You could also update costs if you add a cost display element
    console.log('💰 Token Metrics:', {
        haiku: `${metrics.haiku.total} tokens ($${(metrics.haiku.cost || 0).toFixed(2)})`,
        sonnet: `${metrics.sonnet.total} tokens ($${(metrics.sonnet.cost || 0).toFixed(2)})`,
        total: `${metrics.total.tokens} tokens ($${(metrics.total.cost || 0).toFixed(2)})`
    });
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