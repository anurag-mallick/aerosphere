import type { ElectronAPI } from './editor'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
