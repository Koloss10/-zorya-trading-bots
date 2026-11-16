// Підпис запитів Binance: приклад з офіційної документації Binance API (HMAC SHA256).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, floorStep } from '../supabase/functions/exchange/sign.js';

test('Підпис збігається з прикладом із документації Binance', async () => {
  const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
  const q = 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
  assert.equal(await sign(q, secret), 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
});

test('Кількість округлюється вниз до кроку біржі', () => {
  assert.equal(floorStep(0.0021428, 0.001), 0.002);
  assert.equal(floorStep(12.3456, 0.1), 12.3);
  assert.equal(floorStep(0.3, 0.1), 0.3);
  assert.equal(floorStep(5, 1), 5);
});

test('Підпис Bybit v5 збігається з незалежним HMAC (GET і POST)', async () => {
  const { createHmac } = await import('node:crypto');
  const { bybitPayload } = await import('../supabase/functions/exchange/sign.js');
  const key = 'XXXXXXXXXXXXXXXXXX', secret = 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY', ts = 1658384314791, recv = 5000;
  for (const payload of ['category=linear&symbol=BTCUSDT', JSON.stringify({ category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001' })]) {
    const pre = bybitPayload(ts, key, recv, payload);
    assert.equal(pre, '1658384314791' + key + '5000' + payload);
    assert.equal(await sign(pre, secret), createHmac('sha256', secret).update(pre).digest('hex'));
  }
});
