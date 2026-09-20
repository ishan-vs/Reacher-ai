import streamlit as st
import time

from agents import (
    build_reader_agent,
    build_search_agent,
    writer_chain,
    critic_chain,
    invoke_with_retry,
)


# ============================================================
# PAGE CONFIG
# ============================================================

st.set_page_config(
    page_title="Reacher AI | Multi-Agent Research",
    page_icon="✦",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# ============================================================
# SESSION STATE
# ============================================================

defaults = {
    "topic_input": "",
    "results": {},
    "running": False,
    "done": False,
    "error": None,
    "elapsed": 0,
}

for key, value in defaults.items():
    if key not in st.session_state:
        st.session_state[key] = value


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def get_content(value):
    """
    Converts LangChain AIMessage/string/object into plain text.
    """
    if hasattr(value, "content"):
        return value.content

    return str(value)


def reset_research():
    st.session_state.results = {}
    st.session_state.running = False
    st.session_state.done = False
    st.session_state.error = None
    st.session_state.elapsed = 0


def html_block(s: str) -> str:
    """
    Strips leading/trailing whitespace from EVERY line individually
    (not just the common shared prefix like textwrap.dedent does).

    Streamlit's st.markdown() runs content through a Markdown parser
    even when unsafe_allow_html=True is set. Markdown treats any line
    indented by 4+ spaces as a code block. Deeply nested HTML (divs
    inside divs inside divs) ends up with inconsistent indentation
    that dedent() can't fully flatten, so some lines stay indented
    and get rendered as a literal code block instead of parsed HTML.

    Flattening every line's indentation to zero avoids that entirely.
    """
    return "\n".join(line.strip() for line in s.strip("\n").splitlines())


# ============================================================
# CUSTOM CSS
# ============================================================

st.markdown(
    html_block(
        """
        <style>

        /* ====================================================
           GLOBAL
        ==================================================== */

        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

        html,
        body,
        [class*="css"] {
            font-family: 'DM Sans', sans-serif;
        }

        .stApp {
            background:
                radial-gradient(
                    circle at 5% 5%,
                    rgba(255, 105, 40, 0.13),
                    transparent 27%
                ),
                radial-gradient(
                    circle at 95% 10%,
                    rgba(100, 80, 255, 0.10),
                    transparent 28%
                ),
                radial-gradient(
                    circle at 50% 100%,
                    rgba(255, 70, 30, 0.07),
                    transparent 35%
                ),
                #08090d;

            color: #eeeae4;

            overflow-x: hidden;
        }


        /* ====================================================
           BACKGROUND GRID
           ==================================================== */

        .stApp::before {
            content: "";

            position: fixed;

            inset: 0;

            pointer-events: none;

            background-image:
                linear-gradient(
                    rgba(255,255,255,0.018) 1px,
                    transparent 1px
                ),
                linear-gradient(
                    90deg,
                    rgba(255,255,255,0.018) 1px,
                    transparent 1px
                );

            background-size: 55px 55px;

            mask-image:
                linear-gradient(
                    to bottom,
                    black,
                    transparent 80%
                );

            z-index: 0;
        }


        /* ====================================================
           STREAMLIT
           ==================================================== */

        #MainMenu,
        footer,
        header {
            visibility: hidden;
        }

        .block-container {
            max-width: 1250px;

            padding:
                1.2rem
                2.5rem
                4rem;
        }


        /* ====================================================
           NAVBAR
           ==================================================== */

        .navbar {
            display: flex;

            justify-content: space-between;

            align-items: center;

            padding:
                0.7rem
                0
                1.4rem;

            border-bottom:
                1px solid
                rgba(255,255,255,0.07);

            position: relative;

            z-index: 5;
        }

        .brand {
            display: flex;

            align-items: center;

            gap: 0.7rem;
        }

        .logo-mark {
            width: 34px;
            height: 34px;

            display: flex;

            align-items: center;
            justify-content: center;

            border-radius: 10px;

            background:
                linear-gradient(
                    135deg,
                    #ffb35f,
                    #ff5420
                );

            color: #090a0d;

            font-family:
                'Space Grotesk',
                sans-serif;

            font-weight: 800;

            box-shadow:
                0 0 30px
                rgba(255,100,30,0.25);
        }

        .brand-name {
            font-family:
                'Space Grotesk',
                sans-serif;

            font-size: 1.12rem;

            font-weight: 700;

            color: #f5f1ea;
        }

        .brand-name span {
            color: #ff8640;
        }

        .nav-right {
            display: flex;

            align-items: center;

            gap: 0.6rem;
        }

        .nav-badge {
            font-family:
                'DM Mono',
                monospace;

            font-size: 0.58rem;

            color: #858078;

            border:
                1px solid
                rgba(255,255,255,0.08);

            background:
                rgba(255,255,255,0.025);

            padding:
                0.4rem
                0.7rem;

            border-radius: 999px;

            letter-spacing: 0.08em;
        }


        /* ====================================================
           HERO
           ==================================================== */

        .hero {
            text-align: center;

            padding:
                5rem
                0
                3.5rem;

            position: relative;

            z-index: 1;
        }

        .hero-label {
            display: inline-flex;

            align-items: center;

            gap: 0.5rem;

            font-family:
                'DM Mono',
                monospace;

            font-size: 0.63rem;

            color: #ff9147;

            letter-spacing: 0.17em;

            text-transform: uppercase;

            padding:
                0.45rem
                0.8rem;

            border:
                1px solid
                rgba(255,145,71,0.2);

            background:
                rgba(255,145,71,0.045);

            border-radius: 999px;

            margin-bottom: 1.2rem;
        }

        .pulse-dot {
            width: 6px;
            height: 6px;

            border-radius: 50%;

            background: #ff9147;

            animation:
                pulse 2s infinite;
        }

        @keyframes pulse {

            0% {
                box-shadow:
                    0 0 0 0
                    rgba(255,145,71,0.5);
            }

            70% {
                box-shadow:
                    0 0 0 9px
                    rgba(255,145,71,0);
            }

            100% {
                box-shadow:
                    0 0 0 0
                    rgba(255,145,71,0);
            }
        }

        .hero h1 {
            font-family:
                'Space Grotesk',
                sans-serif;

            font-size:
                clamp(3.7rem, 8vw, 7rem);

            line-height: 0.92;

            letter-spacing: -0.065em;

            margin: 0;

            color: #f4f0e9;
        }

        .hero h1 span {
            background:
                linear-gradient(
                    100deg,
                    #ffc06d,
                    #ff7130,
                    #ff3d1d
                );

            -webkit-background-clip: text;

            -webkit-text-fill-color:
                transparent;
        }

        .hero-sub {
            max-width: 650px;

            margin:
                1.5rem auto 0;

            color: #8c8882;

            font-size: 1rem;

            line-height: 1.75;

            font-weight: 300;
        }


        /* ====================================================
           MAIN CARD
           ==================================================== */

        .glass-card {
            position: relative;

            z-index: 1;

            background:
                linear-gradient(
                    145deg,
                    rgba(255,255,255,0.055),
                    rgba(255,255,255,0.018)
                );

            border:
                1px solid
                rgba(255,255,255,0.08);

            border-radius: 20px;

            padding: 1.7rem;

            box-shadow:
                0 25px 70px
                rgba(0,0,0,0.22);

            backdrop-filter:
                blur(18px);
        }


        /* ====================================================
           INPUT AREA
           ==================================================== */

        .input-title {
            font-family:
                'Space Grotesk',
                sans-serif;

            font-size: 1.15rem;

            font-weight: 600;

            color: #f0ece5;

            margin-bottom: 0.25rem;
        }

        .input-subtitle {
            color: #716d67;

            font-size: 0.76rem;

            margin-bottom: 1.2rem;
        }

        .stTextInput > div > div > input {

            background:
                rgba(255,255,255,0.045) !important;

            border:
                1px solid
                rgba(255,255,255,0.10) !important;

            border-radius:
                12px !important;

            color:
                #f5f0e9 !important;

            font-size:
                0.93rem !important;

            padding:
                0.9rem
                1rem !important;

            transition:
                all 0.2s ease !important;
        }

        .stTextInput > div > div > input:focus {

            border-color:
                rgba(255,139,58,0.7)
                !important;

            box-shadow:
                0 0 0 3px
                rgba(255,139,58,0.08)
                !important;
        }

        .stTextInput label {
            display: none !important;
        }


        /* ====================================================
           BUTTONS
           ==================================================== */

        .stButton > button {

            border:
                none !important;

            border-radius:
                11px !important;

            background:
                linear-gradient(
                    135deg,
                    #ffae5d,
                    #ff6225
                ) !important;

            color:
                #090a0d !important;

            font-family:
                'Space Grotesk',
                sans-serif !important;

            font-weight:
                700 !important;

            min-height:
                46px !important;

            transition:
                all 0.2s ease !important;

            box-shadow:
                0 8px 25px
                rgba(255,100,35,0.18)
                !important;
        }

        .stButton > button:hover {

            transform:
                translateY(-2px)
                !important;

            box-shadow:
                0 12px 32px
                rgba(255,100,35,0.3)
                !important;
        }


        /* ====================================================
           PIPELINE
           ==================================================== */

        .pipeline-title {
            font-family:
                'Space Grotesk',
                sans-serif;

            font-size: 1rem;

            font-weight: 600;

            color: #eeeae3;

            margin-bottom: 1rem;
        }

        .pipeline {
            display: flex;

            flex-direction: column;

            gap: 0.6rem;
        }

        .pipeline-step {

            display: flex;

            align-items: center;

            gap: 0.8rem;

            padding: 0.75rem;

            border:
                1px solid
                rgba(255,255,255,0.055);

            background:
                rgba(255,255,255,0.018);

            border-radius: 11px;

            transition:
                all 0.3s ease;
        }

        .step-icon {

            width: 31px;
            height: 31px;

            flex-shrink: 0;

            display: flex;

            align-items: center;
            justify-content: center;

            border-radius: 9px;

            background:
                rgba(255,255,255,0.05);

            color: #69655f;

            font-size: 0.75rem;
        }

        .step-content {
            flex: 1;
        }

        .step-name {

            font-family:
                'Space Grotesk',
                sans-serif;

            font-size: 0.76rem;

            font-weight: 600;

            color: #d7d2cb;
        }

        .step-description {

            color: #65615c;

            font-size: 0.59rem;

            margin-top: 0.1rem;
        }

        .step-status {

            font-family:
                'DM Mono',
                monospace;

            font-size: 0.51rem;

            color: #514d49;

            letter-spacing: 0.06em;
        }

        .pipeline-step.active {

            border-color:
                rgba(255,139,58,0.35);

            background:
                rgba(255,139,58,0.055);

            transform:
                translateX(3px);

            box-shadow:
                0 0 25px
                rgba(255,100,30,0.06);
        }

        .pipeline-step.active .step-icon {

            color: #ff9147;

            background:
                rgba(255,139,58,0.12);

            animation:
                activeGlow 1.5s infinite;
        }

        .pipeline-step.active .step-status {
            color: #ff9147;
        }

        .pipeline-step.completed {

            border-color:
                rgba(79,205,128,0.22);

            background:
                rgba(79,205,128,0.03);
        }

        .pipeline-step.completed .step-icon {

            color: #50c878;

            background:
                rgba(79,205,128,0.09);
        }

        .pipeline-step.completed .step-status {
            color: #50c878;
        }

        @keyframes activeGlow {

            0%, 100% {
                box-shadow:
                    0 0 0
                    rgba(255,139,58,0);
            }

            50% {
                box-shadow:
                    0 0 18px
                    rgba(255,139,58,0.18);
            }
        }


        /* ====================================================
           QUICK TOPICS
           ==================================================== */

        .quick-label {

            font-family:
                'DM Mono',
                monospace;

            color: #5f5b56;

            font-size: 0.57rem;

            letter-spacing: 0.12em;

            margin:
                1.1rem 0 0.5rem;
        }


        /* ====================================================
           SECTION TITLES
           ==================================================== */

        .section-title {

            font-family:
                'Space Grotesk',
                sans-serif;

            font-size: 1.45rem;

            font-weight: 600;

            color: #eeeae3;

            margin-top: 3rem;
        }

        .section-line {

            height: 1px;

            background:
                linear-gradient(
                    90deg,
                    rgba(255,255,255,0.1),
                    transparent
                );

            margin:
                0.7rem 0 1.2rem;
        }


        /* ====================================================
           REPORT
           ==================================================== */

        .report-box {

            position: relative;

            overflow: hidden;

            border:
                1px solid
                rgba(255,139,58,0.16);

            border-radius: 17px;

            padding: 1.8rem;

            background:
                linear-gradient(
                    145deg,
                    rgba(255,139,58,0.035),
                    rgba(255,255,255,0.018)
                );
        }

        .report-box::before {

            content: "";

            position: absolute;

            top: 0;
            left: 0;

            width: 100%;
            height: 2px;

            background:
                linear-gradient(
                    90deg,
                    transparent,
                    #ff7835,
                    transparent
                );

            animation:
                scanLine 3s infinite;
        }

        @keyframes scanLine {

            0% {
                transform:
                    translateX(-100%);
            }

            100% {
                transform:
                    translateX(100%);
            }
        }

        .report-heading {

            display: flex;

            justify-content:
                space-between;

            align-items: center;

            margin-bottom: 1.4rem;
        }

        .report-heading-title {

            font-family:
                'Space Grotesk',
                sans-serif;

            font-size: 1.1rem;

            font-weight: 600;

            color: #f0ece5;
        }

        .report-heading-meta {

            font-family:
                'DM Mono',
                monospace;

            color: #625e58;

            font-size: 0.52rem;

            letter-spacing: 0.08em;
        }


        /* ====================================================
           METRICS
           ==================================================== */

        [data-testid="stMetric"] {

            background:
                rgba(255,255,255,0.025);

            border:
                1px solid
                rgba(255,255,255,0.06);

            border-radius:
                12px;

            padding:
                0.8rem;
        }

        [data-testid="stMetricLabel"] {
            color: #77726b !important;
        }

        [data-testid="stMetricValue"] {
            color: #eeeae4 !important;
        }


        /* ====================================================
           EXPANDERS
           ==================================================== */

        details {

            border:
                1px solid
                rgba(255,255,255,0.06)
                !important;

            border-radius:
                11px
                !important;

            background:
                rgba(255,255,255,0.018)
                !important;

            margin-bottom:
                0.7rem;
        }

        details summary {

            font-family:
                'DM Mono',
                monospace
                !important;

            font-size:
                0.62rem
                !important;

            color:
                #88827b
                !important;

            letter-spacing:
                0.05em;
        }


        /* ====================================================
           CODE BLOCK
           ==================================================== */

        .stCodeBlock {

            border-radius:
                10px !important;
        }


        /* ====================================================
           FOOTER
           ==================================================== */

        .footer {

            text-align: center;

            margin-top: 4rem;

            padding-top: 1.5rem;

            border-top:
                1px solid
                rgba(255,255,255,0.05);

            color: #4c4844;

            font-family:
                'DM Mono',
                monospace;

            font-size: 0.55rem;

            letter-spacing: 0.1em;
        }

        .footer span {
            color: #ff8140;
        }


        /* ====================================================
           MOBILE
           ==================================================== */

        @media (max-width: 800px) {

            .block-container {
                padding:
                    1rem
                    1rem
                    3rem;
            }

            .hero {
                padding:
                    3.5rem
                    0
                    2.5rem;
            }

            .hero h1 {
                font-size: 4rem;
            }

            .nav-badge {
                display: none;
            }

        }

        </style>
        """
    ),
    unsafe_allow_html=True,
)


# ============================================================
# NAVBAR
# ============================================================

st.markdown(
    html_block(
        """
        <div class="navbar">

            <div class="brand">

                <div class="logo-mark">
                    ✦
                </div>

                <div class="brand-name">
                    Reacher <span>AI</span>
                </div>

            </div>

            <div class="nav-right">

                <div class="nav-badge">
                    4 AI AGENTS
                </div>

                <div class="nav-badge">
                    RESEARCH ENGINE
                </div>

            </div>

        </div>
        """
    ),
    unsafe_allow_html=True,
)


# ============================================================
# HERO
# ============================================================

st.markdown(
    html_block(
        """
        <div class="hero">

            <div class="hero-label">

                <span class="pulse-dot"></span>

                AI RESEARCH INTELLIGENCE

            </div>

            <h1>
                Research<span> deeper.</span>
            </h1>

            <p class="hero-sub">
                Reacher AI coordinates specialized AI agents to
                search, analyze, write and critically review
                research — all in one intelligent pipeline.
            </p>

        </div>
        """
    ),
    unsafe_allow_html=True,
)


# ============================================================
# INPUT + PIPELINE
# ============================================================

input_col, pipeline_col = st.columns(
    [1.55, 1],
    gap="large",
)


# ============================================================
# INPUT SECTION
# ============================================================

with input_col:

    st.markdown(
        html_block(
            """
            <div class="glass-card">

                <div class="input-title">
                    What do you want to research?
                </div>

                <div class="input-subtitle">
                    Enter a topic and let Reacher investigate it.
                </div>

            </div>
            """
        ),
        unsafe_allow_html=True,
    )


    topic = st.text_input(
        "Research Topic",
        placeholder="e.g. Impact of AI on the future of software engineering",
        key="topic_input",
        label_visibility="collapsed",
    )


    st.markdown(
        '<div class="quick-label">TRY A TOPIC</div>',
        unsafe_allow_html=True,
    )


    quick_col1, quick_col2 = st.columns(2)

    if quick_col1.button(
        "AI & Future of Work",
        use_container_width=True,
    ):

        st.session_state.topic_input = (
            "Impact of AI on the future of work"
        )

        st.rerun()


    if quick_col2.button(
        "Quantum Computing",
        use_container_width=True,
    ):

        st.session_state.topic_input = (
            "Current state and future of quantum computing"
        )

        st.rerun()


    quick_col3, quick_col4 = st.columns(2)

    if quick_col3.button(
        "Fusion Energy",
        use_container_width=True,
    ):

        st.session_state.topic_input = (
            "Latest developments in nuclear fusion energy"
        )

        st.rerun()


    if quick_col4.button(
        "CRISPR Technology",
        use_container_width=True,
    ):

        st.session_state.topic_input = (
            "Recent developments and applications of CRISPR gene editing"
        )

        st.rerun()


    st.markdown("<br>", unsafe_allow_html=True)


    action_col1, action_col2 = st.columns(
        [3, 1]
    )


    run_btn = action_col1.button(
        "✦  Start Deep Research",
        use_container_width=True,
    )


    clear_btn = action_col2.button(
        "Clear",
        use_container_width=True,
    )


    if clear_btn:

        reset_research()

        st.session_state.topic_input = ""

        st.rerun()


# ============================================================
# PIPELINE UI
# ============================================================

with pipeline_col:

    current_results = st.session_state.results

    steps = [
        (
            "search",
            "01",
            "Search Agent",
            "Finds relevant web information",
            "⌕",
        ),
        (
            "reader",
            "02",
            "Reader Agent",
            "Extracts deeper content",
            "◈",
        ),
        (
            "writer",
            "03",
            "Writer Agent",
            "Creates the research report",
            "✎",
        ),
        (
            "critic",
            "04",
            "Critic Agent",
            "Reviews the final report",
            "✓",
        ),
    ]


    step_order = [
        "search",
        "reader",
        "writer",
        "critic",
    ]


    html_output = """
    <div class="glass-card">

        <div class="pipeline-title">
            Research Pipeline
        </div>

        <div class="pipeline">
    """


    active_step = None

    if st.session_state.running:

        for step in step_order:

            if step not in current_results:

                active_step = step

                break


    for key, number, name, description, icon in steps:

        if key in current_results:

            state_class = "completed"

            status = "DONE"

            display_icon = "✓"

        elif key == active_step:

            state_class = "active"

            status = "RUNNING"

            display_icon = "◌"

        else:

            state_class = ""

            status = "WAITING"

            display_icon = icon


        html_output += f"""
        <div class="pipeline-step {state_class}">

            <div class="step-icon">
                {display_icon}
            </div>

            <div class="step-content">

                <div class="step-name">
                    {number} · {name}
                </div>

                <div class="step-description">
                    {description}
                </div>

            </div>

            <div class="step-status">
                {status}
            </div>

        </div>
        """


    html_output += """
        </div>

    </div>
    """


    st.markdown(
        html_block(html_output),
        unsafe_allow_html=True,
    )


# ============================================================
# START RESEARCH
# ============================================================

if run_btn:

    if not topic.strip():

        st.warning(
            "Please enter a research topic first."
        )

    else:

        st.session_state.results = {}

        st.session_state.running = True

        st.session_state.done = False

        st.session_state.error = None

        st.session_state.elapsed = 0

        st.session_state.research_start = time.time()

        st.rerun()


# ============================================================
# RESEARCH PIPELINE
# ============================================================

if (
    st.session_state.running
    and not st.session_state.done
):

    topic_val = st.session_state.topic_input.strip()

    results = {}

    start_time = time.time()


    progress = st.progress(
        0,
        text="Initializing Reacher AI..."
    )


    try:

        # ====================================================
        # SEARCH AGENT
        # ====================================================

        progress.progress(
            5,
            text="⌕ Search Agent is finding relevant information..."
        )


        search_agent = build_search_agent()


        search_result = invoke_with_retry(
            search_agent,
            {
                "messages": [
                    (
                        "user",
                        f"""
Find recent, reliable and detailed information about:

{topic_val}

Look for useful sources and information that can
help another AI agent create a high-quality research report.
""",
                    )
                ]
            },
        )


        results["search"] = get_content(
            search_result["messages"][-1]
        )


        st.session_state.results = dict(results)


        progress.progress(
            25,
            text="✓ Search complete · Reader Agent starting..."
        )


        # ====================================================
        # READER AGENT
        # ====================================================

        reader_agent = build_reader_agent()


        reader_result = invoke_with_retry(
            reader_agent,
            {
                "messages": [
                    (
                        "user",
                        f"""
Research topic:

{topic_val}

Use the following search information to identify
the most useful source and extract deeper,
relevant information.

SEARCH INFORMATION:

{results["search"][:8000]}
""",
                    )
                ]
            },
        )


        results["reader"] = get_content(
            reader_result["messages"][-1]
        )


        st.session_state.results = dict(results)


        progress.progress(
            50,
            text="✓ Source analysis complete · Writer Agent starting..."
        )


        # ====================================================
        # WRITER AGENT
        # ====================================================

        research_combined = f"""
SEARCH RESULTS:

{results["search"]}


DETAILED SOURCE ANALYSIS:

{results["reader"]}
"""


        writer_result = writer_chain.invoke(
            {
                "topic": topic_val,
                "research": research_combined,
            }
        )


        results["writer"] = get_content(
            writer_result
        )


        st.session_state.results = dict(results)


        progress.progress(
            75,
            text="✓ Report generated · Critic Agent reviewing..."
        )


        # ====================================================
        # CRITIC AGENT
        # ====================================================

        critic_result = critic_chain.invoke(
            {
                "report": results["writer"]
            }
        )


        results["critic"] = get_content(
            critic_result
        )


        st.session_state.results = dict(results)


        # ====================================================
        # COMPLETE
        # ====================================================

        elapsed = time.time() - start_time

        st.session_state.elapsed = elapsed

        progress.progress(
            100,
            text="✓ Research complete!"
        )

        time.sleep(0.5)

        st.session_state.running = False

        st.session_state.done = True

        st.rerun()


    except Exception as e:

        elapsed = time.time() - start_time

        st.session_state.elapsed = elapsed

        st.session_state.results = dict(results)

        st.session_state.running = False

        st.session_state.done = False

        st.session_state.error = str(e)

        st.error(
            f"Research pipeline stopped: {e}"
        )

        st.stop()


# ============================================================
# ERROR MESSAGE
# ============================================================

if st.session_state.error:

    st.markdown(
        html_block(
            """
            <div class="section-title">
                Something went wrong
            </div>
            """
        ),
        unsafe_allow_html=True,
    )

    st.error(
        st.session_state.error
    )


# ============================================================
# RESULTS
# ============================================================

results = st.session_state.results


if results:

    st.markdown(
        html_block(
            """
            <div class="section-title">
                Research Results
            </div>

            <div class="section-line"></div>
            """
        ),
        unsafe_allow_html=True,
    )


    # ========================================================
    # METRICS
    # ========================================================

    metric1, metric2, metric3 = st.columns(3)


    with metric1:

        st.metric(
            "Agents completed",
            f"{len(results)} / 4"
        )


    with metric2:

        if st.session_state.elapsed:

            elapsed_text = (
                f"{st.session_state.elapsed:.1f}s"
            )

        else:

            elapsed_text = "—"


        st.metric(
            "Research time",
            elapsed_text
        )


    with metric3:

        if "critic" in results:

            status_text = "Reviewed"

        else:

            status_text = "Processing"


        st.metric(
            "Report status",
            status_text
        )


    st.markdown("<br>", unsafe_allow_html=True)


    # ========================================================
    # TABS
    # ========================================================

    report_tab, critic_tab, search_tab, reader_tab = st.tabs(
        [
            "✦ Final Report",
            "✓ Critic Review",
            "⌕ Search Intelligence",
            "◈ Source Analysis",
        ]
    )


    # ========================================================
    # FINAL REPORT
    # ========================================================

    with report_tab:

        if "writer" in results:

            st.markdown(
                html_block(
                    """
                    <div class="report-box">

                        <div class="report-heading">

                            <div class="report-heading-title">
                                ✦ Research Report
                            </div>

                            <div class="report-heading-meta">
                                REACHER AI
                            </div>

                        </div>

                    </div>
                    """
                ),
                unsafe_allow_html=True,
            )


            st.markdown(
                results["writer"]
            )


            st.download_button(
                label="↓  Download Report",
                data=results["writer"],
                file_name=(
                    f"reacher_ai_research_"
                    f"{int(time.time())}.md"
                ),
                mime="text/markdown",
                use_container_width=False,
            )

        else:

            st.info(
                "The research report is not available yet."
            )


    # ========================================================
    # CRITIC
    # ========================================================

    with critic_tab:

        if "critic" in results:

            st.markdown(
                html_block(
                    """
                    <div class="result-box">

                        <div class="result-label">
                            CRITIC AGENT
                        </div>

                    </div>
                    """
                ),
                unsafe_allow_html=True,
            )

            st.markdown(
                results["critic"]
            )

        else:

            st.info(
                "Critic review is not available yet."
            )


    # ========================================================
    # SEARCH
    # ========================================================

    with search_tab:

        if "search" in results:

            st.code(
                results["search"],
                language="text"
            )

        else:

            st.info(
                "Search results are not available."
            )


    # ========================================================
    # READER
    # ========================================================

    with reader_tab:

        if "reader" in results:

            st.code(
                results["reader"],
                language="text"
            )

        else:

            st.info(
                "Source analysis is not available."
            )


# ============================================================
# FOOTER
# ============================================================

st.markdown(
    html_block(
        """
        <div class="footer">

            REACHER AI

            <span> · </span>

            MULTI-AGENT RESEARCH INTELLIGENCE

            <span> · </span>

            POWERED BY LANGCHAIN

        </div>
        """
    ),
    unsafe_allow_html=True,
)