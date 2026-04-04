from flask import Flask, render_template, request, session
import openai
import os
from datetime import timedelta

app = Flask(__name__)
app.secret_key = os.urandom(24)  # Generate a new secret key each time the app starts
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(minutes=30)

# Set your OpenAI API key
openai.api_key = os.getenv("OPENAI_API_KEY")

UPLOAD_FOLDER = "uploads"
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER


@app.route("/")
def index():
    if "transcriptions" not in session:
        session["transcriptions"] = []
    # Reverse the transcriptions list to show the most recent on top
    transcriptions = session["transcriptions"][::-1]
    return render_template("index.html", transcriptions=transcriptions)


@app.route("/upload", methods=["POST"])
def upload():
    if "audio_data" in request.files:
        audio_file = request.files["audio_data"]
        file_path = os.path.join(app.config["UPLOAD_FOLDER"], audio_file.filename)
        audio_file.save(file_path)

        # Use OpenAI API to transcribe
        with open(file_path, "rb") as f:
            from openai import OpenAI

            client = OpenAI()
            transcription = client.audio.transcriptions.create(
                model="whisper-1", file=f
            )

        # Save transcription to session
        transcriptions = session.get("transcriptions", [])
        transcriptions.append(transcription.text)
        session["transcriptions"] = transcriptions

        # Remove the uploaded file
        os.remove(file_path)

        return transcription.text
    else:
        return "No audio data received", 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
