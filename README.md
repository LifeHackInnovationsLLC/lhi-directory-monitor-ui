# LHI Directory Monitor UI

A **feature-module** providing a React UI and Express backend for real-time file system monitoring with manifest generation and exclude pattern management.

## Quick Start

```bash
# Start backend only (for embedded mode in Admin Dashboard)
./launch.sh start

# Or start in standalone mode (backend + frontend)
./launch.sh standalone
```

## Architecture

This module follows the **LHI Feature-Module** pattern, meaning it can run:
1. **Embedded** in the LHI Admin Dashboard (UI served by dashboard, uses shared port)
2. **Standalone** with its own frontend (useful for development or isolated use)

### Ports
- **Backend API**: 7014
- **Frontend Dev Server**: 7015 (standalone mode only)

### Integration with Admin Dashboard

The module is registered in `lhi-admin-dashboard/src/App.tsx`:

```typescript
import DirectoryMonitorModule from "@/../../lhi-directory-monitor-ui"

const { navigationItems, routes } = loadModules([
  GitHubProjectManagerModule,
  DirectoryMonitorModule,  // Added here
])
```

## Features

- **Start/Stop Daemon**: Control the directory monitor daemon from the UI
- **View Manifest**: Visualize the `.lhi_manifest` file tree structure
- **Manage Excludes**: View and manage `.lhi_excludes` patterns
- **Real-time Status**: Live updates on monitor status and uptime

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | Monitor daemon status |
| `/api/manifest` | GET | Get parsed manifest data |
| `/api/excludes` | GET | Get exclude patterns |
| `/api/start` | POST | Start the monitor daemon |
| `/api/stop` | POST | Stop the monitor daemon |
| `/api/refresh` | POST | Regenerate manifest |

## Core Module

This UI interfaces with the core LHI Directory Monitor located at:
```
lhi_modules/lhi_git_projects/LifeHackInnovationsLLC/lhi_node_modules/lhi_directory_monitor/
```

The core module provides:
- `lhi_directory_monitor_daemon.sh` - Background daemon
- `lhi_directory_monitor.sh` - One-shot manifest generation
- `.lhi_manifest` - JSON file with directory structure
- `.lhi_excludes` - Patterns to exclude from monitoring

## Commands

```bash
./launch.sh start      # Start backend only
./launch.sh standalone # Start backend + frontend
./launch.sh stop       # Stop all services
./launch.sh restart    # Restart services
./launch.sh status     # Show service status
./launch.sh logs       # View backend logs
```

## File Structure

```
lhi-directory-monitor-ui/
├── components/
│   └── DirectoryMonitor.tsx    # Main React component
├── config/
│   └── ports.ts                # Port configuration
├── server/
│   └── index.js                # Express backend
├── index.tsx                   # Module entry point
├── launch.sh                   # Launch script
├── package.json
├── lhi_module.json             # Module metadata
└── README.md
```

## Related Modules

- **lhi_directory_monitor** - Core bash scripts for file monitoring
- **lhi-admin-dashboard** - Parent dashboard that embeds this module
- **github-project-manager** - Another feature-module (reference implementation)
- **lhi_launch_service** - Loading screen during module startup
