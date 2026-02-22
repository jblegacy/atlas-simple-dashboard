# Atlas Dashboard Update Guide

## What Changed

### 1. **Work Queue Tabs** (ACTIVE, STUCK, ERROR, COMPLETE)
- Added tab navigation to filter tasks by status
- Tasks now categorized as they move through different states
- Each tab has color-coded styling for quick visual scanning

### 2. **Anthropic API Endpoint Configuration**
- Dashboard can now connect to a custom Anthropic API endpoint
- Dynamic configuration via environment variables or REST API
- Real-time token usage monitoring from your custom endpoint

---

## How to Configure Anthropic API Endpoint

### Option 1: Environment Variables (Recommended)

Set these before running the dashboard:

```bash
export ANTHROPIC_API_KEY="your-api-key-here"
export ANTHROPIC_API_ENDPOINT="https://your-custom-endpoint.com/v1/usage"

npm start
```

### Option 2: Runtime Configuration via API

Send a POST request to configure dynamically:

```bash
curl -X POST http://localhost:4002/api/anthropic/configure \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "your-api-key-here",
    "endpoint": "https://your-custom-endpoint.com/v1/usage"
  }'
```

### Option 3: Default (Anthropic Official API)

If no custom endpoint is set, the dashboard defaults to:
- `https://api.anthropic.com/v1/usage`

---

## API Endpoints

### Configure Anthropic
```
POST /api/anthropic/configure
Body: {
  "apiKey": "string",     // Optional
  "endpoint": "string"    // Optional
}
```

### Get Current Configuration
```
GET /api/anthropic/config
Response: {
  "endpoint": "string",
  "apiKeySet": boolean
}
```

---

## Task Status Flow

```
ACTIVE (Blue)   ← What I'm doing NOW or QUEUED to do
  ↓
STUCK (Yellow)  ← Got blocked/hung up
  ↓
ERROR (Red)     ← Task failed
  ↓
COMPLETE (Green) ← All done, moved to archive
```

When you send me a message, I'll:
1. Break it into tasks
2. Add them as ACTIVE (queued)
3. Mark as IN_PROGRESS as I work
4. Move to COMPLETE when done
5. If anything blocks: move to STUCK or ERROR

---

## Files Modified

- `public/index.html` - Added tab buttons
- `public/css/styles.css` - Added tab styling
- `public/js/dashboard.js` - Added tab filtering logic
- `server.js` - Added Anthropic endpoint configuration

---

## Running the Dashboard

```bash
# Standard start
npm start

# With custom Anthropic endpoint
ANTHROPIC_API_KEY="sk-..." ANTHROPIC_API_ENDPOINT="https://..." npm start

# Custom port
PORT=3000 npm start
```

Dashboard will be available at: `http://localhost:4002` (or your custom PORT)

---

## Dashboard Features Now

✅ Real-time system metrics (CPU, Memory, Disk)  
✅ Work queue with 4-stage filtering (ACTIVE/STUCK/ERROR/COMPLETE)  
✅ Git commit history with type categorization  
✅ File tree with live updates  
✅ OpenClaw status monitoring  
✅ Token usage tracking from Anthropic  
✅ Live system logs  
✅ Agent name display  
✅ Backup metrics  
✅ Model switching (Haiku/Sonnet/Opus)  

---

## Next Steps

1. Copy these files to your repo
2. Install dependencies: `npm install`
3. Configure your Anthropic API endpoint (if using custom)
4. Start the dashboard: `npm start`
5. I'll automatically populate the work queue as you give me tasks
