# Task Persistence

## How Tasks Are Saved

Tasks now **persist across server restarts** using a simple JSON file storage system.

### Storage Location
```
config/tasks.json
```

Located in the same `config/` directory as your API key configuration.

### When Tasks Are Saved

Tasks are automatically saved to disk whenever:
- ✅ A new task is created (`POST /api/tasks/add`)
- ✅ A task is updated (`POST /api/tasks/update/:id`)
- ✅ A task is deleted (`POST /api/tasks/delete/:id`)

### When Tasks Are Loaded

On server startup:
1. Server checks for `config/tasks.json`
2. If found, loads all tasks into memory
3. Tasks appear in dashboard immediately

```
✅ Loaded 12 tasks from file
```

### Task File Format

```json
[
  {
    "id": 1771750756444,
    "title": "Analyze task population mechanism",
    "description": "Understand why tasks arent appearing when Atlas thinks through work",
    "status": "COMPLETE",
    "progress": 100,
    "eta": "Atlas-generated",
    "createdAt": "2026-02-22T08:59:16.444Z"
  },
  {
    "id": 1771750760757,
    "title": "Review trigger mechanism in code",
    "description": "Check if task creation is wired to incoming messages",
    "status": "COMPLETE",
    "progress": 100,
    "eta": "Atlas-generated",
    "createdAt": "2026-02-22T08:59:20.757Z"
  }
]
```

## Important Notes

### Git Ignoring
Tasks file is NOT in `.gitignore` (unlike API keys) because:
- Tasks are project-specific data, not secrets
- You might want to version control your work history
- Can be useful for documentation

If you prefer NOT to track tasks in git:
```bash
echo "config/tasks.json" >> .gitignore
git rm --cached config/tasks.json
```

### Cleanup

To start fresh with no tasks:
1. Delete `config/tasks.json`
2. Restart server

New tasks file will be created on first task addition.

## Workflow

**Before (tasks lost on restart):**
```
1. Server running with 10 tasks
2. Server restarts
3. All tasks gone ❌
```

**Now (tasks persist):**
```
1. Server running with 10 tasks
2. Server restarts
3. All 10 tasks still there ✅
4. Logged: "Loaded 10 tasks from file"
```

## Example

```bash
# Server starts
npm start

# Loads tasks from disk
✅ Loaded 12 tasks from file

# All 12 tasks appear in dashboard immediately
# Work on them...

# Add new task
curl -X POST http://localhost:4002/api/tasks/add ...
# ✅ Task added and saved to config/tasks.json

# Server restarts (intentional or crash)
# All tasks (old + new) are restored ✅
```

---

**Status:** ✅ Task persistence is LIVE - Tasks survive server restarts!
