# Rate Limit Handling

## The Issue

The Anthropic Admin API has rate limits. The original dashboard was calling the API **every 10 seconds**, which quickly exceeded the quota:

```
❌ Every 10 seconds = 6 calls/minute = 360 calls/hour
❌ 2 API requests per call (today + all-time) = 720 API calls/hour
❌ Rate limit exceeded quickly
```

Error response:
```
"You exceeded your rate limit. Please try again later."
```

## The Solution

### 1. Increased Polling Interval

Changed from **10 seconds** to **5 minutes**:

```
✅ Every 5 minutes = 12 calls/hour = 24 API calls/hour
✅ 2 API requests per call = 48 API calls/hour total
✅ Well under rate limit
```

### 2. Exponential Backoff

When rate limit is hit:
- **Hit 1:** Back off 1 minute
- **Hit 2:** Back off 2 minutes  
- **Hit 3:** Back off 3 minutes
- **Max:** 5 minutes backoff

Dashboard will log:
```
⚠️  Rate limit hit on today's usage API
⏸️  Rate limit backoff active - waiting 60s before next API call
```

### 3. Automatic Recovery

On successful API calls, counters reset:
```
✅ Rate limit counter reset - API calls successful
```

## Configuration

To adjust the polling interval, edit the server:

**Current (5 minutes):**
```javascript
setInterval(updateTokenMetrics, 5 * 60 * 1000);  // Every 5 minutes
```

**Alternatives:**

```javascript
// Every 1 minute (faster updates, higher API usage)
setInterval(updateTokenMetrics, 1 * 60 * 1000);

// Every 10 minutes (slower updates, lower API usage)
setInterval(updateTokenMetrics, 10 * 60 * 1000);

// Every 30 minutes (minimal API usage)
setInterval(updateTokenMetrics, 30 * 60 * 1000);
```

## API Rate Limit Info

Anthropic Admin API rate limits depend on your account tier:
- **Free/Trial:** ~10-100 requests per minute (conservative estimate)
- **Paid:** Higher limits based on plan

Current safe configuration:
- ✅ **48 API calls/hour** (5-minute polling, 2 requests per poll)
- ✅ **1,152 API calls/day** 

This is well within typical rate limits.

## Monitoring

Check server logs for rate limit status:

```bash
# Normal operation
🔄 Updating token metrics from Anthropic API...
✅ Today's usage: ...
✅ All-time usage: ...

# Rate limited
⚠️  Rate limit hit on today's usage API
⏸️  Rate limit backoff active - waiting 300s before next API call

# Recovery
✅ Rate limit counter reset - API calls successful
```

## Troubleshooting

**Still getting rate limited?**
1. Increase polling interval further (try 10 minutes)
2. Check if another process is calling the same API
3. Verify your API key is not shared

**Want faster updates?**
1. Reduce polling interval cautiously
2. Monitor rate limit errors
3. Switch to shorter interval only if no errors occur

---

**Status:** ✅ Rate limit handling is active - API calls are safely throttled.
