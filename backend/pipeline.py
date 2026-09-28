try:
    from .agents import (
        writer_chain,
        run_critic_safely,
        invoke_with_retry,
    )
    from .tools import scrape_url, web_search
except ImportError:  # Supports running this file directly from backend/.
    from agents import (
        writer_chain,
        run_critic_safely,
        invoke_with_retry,
    )
    from tools import scrape_url, web_search
import re
from concurrent.futures import ThreadPoolExecutor


def run_research_pipeline(topic: str) -> dict:

    state = {}

    # =====================================================
    # STEP 1 - SEARCH
    # =====================================================

    print("\n" + "=" * 50)
    print("STEP 1 - Search agent is working...")
    print("=" * 50)

    # Search is already a deterministic Tavily tool. Calling an LLM agent just
    # to decide to use it added several model calls and frequently hit Groq's
    # rate limits before any report could be written.
    state["search_results"] = web_search.invoke({"query": topic})

    print("\nSearch Results:\n")
    print(state["search_results"])


    # =====================================================
    # STEP 2 - READER
    # =====================================================

    print("\n" + "=" * 50)
    print("STEP 2 - Reader agent is scraping top resources...")
    print("=" * 50)

    urls = list(dict.fromkeys(
        re.findall(r"https?://[^\s<>\]\")']+", state["search_results"])
    ))[:2]
    if urls:
        # Tavily returns sources in relevance order. Read the top two in
        # parallel so the report can compare evidence without doubling wait.
        with ThreadPoolExecutor(max_workers=len(urls)) as executor:
            contents = list(executor.map(
                lambda url: scrape_url.invoke({"url": url}),
                urls,
            ))
        state["scraped_content"] = "\n\n".join(
            f"SOURCE {index} ({url}):\n{content}"
            for index, (url, content) in enumerate(zip(urls, contents), start=1)
        )
    else:
        state["scraped_content"] = "No source URL was returned by the web search."

    print("\nScraped Content:\n")
    print(state["scraped_content"])


    # =====================================================
    # STEP 3 - WRITER
    # =====================================================

    print("\n" + "=" * 50)
    print("STEP 3 - Writer is drafting the report...")
    print("=" * 50)

    research_combined = (

        f"SEARCH RESULTS:\n"
        f"{state['search_results']}\n\n"

        f"DETAILED SOURCE CONTENT:\n"
        f"{state['scraped_content']}"

    )

    state["report"] = invoke_with_retry(writer_chain, {

        "topic": topic,

        "research": research_combined

    }, retries=0)

    print("\nFINAL REPORT:\n")
    print(state["report"])


    # =====================================================
    # STEP 4 - CRITIC
    # =====================================================

    print("\n" + "=" * 50)
    print("STEP 4 - Critic is reviewing the report...")
    print("=" * 50)

    state["feedback"] = run_critic_safely(
        state["report"]
    )

    print("\nCRITIC REPORT:\n")
    print(state["feedback"])


    # =====================================================
    # RETURN EVERYTHING TO API
    # =====================================================

    return {

        "search_results":
            state["search_results"],

        "scraped_content":
            state["scraped_content"],

        "report":
            state["report"],

        "feedback":
            state["feedback"],

    }


# =========================================================
# RUN DIRECTLY FROM TERMINAL
# =========================================================

if __name__ == "__main__":

    topic = input(
        "\nEnter a research topic: "
    )

    run_research_pipeline(topic)
