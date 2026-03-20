import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.routers import clients, profiles, captures, logs, portal, overview, settings, setup
from app.services.impairment import ImpairmentService
from app.services.dnsmasq import DnsmasqService
from app.services.firewall import FirewallService


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

    # Initialize services if setup was already completed (e.g., server restart)
    from app.config import settings as cfg
    import platform

    if cfg.setup_completed and platform.system() == "Linux":
        # Initialize tc/netem root qdisc
        try:
            await ImpairmentService.initialize()
            logger.info("tc/netem initialized")
        except Exception as e:
            logger.error(f"Failed to initialize tc/netem on startup: {e}")

        # Start dnsmasq (generate config + restart)
        try:
            await DnsmasqService.generate_config()
            await DnsmasqService.restart()
            logger.info("dnsmasq started")
        except Exception as e:
            logger.error(f"Failed to start dnsmasq on startup: {e}")

        # Initialize nftables firewall
        try:
            await FirewallService.initialize()
            logger.info("nftables initialized")
        except Exception as e:
            logger.error(f"Failed to initialize firewall on startup: {e}")

        # Enable IP forwarding
        try:
            import subprocess
            subprocess.run(
                ["sysctl", "-w", "net.ipv4.ip_forward=1"],
                capture_output=True, timeout=5,
            )
            logger.info("IP forwarding enabled")
        except Exception as e:
            logger.error(f"Failed to enable IP forwarding: {e}")
    else:
        # Still try to initialize tc (has its own platform + setup guard)
        await ImpairmentService.initialize()

    yield

    logger.info("JetLag appliance shutting down...")


app = FastAPI(
    title="JetLag",
    description="Captive Portal Network Simulator — Admin API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend from any host (dev + LAN access)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup router (always accessible)
app.include_router(setup.router)

# API routers
app.include_router(overview.router)
app.include_router(clients.router)
app.include_router(profiles.router)
app.include_router(captures.router)
app.include_router(logs.router)
app.include_router(portal.router)
app.include_router(settings.router)


@app.middleware("http")
async def lan_restriction_middleware(request: Request, call_next):
    """
    After setup is completed, restrict admin API access to the LAN interface only.
    The WAN interface should not be able to reach the admin UI or API.
    Setup endpoints and health check are always accessible.
    """
    from app.config import settings as cfg

    # Always allow setup endpoints and health check
    path = request.url.path
    if path.startswith("/api/setup") or path == "/api/health":
        return await call_next(request)

    # If setup is not completed, allow everything (initial config phase)
    if not cfg.setup_completed:
        return await call_next(request)

    # After setup: check if request comes from LAN side
    # On a real appliance, we compare the server's receiving interface.
    # In practice, we check the client IP against the LAN subnet.
    client_ip = request.client.host if request.client else None
    lan_ip = cfg.network.lan_ip
    lan_subnet = cfg.network.lan_subnet

    # Allow requests from localhost (for proxied frontend)
    if client_ip in ("127.0.0.1", "::1", "localhost"):
        return await call_next(request)

    # Allow requests from the appliance's own LAN IP
    if client_ip == lan_ip:
        return await call_next(request)

    # Check if client IP is within the LAN subnet
    try:
        import ipaddress
        network = ipaddress.IPv4Network(lan_subnet, strict=False)
        if ipaddress.IPv4Address(client_ip) in network:
            return await call_next(request)
    except (ValueError, TypeError):
        # If we can't parse, allow the request (fail-open for dev)
        return await call_next(request)

    # Block: client is not on LAN
    return JSONResponse(
        status_code=403,
        content={
            "detail": "Access denied. Admin interface is only accessible from the LAN interface after setup."
        },
    )

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
