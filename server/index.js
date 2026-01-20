/**
 * LHI Directory Monitor - Backend API Server
 *
 * Express server that provides REST API for:
 * - Monitor daemon control (start/stop/status)
 * - Manifest file reading
 * - Exclude pattern management
 *
 * Port: 7014
 */

import express from "express"
import cors from "cors"
import { spawn, exec } from "child_process"
import { promisify } from "util"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const execAsync = promisify(exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 7014

// Paths
const MONITOR_DIR = path.resolve(
  __dirname,
  "../../lhi_node_modules/lhi_directory_monitor"
)
const DAEMON_SCRIPT = path.join(MONITOR_DIR, "src/lhi_directory_monitor_daemon.sh")
const STATUS_SCRIPT = path.join(MONITOR_DIR, "src/lhi_directory_monitor_status.sh")
const REGISTRY_SCRIPT = path.join(MONITOR_DIR, "src/lhi_directory_monitor_registry.sh")

// Registry file location - cross-platform
// macOS: ~/Library/Application Support/LHI/DirectoryMonitor/registry.json
// Linux: ~/.config/lhi/directory-monitor/registry.json
const REGISTRY_FILE = path.join(
  process.env.HOME,
  process.platform === "darwin"
    ? "Library/Application Support/LHI/DirectoryMonitor/registry.json"
    : ".config/lhi/directory-monitor/registry.json"
)

// Default watched path - MUST use LHI_SCRIPTS_ROOT environment variable
// No hardcoded paths - path independence is mandatory
const DEFAULT_WATCHED_PATH = process.env.LHI_SCRIPTS_ROOT || null

app.use(cors())
app.use(express.json())

// Helper: Normalize path from URL parameter
// nginx proxy may decode %2F to / and strip leading /, so we need to handle both cases
function normalizePathParam(encodedPath) {
  let watchPath = decodeURIComponent(encodedPath)
  // Ensure absolute path (nginx proxy may strip leading /)
  if (!watchPath.startsWith("/")) {
    watchPath = "/" + watchPath
  }
  return watchPath
}

// Health check (both paths for direct access and nginx proxy)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "lhi-directory-monitor-backend", port: PORT })
})

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "lhi-directory-monitor-backend", port: PORT })
})

// ============================================================
// REGISTRY API ENDPOINTS
// ============================================================

