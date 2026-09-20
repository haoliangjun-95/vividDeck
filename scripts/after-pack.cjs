// electron-builder afterPack 钩子：打包后固定等待，让杀毒软件（腾讯电脑管家 /
// Windows Defender 等）完成对刚写出的主程序 exe 的实时扫描并释放文件，
// 避免下一步 rcedit 修改 PE 资源时报 "Fatal error: Unable to commit changes"。
// 注意：不能用"尝试以读写模式打开"来探测——杀毒以内存映射持有时普通打开仍会
// 成功，只有 rcedit 的 UpdateResource 提交会失败，因此采用固定冷却时间。
// 运行：electron-builder.yml → afterPack: scripts/after-pack.cjs
const WAIT_MS = 15000

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  console.log(`  • afterPack: 等待 ${WAIT_MS}ms（杀毒实时扫描冷却）`)
  await new Promise((r) => setTimeout(r, WAIT_MS))
}

module.exports = afterPack
