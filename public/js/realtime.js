// Live "something changed" pings for a room.
//
// Production uses Supabase Realtime: a public broadcast channel per room that
// only carries the new version number, plus Presence to show who is online.
// Local dev uses the dev server's Server-Sent Events stand-in.

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export async function connectRealtime(config, { code, playerId, onUpdate, onPresence, onStatus }) {
  if (!config) return null;

  if (config.kind === 'dev') {
    const es = new EventSource(`/api/dev-events?code=${encodeURIComponent(code)}`);
    es.onopen = () => onStatus(true);
    es.onerror = () => onStatus(false);
    es.onmessage = (e) => {
      try { onUpdate(JSON.parse(e.data).v); } catch {}
    };
    return { close: () => es.close() };
  }

  if (config.kind === 'supabase') {
    const { createClient } = await import(SUPABASE_JS);
    const client = createClient(config.url, config.key, { auth: { persistSession: false } });
    const channel = client.channel(`room:${code}`, {
      config: { presence: { key: playerId }, broadcast: { self: false } }
    });
    channel
      .on('broadcast', { event: 'update' }, ({ payload }) => onUpdate(payload?.v))
      .on('presence', { event: 'sync' }, () => onPresence(new Set(Object.keys(channel.presenceState()))))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          onStatus(true);
          channel.track({ at: Date.now() }).catch(() => {});
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onStatus(false);
        }
      });
    return { close: () => client.removeChannel(channel) };
  }

  return null;
}
