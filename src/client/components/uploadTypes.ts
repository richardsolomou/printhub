import type { PrintTechnology } from '../../core/types'

export type UploadEntry = {
  key: string
  file: File
  name: string
  quantity: string
  notes: string
  sourceUrl: string
  technology?: PrintTechnology
  printerId?: string
  noteOpen: boolean
  linkOpen: boolean
  thumbnail?: string
  state: 'pending' | 'uploading' | 'done' | 'error'
}
