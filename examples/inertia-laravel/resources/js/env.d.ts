import type Echo from 'laravel-echo'
import type Pusher from 'pusher-js'

declare global {
  interface Window {
    Echo: Echo<'reverb'>
    Pusher: typeof Pusher
  }

  interface ImportMetaEnv {
    readonly VITE_REVERB_APP_KEY: string
    readonly VITE_REVERB_HOST: string
    readonly VITE_REVERB_PORT?: string
    readonly VITE_REVERB_SCHEME?: string
  }
}

export {}
