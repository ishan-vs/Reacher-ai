from langchain.agents import create_agent
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

try:
    from .tools import web_search, scrape_url
except ImportError:  # Supports running modules directly from backend/.
    from tools import web_search, scrape_url
from dotenv import load_dotenv
import os

load_dotenv()


# =========================================================
# MAIN LLM
# =========================================================

def _build_llm(max_tokens: int):
    """Build the configured LLM without ever exposing a provider key to the UI.

    OmniRoute exposes an OpenAI-compatible `/v1` endpoint.  Its `auto` model
    selects a capable available provider and moves to another one when a
    configured provider reaches a limit.  If OmniRoute has not been configured
    yet, keep the original Groq integration working for local development.
    """
    omniroute_base_url = os.getenv("OMNIROUTE_BASE_URL", "").strip()

    if omniroute_base_url:
        return ChatOpenAI(
            model=os.getenv("OMNIROUTE_MODEL", "auto"),
            base_url=omniroute_base_url.rstrip("/"),
            # A locally fresh OmniRoute installation can accept any non-empty
            # value. A public deployment must use a real scoped gateway key.
            api_key=os.getenv("OMNIROUTE_API_KEY", "not-needed"),
            temperature=0.2,
            max_tokens=max_tokens,
            max_retries=0,
        )

    return ChatGroq(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
        temperature=0.2,
        max_tokens=max_tokens,
        max_retries=0,
    )


# The writer receives enough output budget for a substantial report, while the
# smaller critic call keeps the request responsive on serverless deployments.
llm = _build_llm(max_tokens=2600)
critic_llm = _build_llm(max_tokens=650)


# =========================================================
# SEARCH AGENT
# =========================================================

def build_search_agent():
    return create_agent(
        model=llm,
        tools=[web_search],
    )


# =========================================================
# READER AGENT
# =========================================================

def build_reader_agent():
    return create_agent(
        model=llm,
        tools=[scrape_url],
    )


# =========================================================
# RETRY HELPER
# =========================================================

def invoke_with_retry(agent, payload, retries: int = 1):

    last_err = None

    for attempt in range(retries + 1):

        try:
            return agent.invoke(payload)

        except Exception as e:

            last_err = e
            error_text = str(e).lower()

            # Do not repeatedly retry quota/token errors
            if (
                "413" in error_text
                or "request too large" in error_text
                or "tokens per minute" in error_text
                or "rate_limit_exceeded" in error_text
                or "429" in error_text
            ):
                raise

    raise last_err


# =========================================================
# WRITER
# =========================================================

writer_prompt = ChatPromptTemplate.from_messages([

    (
        "system",
        """
You are an expert research writer.

Create a clear, factual and well-structured research report.

Use ONLY the information provided in the research material.

Do not invent facts.

Do not unnecessarily repeat information.

IMPORTANT:
Always include the source URLs that appear in the research material.

Format the report using Markdown headings, bullet points,
numbered lists and tables when appropriate.

Make the report easy for a human to read.
"""
    ),

    (
        "human",
        """
Write a research report about:

Topic:
{topic}

Research Material:
{research}

Use this structure:

# Introduction

Give a concise introduction to the topic.

# Key Findings

Provide the most important findings.

Use numbered sections or bullet points.

# Detailed Analysis

Explain the important evidence and implications.

Use bullet points or tables where useful.

# Practical Takeaways

Give useful conclusions based ONLY on the research.

# Conclusion

Summarize the main points.

# Sources

List the actual URLs found in the research material.

IMPORTANT:
- Preserve complete URLs.
- Do not replace URLs with phrases such as "Source".
- Do not invent URLs.
- Make URLs clickable Markdown links when possible.

Example:

- [Example Source](https://example.com)

Write a substantive report of roughly 1,200–1,600 words. Include concrete
evidence from the supplied material, explain how the sources agree or differ,
and use a compact table when it improves clarity. Keep it readable, but do not
replace analysis with a short summary. Finish every required section; never
stop midway through the report.
"""
    ),

])


writer_chain = writer_prompt | llm | StrOutputParser()


# =========================================================
# CRITIC
# =========================================================

critic_prompt = ChatPromptTemplate.from_messages([

    (
        "system",
        """
You are a professional research quality reviewer.

Review the provided research report.

Check:

1. Factual clarity
2. Organization and readability
3. Missing important information
4. Unsupported claims
5. Source quality
6. Whether the report actually answers the topic
7. Whether the sources are clearly presented

IMPORTANT:
You MUST return a written response.

NEVER return an empty response.

Keep the review concise.
"""
    ),

    (
        "human",
        """
Review this research report:

{report}

Return EXACTLY this structure:

## Quality Score

Score: X/10

## Strengths

- Point 1
- Point 2
- Point 3

## Areas to Improve

- Point 1
- Point 2

## Source Check

- Comment about source quality and URLs.

## Verdict

One or two sentences explaining the overall quality.

IMPORTANT:
Always provide an answer, even if the report is already good.
"""
    ),

])


critic_chain = critic_prompt | critic_llm | StrOutputParser()


# =========================================================
# SAFE CRITIC FUNCTION
# =========================================================

def run_critic_safely(report: str) -> str:
    """Return a review without spending another request after a provider error."""
    try:
        feedback = critic_chain.invoke({
            "report": report
        })
        if feedback and feedback.strip():
            return feedback.strip()

    except Exception:
        pass

    return """
## Quality Review

The research report was generated successfully.

The AI critic did not return detailed feedback for this run.

## Verdict

The report is available above. Please review the cited sources and key findings for additional verification.
""".strip()
