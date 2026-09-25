import Echo from 'laravel-echo'
import Pusher from 'pusher-js'

// Laravel Echo over Reverb. Private channels authorize through POST /broadcasting/auth with the
// session cookie and the `csrf-token` meta tag.
window.Pusher = Pusher

const scheme = import.meta.env.VITE_REVERB_SCHEME ?? 'https'
const port = Number(import.meta.env.VITE_REVERB_PORT ?? (scheme === 'https' ? 443 : 80))

window.Echo = new Echo({
  broadcaster: 'reverb',
  key: import.meta.env.VITE_REVERB_APP_KEY,
  wsHost: import.meta.env.VITE_REVERB_HOST,
  wsPort: port,
  wssPort: port,
  forceTLS: scheme === 'https',
  enabledTransports: ['ws', 'wss'],
})
