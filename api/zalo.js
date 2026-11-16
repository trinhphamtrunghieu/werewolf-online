// Zalo Bot webhook (see lib/zalo.js). Point the bot at it with setWebhook:
//   url: https://<your-site>/api/zalo   secret_token: <ZALO_WEBHOOK_SECRET>
//
// A text message ">createRoom wolf" opens an empty Ma Sói room; the bot
// replies in the chat with its link, and the first person to join becomes
// the host. Other messages are ignored.

import { createRoom, secureRandom } from '../lib/engine.js';
import { getStore, createRoomRecord, StoreError } from '../lib/store.js';
import {
  parseCommand, zaloConfig, sendMessage, createdMessage, roomUrl, SECRET_HEADER
} from '../lib/zalo.js';
import { newCode, readBody } from './room.js';

function siteUrl(req, config) {
  if (config.appUrl) return config.appUrl;
  const h = req.headers;
  const host = h['x-forwarded-host'] || h.host || 'localhost:3000';
  const proto = h['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function openRoom(store, gameId, zalo) {
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    const { state } = createRoom({ code, now, gameId, hostless: true });
    state.zalo = zalo;
    if (await createRoomRecord(store, code, state)) return code;
  }
  throw new StoreError('Không tạo được phòng, hãy thử lại.');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const config = zaloConfig();
  if (!config.secret) return res.status(503).json({ message: 'Chưa cấu hình ZALO_WEBHOOK_SECRET.' });
  if (req.headers[SECRET_HEADER] !== config.secret) return res.status(403).json({ message: 'Unauthorized' });

  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ message: 'Invalid JSON' });
  }
  const msg = body.message || {};
  const command = body.event_name === 'message.text.received' ? parseCommand(msg.text) : null;
  const chatId = msg.chat?.id;
  if (!command || !chatId) return res.status(200).json({ message: 'Ignored' });

  const reply = async (text) => {
    if (!config.botToken) return;
    try {
      await sendMessage(config.botToken, chatId, text);
    } catch (err) {
      console.warn('Zalo sendMessage failed', err);
    }
  };

  if (command.error) {
    await reply(command.error);
    return res.status(200).json({ message: 'Unknown game' });
  }
  try {
    const base = siteUrl(req, config);
    const code = await openRoom(getStore(), command.gameId, {
      chatId,
      messageId: msg.message_id || null,
      from: { id: msg.from?.id || null, display_name: msg.from?.display_name || null },
      appUrl: base
    });
    const url = roomUrl(base, code);
    await reply(createdMessage(command.gameId, url, code));
    return res.status(200).json({ message: 'Success', code, url });
  } catch (err) {
    console.error(err);
    await reply('Không tạo được phòng, hãy thử lại sau.');
    return res.status(503).json({ message: err instanceof StoreError ? err.message : 'Server error' });
  }
}
