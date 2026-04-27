from fastapi import FastAPI

from app.routers import health

app = FastAPI(title="InTempo API")
app.include_router(health.router, prefix="/v1")


@app.get("/")
def root():
    return {"app": "intempo", "status": "ok"}
