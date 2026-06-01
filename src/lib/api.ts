// API base URL — override at build time with VITE_API_BASE
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://ptl-service.5mmm.online";

export const PTL_API_BASE =
  (import.meta.env.VITE_PTL_API_BASE as string | undefined) ??
  "http://localhost:3001/api";

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

async function requestPtl<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PTL_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`PTL ${res.status}: ${text || res.statusText}`);
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
  scanSku: (body: {
    wave_no: string;
    sku: string;
    operator_id: string;
    device_id: string;
    zone_id?: number | null;
  }) =>
    request<any>(`/api/v1/scan`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  confirmScan: (body: {
    wave_no: string;
    sku: string;
    operator_id: string;
    location_codes?: string[] | null;
  }) =>
    request<any>(`/api/v1/confirm/scan`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  putConfirm: (body: {
    wave_no: string;
    sku: string;
    operator_id: string;
    location_code: string;
    qty: number;
  }) =>
    request<any>(`/api/v1/put/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  confirmCancel: (body: {
    wave_no: string;
    sku: string;
    operator_id: string;
    location_codes?: string[] | null;
  }) =>
    request<any>(`/api/v1/confirm/cancel`, {
      method: "POST",
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

export type PtlDisplayMode = "auto" | "manual";
export type PtlEffect = "none" | "blink";

export const ptlApi = {
  getStatus: () => requestPtl<any>(`/ptl/status`),
  sendCommand: (body: { command: string; timeout?: number; retry?: number }) =>
    requestPtl<any>(`/ptl/send`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  display: (body: {
    address: string;
    value: string | number;
    mode?: PtlDisplayMode;
    effect?: PtlEffect;
  }) =>
    requestPtl<any>(`/ptl/display`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  clear: (address: string) =>
    requestPtl<any>(`/ptl/clear`, {
      method: "POST",
      body: JSON.stringify({ address }),
    }),
};