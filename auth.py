"""Google OAuth login and PostgreSQL-backed Playroom sessions.

Users may play as guests. Google login is optional and only activates once
DATABASE_URL and the three Google OAuth environment variables are configured.
"""
import asyncio
import base64
import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse

import aiohttp
import asyncpg
from aiohttp import web
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

LOGGER = logging.getLogger(__name__)
DATABASE_URL = os.getenv("DATABASE_URL", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() != "false"
REQUIRE_DATABASE = os.getenv("REQUIRE_DATABASE", "false").lower() == "true"
SESSION_COOKIE = "playroom_session"
SESSION_DAYS = 30


def auth_enabled(app):
    return bool(app.get("db") and GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI)


def safe_next(value):
    """Preserve private room invitation URLs without allowing open redirects."""
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//"):
        return "/"
    if "\\" in value or "\r" in value or "\n" in value or len(value) > 512:
        return "/"
    return value


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def start_db(app):
    if not DATABASE_URL:
        if REQUIRE_DATABASE:
            raise RuntimeError("DATABASE_URL is required when REQUIRE_DATABASE=true")
        app["db"] = None
        LOGGER.warning("DATABASE_URL not set: guest-only development mode")
        return
    app["db"] = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    schema = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    async with app["db"].acquire() as conn:
        await conn.execute(schema)


async def close_db(app):
    pool = app.get("db")
    if pool:
        await pool.close()


async def get_user(request):
    pool = request.app.get("db")
    token = request.cookies.get(SESSION_COOKIE, "")
    if not pool or not token or len(token) > 256:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT u.id::text AS id, u.display_name, u.email, u.avatar_url
               FROM auth_sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = $1 AND s.expires_at > now()""",
            token_hash(token),
        )
    return dict(row) if row else None


async def api_me(request):
    user = await get_user(request)
    return web.json_response(
        {"user": user, "loginEnabled": auth_enabled(request.app)},
        headers={"Cache-Control": "no-store"},
    )


async def api_history(request):
    user = await get_user(request)
    if not user:
        raise web.HTTPUnauthorized(text="Connecte-toi pour retrouver tes parties")
    async with request.app["db"].acquire() as conn:
        rows = await conn.fetch(
            """SELECT g.mode, g.rounds, g.finished_at, r.player_name, r.score
               FROM match_results r JOIN matches g ON r.match_id = g.id
               WHERE r.user_id = $1::uuid
               ORDER BY g.finished_at DESC LIMIT 30""",
            user["id"],
        )
    return web.json_response(
        {"history": [
            {**dict(row), "finished_at": row["finished_at"].isoformat()} for row in rows
        ]},
        headers={"Cache-Control": "no-store"},
    )


def oauth_ready(request):
    if not auth_enabled(request.app):
        raise web.HTTPServiceUnavailable(
            text="La connexion Google sera disponible après la configuration OAuth et PostgreSQL."
        )


async def google_start(request):
    oauth_ready(request)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    next_path = safe_next(request.query.get("next", "/"))
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    response = web.HTTPFound("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params))
    for key, val in (("playroom_oauth_state", state), ("playroom_oauth_verifier", verifier),
                     ("playroom_oauth_next", next_path)):
        response.set_cookie(
            key, val, max_age=600, httponly=True, secure=COOKIE_SECURE,
            samesite="Lax", path="/auth/google",
        )
    raise response


async def google_callback(request):
    oauth_ready(request)
    incoming_state = request.query.get("state", "")
    saved_state = request.cookies.get("playroom_oauth_state", "")
    verifier = request.cookies.get("playroom_oauth_verifier", "")
    if not incoming_state or not saved_state or not verifier or not secrets.compare_digest(incoming_state, saved_state):
        raise web.HTTPForbidden(text="Session de connexion expirée. Recommence la connexion Google.")
    code = request.query.get("code", "")
    if not code:
        raise web.HTTPBadRequest(text="Connexion Google annulée ou code manquant.")

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
        async with session.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code, "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code", "code_verifier": verifier,
            },
        ) as response:
            if response.status != 200:
                LOGGER.warning("Google token exchange failed: HTTP %s", response.status)
                raise web.HTTPUnauthorized(text="Connexion Google impossible. Réessaie.")
            tokens = await response.json()
    google_jwt = tokens.get("id_token")
    if not google_jwt:
        raise web.HTTPUnauthorized(text="Jeton d'identité Google manquant.")

    try:
        claims = await asyncio.to_thread(id_token.verify_oauth2_token, google_jwt, GoogleRequest(), GOOGLE_CLIENT_ID)
    except Exception:
        LOGGER.exception("Google ID token verification failed")
        raise web.HTTPUnauthorized(text="Impossible de vérifier l'identité Google.") from None
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise web.HTTPUnauthorized(text="Émetteur du jeton invalide.")
    if claims.get("email_verified") is not True or not claims.get("sub"):
        raise web.HTTPUnauthorized(text="Adresse Google non vérifiée.")

    email = str(claims.get("email") or "")[:320]
    name = str(claims.get("name") or email.split("@")[0] or "Joueur")[:100]
    avatar = str(claims.get("picture") or "")[:2048]
    session_token = secrets.token_urlsafe(48)
    async with request.app["db"].acquire() as conn:
        async with conn.transaction():
            user_id = await conn.fetchval(
                """INSERT INTO users (google_sub, email, display_name, avatar_url, last_login_at)
                   VALUES ($1, $2, $3, $4, now())
                   ON CONFLICT (google_sub) DO UPDATE SET
                     email = excluded.email, display_name = excluded.display_name,
                     avatar_url = excluded.avatar_url, last_login_at = now()
                   RETURNING id""",
                claims["sub"], email, name, avatar,
            )
            await conn.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)",
                token_hash(session_token), user_id,
                datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
            )

    result = web.HTTPFound(safe_next(request.cookies.get("playroom_oauth_next", "/")))
    for key in ("playroom_oauth_state", "playroom_oauth_verifier", "playroom_oauth_next"):
        result.del_cookie(key, path="/auth/google")
    result.set_cookie(
        SESSION_COOKIE, session_token, max_age=SESSION_DAYS * 86400,
        httponly=True, secure=COOKIE_SECURE, samesite="Lax", path="/",
    )
    raise result


async def logout(request):
    # A state-changing endpoint: verify the browser's origin to prevent CSRF.
    origin = request.headers.get("Origin", "")
    configured_origin = os.getenv("APP_ORIGIN", "").rstrip("/")
    if not configured_origin and GOOGLE_REDIRECT_URI:
        parsed = urlparse(GOOGLE_REDIRECT_URI)
        configured_origin = f"{parsed.scheme}://{parsed.netloc}"
    if not origin or not configured_origin or origin != configured_origin:
        raise web.HTTPForbidden(text="Origine non autorisée")
    token = request.cookies.get(SESSION_COOKIE, "")
    if token and request.app.get("db"):
        async with request.app["db"].acquire() as conn:
            await conn.execute("DELETE FROM auth_sessions WHERE token_hash=$1", token_hash(token))
    result = web.json_response({"ok": True}, headers={"Cache-Control": "no-store"})
    result.del_cookie(SESSION_COOKIE, path="/")
    return result


async def ready(request):
    if REQUIRE_DATABASE or DATABASE_URL:
        pool = request.app.get("db")
        if not pool:
            raise web.HTTPServiceUnavailable(text="Base de données indisponible")
        try:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
        except Exception:
            raise web.HTTPServiceUnavailable(text="Base de données indisponible") from None
    return web.json_response({"status": "ok"})


def install_auth(app):
    app.on_startup.append(start_db)
    app.on_cleanup.append(close_db)
    app.router.add_get("/api/me", api_me)
    app.router.add_get("/api/me/history", api_history)
    app.router.add_get("/auth/google", google_start)
    app.router.add_get("/auth/google/callback", google_callback)
    app.router.add_post("/auth/logout", logout)
    app.router.add_get("/readyz", ready)
