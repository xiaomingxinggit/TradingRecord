export class ApiError extends Error { constructor(message: string, public status: number) { super(message) } }
export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  let result
  try { result = await response.json() } catch { throw new ApiError('服务返回了无效响应，请确认后端已重启到最新版本。', response.status) }
  if (!response.ok) throw new ApiError(result.error || '操作失败，请稍后重试。', response.status)
  return result as T
}
export const jsonBody = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
