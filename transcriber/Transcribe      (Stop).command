#!/bin/bash

# Find and kill the Flask app process
PID=$(lsof -t -i:5001)

if [ -z "$PID" ]; then
    echo "Transcription app is not running."
else
    kill $PID
    echo "Transcription app stopped."
fi
