import asyncio
import unittest
from aiohttp import ClientSession, web
from server import create_app, ROOMS

class PlayroomFlow(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runner = web.AppRunner(create_app())
        await self.runner.setup()
        self.site = web.TCPSite(self.runner,'127.0.0.1',0)
        await self.site.start()
        port = self.site._server.sockets[0].getsockname()[1]
        self.url = f'http://127.0.0.1:{port}'
        self.session = ClientSession()

    async def asyncTearDown(self):
        await self.session.close()
        await self.runner.cleanup()
        ROOMS.clear()

    async def get_state(self, ws, status=None, game=None):
        for _ in range(12):
            msg = await asyncio.wait_for(ws.receive_json(),3)
            if msg.get('type') == 'state' and (status is None or msg['status']==status) and (game is None or msg['game']==game):
                return msg
        self.fail('Desired state not delivered')

    async def test_full_three_game_rounds(self):
        async with self.session.post(self.url+'/api/rooms') as r:
            self.assertEqual(r.status,200)
            code = (await r.json())['code']
        alice = await self.session.ws_connect(self.url+f'/ws?room={code}')
        bob = await self.session.ws_connect(self.url+f'/ws?room={code}')
        try:
            await alice.send_json({'type':'join','name':'Alice','platform':'web'})
            sa = await self.get_state(alice)
            self.assertEqual(len(sa['players']),1)
            await bob.send_json({'type':'join','name':'Bob','platform':'web'})
            sa = await self.get_state(alice)
            sb = await self.get_state(bob)
            self.assertEqual(len(sa['players']),2)
            self.assertEqual(sa['host'],sa['you'])
            await alice.send_json({'type':'start','rounds':3})
            drawing = await self.get_state(alice,'playing','draw')
            spectator = await self.get_state(bob,'playing','draw')
            self.assertNotEqual(drawing['word'],'???')
            self.assertEqual(spectator['word'],'???')
            await alice.send_json({'type':'draw','points':[[.1,.2],[.3,.4]],'color':'#432ad0'})
            item = await bob.receive_json()
            self.assertEqual(item['type'],'stroke')
            await bob.send_json({'type':'guess','value':drawing['word']})
            r1 = await self.get_state(alice,'results','draw')
            await self.get_state(bob,'results','draw')
            self.assertEqual(next(p for p in r1['players'] if p['name']=='Bob')['score'],100)
            await alice.send_json({'type':'next'})
            quiz_a = await self.get_state(alice,'playing','quiz')
            quiz_b = await self.get_state(bob,'playing','quiz')
            self.assertEqual(quiz_a['correct'],None)
            answer = ROOMS[code].quiz['correct']
            await alice.send_json({'type':'choice','index':answer})
            await bob.send_json({'type':'choice','index':(answer+1)%4})
            qres = await self.get_state(alice,'results','quiz')
            await self.get_state(bob,'results','quiz')
            self.assertEqual(qres['correct'],answer)
            await alice.send_json({'type':'next'})
            va = await self.get_state(alice,'playing','vote')
            vb = await self.get_state(bob,'playing','vote')
            await alice.send_json({'type':'vote','target':vb['you']})
            await bob.send_json({'type':'vote','target':va['you']})
            await self.get_state(alice,'results','vote')
            await self.get_state(bob,'results','vote')
            await alice.send_json({'type':'next'})
            ending = await self.get_state(alice,'finished')
            self.assertEqual(ending['totalRounds'],3)
            self.assertEqual(len(ending['players']),2)
        finally:
            await alice.close(); await bob.close()

    async def test_choose_single_game_and_switch_with_scores(self):
        async with self.session.post(self.url+'/api/rooms') as r:
            self.assertEqual(r.status, 200)
            code = (await r.json())['code']
        alice = await self.session.ws_connect(self.url+f'/ws?room={code}')
        bob = await self.session.ws_connect(self.url+f'/ws?room={code}')
        try:
            await alice.send_json({'type':'join','name':'Alice'})
            await self.get_state(alice)
            await bob.send_json({'type':'join','name':'Bob'})
            await self.get_state(alice)
            await self.get_state(bob)

            await alice.send_json({'type':'start','game':'quiz','rounds':3})
            qa = await self.get_state(alice,'playing','quiz')
            await self.get_state(bob,'playing','quiz')
            self.assertEqual(qa['mode'],'quiz')
            correct = ROOMS[code].quiz['correct']
            await alice.send_json({'type':'choice','index':correct})
            await bob.send_json({'type':'choice','index':(correct+1)%4})
            result = await self.get_state(alice,'results','quiz')
            await self.get_state(bob,'results','quiz')
            self.assertEqual(next(p['score'] for p in result['players'] if p['name']=='Alice'),100)

            await alice.send_json({'type':'lobby'})
            lobby = await self.get_state(alice,'lobby')
            await self.get_state(bob,'lobby')
            self.assertTrue(lobby['resumeScores'])
            await alice.send_json({'type':'start','game':'vote','rounds':0})
            va = await self.get_state(alice,'playing','vote')
            vb = await self.get_state(bob,'playing','vote')
            self.assertEqual(va['totalRounds'],0)
            self.assertEqual(va['mode'],'vote')
            self.assertEqual(next(p['score'] for p in va['players'] if p['name']=='Alice'),100)
            await alice.send_json({'type':'vote','target':vb['you']})
            await bob.send_json({'type':'vote','target':va['you']})
            await self.get_state(alice,'results','vote')
            await self.get_state(bob,'results','vote')
            await alice.send_json({'type':'next'})
            second = await self.get_state(alice,'playing','vote')
            self.assertEqual(second['round'],2)
            self.assertEqual(second['totalRounds'],0)
        finally:
            await alice.close()
            await bob.close()


    async def test_music_quiz_sync_and_scoring(self):
        async with self.session.post(self.url+'/api/rooms') as response:
            code = (await response.json())['code']
        alice = await self.session.ws_connect(self.url+f'/ws?room={code}')
        bob = await self.session.ws_connect(self.url+f'/ws?room={code}')
        try:
            await alice.send_json({'type':'join','name':'Alice'})
            await self.get_state(alice)
            await bob.send_json({'type':'join','name':'Bob'})
            await self.get_state(alice)
            await self.get_state(bob)
            await alice.send_json({'type':'start','game':'music','rounds':3})
            qa = await self.get_state(alice,'playing','music')
            qb = await self.get_state(bob,'playing','music')
            self.assertEqual(qa['melody'], qb['melody'])
            self.assertTrue(len(qa['melody']) >= 6)
            self.assertTrue(len(qa['choices']) == 4)
            self.assertIsNone(qa['correct'])
            correct = ROOMS[code].quiz['correct']
            await alice.send_json({'type':'choice','index':correct})
            await bob.send_json({'type':'choice','index':(correct+1)%4})
            result = await self.get_state(alice,'results','music')
            await self.get_state(bob,'results','music')
            self.assertEqual(result['correct'], correct)
            self.assertEqual(next(p['score'] for p in result['players'] if p['name']=='Alice'),100)
        finally:
            await alice.close()
            await bob.close()

    async def test_drawing_words_are_simple_with_progressive_hints(self):
        from server import WORDS, normalize
        import time
        self.assertTrue(all(1 <= len(normalize(word)) <= 12 for word in WORDS))
        self.assertTrue(all(' ' not in word for word in WORDS))
        async with self.session.post(self.url+'/api/rooms') as response:
            code = (await response.json())['code']
        alice = await self.session.ws_connect(self.url+f'/ws?room={code}')
        bob = await self.session.ws_connect(self.url+f'/ws?room={code}')
        try:
            await alice.send_json({'type':'join','name':'Alice'})
            await self.get_state(alice)
            await bob.send_json({'type':'join','name':'Bob'})
            await self.get_state(alice)
            await self.get_state(bob)
            await alice.send_json({'type':'start','game':'draw','rounds':3})
            artist = await self.get_state(alice,'playing','draw')
            spectator = await self.get_state(bob,'playing','draw')
            self.assertEqual(spectator['word'], '???')
            self.assertEqual(spectator['wordLength'],len(normalize(artist['word'])))
            self.assertEqual(spectator['hintLetter'],'')
            self.assertEqual(spectator['dimLetters'],[])
            room = ROOMS[code]
            room.ends_at = time.time()+8
            await room.broadcast()
            artist_hint = await self.get_state(alice,'playing','draw')
            spectator_hint = await self.get_state(bob,'playing','draw')
            self.assertEqual(spectator_hint['word'],'???')
            self.assertEqual(spectator_hint['hintLetter'],normalize(artist['word'])[0].upper())
            valid_letters = {x.upper() for x in normalize(artist['word'])}
            self.assertFalse(set(spectator_hint['dimLetters']) & valid_letters)
            self.assertEqual(artist_hint['word'],artist['word'])
        finally:
            await alice.close()
            await bob.close()

if __name__ == '__main__':
    unittest.main()
