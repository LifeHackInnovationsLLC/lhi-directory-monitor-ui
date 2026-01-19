/**
 * LHI Directory Monitor - Module Export
 *
 * This file re-exports the DirectoryMonitor component for use in other projects
 * (like lhi-admin-dashboard). The actual implementation is in src/components/.
 *
 * For standalone usage, import directly from src/components/DirectoryMonitor.
 * For embedded usage (admin dashboard), import from this file.
 */

export { DirectoryMonitor } from "../src/components/DirectoryMonitor"
