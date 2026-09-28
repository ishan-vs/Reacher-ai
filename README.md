# Reacher AI

## Deploy to Vercel

The frontend and FastAPI service deploy together from the repository root.

1. Import the repository into Vercel, leaving the Root Directory set to `./`.
2. Add `TAVILY_API_KEY` plus one LLM configuration to the Production, Preview, and Development environment targets:
   - **Recommended — OmniRoute:** `OMNIROUTE_BASE_URL` (the public HTTPS URL of your own OmniRoute instance, including `/v1`), `OMNIROUTE_API_KEY` (a scoped gateway key), and optionally `OMNIROUTE_MODEL=auto`. OmniRoute then selects an available model and fails over according to the combo configured in its dashboard.
   - **Fallback — Groq:** `GROQ_API_KEY` and optionally `GROQ_MODEL`.

   Do not add provider API keys or OmniRoute credentials as `VITE_` variables: Vite would expose them to every browser visitor. Vercel environment variables are supplied to the FastAPI function only.
3. Deploy. The UI is served at `/` and the API is served at `/api/research`.

The research request can take up to 60 seconds, which is configured in `vercel.json`. Local development keeps working through Vite's `/api` proxy:

```powershell
cd backend
..\.venv\Scripts\uvicorn.exe api:app --reload

cd ..\frontend
npm run dev
```

## OmniRoute setup

OmniRoute is a gateway you host and configure with the AI-provider accounts you
want it to use. It is not an internet API that Vercel can reach at
`localhost:20128`: deploy OmniRoute to a server with a persistent volume and a
private/scoped API key, then use its public HTTPS address in
`OMNIROUTE_BASE_URL` (for example, `https://llm.example.com/v1`). Keep that
endpoint protected; otherwise strangers could spend your connected providers'
quotas.

Set `OMNIROUTE_MODEL=auto` to use OmniRoute's automatic routing. For more
control, create a quality-first combo in its dashboard and put that combo's
model identifier in `OMNIROUTE_MODEL`. The app uses the same router for both
the report writer and the critic, with a larger writer output budget so reports
can complete at roughly 1,200–1,600 words.
