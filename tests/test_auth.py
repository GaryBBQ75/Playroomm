"""Exercise real PostgreSQL sessions without contacting Google production."""
import os
import secrets
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from aiohttp import ClientSession, CookieJar, web
from yarl import URL

import auth
from server import create_app, Room, Player


@unittest.skipUnless(os.getenv("DATABASE_URL"), "PostgreSQL integration tests need DATABASE_URL")
class PlayroomAuthIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runner = web.AppRunner(create_app())
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await self.site.start()
        port = self.site._server.sockets[0].getsockname()[1]
        self.url = f"http://127.0.0.1:{port}"
        self.session = ClientSession(cookie_jar=CookieJar(unsafe=True))

    async def asyncTearDown(self):
        await self.session.close()
        await self.runner.cleanup()

    async def create_account_and_session(self):
        token = secrets.token_urlsafe(48)
        async with self.runner.app["db"].acquire() as conn:
            user_id = await conn.fetchval(
                """INSERT INTO users (google_sub, email, display_name)
                   VALUES ($1, $2, $3) RETURNING id""",
                "test-sub-" + secrets.token_hex(10), "player@example.com", "Alex Test",
            )
            await conn.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)",
                auth.token_hash(token), user_id,
                datetime.now(timezone.utc) + timedelta(hours=1),
            )
        self.session.cookie_jar.update_cookies(
            {auth.SESSION_COOKIE: token}, response_url=URL(self.url)
        )
        return user_id, token

    async def test_google_login_needs_credentials(self):
        if auth.GOOGLE_CLIENT_ID:
            self.skipTest("Google credentials configured on this environment")
        async with self.session.get(self.url + "/api/me") as res:
            self.assertEqual(res.status, 200)
            payload = await res.json()
            self.assertIsNone(payload["user"])
            self.assertFalse(payload["loginEnabled"])
        async with self.session.get(self.url + "/auth/google") as res:
            self.assertEqual(res.status, 503)

    async def test_session_and_match_history_and_logout(self):
        user_id, _ = await self.create_account_and_session()
        async with self.session.get(self.url + "/api/me") as res:
            self.assertEqual(res.status, 200)
            me = await res.json()
            self.assertEqual(me["user"]["display_name"], "Alex Test")
            self.assertEqual(me["user"]["email"], "player@example.com")
            self.assertNotIn("google_sub", me["user"])

        # Save a completed match with one signed-in player and one guest.
        room = Room("XYZ123", db_pool=self.runner.app["db"], mode="quiz", round_number=3)
        room.players["p1"] = Player("p1", "Alex Test", web.WebSocketResponse(), score=250, user_id=str(user_id))
        room.players["p2"] = Player("p2", "Invité", web.WebSocketResponse(), score=80)
        await room.save_match()
        async with self.session.get(self.url + "/api/me/history") as res:
            self.assertEqual(res.status, 200)
            history = (await res.json())["history"]
            self.assertTrue(any(item["score"] == 250 and item["mode"] == "quiz" for item in history))

        # State-changing logout requires the correct Origin.
        async with self.session.post(self.url + "/auth/logout") as res:
            self.assertEqual(res.status, 403)
        with patch.dict(os.environ, {"APP_ORIGIN": self.url}):
            async with self.session.post(
                self.url + "/auth/logout", headers={"Origin": self.url}
            ) as res:
                self.assertEqual(res.status, 200)
        async with self.session.get(self.url + "/api/me") as res:
            self.assertIsNone((await res.json())["user"])

    async def test_oauth_state_cookie_and_safe_redirect(self):
        with patch.object(auth, "GOOGLE_CLIENT_ID", "test-id"), \
             patch.object(auth, "GOOGLE_CLIENT_SECRET", "test-secret"), \
             patch.object(auth, "GOOGLE_REDIRECT_URI", self.url + "/auth/google/callback"):
            async with self.session.get(
                self.url + "/auth/google?next=%2F%3Froom%3DABC123",
                allow_redirects=False,
            ) as res:
                self.assertEqual(res.status, 302)
                self.assertTrue(res.headers["Location"].startswith("https://accounts.google.com/"))
                self.assertIn("playroom_oauth_state", res.cookies)
                self.assertEqual(res.cookies["playroom_oauth_next"].value, "/?room=ABC123")
        self.assertEqual(auth.safe_next("//bad.example"), "/")
        self.assertEqual(auth.safe_next("/\\bad.example"), "/")
        self.assertEqual(auth.safe_next("/?room=ABC123"), "/?room=ABC123")


if __name__ == "__main__":
    unittest.main()
