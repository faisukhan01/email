#!/bin/bash
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null; pkill -f next-server 2>/dev/null; sleep 1
rm -f dev.log
setsid nohup bun run dev < /dev/null > /dev/null 2>&1 &
disown
