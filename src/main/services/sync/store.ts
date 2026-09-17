/**
 * 同步配置与密钥存储
 * - SyncConfig 存 JSON（不含密钥）
 * - secretKey 经 safeStorage 加密存 data/sync-secret.bin（Linux 无 keychain 回退 base64）
 */
import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SyncConfig } from '@shared/types'
import { JsonStore } from '../store'
import { dataDir } from '../paths'

const DEFAULT_CONFIG: SyncConfig = {
  enabled: false,
  endpoint: '',
  port: 9000,
  useSSL: false,
  bucket: 'vividdeck',
  accessKey: '',
  autoSync: true
}

const syncConfigStore = new JsonStore<SyncConfig>('sync-config', DEFAULT_CONFIG)

function secretFile(): string {
  return path.join(dataDir(), 'sync-secret.bin')
}

export function getSyncConfig(): SyncConfig {
  return syncConfigStore.get()
}

export function updateSyncConfig(patch: Partial<SyncConfig>): SyncConfig {
  return syncConfigStore.set(patch)
}

export function flushSyncConfig(): void {
  syncConfigStore.flush()
}

/** 保存密钥（safeStorage 加密；不可用时 base64 明文回退） */
export function saveSecret(secretKey: string): { encrypted: boolean } {
  let buf: Buffer
  let encrypted = true
  if (safeStorage.isEncryptionAvailable()) {
    buf = safeStorage.encryptString(secretKey)
  } else {
    buf = Buffer.from(secretKey, 'utf8').toString('base64') as unknown as Buffer
    encrypted = false
  }
  fs.writeFileSync(secretFile(), buf)
  return { encrypted }
}

/** 读取密钥（无则返回空串） */
export function loadSecret(): string {
  try {
    const buf = fs.readFileSync(secretFile())
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf)
    }
    return Buffer.from(buf.toString('utf8'), 'base64').toString('utf8')
  } catch {
    return ''
  }
}

export function hasSecret(): boolean {
  return fs.existsSync(secretFile()) && loadSecret() !== ''
}
