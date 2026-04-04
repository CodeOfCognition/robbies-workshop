"""
ToneBoard AI Backend — FastAPI + LangGraph
Suggests Mustang Micro Plus amp presets based on song/genre/tone.
"""

import os
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from agent import suggest_preset_agent

app = FastAPI(title="ToneBoard API", version="0.1.0")

# CORS — only allow the Vercel deployment
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://robbies-workshop.vercel.app,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# API key auth
TONEBOARD_API_KEY = os.getenv("TONEBOARD_API_KEY", "")


def verify_api_key(x_api_key: str = Header(...)):
    if not TONEBOARD_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")
    if x_api_key != TONEBOARD_API_KEY:
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
    return {"status": "ok", "service": "toneboard-api"}


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
