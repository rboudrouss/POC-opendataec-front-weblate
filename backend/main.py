import binascii
import os
import re
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

_pool: asyncpg.Pool | None = None
_redis: aioredis.Redis | None = None

limiter = Limiter(key_func=get_remote_address)

TOKEN_TTL = 3600  # 1h cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pool, _redis
    _pool = await asyncpg.create_pool(
        host=os.environ["POSTGRES_HOST"],
        port=int(os.environ.get("POSTGRES_PORT", 5432)),
        database=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        min_size=2,
        max_size=20,
    )
    _redis = aioredis.from_url(
        f"redis://{os.environ.get('REDIS_HOST', 'redis')}",
        decode_responses=True,
    )
    yield
    await _pool.close()
    await _redis.aclose()


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS != [""] else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WEBLATE_URL = os.environ.get("WEBLATE_URL", "http://weblate:8080")
WEBLATE_HOST = os.environ.get("WEBLATE_SITE_DOMAIN", "localhost")


def _token_from_header(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Token "):
        raise HTTPException(401, "Missing token")
    return authorization.removeprefix("Token ")


async def _username_for_token(token: str) -> str:
    cache_key = f"token:{token}"
    cached = await _redis.get(cache_key)
    if cached:
        return cached

    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT u.username FROM weblate_auth_user u
            JOIN authtoken_token t ON t.user_id = u.id
            WHERE t.key = $1
            """,
            token,
        )
    if not row:
        raise HTTPException(401, "Invalid token")

    await _redis.setex(cache_key, TOKEN_TTL, row["username"])
    return row["username"]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest):
    try:
        async with httpx.AsyncClient(follow_redirects=False) as client:
            r1 = await client.get(
                f"{WEBLATE_URL}/accounts/login/",
                headers={"Host": WEBLATE_HOST},
            )
            match = re.search(r'csrfmiddlewaretoken[^>]*value="([^"]+)"', r1.text)
            if not match:
                raise HTTPException(500, "CSRF not found")
            csrf = match.group(1)
            session_cookie = r1.headers.get("set-cookie", "").split(";")[0]

            r2 = await client.post(
                f"{WEBLATE_URL}/accounts/login/",
                content=f"username={body.username}&password={body.password}&csrfmiddlewaretoken={csrf}",
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Cookie": session_cookie,
                    "Host": WEBLATE_HOST,
                },
            )
    except httpx.ConnectError:
        raise HTTPException(503, "Weblate unavailable")

    if r2.status_code != 302:
        raise HTTPException(401, "Identifiants incorrects")

    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM weblate_auth_user WHERE username = $1", body.username
        )
        if not row:
            raise HTTPException(401, "User not found")
        user_id = row["id"]

        token_row = await conn.fetchrow(
            "SELECT key FROM authtoken_token WHERE user_id = $1", user_id
        )
        if token_row:
            token = token_row["key"]
        else:
            token = binascii.hexlify(os.urandom(20)).decode()
            await conn.execute(
                "INSERT INTO authtoken_token (key, user_id, created) VALUES ($1, $2, NOW())",
                token,
                user_id,
            )

    await _redis.setex(f"token:{token}", TOKEN_TTL, body.username)
    return {"token": token, "username": body.username}


# ---------------------------------------------------------------------------
# Suggestions
# ---------------------------------------------------------------------------


class SuggestionCreate(BaseModel):
    target: str


class SuggestionPatch(BaseModel):
    target: str


class VoteRequest(BaseModel):
    value: int  # 1 or -1


async def _suggestion_row(conn: asyncpg.Connection, suggestion_id: int, username: str | None) -> dict:
    row = await conn.fetchrow(
        """
        SELECT s.id, s.target, u.username AS "user", s.timestamp,
               COALESCE(SUM(v.value), 0) AS num_votes
        FROM trans_suggestion s
        LEFT JOIN weblate_auth_user u ON u.id = s.user_id
        LEFT JOIN trans_vote v ON v.suggestion_id = s.id
        WHERE s.id = $1
        GROUP BY s.id, s.target, u.username, s.timestamp
        """,
        suggestion_id,
    )
    d = dict(row)
    d["timestamp"] = str(d["timestamp"])
    d["num_votes"] = int(d["num_votes"])
    if username:
        uv = await conn.fetchrow(
            "SELECT value FROM trans_vote v "
            "JOIN weblate_auth_user u ON u.id = v.user_id "
            "WHERE v.suggestion_id = $1 AND u.username = $2",
            suggestion_id,
            username,
        )
        d["user_vote"] = uv["value"] if uv else None
    else:
        d["user_vote"] = None
    return d


@app.get("/suggestions/{unit_id}")
async def list_suggestions(unit_id: int, authorization: Optional[str] = Header(None)):
    token = _token_from_header(authorization)
    username = await _username_for_token(token)

    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.target, u.username AS "user", s.timestamp,
                   COALESCE(SUM(v.value), 0) AS num_votes,
                   uv.value AS user_vote
            FROM trans_suggestion s
            LEFT JOIN weblate_auth_user u ON u.id = s.user_id
            LEFT JOIN trans_vote v ON v.suggestion_id = s.id
            LEFT JOIN weblate_auth_user me ON me.username = $2
            LEFT JOIN trans_vote uv ON uv.suggestion_id = s.id AND uv.user_id = me.id
            WHERE s.unit_id = $1
            GROUP BY s.id, s.target, u.username, s.timestamp, uv.value
            ORDER BY num_votes DESC
            """,
            unit_id,
            username,
        )
        result = []
        for row in rows:
            d = dict(row)
            d["timestamp"] = str(d["timestamp"])
            d["num_votes"] = int(d["num_votes"])
            result.append(d)

    return result


