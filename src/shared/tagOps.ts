/**
 * 标签管理操作（重命名 / 合并 / 删除）的纯函数核心：
 * 标签是自由字符串，同时存在于图片记录（img.tags）与智能相册规则
 * （tagsAll/tagsAny）两处——任何标签级操作必须同步改写相册规则，
 * 否则相册会静默匹配不到已改名/已合并的标签。
 * 主进程 library.ts 调用；断言见 tests/tag-ops.test.ts。
 */
import type { SmartAlbumRules } from './types'

/** 改写单份相册规则中的标签引用：from → to（to 为 null 表示删除该标签）；无命中返回原对象 */
export function rewriteRulesForTag(
  rules: SmartAlbumRules,
  from: string,
  to: string | null
): SmartAlbumRules {
  if (!rules.tagsAll?.includes(from) && !rules.tagsAny?.includes(from)) return rules
  const map = (tags: string[]): string[] => {
    // 先替换再过滤（to=null 即删除）；重命名撞名时去重保序
    const replaced = tags.flatMap((t) => (t === from ? (to === null ? [] : [to]) : [t]))
    return to === null ? replaced : Array.from(new Set(replaced))
  }
  const next: SmartAlbumRules = { ...rules }
  if (rules.tagsAll) next.tagsAll = map(rules.tagsAll)
  if (rules.tagsAny) next.tagsAny = map(rules.tagsAny)
  return next
}

/** 整组规则批量改写（相册集遍历用）；无命中返回原引用（避免无谓的新对象） */
export function rewriteAlbumsForTag<T extends { rules: SmartAlbumRules }>(
  albums: T[],
  from: string,
  to: string | null
): T[] {
  if (!albums.some((a) => a.rules.tagsAll?.includes(from) || a.rules.tagsAny?.includes(from))) {
    return albums
  }
  return albums.map((a) => {
    if (!a.rules.tagsAll?.includes(from) && !a.rules.tagsAny?.includes(from)) return a
    return { ...a, rules: rewriteRulesForTag(a.rules, from, to) }
  })
}

/** 校验标签名：非空、去首尾空白、限长（与图片标签输入口径一致） */
export function normalizeTagName(raw: string): string | null {
  const name = raw.trim()
  return name.length > 0 && name.length <= 50 ? name : null
}
