# API Key Persistence

## How It Works

Your Anthropic API key is now **persisted locally** and survives server restarts.

### Flow

1. **User enters API key via modal**
   - Sent to `/api/anthropic/configure` endpoint
   
2. **Backend saves to config file**
   - Stored in `config/anthropic.json` (not committed to git)
   - Also updates `process.env` for current session
   
3. **Server startup**
   - On boot, loads API key from `config/anthropic.json`
   - Sets `process.env.ANTHROPIC_API_KEY` automatically
   - Token metrics start flowing immediately
   
4. **Update existing key**
   - Click API status header → modal opens
   - Enter new key → saved to file
   - No server restart needed

## Config File Structure

```json
{
  "apiKey": "sk-ant-admin01-...",
  "endpoint": "https://api.anthropic.com/v1/organizations/usage_report/messages"
}
```

**Location:** `config/anthropic.json` (inside dashboard directory)

**Why not in git?** Added to `.gitignore` — API keys should NEVER be committed

## Security

✅ API key stored locally on your machine only  
✅ Never sent anywhere except to Anthropic API  
✅ Not committed to git repository  
✅ Can be edited/replaced anytime via modal  

## Persistent Across Restarts

**Before:** API key lost on server restart (needed env vars on startup)

```bash
# Old way - had to set env vars every time
ANTHROPIC_API_KEY="sk-ant-..." npm start
```

**Now:** API key is persistent and loads automatically

```bash
# New way - just start normally
npm start
# ✅ API key automatically loaded from config/anthropic.json
```

## Troubleshooting

**API key disappeared after restart?**
1. Check if `config/anthropic.json` exists
2. Check file permissions (should be readable/writable)
3. Re-enter key via modal if needed

**Want to use environment variables instead?**
You can still set env vars at startup — they take precedence over the config file:

```bash
ANTHROPIC_API_KEY="sk-ant-..." npm start
```

**Want to reset/forget the key?**
Delete `config/anthropic.json` and restart the server.

