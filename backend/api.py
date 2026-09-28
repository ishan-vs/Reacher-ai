from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os

try:
    from .pipeline import run_research_pipeline
except ImportError:  # Supports `uvicorn api:app` from the backend folder.
    from pipeline import run_research_pipeline

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ResearchRequest(BaseModel):
    topic: str


@app.get("/api")
def home():
    return {
        "message": "Research API is running!",
        "llm_provider": "omniroute" if os.getenv("OMNIROUTE_BASE_URL") else "groq",
    }


@app.post("/api/research")
def research(request: ResearchRequest):

    try:
        result = run_research_pipeline(request.topic)
    except Exception as exc:
        error_text = str(exc).lower()
        if "429" in error_text or "rate limit" in error_text:
            raise HTTPException(
                status_code=429,
                detail="The AI provider is busy. Please retry in a moment.",
            ) from exc
        raise HTTPException(
            status_code=503,
            detail="Research could not be completed. Please try again shortly.",
        ) from exc

    return {
        "topic": request.topic,
        "search_results": result["search_results"],
        "scraped_content": result["scraped_content"],
        "report": result["report"],
        "feedback": result["feedback"],
    }
