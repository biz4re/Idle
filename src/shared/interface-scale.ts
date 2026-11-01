export const INTERFACE_SCALES = [1, 1.25, 1.5] as const
export function interfaceScale(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return INTERFACE_SCALES.find((scale) => scale === number) ?? 1
}
export function interfaceViewport(width: number, scale: number): number { return width / interfaceScale(scale) }
export function interfaceRect<T extends { left: number; right: number; top: number; bottom: number; width: number }>(rect: T, scale: number) {
  const factor = interfaceScale(scale)
  return { left: rect.left / factor, right: rect.right / factor, top: rect.top / factor, bottom: rect.bottom / factor, width: rect.width / factor }
}
