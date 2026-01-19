#!/bin/bash

# LHI Directory Monitor - Launch Script
# Single command to start/stop all required services
#
# Usage:
#   ./launch.sh [start|stop|restart|status|logs]
#
# Ports:
#   Backend: 7014
#   Frontend: 7015 (standalone mode only)

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Source LHI Launch Service helpers if available (for loading screen during startup)
LHI_LAUNCH_HELPERS="${LHI_SCRIPTS_ROOT:-/Users/patrickwatson/lhi_scripts}/lhi_modules/lhi_utility_modules/lhi_launch_service/helpers/launch-helpers.sh"
if [ -f "$LHI_LAUNCH_HELPERS" ]; then
    source "$LHI_LAUNCH_HELPERS"
fi

# Ports
BACKEND_PORT=7014
FRONTEND_PORT=7015

# PID files
BACKEND_PID_FILE="$SCRIPT_DIR/.backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/.frontend.pid"

# Log directory
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Kill process on port
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}Killing process on port $port (PID: $pid)${NC}"
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi
}

# Check if process is running
is_running() {
    local pid_file=$1
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p $pid > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Start backend
start_backend() {
    echo -e "${BLUE}Starting backend on port $BACKEND_PORT...${NC}"

    # Kill any existing process on port
    kill_port $BACKEND_PORT

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install
    fi

    # Start backend
    nohup node server/index.js > "$LOG_DIR/backend.log" 2>&1 &
    echo $! > "$BACKEND_PID_FILE"

    # Wait for startup
    sleep 2

    # Verify it started
    if is_running "$BACKEND_PID_FILE"; then
        echo -e "${GREEN}Backend started successfully (PID: $(cat $BACKEND_PID_FILE))${NC}"
    else
        echo -e "${RED}Backend failed to start. Check $LOG_DIR/backend.log${NC}"
        return 1
    fi
}

# Stop backend
stop_backend() {
    echo -e "${BLUE}Stopping backend...${NC}"

    if [ -f "$BACKEND_PID_FILE" ]; then
        local pid=$(cat "$BACKEND_PID_FILE")
        kill $pid 2>/dev/null || true
        rm -f "$BACKEND_PID_FILE"
    fi

    kill_port $BACKEND_PORT
    echo -e "${GREEN}Backend stopped${NC}"
}

# Start frontend (standalone mode)
start_frontend() {
    echo -e "${BLUE}Starting frontend on port $FRONTEND_PORT...${NC}"

    kill_port $FRONTEND_PORT

    nohup npm run dev -- --port $FRONTEND_PORT > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"

    sleep 3

    if is_running "$FRONTEND_PID_FILE"; then
        echo -e "${GREEN}Frontend started successfully (PID: $(cat $FRONTEND_PID_FILE))${NC}"
        echo -e "${GREEN}Open http://localhost:$FRONTEND_PORT${NC}"
    else
        echo -e "${RED}Frontend failed to start. Check $LOG_DIR/frontend.log${NC}"
        return 1
    fi
}

# Stop frontend
stop_frontend() {
    echo -e "${BLUE}Stopping frontend...${NC}"

    if [ -f "$FRONTEND_PID_FILE" ]; then
        local pid=$(cat "$FRONTEND_PID_FILE")
        kill $pid 2>/dev/null || true
        rm -f "$FRONTEND_PID_FILE"
    fi

    kill_port $FRONTEND_PORT
    echo -e "${GREEN}Frontend stopped${NC}"
}

# Show status
show_status() {
    echo -e "${BLUE}=== LHI Directory Monitor Status ===${NC}"
    echo ""

    echo -n "Backend (port $BACKEND_PORT): "
    if is_running "$BACKEND_PID_FILE"; then
        echo -e "${GREEN}Running (PID: $(cat $BACKEND_PID_FILE))${NC}"
    else
        local pid=$(lsof -ti:$BACKEND_PORT 2>/dev/null || true)
        if [ -n "$pid" ]; then
            echo -e "${YELLOW}Running (PID: $pid, not managed)${NC}"
        else
            echo -e "${RED}Stopped${NC}"
        fi
    fi

    echo -n "Frontend (port $FRONTEND_PORT): "
    if is_running "$FRONTEND_PID_FILE"; then
        echo -e "${GREEN}Running (PID: $(cat $FRONTEND_PID_FILE))${NC}"
    else
        local pid=$(lsof -ti:$FRONTEND_PORT 2>/dev/null || true)
        if [ -n "$pid" ]; then
            echo -e "${YELLOW}Running (PID: $pid, not managed)${NC}"
        else
            echo -e "${RED}Stopped${NC}"
        fi
    fi

    echo ""
}

# Show logs
show_logs() {
    local service=${1:-backend}
    local log_file="$LOG_DIR/$service.log"

    if [ -f "$log_file" ]; then
        echo -e "${BLUE}=== Last 50 lines of $service.log ===${NC}"
        tail -50 "$log_file"
    else
        echo -e "${YELLOW}No log file found for $service${NC}"
    fi
}

# Main
case "${1:-start}" in
    start)
        echo -e "${BLUE}=== Starting LHI Directory Monitor ===${NC}"
        start_backend
        echo ""
        show_status
        echo -e "${GREEN}Backend API: http://localhost:$BACKEND_PORT/api/health${NC}"
        echo -e "${YELLOW}Note: UI is served through LHI Admin Dashboard${NC}"
        ;;

    standalone)
        echo -e "${BLUE}=== Starting LHI Directory Monitor (Standalone Mode) ===${NC}"

        # Use LHI Launch Service for loading screen if available
        if command -v lhi_launch_with_ui &> /dev/null; then
            lhi_launch_with_ui "Directory Monitor" "http://localhost:$FRONTEND_PORT"
        fi

        start_backend
        start_frontend
        echo ""
        show_status
        ;;

    stop)
        echo -e "${BLUE}=== Stopping LHI Directory Monitor ===${NC}"
        stop_backend
        stop_frontend
        ;;

    restart)
        echo -e "${BLUE}=== Restarting LHI Directory Monitor ===${NC}"
        stop_backend
        stop_frontend
        sleep 1
        start_backend
        echo ""
        show_status
        ;;

    status)
        show_status
        ;;

    logs)
        show_logs "${2:-backend}"
        ;;

    *)
        echo "Usage: $0 [start|standalone|stop|restart|status|logs [backend|frontend]]"
        echo ""
        echo "  start      - Start backend only (for embedded mode in Admin Dashboard)"
        echo "  standalone - Start both backend and frontend (standalone mode)"
        echo "  stop       - Stop all services"
        echo "  restart    - Restart all services"
        echo "  status     - Show service status"
        echo "  logs       - Show service logs"
        exit 1
        ;;
esac
