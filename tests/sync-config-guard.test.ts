/**
 * sync/configGuard.ts —— SYNC_SET_CONFIG 入参校验（H3/#9）
 * 背景：#9 给 SyncConfig 加的 scope 字段曾被白名单漏掉，选择性同步
 * 设置保存 100% 被拒——该缺陷因无 IPC 校验层测试而逃过全部关卡。
 */
import { describe, expect, it } from 'vitest'
import { assertValidSyncConfigPatch } from '@main/services/sync/configGuard'
import type { SyncConfig } from '@shared/types'

function patch(p: Record<string, unknown>): Partial<SyncConfig> {
  return p as Partial<SyncConfig>
}

describe('字段白名单', () => {
  it('已知字段全部放行', () => {
    expect(() =>
      assertValidSyncConfigPatch(
        patch({ enabled: true, autoSync: false, useSSL: true, port: 9000 })
      )
    ).not.toThrow()
  })

  it('未知字段直接拒绝（防渲染端把任意字段写进 sync-config.json）', () => {
    expect(() => assertValidSyncConfigPatch(patch({ evil: 'x' }))).toThrow('不支持的配置字段')
    expect(() => assertValidSyncConfigPatch(patch({ confirmInsecure: true }))).toThrow(
      '不支持的配置字段'
    )
  })

  it('非对象入参拒绝', () => {
    expect(() => assertValidSyncConfigPatch(null as unknown as Partial<SyncConfig>)).toThrow(
      '配置必须是对象'
    )
  })
})

describe('endpoint / port / bucket 结构校验（H3）', () => {
  it('endpoint 允许域名 / IP，剥离协议前缀后校验', () => {
    expect(() => assertValidSyncConfigPatch(patch({ endpoint: 'minio.example.com' }))).not.toThrow()
    expect(() =>
      assertValidSyncConfigPatch(patch({ endpoint: 'https://192.168.1.10/' }))
    ).not.toThrow()
    expect(() => assertValidSyncConfigPatch(patch({ endpoint: 'evil.com/path' }))).toThrow()
    expect(() => assertValidSyncConfigPatch(patch({ endpoint: 'evil.com:9000' }))).toThrow()
  })

  it('port 限 1-65535 整数', () => {
    expect(() => assertValidSyncConfigPatch(patch({ port: 9000 }))).not.toThrow()
    expect(() => assertValidSyncConfigPatch(patch({ port: 0 }))).toThrow()
    expect(() => assertValidSyncConfigPatch(patch({ port: 70000 }))).toThrow()
    expect(() => assertValidSyncConfigPatch(patch({ port: 9000.5 }))).toThrow()
  })

  it('bucket 限 S3 命名形态', () => {
    expect(() => assertValidSyncConfigPatch(patch({ bucket: 'vividdeck' }))).not.toThrow()
    expect(() => assertValidSyncConfigPatch(patch({ bucket: 'a' }))).toThrow()
    expect(() => assertValidSyncConfigPatch(patch({ bucket: '-bad-' }))).toThrow()
  })
})

describe('scope 结构校验（#9 回归）', () => {
  it('all / categories / albums 合法形态放行', () => {
    expect(() => assertValidSyncConfigPatch(patch({ scope: { type: 'all' } }))).not.toThrow()
    expect(() =>
      assertValidSyncConfigPatch(patch({ scope: { type: 'categories', ids: ['c1', 'c2'] } }))
    ).not.toThrow()
    expect(() =>
      assertValidSyncConfigPatch(patch({ scope: { type: 'albums', ids: [] } }))
    ).not.toThrow()
  })

  it('非法 type / 非字符串 ids / 缺 ids 拒绝', () => {
    expect(() => assertValidSyncConfigPatch(patch({ scope: { type: 'images' } }))).toThrow(
      '同步范围不合法'
    )
    expect(() =>
      assertValidSyncConfigPatch(patch({ scope: { type: 'categories', ids: [1, 2] } }))
    ).toThrow('同步范围不合法')
    expect(() => assertValidSyncConfigPatch(patch({ scope: { type: 'albums' } }))).toThrow(
      '同步范围不合法'
    )
  })
})