// Get all registered directories
app.get("/api/registry", async (req, res) => {
  try {
    // Read registry file directly (faster than calling bash script)
    try {
      await fs.access(REGISTRY_FILE)
      const content = await fs.readFile(REGISTRY_FILE, "utf-8")
      const registry = JSON.parse(content)

      // Convert to array format for easier UI consumption
      const monitors = Object.entries(registry.monitors || {}).map(([dir, data]) => ({
        directory: dir,
        manifest: data.manifest,
        lastUpdate: data.last_update,
        lastUpdateEst: data.last_update_est,
      }))

      res.json({ monitors })
    } catch {
      // Registry doesn't exist yet
      res.json({ monitors: [] })
    }
  } catch (error) {
    console.error("Registry read error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Add a directory to registry
app.post("/api/registry/add", async (req, res) => {
  try {
    const { directory } = req.body

    if (!directory) {
      return res.status(400).json({ error: "Directory path is required" })
    }

    // Verify directory exists
    try {
      await fs.access(directory)
    } catch {
      return res.status(400).json({ error: `Directory does not exist: ${directory}` })
    }

    // Call the registry script to add the directory
    const { stdout, stderr } = await execAsync(
      `bash "${REGISTRY_SCRIPT}" add "${directory}"`,
      { cwd: MONITOR_DIR }
    )

    res.json({
      success: true,
      message: `Directory added: ${directory}`,
      output: stdout
    })
  } catch (error) {
    console.error("Registry add error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Remove a directory from registry
app.post("/api/registry/remove", async (req, res) => {
  try {
    const { directory } = req.body

    if (!directory) {
      return res.status(400).json({ error: "Directory path is required" })
    }

    // Call the registry script to remove the directory
    const { stdout, stderr } = await execAsync(
      `bash "${REGISTRY_SCRIPT}" remove-direct "${directory}"`,
      { cwd: MONITOR_DIR }
    )

    res.json({
      success: true,
      message: `Directory removed: ${directory}`,
      output: stdout
    })
  } catch (error) {
    console.error("Registry remove error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get manifest for a specific directory (dynamic path)
// Uses wildcard (*) to capture the entire path including slashes when nginx decodes them
app.get("/api/manifest/*", async (req, res) => {
  try {
    const watchPath = normalizePathParam(req.params[0])
    const manifestPath = path.join(watchPath, ".lhi_manifest")

    // Check if manifest exists
    try {
      await fs.access(manifestPath)
    } catch {
      return res.json({
        directory: watchPath,
        timestamp: null,
        total_files: 0,
        total_directories: 0,
        tree: [],
        error: "No manifest file found. Click Refresh to generate one.",
      })
    }

    const content = await fs.readFile(manifestPath, "utf-8")
    const parsed = parseTextManifest(content)

    res.json({
      directory: parsed.directory || watchPath,
      timestamp: parsed.timestamp || new Date().toISOString(),
      total_files: parsed.total_files || 0,
      total_directories: parsed.total_directories || 0,
      tree: parsed.tree || [],
    })
  } catch (error) {
    console.error("Manifest read error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get excludes for a specific directory
// PRIORITY ORDER (matches lhi_directory_monitor_utils.sh):
// 1. .lhi_excludes - Single source of truth for all LHI tools including Mutagen
// 2. .gitignore - Standard git ignore (fallback)
app.get("/api/excludes/*", async (req, res) => {
  try {
    const watchPath = normalizePathParam(req.params[0])

    // PRIORITY 1: .lhi_excludes - Single source of truth (Mutagen-aligned patterns)
    const excludePath = path.join(watchPath, ".lhi_excludes")
    try {
      await fs.access(excludePath)
      const content = await fs.readFile(excludePath, "utf-8")
      return res.json({ patterns: parseExcludes(content), source: ".lhi_excludes" })
    } catch {
      // Not found, try next priority
    }

    // PRIORITY 2: Standard .gitignore (fallback)
    const gitignorePath = path.join(watchPath, ".gitignore")
    try {
      await fs.access(gitignorePath)
      const content = await fs.readFile(gitignorePath, "utf-8")
      return res.json({ patterns: parseExcludes(content), source: ".gitignore" })
    } catch {
      return res.json({ patterns: [], source: null })
    }
  } catch (error) {
    console.error("Excludes read error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Refresh manifest for a specific directory
app.post("/api/refresh/*", async (req, res) => {
  try {
    const watchPath = normalizePathParam(req.params[0])
    const monitorScript = path.join(MONITOR_DIR, "src/lhi_directory_monitor.sh")

    const child = spawn("bash", [monitorScript, "-d", watchPath], {
      cwd: MONITOR_DIR,
      detached: true,
      stdio: "ignore",
    })

    // Wait for the manifest to be generated
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Kill the monitor since we only wanted the initial manifest
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch (e) {
      // Process may have already exited
    }

    res.json({ success: true, message: "Manifest refreshed" })
  } catch (error) {
    console.error("Refresh error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get monitor status for a specific directory
app.get("/api/status/*", async (req, res) => {
  try {
    const watchPath = normalizePathParam(req.params[0])

    // Check if fswatch is monitoring this specific directory
    const { stdout } = await execAsync(
      `pgrep -f "fswatch.*${watchPath}" || true`
    )
    const pids = stdout.trim().split("\n").filter(Boolean)
    const running = pids.length > 0

    let uptime = null
    if (running && pids[0]) {
      try {
        const { stdout: psOut } = await execAsync(`ps -p ${pids[0]} -o etime= || true`)
        uptime = psOut.trim()
      } catch (e) {
        // Ignore
      }
    }

    // Get manifest last modified time
    const manifestPath = path.join(watchPath, ".lhi_manifest")
    let lastManifestUpdate = null
    try {
      const stats = await fs.stat(manifestPath)
      lastManifestUpdate = stats.mtime.toISOString()
    } catch {
      // No manifest
    }

    res.json({
      running,
      pid: running ? parseInt(pids[0]) : null,
      watchedPath: watchPath,
      uptime,
      lastManifestUpdate,
    })
  } catch (error) {
    console.error("Status check error:", error)
    res.json({
      running: false,
      pid: null,
      watchedPath: normalizePathParam(req.params[0]),
      error: error.message,
    })
  }
})

// Get recent file changes for a directory (reads from log files or manifest mtime)
app.get("/api/changes/*", async (req, res) => {
  try {
    const watchPath = normalizePathParam(req.params[0])
    const logsDir = path.join(MONITOR_DIR, "logs")

    // Get directory short name for log file matching
    const dirName = path.basename(watchPath)

    // Find the most recent log directory for this watch path
    let recentChanges = []

    try {
      const logDirs = await fs.readdir(logsDir)

      // Find log directories that match this directory name
      const matchingDirs = logDirs.filter(d =>
        d.startsWith("ldm_") && d.includes(dirName.toLowerCase().replace(/[^a-z0-9]/g, "_"))
      )

      if (matchingDirs.length > 0) {
        // Sort by directory modification time to get most recent
        const dirsWithStats = await Promise.all(
          matchingDirs.map(async (d) => {
            const stats = await fs.stat(path.join(logsDir, d))
            return { name: d, mtime: stats.mtime }
          })
        )
        dirsWithStats.sort((a, b) => b.mtime - a.mtime)
        const latestDir = dirsWithStats[0].name
        const logDirPath = path.join(logsDir, latestDir)

        // Find log files in this directory
        const logFiles = await fs.readdir(logDirPath)
        const logFile = logFiles.find(f => f.endsWith(".log"))

        if (logFile) {
          const logContent = await fs.readFile(path.join(logDirPath, logFile), "utf-8")

          // Extract change lines: [timestamp][fswatch] Change detected: filename
          const lines = logContent.split("\n")
          const changeLines = lines.filter(line =>
            line.includes("[fswatch] Change detected:")
          )

          // Get last 5 changes
          recentChanges = changeLines.slice(-5).map(line => {
            const match = line.match(/\[([^\]]+)\]\[fswatch\] Change detected: (.+)/)
            if (match) {
              return {
                timestamp: match[1],
                file: match[2],
              }
            }
            return null
          }).filter(Boolean).reverse()
        }
      }
    } catch (logError) {
      console.log("Could not read logs:", logError.message)
    }

    // Also get manifest modification time as a fallback indicator
    const manifestPath = path.join(watchPath, ".lhi_manifest")
    let manifestMtime = null
    try {
      const stats = await fs.stat(manifestPath)
      manifestMtime = stats.mtime.toISOString()
    } catch {
      // No manifest
    }

    res.json({
      recentChanges,
      manifestLastModified: manifestMtime,
    })
  } catch (error) {
    console.error("Changes read error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Start monitor for a specific directory
app.post("/api/start/*", async (req, res) => {
  try {
    const watchPath = normalizePathParam(req.params[0])

    // Check if already running for this directory
    const { stdout } = await execAsync(`pgrep -f "fswatch.*${watchPath}" || true`)
    if (stdout.trim()) {
      return res.json({ success: true, message: "Monitor already running for this directory" })
    }

    // Start the monitor for this specific directory
    const monitorScript = path.join(MONITOR_DIR, "src/lhi_directory_monitor.sh")
    const child = spawn("bash", [monitorScript, "-d", watchPath, "--verbose"], {
      detached: true,
      stdio: "ignore",
      cwd: MONITOR_DIR,
    })
    child.unref()

    // Wait a moment for process to start
    await new Promise((resolve) => setTimeout(resolve, 2000))

    res.json({ success: true, message: `Monitor started for ${watchPath}` })
  } catch (error) {
    console.error("Start error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Stop monitor for a specific directory
app.post("/api/stop/*", async (req, res) => {
  try {
    const watchPath = normalizePathParam(req.params[0])

    // Kill fswatch processes monitoring this specific directory
    await execAsync(`pkill -f "fswatch.*${watchPath}" || true`)

    // Also kill any lhi_directory_monitor processes for this directory
    await execAsync(`pkill -f "lhi_directory_monitor.*${watchPath}" || true`)

    res.json({ success: true, message: `Monitor stopped for ${watchPath}` })
  } catch (error) {
    console.error("Stop error:", error)
    res.status(500).json({ error: error.message })
  }
})

// ============================================================
// LEGACY API ENDPOINTS (for backward compatibility)
// ============================================================

// Get monitor status
app.get("/api/status", async (req, res) => {
  try {
    // Check if daemon process is running
    const { stdout } = await execAsync("pgrep -f 'lhi_directory_monitor_daemon.sh' || true")
    const pids = stdout.trim().split("\n").filter(Boolean)
    const running = pids.length > 0

    let uptime = null
    if (running && pids[0]) {
      try {
        const { stdout: psOut } = await execAsync(`ps -p ${pids[0]} -o etime= || true`)
        uptime = psOut.trim()
      } catch (e) {
        // Ignore
      }
    }

    res.json({
      running,
      pid: running ? parseInt(pids[0]) : null,
      watchedPath: DEFAULT_WATCHED_PATH,
      uptime,
      lastUpdate: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Status check error:", error)
    res.json({
      running: false,
      pid: null,
      watchedPath: DEFAULT_WATCHED_PATH,
      error: error.message,
    })
  }
})

// Get manifest data
app.get("/api/manifest", async (req, res) => {
  try {
    const manifestPath = path.join(DEFAULT_WATCHED_PATH, ".lhi_manifest")

    // Check if manifest exists
    try {
      await fs.access(manifestPath)
    } catch {
      return res.json({
        directory: DEFAULT_WATCHED_PATH,
        timestamp: null,
        total_files: 0,
        total_directories: 0,
        tree: [],
        error: "No manifest file found. Start the monitor to generate one.",
      })
    }

    const content = await fs.readFile(manifestPath, "utf-8")

    // Parse the text-based manifest format
    const parsed = parseTextManifest(content)

    res.json({
      directory: parsed.directory || DEFAULT_WATCHED_PATH,
      timestamp: parsed.timestamp || new Date().toISOString(),
      total_files: parsed.total_files || 0,
      total_directories: parsed.total_directories || 0,
      tree: parsed.tree || [],
    })
  } catch (error) {
    console.error("Manifest read error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Get exclude patterns (legacy endpoint)
// PRIORITY ORDER (matches lhi_directory_monitor_utils.sh):
// 1. .lhi_excludes - Single source of truth (Mutagen-aligned patterns)
// 2. .gitignore - Standard git ignore (fallback)
app.get("/api/excludes", async (req, res) => {
  try {
    // PRIORITY 1: .lhi_excludes - Single source of truth
    const excludePath = path.join(DEFAULT_WATCHED_PATH, ".lhi_excludes")
    try {
      await fs.access(excludePath)
      const content = await fs.readFile(excludePath, "utf-8")
      return res.json({ patterns: parseExcludes(content), source: ".lhi_excludes" })
    } catch {
      // Not found, try next priority
    }

    // PRIORITY 2: .gitignore fallback
    const gitignorePath = path.join(DEFAULT_WATCHED_PATH, ".gitignore")
    try {
      await fs.access(gitignorePath)
      const content = await fs.readFile(gitignorePath, "utf-8")
      return res.json({ patterns: parseExcludes(content), source: ".gitignore" })
    } catch {
      return res.json({ patterns: [], source: null })
    }
  } catch (error) {
    console.error("Excludes read error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Start monitor
app.post("/api/start", async (req, res) => {
  try {
    const watchPath = req.body.path || DEFAULT_WATCHED_PATH

    // Check if already running
    const { stdout } = await execAsync("pgrep -f 'lhi_directory_monitor_daemon.sh' || true")
    if (stdout.trim()) {
      return res.json({ success: true, message: "Monitor already running" })
    }

    // Start the daemon
    const child = spawn("bash", [DAEMON_SCRIPT, "start", watchPath], {
      detached: true,
      stdio: "ignore",
      cwd: MONITOR_DIR,
    })
    child.unref()

    // Wait a moment for process to start
    await new Promise((resolve) => setTimeout(resolve, 1000))

    res.json({ success: true, message: "Monitor started" })
  } catch (error) {
    console.error("Start error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Stop monitor
app.post("/api/stop", async (req, res) => {
  try {
    // Kill all related processes
    await execAsync("pkill -f 'lhi_directory_monitor' || true")
    await execAsync("pkill -f 'fswatch.*lhi_scripts' || true")

    res.json({ success: true, message: "Monitor stopped" })
  } catch (error) {
    console.error("Stop error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Refresh manifest - triggers a one-time scan of the directory
app.post("/api/refresh", async (req, res) => {
  try {
    const watchPath = req.body.path || DEFAULT_WATCHED_PATH

    // Run the monitor script briefly to generate fresh manifest
    // The script will create/update .lhi_manifest in the watched directory
    const monitorScript = path.join(MONITOR_DIR, "src/lhi_directory_monitor.sh")

    // Start the monitor script which generates the manifest
    // We run it in a subshell and let it create the manifest, then it will be killed
    const child = spawn("bash", [monitorScript, "-d", watchPath], {
      cwd: MONITOR_DIR,
      detached: true,
      stdio: "ignore",
    })

    // Wait for the manifest to be generated (initial scan takes a few seconds)
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Kill the monitor since we only wanted the initial manifest
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch (e) {
      // Process may have already exited
    }

    res.json({ success: true, message: "Manifest refreshed" })
  } catch (error) {
    console.error("Refresh error:", error)
    res.status(500).json({ error: error.message })
  }
})

// Helper: Parse the text-based manifest format
// Format:
// ======================================================================
// LHI Directory Monitor - MANIFEST
// ======================================================================
// Monitor PID: 2113
// Generated by: LifeHack Innovations Directory Monitor v1.1
// Timestamp: 2026-01-19 04:10:57 PM EST
// Directory: /Users/patrickwatson/lhi_scripts
// ...
// File Listing:
// -------------
// ".claude/PLAN.md" (4422 bytes) - Modified: 2025-08-06 13:58:55
// ...
// Summary:
// --------
// Total Files: 123
// Total Directories: 45
function parseTextManifest(content) {
  const lines = content.split("\n")
  const result = {
    directory: null,
    timestamp: null,
    total_files: 0,
    total_directories: 0,
    tree: [],
  }

  const files = []
  let inFileListing = false
  let inSummary = false

  for (const line of lines) {
    // Parse header info
    if (line.startsWith("Timestamp:")) {
      result.timestamp = line.replace("Timestamp:", "").trim()
    } else if (line.startsWith("Directory:")) {
      result.directory = line.replace("Directory:", "").trim()
    } else if (line.startsWith("File Listing:")) {
      inFileListing = true
      inSummary = false
      continue
    } else if (line.startsWith("Summary:")) {
      inFileListing = false
      inSummary = true
      continue
    } else if (line.startsWith("-------------") || line.startsWith("--------")) {
      continue
    }

    // Parse summary section (takes precedence for counts)
    if (inSummary && line.trim()) {
      const filesMatch = line.match(/^Total Files:\s*(\d+)/)
      const dirsMatch = line.match(/^Total Directories:\s*(\d+)/)
      if (filesMatch) {
        result.total_files = parseInt(filesMatch[1], 10)
      }
      if (dirsMatch) {
        result.total_directories = parseInt(dirsMatch[1], 10)
      }
    }

    // Parse file entries
    if (inFileListing && line.trim() && !line.startsWith("Summary:")) {
      // Format: "path/to/file.ext" (1234 bytes) - Modified: 2025-08-06 13:58:55
      const match = line.match(/^"([^"]+)"\s+\((\d+)\s+bytes\)\s+-\s+Modified:\s+(.+)$/)
      if (match) {
        const [, filePath, size, modified] = match
        files.push({
          path: filePath,
          type: "file",
          size: parseInt(size, 10),
          modified: modified.trim(),
        })
      }
    }
  }

  // If summary section didn't provide counts, calculate from files
  if (result.total_files === 0) {
    result.total_files = files.length
  }

  // Count unique directories from file paths if summary didn't provide it
  if (result.total_directories === 0 && files.length > 0) {
    const directories = new Set()
    for (const file of files) {
      const parts = file.path.split("/")
      let currentPath = ""
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
        directories.add(currentPath)
      }
    }
    result.total_directories = directories.size
  }

  // Build tree structure
  result.tree = buildTreeFromFiles(files)

  return result
}

// Helper: Parse exclude patterns
function parseExcludes(content) {
  const patterns = []
  const lines = content.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const isDirectory = trimmed.endsWith("/")
    patterns.push({
      pattern: trimmed,
      isDirectory,
    })
  }

  return patterns
}

// Helper: Build tree from flat file list
function buildTreeFromFiles(files) {
  const tree = []
  const pathMap = new Map()

  for (const file of files) {
    const parts = file.path.split("/")
    let currentLevel = tree
    let currentPath = ""

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLast = i === parts.length - 1

      let existing = currentLevel.find((e) => e.path === currentPath)
      if (!existing) {
        existing = {
          path: currentPath,
          type: isLast && file.type !== "directory" ? "file" : "directory",
          size: isLast ? file.size : undefined,
          modified: isLast ? file.modified : undefined,
          children: isLast && file.type !== "directory" ? undefined : [],
        }
        currentLevel.push(existing)
      }

      if (existing.children) {
        currentLevel = existing.children
      }
    }
  }

  return tree
}

app.listen(PORT, () => {
  console.log(`LHI Directory Monitor Backend running on port ${PORT}`)
  console.log(`Registry file: ${REGISTRY_FILE}`)
  console.log(`Monitor scripts: ${MONITOR_DIR}`)
  console.log(`Platform: ${process.platform}`)

  if (!process.env.LHI_SCRIPTS_ROOT) {
    console.warn(`WARNING: LHI_SCRIPTS_ROOT environment variable not set!`)
    console.warn(`Path independence requires LHI_SCRIPTS_ROOT to be defined.`)
    console.warn(`Set it in your shell profile or systemd service file.`)
  } else {
    console.log(`LHI_SCRIPTS_ROOT: ${process.env.LHI_SCRIPTS_ROOT}`)
  }
})
