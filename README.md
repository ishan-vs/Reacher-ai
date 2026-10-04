# Reacher AI

## Deploy to Vercel

The frontend and FastAPI service deploy together from the repository root.

1. Import the repository into Vercel, leaving the Root Directory set to `./`.
2. Add `GROQ_API_KEY` and `TAVILY_API_KEY` to the Production, Preview, and Development environment targets. Their values are available in the local `backend/.env` file but are intentionally excluded from source control and deployment uploads.
3. Deploy. The UI is served at `/` and the API is served at `/api/research`.

The research request can take up to 60 seconds, which is configured in `vercel.json`. Local development keeps working through Vite's `/api` proxy:

```powershell
cd backend
..\.venv\Scripts\uvicorn.exe api:app --reload

cd ..\frontend
npm run dev
```