@app.post("/suggestions/{unit_id}", status_code=201)
async def create_suggestion(
    unit_id: int,
    body: SuggestionCreate,
    authorization: Optional[str] = Header(None),
):
    token = _token_from_header(authorization)
    username = await _username_for_token(token)

    async with _pool.acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT id FROM weblate_auth_user WHERE username = $1", username
        )
        user_id = user_row["id"]

        existing = await conn.fetchrow(
            "SELECT id FROM trans_suggestion WHERE unit_id = $1 AND target = $2",
            unit_id,
            body.target,
        )
        if existing:
            return await _suggestion_row(conn, existing["id"], username)

        new_id = await conn.fetchval(
            "INSERT INTO trans_suggestion (target, unit_id, user_id, timestamp) "
            "VALUES ($1, $2, $3, NOW()) RETURNING id",
            body.target,
            unit_id,
            user_id,
        )
        return await _suggestion_row(conn, new_id, username)


@app.post("/suggestions/{suggestion_id}/vote")
async def vote_suggestion(
    suggestion_id: int,
    body: VoteRequest,
    authorization: Optional[str] = Header(None),
):
    token = _token_from_header(authorization)
    username = await _username_for_token(token)
    value = 1 if body.value == 1 else -1

    async with _pool.acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT id FROM weblate_auth_user WHERE username = $1", username
        )
        user_id = user_row["id"]

        existing_vote = await conn.fetchrow(
            "SELECT id, value FROM trans_vote WHERE suggestion_id = $1 AND user_id = $2",
            suggestion_id,
            user_id,
        )

        if existing_vote and existing_vote["value"] == value:
            await conn.execute("DELETE FROM trans_vote WHERE id = $1", existing_vote["id"])
        elif existing_vote:
            await conn.execute(
                "UPDATE trans_vote SET value = $1 WHERE id = $2",
                value,
                existing_vote["id"],
            )
        else:
            await conn.execute(
                "INSERT INTO trans_vote (suggestion_id, user_id, value) VALUES ($1, $2, $3)",
                suggestion_id,
                user_id,
                value,
            )

        num_votes = await conn.fetchval(
            "SELECT COALESCE(SUM(value), 0) FROM trans_vote WHERE suggestion_id = $1",
            suggestion_id,
        )
        uv = await conn.fetchrow(
            "SELECT value FROM trans_vote WHERE suggestion_id = $1 AND user_id = $2",
            suggestion_id,
            user_id,
        )

    return {"id": suggestion_id, "num_votes": int(num_votes), "user_vote": uv["value"] if uv else None}


@app.patch("/suggestions/{suggestion_id}")
async def edit_suggestion(
    suggestion_id: int,
    body: SuggestionPatch,
    authorization: Optional[str] = Header(None),
):
    token = _token_from_header(authorization)
    username = await _username_for_token(token)

    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT s.id, u.username AS owner FROM trans_suggestion s "
            "LEFT JOIN weblate_auth_user u ON u.id = s.user_id "
            "WHERE s.id = $1",
            suggestion_id,
        )
        if not row:
            raise HTTPException(404, "Suggestion not found")
        if row["owner"] and row["owner"] != username:
            raise HTTPException(403, "Not authorized")

        await conn.execute(
            "UPDATE trans_suggestion SET target = $1 WHERE id = $2",
            body.target,
            suggestion_id,
        )
        return await _suggestion_row(conn, suggestion_id, username)
