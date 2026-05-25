import binascii
import os
import re
import secrets
from contextlib import asynccontextmanager
from typing import Optional

import httpx
import psycopg2
import psycopg2.extras
import psycopg2.pool
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

_pool: psycopg2.pool.SimpleConnectionPool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pool
    _pool = psycopg2.pool.SimpleConnectionPool(
        1,
        10,
        host=os.environ["POSTGRES_HOST"],
        port=int(os.environ.get("POSTGRES_PORT", 5432)),
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
    yield
    _pool.closeall()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WEBLATE_URL = os.environ.get("WEBLATE_URL", "http://weblate:8080")
WEBLATE_HOST = os.environ.get("WEBLATE_SITE_DOMAIN", "localhost")


class _Conn:
    def __enter__(self):
        self.conn = _pool.getconn()
        self.cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        return self.conn, self.cur

    def __exit__(self, exc, *_):
        if exc:
            self.conn.rollback()
        else:
            self.conn.commit()
        self.cur.close()
        _pool.putconn(self.conn)


def _token_from_header(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Token "):
        raise HTTPException(401, "Missing token")
    return authorization.removeprefix("Token ")


def _username_for_token(token: str) -> str:
    with _Conn() as (_, cur):
        cur.execute(
            """
            SELECT u.username FROM weblate_auth_user u
            JOIN authtoken_token t ON t.user_id = u.id
            WHERE t.key = %s
            """,
            (token,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(401, "Invalid token")
    return row["username"]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/login")
async def login(body: LoginRequest):
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

    with _Conn() as (conn, cur):
        cur.execute(
            "SELECT id FROM weblate_auth_user WHERE username = %s", (body.username,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(401, "User not found")
        user_id = row["id"]

        cur.execute("SELECT key FROM authtoken_token WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        if row:
            token = row["key"]
        else:
            token = binascii.hexlify(os.urandom(20)).decode()
            cur.execute(
                "INSERT INTO authtoken_token (key, user_id, created) VALUES (%s, %s, NOW())",
                (token, user_id),
            )

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


def _suggestion_row(cur, suggestion_id: int, username: str | None) -> dict:
    cur.execute(
        """
        SELECT s.id, s.target, u.username AS "user", s.timestamp,
               COALESCE(SUM(v.value), 0) AS num_votes
        FROM trans_suggestion s
        LEFT JOIN weblate_auth_user u ON u.id = s.user_id
        LEFT JOIN trans_vote v ON v.suggestion_id = s.id
        WHERE s.id = %s
        GROUP BY s.id, s.target, u.username, s.timestamp
        """,
        (suggestion_id,),
    )
    row = dict(cur.fetchone())
    row["timestamp"] = str(row["timestamp"])
    row["num_votes"] = int(row["num_votes"])
    if username:
        cur.execute(
            "SELECT value FROM trans_vote v "
            "JOIN weblate_auth_user u ON u.id = v.user_id "
            "WHERE v.suggestion_id = %s AND u.username = %s",
            (suggestion_id, username),
        )
        uv = cur.fetchone()
        row["user_vote"] = uv["value"] if uv else None
    else:
        row["user_vote"] = None
    return row


@app.get("/suggestions/{unit_id}")
async def list_suggestions(
    unit_id: int, authorization: Optional[str] = Header(None)
):
    token = _token_from_header(authorization)
    username = _username_for_token(token)

    with _Conn() as (_, cur):
        cur.execute(
            """
            SELECT s.id, s.target, u.username AS "user", s.timestamp,
                   COALESCE(SUM(v.value), 0) AS num_votes
            FROM trans_suggestion s
            LEFT JOIN weblate_auth_user u ON u.id = s.user_id
            LEFT JOIN trans_vote v ON v.suggestion_id = s.id
            WHERE s.unit_id = %s
            GROUP BY s.id, s.target, u.username, s.timestamp
            ORDER BY num_votes DESC
            """,
            (unit_id,),
        )
        rows = cur.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            d["timestamp"] = str(d["timestamp"])
            d["num_votes"] = int(d["num_votes"])
            cur.execute(
                "SELECT value FROM trans_vote v "
                "JOIN weblate_auth_user u ON u.id = v.user_id "
                "WHERE v.suggestion_id = %s AND u.username = %s",
                (d["id"], username),
            )
            uv = cur.fetchone()
            d["user_vote"] = uv["value"] if uv else None
            result.append(d)

    return result


@app.post("/suggestions/{unit_id}", status_code=201)
async def create_suggestion(
    unit_id: int,
    body: SuggestionCreate,
    authorization: Optional[str] = Header(None),
):
    token = _token_from_header(authorization)
    username = _username_for_token(token)

    with _Conn() as (_, cur):
        cur.execute(
            "SELECT id FROM weblate_auth_user WHERE username = %s", (username,)
        )
        user_id = cur.fetchone()["id"]

        cur.execute(
            "SELECT id FROM trans_suggestion WHERE unit_id = %s AND target = %s",
            (unit_id, body.target),
        )
        existing = cur.fetchone()
        if existing:
            return _suggestion_row(cur, existing["id"], username)

        cur.execute(
            "INSERT INTO trans_suggestion (target, unit_id, user_id, timestamp) "
            "VALUES (%s, %s, %s, NOW()) RETURNING id",
            (body.target, unit_id, user_id),
        )
        new_id = cur.fetchone()["id"]
        return _suggestion_row(cur, new_id, username)


@app.post("/suggestions/{suggestion_id}/vote")
async def vote_suggestion(
    suggestion_id: int,
    body: VoteRequest,
    authorization: Optional[str] = Header(None),
):
    token = _token_from_header(authorization)
    username = _username_for_token(token)
    value = 1 if body.value == 1 else -1

    with _Conn() as (_, cur):
        cur.execute(
            "SELECT id FROM weblate_auth_user WHERE username = %s", (username,)
        )
        user_id = cur.fetchone()["id"]

        cur.execute(
            "SELECT id, value FROM trans_vote WHERE suggestion_id = %s AND user_id = %s",
            (suggestion_id, user_id),
        )
        existing_vote = cur.fetchone()

        if existing_vote and existing_vote["value"] == value:
            cur.execute("DELETE FROM trans_vote WHERE id = %s", (existing_vote["id"],))
        elif existing_vote:
            cur.execute(
                "UPDATE trans_vote SET value = %s WHERE id = %s",
                (value, existing_vote["id"]),
            )
        else:
            cur.execute(
                "INSERT INTO trans_vote (suggestion_id, user_id, value) VALUES (%s, %s, %s)",
                (suggestion_id, user_id, value),
            )

        cur.execute(
            "SELECT COALESCE(SUM(value), 0) AS num_votes FROM trans_vote WHERE suggestion_id = %s",
            (suggestion_id,),
        )
        num_votes = int(cur.fetchone()["num_votes"])

        cur.execute(
            "SELECT value FROM trans_vote WHERE suggestion_id = %s AND user_id = %s",
            (suggestion_id, user_id),
        )
        uv = cur.fetchone()
        user_vote = uv["value"] if uv else None

    return {"id": suggestion_id, "num_votes": num_votes, "user_vote": user_vote}


@app.patch("/suggestions/{suggestion_id}")
async def edit_suggestion(
    suggestion_id: int,
    body: SuggestionPatch,
    authorization: Optional[str] = Header(None),
):
    token = _token_from_header(authorization)
    username = _username_for_token(token)

    with _Conn() as (_, cur):
        cur.execute(
            "SELECT s.id, u.username AS owner FROM trans_suggestion s "
            "LEFT JOIN weblate_auth_user u ON u.id = s.user_id "
            "WHERE s.id = %s",
            (suggestion_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Suggestion not found")
        if row["owner"] and row["owner"] != username:
            raise HTTPException(403, "Not authorized")

        cur.execute(
            "UPDATE trans_suggestion SET target = %s WHERE id = %s",
            (body.target, suggestion_id),
        )
        return _suggestion_row(cur, suggestion_id, username)
