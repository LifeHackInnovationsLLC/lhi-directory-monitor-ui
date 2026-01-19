/**
 * LHI Directory Monitor - Module Entry Point
 *
 * This file exports the module configuration and main component
 * for integration with the LHI Admin Dashboard module system.
 *
 * Usage in Admin Dashboard:
 *   import DirectoryMonitorModule from "@lhi-modules/lhi-directory-monitor-ui"
 *   const modules = loadModules([DirectoryMonitorModule])
 */

import { FolderTree } from "lucide-react"
import { DirectoryMonitor } from "./components/DirectoryMonitor"
import type { LHIModule } from "@/lib/lhi-modules"
import { PORTS } from "./config/ports"

/**
 * Module configuration
 * This defines how the module appears in the Admin Dashboard
 */
const config = {
  id: "directory-monitor",
  name: "Directory Monitor",
  icon: FolderTree,
  port: PORTS.BACKEND,
  apiPath: "/api/directory-monitor",
  version: "0.1.0",
  description: "Real-time file system monitoring with manifest generation and exclude pattern management",
  requiresBackend: true,
  launchScript: "lhi_modules/lhi_git_projects/LifeHackInnovationsLLC/lhi-directory-monitor-ui/launch.sh",
  healthCheckPath: "/api/directory-monitor/health",
  serviceName: "lhi-directory-monitor", // For DigitalOcean systemd
}

/**
 * Module export for LHI Admin Dashboard
 * Import this in App.tsx and pass to loadModules()
 */
const DirectoryMonitorModule: LHIModule = {
  config,
  component: DirectoryMonitor,
}

export default DirectoryMonitorModule

// Named exports for flexibility
export { DirectoryMonitor, config }
