# How Atlas Populates the Work Queue

The dashboard now automatically displays tasks that **Atlas** (me) creates as I think through work. Here's how it works:

## How Tasks Get Added

When you send me a message like:
> "Audit the nope-app CI/CD pipeline"

I immediately break it into a task list and call the API endpoint to populate the work queue:

```bash
curl -X POST http://localhost:4002/api/tasks/add \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Check GitHub Actions workflows",
    "description": "Review all CI/CD pipeline configurations",
    "status": "ACTIVE"
  }'
```

## Task Lifecycle

As I work through the tasks:

1. **ACTIVE** - I'm working on this now or it's queued up
2. **IN_PROGRESS** - I'm actively executing
3. **STUCK** - Something blocked me or hung up
4. **ERROR** - Task failed
5. **COMPLETE** - Done, moved to archive

## Example Task Flow

**When you send me work:**
```
☐ Task 1: Initial analysis
   Status: ACTIVE
   Progress: 0%
   
☐ Task 2: Code review
   Status: QUEUED
   Progress: 0%
```

**As I execute:**
```
✓ Task 1: Initial analysis
   Status: COMPLETE
   Progress: 100%
   
⟳ Task 2: Code review
   Status: ACTIVE  
   Progress: 45%
```

**If something blocks:**
```
✗ Task 2: Code review
   Status: STUCK
   Description: Waiting for CI logs from GitHub API
```

## Updating Task Status

I can also update task progress as I work:

```bash
curl -X POST http://localhost:4002/api/tasks/update/TASK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "status": "IN_PROGRESS",
    "progress": 50
  }'
```

## Dashboard Display

The work queue shows:

- **Title** - What I'm doing
- **Description** - Why I'm doing it
- **Status Badge** - Current state (color-coded)
- **Progress Bar** - How far along I am
- **ETA** - Estimated time to completion

Filters at the top let you see only:
- **ACTIVE** (blue) - What I'm doing now
- **STUCK** (yellow) - Where I got blocked
- **ERROR** (red) - What failed
- **COMPLETE** (green) - What's done

## Real-Time Updates

The dashboard updates in real-time via WebSocket:
- When I create a new task → appears instantly
- When I update progress → bar animates smoothly
- When I change status → badge updates with color
- When I complete → moves to COMPLETE tab

## You See My Thinking

This means:
✅ You see the breakdown of how I approach your requests  
✅ You can intervene if I'm going wrong direction  
✅ You get real-time visibility into my work  
✅ You know what's stuck vs done vs in progress  
✅ No manual task entry needed  

Just send me work, and the queue auto-populates! 🚀

