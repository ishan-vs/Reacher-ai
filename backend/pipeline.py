from agents import (
    build_reader_agent,
    build_search_agent,
    writer_chain,
    run_critic_safely
)


def run_research_pipeline(topic: str) -> dict:

    state = {}

    # =====================================================
    # STEP 1 - SEARCH
    # =====================================================

    print("\n" + "=" * 50)
    print("STEP 1 - Search agent is working...")
    print("=" * 50)

    search_agent = build_search_agent()

    search_result = search_agent.invoke({
        "messages": [
            (
                "user",
                f"""
Find recent, reliable and detailed information about:

{topic}

Search for multiple relevant sources.
Return the source titles, URLs and useful information.
"""
            )
        ]
    })

    state["search_results"] = search_result["messages"][-1].content

    print("\nSearch Results:\n")
    print(state["search_results"])


    # =====================================================
    # STEP 2 - READER
    # =====================================================

    print("\n" + "=" * 50)
    print("STEP 2 - Reader agent is scraping top resources...")
    print("=" * 50)

    reader_agent = build_reader_agent()

    reader_result = reader_agent.invoke({
        "messages": [
            (
                "user",
                f"""
You are researching this topic:

{topic}

Below are search results:

{state["search_results"][:8000]}

Select the most relevant URL from these results.

Then use the scrape_url tool to read that source.

Return the useful information you find.
"""
            )
        ]
    })

    state["scraped_content"] = reader_result["messages"][-1].content

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

        f"DETAILED SCRAPED CONTENT:\n"
        f"{state['scraped_content']}"

    )

    state["report"] = writer_chain.invoke({

        "topic": topic,

        "research": research_combined

    })

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