"""
Robbie's Workshop — Backend API (FastAPI + LangGraph)
Hosts AI agents and heavy processing (transcription, preset suggestions, etc.)
"""

import os
import logging
from fastapi import FastAPI, HTTPException, Header, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import openai
from agent import suggest_preset_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Robbie's Workshop API", version="0.1.0")

# CORS — only allow the Vercel deployment
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://robbies-workshop.vercel.app,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API keys
WORKSHOP_BACKEND_API_KEY = os.getenv("WORKSHOP_BACKEND_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


def verify_api_key(x_api_key: str = Header(...)):
    if not WORKSHOP_BACKEND_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")
    if x_api_key != WORKSHOP_BACKEND_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


class PresetRequest(BaseModel):
    song_name: Optional[str] = None
    artist: Optional[str] = None
    genre: Optional[str] = None
    tone_descriptors: Optional[list[str]] = None
    notes: Optional[str] = None


class PresetResponse(BaseModel):
    amp_model: str
    effects: dict[str, Optional[str]]  # stompbox, modulation, delay, reverb
    reasoning: str


@app.get("/health")
def health():
    return {"status": "ok", "service": "robbies-workshop-api"}


@app.post("/suggest-preset", response_model=PresetResponse, dependencies=[Depends(verify_api_key)])
async def suggest_preset(request: PresetRequest):
    try:
        result = await suggest_preset_agent(
            song_name=request.song_name,
            artist=request.artist,
            genre=request.genre,
            tone_descriptors=request.tone_descriptors,
            notes=request.notes,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/transcribe", dependencies=[Depends(verify_api_key)])
async def transcribe(audio_data: UploadFile = File(...)):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    try:
        logger.info(f"Transcribe request: filename={audio_data.filename}, content_type={audio_data.content_type}")
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        file_bytes = await audio_data.read()
        logger.info(f"Read {len(file_bytes)} bytes from upload")

        transcription = client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio_data.filename, file_bytes, audio_data.content_type),
        )

        logger.info("Transcription successful")
        return {"text": transcription.text}
    except openai.APIError as e:
        logger.error(f"OpenAI API error: {e}")
        raise HTTPException(status_code=502, detail=f"OpenAI error: {e.message}")
    except Exception as e:
        logger.error(f"Transcription failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
