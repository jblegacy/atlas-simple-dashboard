# Task Workflow - How Atlas Populates Work Queue

## The Trigger

When **you send Atlas a message** (e.g., "Audit the nope-app CI/CD pipeline"), that message is the trigger to:

1. **Parse your request** - Understand what work you're asking for
2. **Break into tasks** - Split into logical steps
3. **Create tasks immediately** - Call `/api/tasks/add` for each one
4. **Update as I work** - Change status and progress as I execute

## Task Lifecycle

```
ACTIVE (blue)   ← Queued or being worked on
  ↓
IN_PROGRESS     ← Currently executing
  ↓
STUCK (yellow)  ← Blocked/hung up
  ↓
ERROR (red)     ← Failed
  ↓
COMPLETE (green) ← Done
```

## How Atlas Creates Tasks

When you send work, I use curl commands to add tasks:

```bash
# Create a task
curl -X POST http://localhost:4002/api/tasks/add \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Audit GitHub Actions",
    "description": "Review all CI/CD pipeline configurations",
    "status": "ACTIVE"
  }'

# Update progress
curl -X POST http://localhost:4002/api/tasks/update/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "status": "IN_PROGRESS",
    "progress": 50
  }'

# Mark complete
curl -X POST http://localhost:4002/api/tasks/update/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "status": "COMPLETE",
    "progress": 100
  }'
```

## What You'll See in Real-Time

As I work, the dashboard updates live:

1. **Task appears immediately** when I start thinking
2. **Progress bar animates** as I make progress  
3. **Status changes with color** (blue → yellow → green)
4. **Tabs auto-organize** - complete tasks move to COMPLETE tab
5. **Smooth animations** - no jumpy updates

## Example Workflow

**You:** "Analyze the nope-app repository and suggest optimizations"

**Atlas immediately creates:**
```
☐ Task 1: Clone and analyze nope-app structure
   Status: ACTIVE
   Progress: 0%

☐ Task 2: Profile performance bottlenecks
   Status: QUEUED
   Progress: 0%

☐ Task 3: Generate optimization recommendations
   Status: QUEUED
   Progress: 0%
```

**As I work:**
```
✓ Task 1: Clone and analyze nope-app structure
   Status: COMPLETE
   Progress: 100%

⟳ Task 2: Profile performance bottlenecks
   Status: IN_PROGRESS  
   Progress: 67%

☐ Task 3: Generate optimization recommendations
   Status: ACTIVE
   Progress: 0%
```

**You get real-time visibility into:**
- What I'm thinking about
- How I'm breaking down the work
- What's done vs in progress
- What's blocked or failed

## Key Points

✅ **No manual task entry** - I create them as you request work  
✅ **Real-time visibility** - See my thinking process  
✅ **Automatic status updates** - No babysitting needed  
✅ **Smooth animations** - Beautiful UX for status changes  
✅ **One command triggers it all** - Just send me work  

## Next Steps

1. **Send Atlas a task** (any message with work)
2. **Watch tasks appear** in the work queue
3. **See status update** as I work through them
4. **Complete feedback loop** - You know exactly what I'm doing

