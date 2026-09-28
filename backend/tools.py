from langchain.tools import tool
import requests
from bs4 import BeautifulSoup
from tavily import TavilyClient
import os
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

# Tavily client
tavily = TavilyClient(
    api_key=os.getenv("TAVILY_API_KEY")
)


# ============================================================
# EXPLICIT INPUT SCHEMAS
#
# gpt-oss models ship with a built-in "browser" tool convention
# (search / open / find, with args like id, cursor, pattern).
# When a custom tool is only defined with a bare string param and
# a short docstring, the model can sometimes default to that
# internal convention instead of the schema you actually gave it -
# e.g. calling web_search with {"id": 0, "cursor": 0} instead of
# {"query": "..."}.
#
# Giving each tool an explicit Pydantic args_schema, a single
# unambiguously-named field, and a docstring that names the field
# and explicitly rules out the wrong ones fixes this in practice.
# ============================================================

class WebSearchInput(BaseModel):
    query: str = Field(
        ...,
        description="The exact search query string to look up on the web."
    )


class ScrapeUrlInput(BaseModel):
    url: str = Field(
        ...,
        description="The full URL (including https://) of the page to scrape."
    )


@tool("web_search", args_schema=WebSearchInput)
def web_search(query: str) -> str:
    """Search the web for recent and reliable information on a topic.

    Call this with exactly one argument: 'query' (a string containing
    the search text). Returns titles, URLs, and snippets.

    Do NOT call this with 'id', 'cursor', or 'pattern' arguments -
    this tool only accepts 'query'.
    """

    try:
        results = tavily.search(
            query=query,
            max_results=5
        )

        out = []

        for r in results["results"]:
            out.append(
                f"Title: {r['title']}\n"
                f"URL: {r['url']}\n"
                f"Snippet: {r['content'][:250]}\n"
            )

        return "\n----\n".join(out)

    except Exception as e:
        return f"Web search failed: {str(e)}"


@tool("scrape_url", args_schema=ScrapeUrlInput)
def scrape_url(url: str) -> str:
    """Scrape and return clean text content from a given URL for deeper reading.

    Call this with exactly one argument: 'url' (the full page URL to fetch).

    Do NOT call this with 'id', 'cursor', or 'pattern' arguments -
    this tool only accepts 'url'.
    """

    try:
        resp = requests.get(
            url,
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"}
        )

        resp.raise_for_status()

        soup = BeautifulSoup(
            resp.text,
            "html.parser"
        )

        # Remove unnecessary elements
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()

        # Extract clean text
        text = soup.get_text(
            separator=" ",
            strip=True
        )

        return text[:2500]

    except Exception as e:
        return f"Could not scrape URL: {str(e)}"
