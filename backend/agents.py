from langchain.agents import create_agent
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from tools import web_search, scrape_url
from dotenv import load_dotenv

load_dotenv()


# =========================================================
# MAIN LLM
# =========================================================

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0,
    max_tokens=1500,
)


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

Keep the report detailed but readable.
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


critic_chain = critic_prompt | llm | StrOutputParser()


# =========================================================
# SAFE CRITIC FUNCTION
# =========================================================

def run_critic_safely(report: str) -> str:

    # First attempt
    try:

        feedback = critic_chain.invoke({
            "report": report
        })

        # Make sure we actually received text
        if feedback and feedback.strip():

            return feedback.strip()

    except Exception as e:

        print("\nCritic attempt 1 failed:")
        print(str(e))


    # Second attempt
    print("\nCritic returned empty output. Retrying...")

    try:

        feedback = critic_chain.invoke({
            "report": report
        })

        if feedback and feedback.strip():

            return feedback.strip()

    except Exception as e:

        print("\nCritic attempt 2 failed:")
        print(str(e))


    # Final fallback
    return """
## Quality Review

The research report was generated successfully.

The AI critic did not return detailed feedback for this run.

## Verdict

The report is available above. Please review the cited sources and key findings for additional verification.
""".strip()