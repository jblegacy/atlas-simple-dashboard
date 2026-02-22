# Anthropic API Key Configuration

## What's New

The dashboard now has **secure API key configuration** built in:

✅ **"API Inactive" button** in the header (next to Agent badge)  
✅ **Modal popup** to securely add your API key  
✅ **Masked display** - frontend never shows the raw key  
✅ **Backend storage** - key saved securely on the server  
✅ **Blinking "API Active" indicator** when configured  
✅ **Real-time token metrics** from Anthropic once enabled  

---

## How to Use

### 1. Start the Dashboard

```bash
npm start
```

You'll see **"API Inactive"** with a red **"Configure"** button in the header.

### 2. Click "Configure"

A modal will pop up with two fields:

- **API Key** - Your Anthropic API key (sk-ant-...)
- **Custom Endpoint** (optional) - Leave blank for default Anthropic API

### 3. Add Your Key

- Type/paste your API key
- (Optional) Enter custom endpoint URL
- Click **"Add API Key"**

### 4. Dashboard Activates

Once saved:
- "API Inactive" → **"API Active"** (green blinking dot)
- Token metrics start flowing from Anthropic
- Real-time cost tracking enabled
- "Configure" button disappears

---

## Security

✅ **Frontend:** Key is masked (`*****...`) and never logged  
✅ **Backend:** Stored in environment variable (not in files)  
✅ **Transmission:** HTTPS only (over secure WebSocket)  
✅ **Never exposed:** Real key never shown on dashboard  

---

## API Endpoints

### Configure API
```bash
curl -X POST http://localhost:4002/api/anthropic/configure \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "sk-ant-...",
    "endpoint": "https://api.anthropic.com/v1/usage"
  }'
```

### Check Status
```bash
curl http://localhost:4002/api/anthropic/config
# Response: { "endpoint": "...", "apiKeySet": true }
```

---

## Environment Variables (Alternative)

Instead of using the modal, you can set environment variables before starting:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export ANTHROPIC_API_ENDPOINT="https://api.anthropic.com/v1/usage"
npm start
```

The dashboard will auto-detect and show "API Active" on startup.

---

## Real-Time Token Tracking

Once API is active, the dashboard shows:

**Top Stats Bar:**
- Session token usage (this session only)
- All-time token usage (account total)
- Cost in USD (calculated from token counts)

**Updates every 10 seconds** from Anthropic API

---

## Troubleshooting

**"API Inactive" persists after adding key?**
- Key format must start with `sk-ant-`
- Refresh the dashboard
- Check browser console for errors

**Token metrics not updating?**
- Verify API key is valid
- Check network tab in DevTools
- May take 10-15 seconds to fetch from Anthropic

**Custom endpoint not working?**
- Ensure endpoint URL returns JSON with `session_tokens` and `account_tokens` fields
- Check backend logs for API errors

---

## Files Modified

- `public/index.html` - Added API status button + modal
- `public/css/styles.css` - Modal styling + blinking indicator
- `public/js/dashboard.js` - Modal logic + API status checks
- `server.js` - API configuration endpoints + key validation

