"""Playroom multiplayer server: rooms, mini-games and WebRTC signaling."""
import asyncio
import json
import os
import random
import secrets
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from aiohttp import web, WSMsgType

ROOT = Path(__file__).parent
PORT = int(os.getenv("PORT", "8080"))
MAX_PLAYERS = int(os.getenv("MAX_PLAYERS", "8"))
ROUND_TIME = int(os.getenv("ROUND_TIME", "45"))
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "")
ROOMS = {}
WORDS = ["Une girafe en trottinette", "Un chien astronaute", "Un volcan de fromage", "Une licorne au bureau", "Un pingouin en vacances", "Un chat DJ", "Un robot qui jardine", "Un crocodile qui danse"]
QUIZZES = [
    ("Quel animal possède trois cœurs ?", ["La pieuvre","Le dauphin","Le flamant rose","Le lama"], 0),
    ("Combien de côtés a un hexagone ?", ["Cinq","Six","Sept","Huit"], 1),
    ("Quelle planète est surnommée la planète rouge ?", ["Vénus","Mars","Jupiter","Mercure"], 1),
    ("Quel est le plus grand océan de la Terre ?", ["Atlantique","Indien","Arctique","Pacifique"], 3),
    ("Quel instrument possède des touches noires et blanches ?", ["La trompette","Le piano","Le violon","La harpe"], 1),
    ("De quel pays vient le sushi ?", ["Le Japon","Le Brésil","Le Canada","La Grèce"], 0),
]
VOTES = [
    "Qui arriverait en retard à son propre anniversaire ?",
    "Qui survivrait le plus longtemps sur une île déserte ?",
    "Qui lancerait une chaîne de cuisine catastrophique ?",
    "Qui ferait le meilleur espion ?",
    "Qui deviendrait célèbre pour une raison absurde ?",
    "Qui oublierait le mot de passe de son propre coffre ?",
]

def clean(value, limit=28):
    return "".join(c for c in value.strip() if c.isprintable())[:limit] if isinstance(value, str) else ""

def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.lower()) if c.isalnum() and not unicodedata.combining(c))

@dataclass
class Player:
    id: str
    name: str
    ws: web.WebSocketResponse
    platform: str = "web"
    score: int = 0
    media: bool = False
    answered: bool = False

