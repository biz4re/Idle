import type { IdleAPI } from '../../shared/ipc'

declare global {
  interface Window {
    idle: IdleAPI
  }
}
