import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from app.routers import clients, profiles, captures, logs, portal, overview, settings


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler()],
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger = logging.getLogger("jetlag")
    logger.info("JetLag appliance starting up...")

    # Initialize database
    await init_db()
    logger.info("Database initialized")

    # On a real Linux appliance, we'd initialize network services here:
    # await FirewallService.initialize()
    # await ImpairmentService.initialize()
    # await DnsmasqService.generate_config()
    # await DnsmasqService.restart()

    yield

    logger.info("JetLag appliance shutting down...")


app = FastAPI(
    title="JetLag",
    description="Captive Portal Network Simulator — Admin API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
app.include_router(overview.router)
app.include_router(clients.router)
app.include_router(profiles.router)
app.include_router(captures.router)
app.include_router(logs.router)
app.include_router(portal.router)
app.include_router(settings.router)

# Serve captive portal static files
portal_path = Path(__file__).parent.parent.parent / "portal"
if portal_path.exists():
    app.mount("/portal", StaticFiles(directory=str(portal_path), html=True), name="portal")

# Serve frontend build (production)
frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "jetlag"}
