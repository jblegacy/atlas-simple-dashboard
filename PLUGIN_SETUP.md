# Atlas Simple Dashboard - Plugin Setup Guide

**Turn the dashboard into a portable plugin for any OpenClaw agent**

## 🎯 Quick Plugin Setup

### For Nate (main agent)
```bash
# Clone into Nate's workspace
cd /Users/openclaw/.openclaw/workspace
git clone https://github.com/jblegacy/atlas-simple-dashboard.git nate-dashboard
cd nate-dashboard
npm install
npm start
# Opens at localhost:4002
```

### For Alex (tablebuilt agent)
```bash
# Clone into Alex's workspace
cd /Users/openclaw/.openclaw/workspace-tablebuilt
git clone https://github.com/jblegacy/atlas-simple-dashboard.git tablebuilt-dashboard
cd tablebuilt-dashboard
npm install
npm start
# Opens at localhost:4003 (different port)
```

### For Anyone Else
```bash
# Clone into their OpenClaw workspace
git clone https://github.com/jblegacy/atlas-simple-dashboard.git
cd atlas-simple-dashboard
npm install

# Set custom agent name (optional)
export OPENCLAW_AGENT="CustomBotName"

# Set custom port (optional)
export PORT=5000

# Start the dashboard
npm start
```

## 🔧 Configuration Options

### Environment Variables

**OPENCLAW_AGENT**
- Override the detected agent/bot name
- Used in the dashboard header
- Default: Auto-detected from workspace

```bash
export OPENCLAW_AGENT="Nate"
npm start
```

**PORT**
- Custom port for the dashboard
- Default: 4002

```bash
export PORT=5000
npm start
```

**OPENCLAW_CONFIG**
- Path to custom OpenClaw config
- Default: ~/.openclaw/openclaw.json

```bash
export OPENCLAW_CONFIG="/path/to/openclaw.json"
npm start
```

## 📊 Dashboard Features (Auto-Detected)

The dashboard automatically detects and displays:

1. **Agent Name** - From OpenClaw config or environment
2. **System Metrics** - Real-time CPU, memory, disk, uptime
3. **Git Logs** - Repository commits from current directory
4. **File Tree** - Project structure of current folder
5. **Work Queue** - OpenClaw cron jobs and processes
6. **OpenClaw Status** - Gateway and agent health
7. **Current Model** - Which AI model is active
8. **Backup Metrics** - Portfolio backup information

## 🔌 Deployment Patterns

### Pattern 1: Same Machine, Different Ports

```bash
# Nate's dashboard on port 4002
cd ~/workspace/nate-dashboard && PORT=4002 npm start &

# Alex's dashboard on port 4003
cd ~/workspace-tablebuilt/alex-dashboard && PORT=4003 npm start &

# You can access both:
# http://localhost:4002 - Nate's dashboard
# http://localhost:4003 - Alex's dashboard
```

### Pattern 2: Docker Container

```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
ENV OPENCLAW_AGENT=MyBot
ENV PORT=4002
EXPOSE 4002
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t atlas-dashboard .
docker run -p 4002:4002 -e OPENCLAW_AGENT="MyBot" atlas-dashboard
```

### Pattern 3: Remote Deployment

```bash
# Copy to remote server
scp -r atlas-simple-dashboard user@server:/opt/dashboards/

# SSH and start
ssh user@server
cd /opt/dashboards/atlas-simple-dashboard
export OPENCLAW_AGENT="RemoteBot"
npm install && npm start
```

## 🎯 Customization for Each Bot

### For Nate
```bash
cd /Users/openclaw/.openclaw/workspace/nate-dashboard
cat > .env << EOF
PORT=4002
OPENCLAW_AGENT=Nate
EOF
npm start
```

### For Alex
```bash
cd /Users/openclaw/.openclaw/workspace-tablebuilt/alex-dashboard
cat > .env << EOF
PORT=4003
OPENCLAW_AGENT=Alex
EOF
npm start
```

### For Someone Else
```bash
# In their OpenClaw setup
cat > .env << EOF
PORT=5000
OPENCLAW_AGENT=TheirBotName
OPENCLAW_CONFIG=/path/to/their/.openclaw/openclaw.json
EOF
npm start
```

## 📋 What Gets Displayed Per Agent

The dashboard automatically adapts to show:

- **Git Logs:** Repository commits from the current working directory
- **File Tree:** Project structure specific to that bot's workspace
- **Work Queue:** Cron jobs and tasks specific to that bot
- **OpenClaw Status:** Gateway status for that instance
- **System Metrics:** Real-time system performance

## 🚀 Sharing & Distribution

### Share with Others

```bash
# Push a clean copy to your repo
git push origin main

# Give them this command:
git clone https://github.com/jblegacy/atlas-simple-dashboard.git
cd atlas-simple-dashboard
export OPENCLAW_AGENT="TheirBotName"
npm install && npm start
```

### Update All Copies at Once

```bash
# In each dashboard directory:
git pull origin main
npm install
npm start
```

## 🔐 Security Notes

- The dashboard runs on localhost by default
- For remote access, use SSH tunneling or a proxy
- Dashboard has read-only access to system metrics
- No sensitive data is exposed in the UI

## 📞 Troubleshooting

**Agent name not showing?**
```bash
export OPENCLAW_AGENT="YourBotName"
npm start
```

**Port already in use?**
```bash
export PORT=5001
npm start
```

**Can't detect agent from config?**
```bash
# Manually specify the config path
export OPENCLAW_CONFIG="/custom/path/.openclaw/openclaw.json"
npm start
```

**Git logs not showing?**
- Ensure you're running in a git repository
- Check git is installed: `git --version`

---

**This dashboard is designed to be portable and work with any OpenClaw instance!** 🚀