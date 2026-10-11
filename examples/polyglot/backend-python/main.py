from fastapi import FastAPI
from models import Task

app = FastAPI(title="Polyglot Tasks Backend (Python)")

@app.get("/api/health")
def health():
    return {"status": "ok", "backend": "python", "model": "polyglot-tasks"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
