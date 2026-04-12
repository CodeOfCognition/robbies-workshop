"""
Robbie's Workshop — Backend API (FastAPI + LangGraph)
Hosts AI agents and heavy processing (transcription, preset suggestions, etc.)
"""

import os
import logging
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Header, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import json as _json
import openai
from agent import suggest_preset_agent
from agents.spotify import explore_music
from agents.toneboard import run_tone_chat
from db import get_pool

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


class ExploreRequest(BaseModel):
    messages: list[dict]


class ExploreResponse(BaseModel):
    answer: str
    query: str | None = None


@app.post("/explore-music", response_model=ExploreResponse, dependencies=[Depends(verify_api_key)])
async def explore_music_endpoint(request: ExploreRequest):
    try:
        result = await explore_music(request.messages)
        return result
    except Exception as e:
        logger.error(f"Explore music error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class ToneChatRequest(BaseModel):
    tone_id: str
    user_message: str


class ToneChatMessage(BaseModel):
    role: str
    content: list[dict]


class ToneChatResponse(BaseModel):
    messages: list[ToneChatMessage]  # just the new user + assistant pair
    tone: dict


@app.post("/tone-chat", response_model=ToneChatResponse, dependencies=[Depends(verify_api_key)])
async def tone_chat(request: ToneChatRequest):
    pool = await get_pool()
    try:
        # Pre-check tone exists before doing any work — otherwise we'd spend
        # agent budget and persist messages against a phantom tone_id.
        async with pool.acquire() as conn:
            exists = await conn.fetchval(
                "SELECT 1 FROM tones WHERE id = $1::uuid", request.tone_id
            )
            if not exists:
                raise HTTPException(status_code=404, detail="Tone not found")

            rows = await conn.fetch(
                "SELECT role, content FROM tone_messages WHERE tone_id = $1::uuid ORDER BY created_at",
                request.tone_id,
            )
            prior: list[dict] = []
            for r in rows:
                content = r["content"]
                if isinstance(content, str):
                    content = _json.loads(content)
                prior.append({"role": r["role"], "content": content})

        # Run agent
        assistant_blocks = await run_tone_chat(
            tone_id=request.tone_id,
            prior_messages=prior,
            user_message=request.user_message,
        )

        # Persist user + assistant messages and load latest tone
        user_blocks = [{"type": "text", "text": request.user_message}]
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO tone_messages (tone_id, role, content) VALUES ($1::uuid, $2, $3::jsonb)",
                    request.tone_id,
                    "user",
                    _json.dumps(user_blocks),
                )
                await conn.execute(
                    "INSERT INTO tone_messages (tone_id, role, content) VALUES ($1::uuid, $2, $3::jsonb)",
                    request.tone_id,
                    "assistant",
                    _json.dumps(assistant_blocks),
                )

            row = await conn.fetchrow(
                "SELECT * FROM tones WHERE id = $1::uuid", request.tone_id
            )
            if not row:
                # Defensive — we pre-checked at the top of the handler, so
                # reaching here means the row was deleted mid-request.
                raise HTTPException(status_code=404, detail="Tone not found")
            tone = {
                k: (v.isoformat() if hasattr(v, "isoformat") else v)
                for k, v in dict(row).items()
            }

        return ToneChatResponse(
            messages=[
                ToneChatMessage(role="user", content=user_blocks),
                ToneChatMessage(role="assistant", content=assistant_blocks),
            ],
            tone=tone,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"tone-chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal error")


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
