/**
 * LHI Directory Monitor - Main Component
 *
 * Provides a visual interface for:
 * - Managing registered directories (registry)
 * - Starting/stopping the directory monitor per-directory
 * - Viewing file system manifests (.lhi_manifest)
 * - Managing exclude patterns (.lhi_excludes)
 * - Real-time status monitoring with recent changes
 */

import { useState, useEffect, useCallback } from "react"
import {
  FolderTree,
  Play,
  Square,
  RefreshCw,
  FileJson,
  FileX,
  ChevronRight,
  ChevronDown,
  Folder,
  File,
  AlertCircle,
  CheckCircle2,
  Loader2,
  EyeOff,
  Plus,
  Database,
  FolderPlus,
  X,
  Clock,
  Activity,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"
import { Input } from "./ui/input"
import { PORTS } from "../config/ports"

// Types
interface RegisteredDirectory {
  directory: string
  manifest: string
  lastUpdate: string
  lastUpdateEst?: string
}

interface DirectoryStatus {
  running: boolean
  pid?: number
  uptime?: string
  lastManifestUpdate?: string
}

interface ManifestEntry {
  path: string
  type: "file" | "directory"
  size?: number
  modified?: string
  children?: ManifestEntry[]
  fileCount?: number  // Recursive count of files in this directory
  dirCount?: number   // Recursive count of subdirectories in this directory
}

interface ManifestData {
  directory: string
  timestamp: string
  total_files: number
  total_directories: number
  tree: ManifestEntry[]
  error?: string
}

interface ExcludePattern {
  pattern: string
  isDirectory: boolean
  comment?: string
}

interface RecentChange {
  timestamp: string
  file: string
}

// API helper
const getApiBaseUrl = () => {
  const hostname = window.location.hostname
  const port = window.location.port

  // Production DO
  if (hostname === "lifehackinnovations.com") {
    return "/api/directory-monitor"
  }
  // Local Mac via nginx proxy
  if (hostname === "lhi.local" || port === "8080") {
    return "/api/directory-monitor"
  }
  // Direct access to backend
  return `http://localhost:${PORTS.BACKEND}/api`
}

// File tree node component - starts collapsed by default
function FileTreeNode({
  entry,
  level = 0,
  excludePatterns,
  defaultOpen = false,
}: {
  entry: ManifestEntry
  level?: number
  excludePatterns: string[]
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const isExcluded = excludePatterns.some((pattern) => {
    const cleanPattern = pattern.replace(/\*\*/g, "").replace(/\*/g, "")
    return entry.path.includes(cleanPattern) || entry.path.endsWith(cleanPattern)
  })

  const Icon = entry.type === "directory" ? Folder : File
  const hasChildren = entry.children && entry.children.length > 0

  return (
    <div style={{ marginLeft: `${level * 16}px` }}>
      <div
        className={`flex items-center gap-2 py-1 px-2 rounded hover:bg-accent/50 cursor-pointer ${
          isExcluded ? "opacity-50" : ""
        }`}
        onClick={() => hasChildren && setIsOpen(!isOpen)}
      >
        {hasChildren ? (
          isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )
        ) : (
          <span className="w-4" />
        )}
        <Icon
          className={`h-4 w-4 ${
            entry.type === "directory" ? "text-yellow-500" : "text-blue-500"
          } ${isExcluded ? "text-muted-foreground" : ""}`}
        />
        <span className={`text-sm ${isExcluded ? "text-muted-foreground line-through" : ""}`}>
          {entry.path.split("/").pop() || entry.path}
        </span>
        {isExcluded && (
          <Badge variant="outline" className="ml-2 text-xs">
            <EyeOff className="h-3 w-3 mr-1" />
            excluded
          </Badge>
        )}
        {/* Show file/dir counts for directories */}
        {entry.type === "directory" && (entry.fileCount !== undefined || entry.dirCount !== undefined) && (
          <span className="text-xs text-muted-foreground ml-auto flex gap-2">
            {entry.fileCount !== undefined && (
              <span title="Files in this folder">{entry.fileCount.toLocaleString()} files</span>
            )}
            {entry.dirCount !== undefined && (
              <span title="Subdirectories in this folder">{entry.dirCount.toLocaleString()} dirs</span>
            )}
          </span>
        )}
        {/* Show file size for files */}
        {entry.type !== "directory" && entry.size !== undefined && (
          <span className="text-xs text-muted-foreground ml-auto">
            {formatFileSize(entry.size)}
          </span>
        )}
      </div>
      {hasChildren && isOpen && (
        <div>
          {entry.children!.map((child, i) => (
            <FileTreeNode
              key={`${child.path}-${i}`}
              entry={child}
              level={level + 1}
              excludePatterns={excludePatterns}
              defaultOpen={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

// Directory tab component
function DirectoryTab({
  dir,
  isSelected,
  onClick,
  onRemove,
  status,
}: {
  dir: RegisteredDirectory
  isSelected: boolean
  onClick: () => void
  onRemove: () => void
  status?: DirectoryStatus
}) {
  const dirName = dir.directory.split("/").pop() || dir.directory

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-t-lg cursor-pointer border-b-2 transition-colors ${
        isSelected
          ? "bg-background border-primary text-foreground"
          : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted"
      }`}
      onClick={onClick}
    >
      {/* Status indicator dot */}
      <span
        className={`w-2 h-2 rounded-full ${
          status?.running ? "bg-green-500" : "bg-gray-400"
        }`}
        title={status?.running ? "Monitoring active" : "Not monitoring"}
      />
      <Folder className="h-4 w-4" />
      <span className="text-sm font-medium truncate max-w-[150px]" title={dir.directory}>
        {dirName}
      </span>
      <button
        className="ml-1 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        title="Remove from registry"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export function DirectoryMonitor() {
  // Registry state
  const [registry, setRegistry] = useState<RegisteredDirectory[]>([])
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newDirPath, setNewDirPath] = useState("")

  // Per-directory state
  const [dirStatus, setDirStatus] = useState<DirectoryStatus | null>(null)
  const [manifest, setManifest] = useState<ManifestData | null>(null)
  const [excludePatterns, setExcludePatterns] = useState<ExcludePattern[]>([])
  const [recentChanges, setRecentChanges] = useState<RecentChange[]>([])

  // UI state
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showExcludes, setShowExcludes] = useState(false)

  // Status map for all directories (for tab indicators)
  const [statusMap, setStatusMap] = useState<Record<string, DirectoryStatus>>({})

  const apiBase = getApiBaseUrl()

  // Fetch registry
  const fetchRegistry = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/registry`)
      if (response.ok) {
        const data = await response.json()
        setRegistry(data.monitors || [])

        // Auto-select first directory if none selected
        if (!selectedDir && data.monitors?.length > 0) {
          setSelectedDir(data.monitors[0].directory)
        }
      }
    } catch (err) {
      console.error("Failed to fetch registry:", err)
    }
  }, [apiBase, selectedDir])

  // Fetch status for a specific directory
  const fetchDirStatus = useCallback(async (dir: string) => {
    try {
      const encodedPath = encodeURIComponent(dir)
      const response = await fetch(`${apiBase}/status/${encodedPath}`)
      if (response.ok) {
        const data = await response.json()
        return data as DirectoryStatus
      }
    } catch (err) {
      console.error("Failed to fetch status:", err)
    }
    return null
  }, [apiBase])

  // Fetch status for all directories (for tab indicators)
  const fetchAllStatuses = useCallback(async () => {
    const newStatusMap: Record<string, DirectoryStatus> = {}
    for (const dir of registry) {
      const status = await fetchDirStatus(dir.directory)
      if (status) {
        newStatusMap[dir.directory] = status
      }
    }
    setStatusMap(newStatusMap)
  }, [registry, fetchDirStatus])

  // Fetch manifest for selected directory
  const fetchManifest = useCallback(async () => {
    if (!selectedDir) return

    try {
      const encodedPath = encodeURIComponent(selectedDir)
      const response = await fetch(`${apiBase}/manifest/${encodedPath}`)
      if (response.ok) {
        const data = await response.json()
        setManifest(data)
      }
    } catch (err) {
      console.error("Failed to fetch manifest:", err)
    }
  }, [apiBase, selectedDir])

  // Fetch exclude patterns for selected directory
  const fetchExcludes = useCallback(async () => {
    if (!selectedDir) return

    try {
      const encodedPath = encodeURIComponent(selectedDir)
      const response = await fetch(`${apiBase}/excludes/${encodedPath}`)
      if (response.ok) {
        const data = await response.json()
        setExcludePatterns(data.patterns || [])
      }
    } catch (err) {
      console.error("Failed to fetch excludes:", err)
    }
  }, [apiBase, selectedDir])

  // Fetch recent changes for selected directory
  const fetchRecentChanges = useCallback(async () => {
    if (!selectedDir) return

    try {
      const encodedPath = encodeURIComponent(selectedDir)
      const response = await fetch(`${apiBase}/changes/${encodedPath}`)
      if (response.ok) {
        const data = await response.json()
        setRecentChanges(data.recentChanges || [])
      }
    } catch (err) {
      console.error("Failed to fetch recent changes:", err)
    }
  }, [apiBase, selectedDir])

  // Initial fetch
  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await fetchRegistry()
      setLoading(false)
    }
    init()

    // Poll registry every 10 seconds
    const interval = setInterval(() => {
      fetchRegistry()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchRegistry])

  // Fetch all statuses when registry changes
  useEffect(() => {
    if (registry.length > 0) {
      fetchAllStatuses()
    }
  }, [registry, fetchAllStatuses])

  // Poll statuses every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (registry.length > 0) {
        fetchAllStatuses()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [registry, fetchAllStatuses])

  // Fetch manifest, excludes, and status when selected directory changes
  useEffect(() => {
    if (selectedDir) {
      fetchManifest()
      fetchExcludes()
      fetchRecentChanges()
      fetchDirStatus(selectedDir).then(status => {
        if (status) setDirStatus(status)
      })
    }
  }, [selectedDir, fetchManifest, fetchExcludes, fetchRecentChanges, fetchDirStatus])

  // Poll selected directory's data every 5 seconds
  useEffect(() => {
    if (!selectedDir) return

    const interval = setInterval(() => {
      fetchManifest()
      fetchRecentChanges()
      fetchDirStatus(selectedDir).then(status => {
        if (status) setDirStatus(status)
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [selectedDir, fetchManifest, fetchRecentChanges, fetchDirStatus])

  // Add directory to registry
  const addDirectory = async () => {
    if (!newDirPath.trim()) return

    setActionLoading("add")
    try {
      const response = await fetch(`${apiBase}/registry/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: newDirPath.trim() }),
      })

      if (response.ok) {
        await fetchRegistry()
        setNewDirPath("")
        setShowAddDialog(false)
        // Select the newly added directory
        setSelectedDir(newDirPath.trim())
      } else {
        const data = await response.json()
        setError(data.error || "Failed to add directory")
      }
    } catch (err) {
      setError("Failed to add directory")
    }
    setActionLoading(null)
  }

  // Remove directory from registry
  const removeDirectory = async (directory: string) => {
    setActionLoading("remove")
    try {
      const response = await fetch(`${apiBase}/registry/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory }),
      })

      if (response.ok) {
        await fetchRegistry()
        // If we removed the selected directory, select the first remaining one
        if (selectedDir === directory) {
          const remaining = registry.filter(r => r.directory !== directory)
          setSelectedDir(remaining.length > 0 ? remaining[0].directory : null)
        }
      } else {
        const data = await response.json()
        setError(data.error || "Failed to remove directory")
      }
    } catch (err) {
      setError("Failed to remove directory")
    }
    setActionLoading(null)
  }

  // Start monitor for selected directory
  const startMonitor = async () => {
    if (!selectedDir) return

    setActionLoading("start")
    setError(null) // Clear any previous errors
    try {
      const encodedPath = encodeURIComponent(selectedDir)
      const response = await fetch(`${apiBase}/start/${encodedPath}`, {
        method: "POST",
      })
      const data = await response.json()

      if (response.ok || data.success) {
        // Refresh status and manifest after starting
        const status = await fetchDirStatus(selectedDir)
        if (status) setDirStatus(status)
        await fetchAllStatuses()
        await fetchManifest() // Refresh manifest to show file tree
        await fetchRecentChanges()
      } else {
        setError(data.error || data.message || "Failed to start monitor")
      }
    } catch (err) {
      console.error("Start monitor error:", err)
      setError(`Failed to start monitor: ${err instanceof Error ? err.message : "Network error"}`)
    }
    setActionLoading(null)
  }

  // Stop monitor for selected directory
  const stopMonitor = async () => {
    if (!selectedDir) return

    setActionLoading("stop")
    setError(null) // Clear any previous errors
    try {
      const encodedPath = encodeURIComponent(selectedDir)
      const response = await fetch(`${apiBase}/stop/${encodedPath}`, {
        method: "POST",
      })
      const data = await response.json()

      if (response.ok || data.success) {
        // Refresh status after stopping
        const status = await fetchDirStatus(selectedDir)
        if (status) setDirStatus(status)
        await fetchAllStatuses()
      } else {
        setError(data.error || data.message || "Failed to stop monitor")
      }
    } catch (err) {
      console.error("Stop monitor error:", err)
      setError(`Failed to stop monitor: ${err instanceof Error ? err.message : "Network error"}`)
    }
    setActionLoading(null)
  }

  // Refresh manifest for selected directory
  const refreshManifest = async () => {
    if (!selectedDir) return

    setActionLoading("refresh")
    try {
      const encodedPath = encodeURIComponent(selectedDir)
      const response = await fetch(`${apiBase}/refresh/${encodedPath}`, { method: "POST" })
      if (response.ok) {
        await fetchManifest()
      }
    } catch (err) {
      setError("Failed to refresh manifest")
    }
    setActionLoading(null)
  }

  // Get the root directory name for display
  const getRootDirName = () => {
    if (!selectedDir) return null
    return selectedDir.split("/").pop() || selectedDir
  }

  // Build tree with root directory wrapper
  const getTreeWithRoot = () => {
    if (!manifest?.tree || manifest.tree.length === 0) return []

    const rootName = getRootDirName()
    if (!rootName) return manifest.tree

    // Wrap the tree in a root directory node
    return [{
      path: rootName,
      type: "directory" as const,
      children: manifest.tree,
    }]
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderTree className="h-6 w-6" />
            Directory Monitor
          </h1>
          <p className="text-muted-foreground">
            Real-time file system monitoring with manifest generation
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span className="text-destructive">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Main Registry Card - contains everything */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4" />
                Registered Directories ({registry.length})
              </CardTitle>
              <CardDescription>
                Select a directory to view and manage its monitor
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddDialog(true)}
              className="gap-1"
            >
              <FolderPlus className="h-4 w-4" />
              Add Directory
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add Directory Dialog */}
          {showAddDialog && (
            <div className="p-3 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="/path/to/directory"
                  value={newDirPath}
                  onChange={(e) => setNewDirPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addDirectory()}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={addDirectory}
                  disabled={actionLoading === "add" || !newDirPath.trim()}
                >
                  {actionLoading === "add" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAddDialog(false)
                    setNewDirPath("")
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Directory Tabs */}
          {registry.length > 0 ? (
            <div className="flex flex-wrap gap-1 border-b">
              {registry.map((dir) => (
                <DirectoryTab
                  key={dir.directory}
                  dir={dir}
                  isSelected={selectedDir === dir.directory}
                  onClick={() => setSelectedDir(dir.directory)}
                  onRemove={() => removeDirectory(dir.directory)}
                  status={statusMap[dir.directory]}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Database className="h-8 w-8 mb-2" />
              <p>No directories registered</p>
              <p className="text-xs">Click "Add Directory" to start monitoring</p>
            </div>
          )}

          {/* Selected Directory Content */}
          {selectedDir && (
            <div className="space-y-4 pt-2">
              {/* Directory Info Bar with Controls */}
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-4">
                  {/* Status Badge */}
                  <div className="flex items-center gap-2">
                    {dirStatus?.running ? (
                      <Badge variant="default" className="gap-1">
                        <Activity className="h-3 w-3" />
                        Monitoring
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <Square className="h-3 w-3" />
                        Stopped
                      </Badge>
                    )}
                    {dirStatus?.pid && (
                      <span className="text-xs text-muted-foreground">
                        PID: {dirStatus.pid}
                      </span>
                    )}
                    {dirStatus?.uptime && (
                      <span className="text-xs text-muted-foreground">
                        Uptime: {dirStatus.uptime}
                      </span>
                    )}
                  </div>

                  {/* Manifest Stats */}
                  {manifest && !manifest.error && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground border-l pl-4">
                      <FileJson className="h-3 w-3" />
                      <span>{manifest.total_files} files</span>
                      <span>•</span>
                      <span>{manifest.total_directories} dirs</span>
                    </div>
                  )}
                </div>

                {/* Control Buttons */}
                <div className="flex gap-2">
                  <Button
                    variant={dirStatus?.running ? "destructive" : "default"}
                    size="sm"
                    onClick={dirStatus?.running ? stopMonitor : startMonitor}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "start" || actionLoading === "stop" ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : dirStatus?.running ? (
                      <Square className="h-4 w-4 mr-1" />
                    ) : (
                      <Play className="h-4 w-4 mr-1" />
                    )}
                    {dirStatus?.running ? "Stop" : "Start"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshManifest}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "refresh" ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Recent Changes */}
              {recentChanges.length > 0 && (
                <div className="p-3 bg-muted/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Recent Changes</span>
                  </div>
                  <div className="space-y-1 font-mono text-xs">
                    {recentChanges.slice(0, 3).map((change, i) => (
                      <div key={i} className="flex items-center gap-2 text-muted-foreground">
                        <span className="text-blue-500">{change.timestamp}</span>
                        <span>→</span>
                        <span className="truncate">{change.file}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Path Display */}
              <div className="text-xs text-muted-foreground font-mono p-2 bg-muted/20 rounded">
                {selectedDir}
              </div>

              {/* Exclude Patterns */}
              <Collapsible open={showExcludes} onOpenChange={setShowExcludes}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <FileX className="h-4 w-4" />
                    Exclude Patterns ({excludePatterns.length})
                  </span>
                  {showExcludes ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pt-2">
                    {excludePatterns.length > 0 ? (
                      <div className="space-y-1 font-mono text-sm max-h-32 overflow-auto">
                        {excludePatterns.map((p, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-2 py-1 rounded bg-muted/50"
                          >
                            <EyeOff className="h-3 w-3 text-muted-foreground" />
                            <span>{p.pattern}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No exclude patterns configured</p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* File Tree */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FolderTree className="h-4 w-4" />
                  <span className="text-sm font-medium">File Tree</span>
                  {manifest?.timestamp && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      Last update: {manifest.timestamp}
                    </span>
                  )}
                </div>
                {manifest?.tree && manifest.tree.length > 0 ? (
                  <div className="max-h-80 overflow-auto border rounded-lg p-2">
                    {getTreeWithRoot().map((entry, i) => (
                      <FileTreeNode
                        key={`${entry.path}-${i}`}
                        entry={entry}
                        excludePatterns={excludePatterns.map((p) => p.pattern)}
                        defaultOpen={true} // Root is open by default
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-24 text-muted-foreground border rounded-lg">
                    <FolderTree className="h-6 w-6 mb-1" />
                    <p className="text-sm">No manifest data available</p>
                    <p className="text-xs">Click "Refresh" to generate a manifest</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
