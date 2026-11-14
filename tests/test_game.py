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

if __name__ == '__main__':
    unittest.main()
