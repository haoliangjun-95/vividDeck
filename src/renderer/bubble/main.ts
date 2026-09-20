/**
 * 悬浮球渲染层：当前壁纸缩略图圆球
 * - 单击 → 切换下一张壁纸（主进程 nextSlideshowNow，切换成功后 BUBBLE_UPDATE 回推刷新）
 * - 按住拖动超过阈值 → 位移同步主进程移动窗口；松手时位置已持久化
 * - 右键 → 主进程弹出菜单（下一张 / 打开主界面 / 隐藏）
 */
import './main.css'

const bubble = document.getElementById('bubble') as HTMLDivElement
const img = document.getElementById('wallpaper') as HTMLImageElement

function setWallpaper(imageId: string | null): void {
  if (!imageId) {
    img.style.display = 'none'
    bubble.classList.add('empty')
    return
  }
  img.style.display = ''
  bubble.classList.remove('empty')
  // 缩略图带时间戳避免缓存
  img.src = `media://thumb/${imageId}?t=${Date.now()}`
}

/** 初始：当前壁纸 */
void window.api.getBubbleCurrent().then((r) => setWallpaper(r.imageId))

/** 壁纸变化（设置/轮播/悬浮球点击后） */
window.api.onBubbleUpdate(({ imageId }) => setWallpaper(imageId))

// ---------- 单击 vs 拖动 ----------
const DRAG_THRESHOLD = 5 // 位移超过该值（px）判定为拖动
let dragging = false
let pressed = false
let lastX = 0
let lastY = 0

bubble.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  pressed = true
  dragging = false
  lastX = e.screenX
  lastY = e.screenY
})

window.addEventListener('mousemove', (e) => {
  if (!pressed) return
  const dx = e.screenX - lastX
  const dy = e.screenY - lastY
  if (!dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
  dragging = true
  lastX = e.screenX
  lastY = e.screenY
  if (dx !== 0 || dy !== 0) window.api.bubbleMoveBy(dx, dy)
})

window.addEventListener('mouseup', () => {
  if (!pressed) return
  pressed = false
  if (dragging) return
  // 纯单击：切换壁纸 + 点击动效
  bubble.classList.add('clicked')
  setTimeout(() => bubble.classList.remove('clicked'), 240)
  void window.api.slideshowNext().catch((err) => console.error('切换失败:', err))
})

bubble.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.api.bubbleContextMenu()
})

// 拖动时改变光标
bubble.addEventListener('mouseenter', () => (bubble.style.cursor = 'grab'))
bubble.addEventListener('mousedown', () => (bubble.style.cursor = dragging ? 'grabbing' : 'pointer'))
window.addEventListener('mouseup', () => (bubble.style.cursor = 'grab'))
