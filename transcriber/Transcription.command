#!/bin/bash

# Activate the virtual environment
source ~/Documents/venvs/scratch-venv/bin/activate

# Navigate to the app directory
cd /Users/{USER}/Documents/repos/quick_apps/audio_transcriber

# Run the Flask app in the background
python app.py &

FLASK_PID=$!  # Capture the process ID of the Flask app

echo "Transcription app started."

# Give the server a moment to start
sleep 2

# Open the default web browser to the app URL
open http://127.0.0.1:5001/

echo "Transcription app opened in browser."

# Keep the terminal open and wait for user input
read -p "Press [Enter] key to stop the Flask app and exit..."

# Terminate the Flask app
kill $FLASK_PID

echo "Transcription app has been stopped."
