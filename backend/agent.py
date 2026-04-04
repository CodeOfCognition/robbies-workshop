"""
LangGraph agent for suggesting Mustang Micro Plus presets.
Takes song/genre/tone info and returns amp + effects configuration.
"""

import os
import json
from typing import Optional
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict

# Valid amp models and effects for the Mustang Micro Plus
AMP_MODELS = [
    "'57 CHAMP", "'57 DELUXE", "'57 TWIN", "'59 BASSMAN",
    "'65 DELUXE", "'65 TWIN", "'65 PRINCETON",
    "'60S BRITISH", "'70S BRITISH", "'80S BRITISH",
    "'90S AMERICAN", "BRITISH COLOUR", "BRITISH WATTS",
    "BB15 LOW GAIN", "BB15 MID GAIN", "BB15 HIGH GAIN",
    "SUPER-SONIC", "FBE-100", "'60S THRIFT", "EXCELSIOR",
    "STUDIO PREAMP", "METAL 2000", "UBER", "TUBE PREAMP", "ACOUSTIC SIM",
]

EFFECTS = {
    "stompbox": [
        "OVERDRIVE", "GREENBOX", "MYTHIC DRIVE", "BLACKBOX",
        "FUZZ", "BIG FUZZ", "OCTOBOT", "COMPRESSOR",
        "SUSTAIN", "5-BAND EQ", "ENVELOPE FILTER",
    ],
    "modulation": [
        "SINE CHORUS", "TRIANGLE FLANGER", "PHASER",
        "VIBRATONE", "SINE TREMOLO", "HARMONIC TREMOLO",
    ],
    "delay": [
        "MONO DELAY", "TAPE DELAY", "2290 DELAY", "REVERSE DELAY",
    ],
    "reverb": [
        "LARGE HALL", "SMALL ROOM", "SPRING REVERB", "MOD. LARGE HALL",
    ],
}


class AgentState(TypedDict):
    song_name: Optional[str]
    artist: Optional[str]
    genre: Optional[str]
    tone_descriptors: Optional[list[str]]
    notes: Optional[str]
    amp_model: str
    effects: dict[str, Optional[str]]
    reasoning: str


SYSTEM_PROMPT = """You are a guitar tone expert specializing in the Fender Mustang Micro Plus amp modeler.

Given information about a song, artist, or desired tone, suggest the best amp model and effects configuration.

AVAILABLE AMP MODELS (pick exactly one):
{amp_models}

AVAILABLE EFFECTS (pick 0 or 1 per category, use null for empty slots):
- Stompbox: {stompbox}
- Modulation: {modulation}
- Delay: {delay}
- Reverb: {reverb}

Respond with ONLY valid JSON in this exact format:
{{
  "amp_model": "<exact amp name from the list>",
  "effects": {{
    "stompbox": "<effect name or null>",
    "modulation": "<effect name or null>",
    "delay": "<effect name or null>",
    "reverb": "<effect name or null>"
  }},
  "reasoning": "<2-3 sentences explaining why these settings match the requested tone>"
}}

IMPORTANT:
- Use EXACT names from the lists above (case-sensitive)
- Not every song needs effects in every slot — leave slots null when appropriate
- Consider the genre, era, and playing style of the artist
- For clean tones, lean toward Fender models ('57/'65 series)
- For crunch/rock, consider British models or higher-gain Fender amps
- For metal/heavy, use METAL 2000 or UBER
- Match effects to the song's character (e.g., 80s rock → chorus, surf → spring reverb)
"""


def build_prompt(state: AgentState) -> str:
    """Build a natural language request from the state."""
    parts = []
    if state.get("song_name"):
        parts.append(f"Song: {state['song_name']}")
    if state.get("artist"):
        parts.append(f"Artist: {state['artist']}")
    if state.get("genre"):
        parts.append(f"Genre: {state['genre']}")
    if state.get("tone_descriptors"):
        parts.append(f"Desired tone: {', '.join(state['tone_descriptors'])}")
    if state.get("notes"):
        parts.append(f"Additional notes: {state['notes']}")

    if not parts:
        return "Suggest a versatile, all-purpose preset."

    return "Suggest a preset for:\n" + "\n".join(parts)


async def suggest_node(state: AgentState) -> dict:
    """Call the LLM to suggest a preset."""
    llm = ChatGoogleGenerativeAI(
        model="gemini-3.1-pro",
        google_api_key=os.getenv("GOOGLE_API_KEY"),
        temperature=0.7,
        thinking_level="low",
    )

    system = SYSTEM_PROMPT.format(
        amp_models=", ".join(AMP_MODELS),
        stompbox=", ".join(EFFECTS["stompbox"]),
        modulation=", ".join(EFFECTS["modulation"]),
        delay=", ".join(EFFECTS["delay"]),
        reverb=", ".join(EFFECTS["reverb"]),
    )

    user_prompt = build_prompt(state)

    response = await llm.ainvoke([
        {"role": "system", "content": system},
        {"role": "user", "content": user_prompt},
    ])

    # Parse JSON from response
    content = response.content.strip()
    # Handle markdown code fences
    if content.startswith("```"):
        content = content.split("\n", 1)[1]
        content = content.rsplit("```", 1)[0]

    parsed = json.loads(content)

    # Validate amp model
    amp = parsed.get("amp_model", "'65 TWIN")
    if amp not in AMP_MODELS:
        amp = "'65 TWIN"

    # Validate effects
    effects = parsed.get("effects", {})
    for cat, valid in EFFECTS.items():
        val = effects.get(cat)
        if val and val not in valid:
            effects[cat] = None

    return {
        "amp_model": amp,
        "effects": effects,
        "reasoning": parsed.get("reasoning", ""),
    }


# Build the LangGraph
graph_builder = StateGraph(AgentState)
graph_builder.add_node("suggest", suggest_node)
graph_builder.add_edge(START, "suggest")
graph_builder.add_edge("suggest", END)
suggest_graph = graph_builder.compile()


async def suggest_preset_agent(
    song_name: Optional[str] = None,
    artist: Optional[str] = None,
    genre: Optional[str] = None,
    tone_descriptors: Optional[list[str]] = None,
    notes: Optional[str] = None,
) -> dict:
    """Run the preset suggestion agent."""
    result = await suggest_graph.ainvoke({
        "song_name": song_name,
        "artist": artist,
        "genre": genre,
        "tone_descriptors": tone_descriptors,
        "notes": notes,
        "amp_model": "",
        "effects": {},
        "reasoning": "",
    })

    return {
        "amp_model": result["amp_model"],
        "effects": result["effects"],
        "reasoning": result["reasoning"],
    }
