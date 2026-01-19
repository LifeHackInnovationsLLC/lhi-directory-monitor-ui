/**
 * Port configuration for LHI Directory Monitor
 *
 * Backend: 7014 - Express API server that interfaces with bash scripts
 * Frontend: 7015 - Vite dev server (standalone mode only)
 */

export const PORTS = {
  BACKEND: 7014,
  FRONTEND: 7015,
} as const

export type PortKey = keyof typeof PORTS
