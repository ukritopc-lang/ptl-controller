// API base URL — override at build time with VITE_API_BASE
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://ptl-service.5mmm.online";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204 || !text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export type WaveStatus = "WAIT" | "PROCESS" | "PAUSE" | "DONE" | "CANCELLED";

export type WaveSummary = {
  wave_id: number;
  wave_no: string;
  shipment_nos: string[];
  wave_date: string;
  status: WaveStatus;
  total_skus: number;
  total_locations: number;
  completed_skus: number;
  total_qty: number;
  put_qty: number;
  remaining_qty: number;
  progress_percent: number;
  available_action: string;
};

export const api = {
  getActiveWaves: () => request<any>(`/api/v1/waves/active`),
  getWaveDetail: (waveNo: string) =>
    request<any>(`/api/v1/waves/${encodeURIComponent(waveNo)}`),
  getWaveProgress: (waveNo: string) =>
    request<any>(`/api/v1/waves/${encodeURIComponent(waveNo)}/progress`),
  startWave: (waveNo: string, body: { operator_id: string }) =>
    request<any>(`/api/v1/waves/${encodeURIComponent(waveNo)}/start`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  pauseWave: (waveNo: string, body: { operator_id: string; reason?: string }) =>
    request<any>(`/api/v1/waves/${encodeURIComponent(waveNo)}/pause`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  resumeWave: (waveNo: string, body: { operator_id: string }) =>
    request<any>(`/api/v1/waves/${encodeURIComponent(waveNo)}/resume`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  cancelWave: (waveNo: string, body: { operator_id: string; reason: string }) =>
    request<any>(`/api/v1/waves/${encodeURIComponent(waveNo)}/cancel`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};