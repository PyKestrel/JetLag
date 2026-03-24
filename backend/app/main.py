import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import init_db
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, HTMLResponse

from app.routers import clients, profiles, captures, logs, portal, overview, settings, setup
from app.services.impairment import ImpairmentService
from app.services.dnsmasq import DnsmasqService
from app.services.firewall import FirewallService
from app.version import __version__, get_version_info


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
    version=__version__,
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
async def captive_portal_middleware(request: Request, call_next):
    """
    Captive portal interception + LAN restriction.

    When nftables DNAT redirects an unauthenticated client's HTTP request to
    port 8080, the Host header still contains the original destination (e.g.
    "www.google.com").  We detect this and serve the captive portal page.
    """
    from app.config import settings as cfg

    path = request.url.path

    # Always allow API, portal, health, setup, and static asset paths through
    if (
        path.startswith("/api/")
        or path.startswith("/portal")
        or path.startswith("/assets")
        or path == "/favicon.ico"
    ):
        return await call_next(request)

    # If setup is not completed, allow everything (initial config phase)
    if not cfg.setup_completed:
        return await call_next(request)

    # Detect DNAT'd requests: Host header won't match any appliance IP
    host_header = (request.headers.get("host") or "").split(":")[0].lower()
    all_lan_ips = set(cfg.all_lan_ips())
    allowed_hosts = {"localhost", "127.0.0.1", "::1"} | all_lan_ips
    primary_lan_ip = cfg.network.lan_ip  # fallback for redirects

    if host_header not in allowed_hosts:
        # This request was DNAT'd from an unauthenticated client trying
        # to reach the internet.  Serve the captive portal page.
        portal_file = Path(__file__).parent.parent.parent / "portal" / "index.html"
        if portal_file.exists():
            return HTMLResponse(content=portal_file.read_text(), status_code=200)
        # Fallback: redirect to portal path
        return RedirectResponse(url=f"http://{primary_lan_ip}:8080/portal")

    # Request is addressed directly to the appliance — apply LAN restriction
    client_ip = request.client.host if request.client else None

    # Allow requests from localhost (for proxied frontend)
    if client_ip in ("127.0.0.1", "::1", "localhost"):
        return await call_next(request)

    # Allow requests from any of the appliance's own LAN IPs
    if client_ip in all_lan_ips:
        return await call_next(request)

    # Check if client IP is within any configured LAN subnet
    try:
        import ipaddress
        client_addr = ipaddress.IPv4Address(client_ip)
        for lp in cfg.lan_ports:
            if not lp.enabled:
                continue
            network = ipaddress.IPv4Network(lp.subnet, strict=False)
            if client_addr in network:
                return await call_next(request)
    except (ValueError, TypeError):
        # If we can't parse, allow the request (fail-open for dev)
        return await call_next(request)

    # Block: client is not on any LAN
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
    return {"status": "ok", "service": "jetlag", "version": __version__}


@app.get("/api/version")
async def version_info():
    return get_version_info()
