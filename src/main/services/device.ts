/** 设备标识：首次访问生成 UUID，持久化保存（同步冲突的决胜字段） */
import { JsonStore } from './store'

interface DeviceState {
  deviceId: string
}

const deviceStore = new JsonStore<DeviceState>('device', { deviceId: '' })

export function getDeviceId(): string {
  let id = deviceStore.get().deviceId
  if (!id) {
    id = crypto.randomUUID()
    deviceStore.set({ deviceId: id })
    deviceStore.flush()
  }
  return id
}
