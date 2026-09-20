from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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


@app.get("/")
def home():
    return {"message": "Research API is running!"}


@app.post("/research")
def research(request: ResearchRequest):

    result = run_research_pipeline(request.topic)

    return {
        "topic": request.topic,
        "search_results": result["search_results"],
        "scraped_content": result["scraped_content"],
        "report": result["report"],
        "feedback": result["feedback"],
    }