@dataclass
class Room:
    code: str
    players: dict = field(default_factory=dict)
    host: str | None = None
    status: str = "lobby"
    game: str = ""
    round_number: int = -1
    total_rounds: int = 6
    ends_at: float = 0
    answer: str = ""
    quiz: dict = field(default_factory=dict)
    vote_prompt: str = ""
    artist_id: str | None = None
    guesses: list = field(default_factory=list)
    votes: dict = field(default_factory=dict)
    choices: dict = field(default_factory=dict)
    strokes: list = field(default_factory=list)
    recent: list = field(default_factory=list)
    generation: int = 0
    timer: asyncio.Task | None = None
    playlist: list = field(default_factory=lambda: ["draw", "quiz", "vote"])
    mode: str = "mix"
    resume_scores: bool = False
    updated: float = field(default_factory=time.time)

    def view(self, player_id):
        result = {
            "type": "state", "room": self.code, "you": player_id, "host": self.host,
            "status": self.status, "game": self.game, "mode": self.mode, "resumeScores": self.resume_scores, "round": self.round_number + 1,
            "totalRounds": self.total_rounds, "endsAt": int(self.ends_at * 1000),
            "players": [{"id": p.id, "name": p.name, "score": p.score, "platform": p.platform, "media": p.media, "answered": p.answered} for p in self.players.values()],
            "messages": self.recent[-12:], "strokes": self.strokes[-500:], "guesses": self.guesses[-12:],
        }
        if self.game == "draw":
            result["artistId"] = self.artist_id
            result["word"] = self.answer if self.artist_id == player_id or self.status in ("results", "finished") else "???"
            result["solved"] = [g["id"] for g in self.guesses if g.get("correct")]
        elif self.game == "quiz":
            result["question"] = self.quiz.get("q", "")
            result["choices"] = self.quiz.get("choices", [])
            result["correct"] = self.quiz.get("correct") if self.status in ("results", "finished") else None
            result["yourChoice"] = self.choices.get(player_id)
            result["revealChoices"] = self.choices if self.status in ("results", "finished") else {}
        elif self.game == "vote":
            result["question"] = self.vote_prompt
            result["yourChoice"] = self.votes.get(player_id)
            result["voteCounts"] = {pid: list(self.votes.values()).count(pid) for pid in self.players} if self.status in ("results", "finished") else {}
        return result

    async def send(self, player, data):
        if not player.ws.closed:
            try:
                await player.ws.send_json(data)
            except (ConnectionError, RuntimeError):
                pass

    async def broadcast(self):
        self.updated = time.time()
        await asyncio.gather(*(self.send(p, self.view(p.id)) for p in list(self.players.values())))

    def cancel_timer(self):
        if self.timer and self.timer is not asyncio.current_task() and not self.timer.done():
            self.timer.cancel()
        self.generation += 1

    async def start(self, rounds=6, game="mix"):
        self.cancel_timer()
        self.round_number = -1
        self.total_rounds = rounds
        self.mode = game
        self.playlist = ["draw", "quiz", "vote"] if game == "mix" else [game]
        if not self.resume_scores:
            for p in self.players.values():
                p.score = 0
        self.resume_scores = False
        await self.next_round()

    async def next_round(self):
        self.cancel_timer()
        self.round_number += 1
        self.guesses, self.strokes, self.recent = [], [], []
        self.votes, self.choices = {}, {}
        for p in self.players.values():
            p.answered = False
        if self.total_rounds > 0 and self.round_number >= self.total_rounds:
            self.status, self.game, self.ends_at = "finished", "", 0
            await self.broadcast()
            return
        self.status = "playing"
        self.game = self.playlist[self.round_number % len(self.playlist)]
        if self.game == "draw":
            ids = list(self.players)
            self.artist_id = ids[(self.round_number // len(self.playlist)) % len(ids)] if ids else None
            self.answer = random.choice(WORDS)
        elif self.game == "quiz":
            q, options, correct = random.choice(QUIZZES)
            self.quiz = {"q": q, "choices": options, "correct": correct}
        else:
            self.vote_prompt = random.choice(VOTES)
        self.ends_at = time.time() + (60 if self.game == "draw" else ROUND_TIME)
        await self.broadcast()
        self.timer = asyncio.create_task(self._finish_later(self.generation))

    async def _finish_later(self, generation):
        try:
            await asyncio.sleep(max(0, self.ends_at - time.time()))
            if generation == self.generation and self.status == "playing":
                await self.finish_round()
        except asyncio.CancelledError:
            pass

    async def finish_round(self):
        if self.status != "playing":
            return
        self.cancel_timer()
        self.status = "results"
        self.ends_at = time.time() + 7
        if self.game == "quiz":
            for pid, choice in self.choices.items():
                if pid in self.players and choice == self.quiz["correct"]:
                    self.players[pid].score += 100
        elif self.game == "vote":
            for pid in self.votes:
                if pid in self.players:
                    self.players[pid].score += 30
            for pid in self.votes.values():
                if pid in self.players:
                    self.players[pid].score += 10
        await self.broadcast()
        self.timer = asyncio.create_task(self._next_later(self.generation))

    async def _next_later(self, generation):
        try:
            await asyncio.sleep(7)
            if generation == self.generation and self.status == "results":
                await self.next_round()
        except asyncio.CancelledError:
            pass

    async def on_message(self, p, data):
        kind = data.get("type")
        if kind == "start" and p.id == self.host and self.status in ("lobby", "finished") and len(self.players) >= 2:
            chosen = data.get("game", "mix")
            if chosen not in ("mix", "draw", "quiz", "vote"):
                return
            rounds = data.get("rounds", 6)
            if type(rounds) is not int or rounds not in (0, 3, 6, 12):
                rounds = 6
            await self.start(rounds, chosen)
        elif kind == "lobby" and p.id == self.host and self.status in ("playing", "results", "finished"):
            self.cancel_timer()
            self.status, self.game, self.ends_at = "lobby", "", 0
            self.resume_scores = True
            await self.broadcast()
        elif kind == "next" and p.id == self.host and self.status == "results":
            await self.next_round()
        elif kind == "draw" and self.status == "playing" and self.game == "draw" and p.id == self.artist_id:
            raw = data.get("points")
            if not isinstance(raw, list) or len(raw) > 40:
                return
            points = []
            for pt in raw:
                if not isinstance(pt, list) or len(pt) != 2:
                    return
                try:
                    x, y = float(pt[0]), float(pt[1])
                except (TypeError, ValueError):
                    return
                if not (0 <= x <= 1 and 0 <= y <= 1):
                    return
                points.append([round(x, 3), round(y, 3)])
            if points and len(self.strokes) < 500:
                color = data.get("color", "#432ad0")
                if color not in ("#432ad0", "#ef4782", "#ffb841", "#15a18d", "#22263c"):
                    color = "#432ad0"
                stroke = {"points": points, "color": color}
                self.strokes.append(stroke)
                await asyncio.gather(*(self.send(user, {"type":"stroke", "stroke":stroke}) for user in self.players.values() if user.id != p.id))
        elif kind == "clear" and self.status == "playing" and self.game == "draw" and p.id == self.artist_id:
            self.strokes.clear()
            await asyncio.gather(*(self.send(user, {"type":"clear"}) for user in self.players.values()))
        elif kind == "guess" and self.status == "playing" and self.game == "draw" and p.id != self.artist_id:
            guess = clean(data.get("value"), 75)
            if not guess or any(g.get("correct") and g["id"] == p.id for g in self.guesses):
                return
            success = normalize(guess) == normalize(self.answer)
            self.guesses.append({"id":p.id,"name":p.name,"text":"a trouvé le mot !" if success else guess,"correct":success})
            if success:
                p.score += 100
                if self.artist_id in self.players:
                    self.players[self.artist_id].score += 40
            await self.broadcast()
            if success and all(user.id == self.artist_id or any(g["id"] == user.id and g["correct"] for g in self.guesses) for user in self.players.values()):
                await self.finish_round()
        elif kind == "choice" and self.status == "playing" and self.game == "quiz" and p.id not in self.choices:
            option = data.get("index")
            if type(option) is not int or option not in range(len(self.quiz["choices"])):
                return
            self.choices[p.id] = option
            p.answered = True
            await self.broadcast()
            if len(self.choices) >= len(self.players):
                await self.finish_round()
        elif kind == "vote" and self.status == "playing" and self.game == "vote" and p.id not in self.votes:
            target = data.get("target")
            if target not in self.players or target == p.id:
                return
            self.votes[p.id] = target
            p.answered = True
            await self.broadcast()
            if len(self.votes) >= len(self.players):
                await self.finish_round()
        elif kind == "media":
            p.media = bool(data.get("enabled"))
            await self.broadcast()
        elif kind == "signal":
            target = self.players.get(data.get("target"))
            signal = data.get("data")
            if target and isinstance(signal, dict) and len(json.dumps(signal)) < 25000:
                await self.send(target, {"type":"signal","from":p.id,"data":signal})
        elif kind == "chat":
            msg = clean(data.get("value"), 140)
            if msg:
                self.recent.append({"name":p.name,"text":msg})
                await self.broadcast()

async def api_create(request):
    for _ in range(10):
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        if code not in ROOMS:
            ROOMS[code] = Room(code)
            return web.json_response({"code":code,"url":str(request.url.with_path("/").with_query({"room":code}))})
    raise web.HTTPServiceUnavailable()

async def api_room(request):
    code = request.match_info["code"].upper()
    room = ROOMS.get(code)
    if room is None:
        raise web.HTTPNotFound()
    return web.json_response({"code":code,"players":len(room.players),"status":room.status})

async def socket_handler(request):
    if ALLOWED_ORIGIN and request.headers.get("Origin") != ALLOWED_ORIGIN:
        raise web.HTTPForbidden()
    room = ROOMS.get(request.query.get("room","").upper())
    if room is None:
        raise web.HTTPNotFound(text="Salon introuvable")
    if len(room.players) >= MAX_PLAYERS:
        raise web.HTTPForbidden(text="Salon complet")
    ws = web.WebSocketResponse(heartbeat=25,max_msg_size=28000)
    await ws.prepare(request)
    player = None
    try:
        hello = await asyncio.wait_for(ws.receive_json(), timeout=12)
        if not isinstance(hello,dict) or hello.get("type") != "join":
            await ws.close()
            return ws
        platform = hello.get("platform","web")
        if platform not in ("web","android","discord","telegram","tiktok"):
            platform = "web"
        player = Player(secrets.token_urlsafe(10), clean(hello.get("name"), 20) or "Invité", ws, platform)
        room.players[player.id] = player
        if not room.host:
            room.host = player.id
        await room.broadcast()
        async for item in ws:
            if item.type == WSMsgType.TEXT:
                try:
                    data = json.loads(item.data)
                except json.JSONDecodeError:
                    continue
                if isinstance(data,dict):
                    await room.on_message(player,data)
            elif item.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                break
    except (asyncio.TimeoutError, ValueError):
        pass
    finally:
        if player and player.id in room.players:
            del room.players[player.id]
            if room.host == player.id:
                room.host = next(iter(room.players),None)
            if room.artist_id == player.id and room.status == "playing" and room.game == "draw":
                await room.finish_round()
            await room.broadcast()
    return ws

async def index(request):
    return web.FileResponse(ROOT / "public" / "index.html")

async def cleanup(app):
    while True:
        await asyncio.sleep(300)
        for code, room in list(ROOMS.items()):
            if not room.players and time.time() - room.updated > 900:
                room.cancel_timer()
                ROOMS.pop(code, None)

async def startup(app):
    app["cleanup_task"] = asyncio.create_task(cleanup(app))

async def shutdown(app):
    app["cleanup_task"].cancel()
    for room in ROOMS.values():
        room.cancel_timer()

def create_app():
    app = web.Application(client_max_size=100000)
    app.router.add_get("/",index)
    app.router.add_post("/api/rooms",api_create)
    app.router.add_get("/api/rooms/{code}",api_room)
    app.router.add_get("/ws",socket_handler)
    app.router.add_static("/assets/", ROOT / "public" / "assets")
    app.router.add_get("/manifest.webmanifest",lambda _:web.FileResponse(ROOT/"public"/"manifest.webmanifest"))
    app.router.add_get("/sw.js",lambda _:web.FileResponse(ROOT/"public"/"sw.js"))
    app.on_startup.append(startup)
    app.on_cleanup.append(shutdown)
    return app

if __name__ == "__main__":
    web.run_app(create_app(),host="0.0.0.0",port=PORT)
