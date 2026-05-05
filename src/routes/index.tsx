import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { QrScanner } from "@/components/QrScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { api, API_BASE } from "@/lib/api";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { CheckCircle2, QrCode, PackageCheck, Loader2, RotateCcw, Check, Flag } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

type Step = "scan" | "confirm" | "picking" | "done";
type LogEntry = { time: string; ok: boolean; label: string; detail?: string };

type LocationInfo = {
  location_code: string;
  branch_code: string;
  zone_id?: number | null;
  zone_code?: string | null;
  qty_required: number;
  qty_put: number;
  qty_remaining: number;
  light_color: string;
};

type ScanResult = {
  wave_no: string;
  sku: string;
  sku_description?: string | null;
  total_locations: number;
  locations: LocationInfo[];
  message: string;
};

function Index() {
  const [step, setStep] = useState<Step>("scan");
  const [zoneId, setZoneId] = useState<number>(1);
  const [scannedSku, setScannedSku] = useState("");
  const [operatorId, setOperatorId] = useState("OP001");
  const [deviceId, setDeviceId] = useState("DEV001");
  const [manualMode, setManualMode] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [putDone, setPutDone] = useState<Record<string, boolean>>({});
  const [busyLoc, setBusyLoc] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const log = (ok: boolean, label: string, detail?: string) =>
    setLogs((l) => [
      { time: new Date().toLocaleTimeString(), ok, label, detail },
      ...l,
    ]);

  const totalRemaining = result?.locations.reduce((s, l) => s + (l.qty_remaining ?? 0), 0) ?? 0;
  const pendingLocs = result?.locations.filter((l) => !putDone[l.location_code]) ?? [];
  const allDone = result ? pendingLocs.length === 0 : false;

  const findWaveForSku = async (sku: string): Promise<string | null> => {
    const activeRes: any = await api.getActiveWaves();
    log(true, `GET /waves/active`, `${(Array.isArray(activeRes) ? activeRes : []).length} waves`);
    const waves: any[] = Array.isArray(activeRes) ? activeRes : activeRes?.data ?? [];
    for (const w of waves) {
      const wNo = w.wave_no ?? w.waveNo;
      if (!wNo) continue;
      try {
        const detail: any = await api.getWaveDetail(wNo);
        const skus: any[] = detail?.skus ?? detail?.sku_list ?? detail?.data?.skus ?? [];
        const hit = skus.find(
          (s) => String(s.sku ?? s.sku_code ?? "").toUpperCase() === sku.toUpperCase(),
        );
        if (hit) {
          log(true, `GET /waves/${wNo}`, `SKU matched`);
          return wNo;
        }
      } catch (err: any) {
        log(false, `GET /waves/${wNo}`, err.message);
      }
    }
    return null;
  };

  const doScan = async (sku: string) => {
    const code = sku.trim();
    if (!code) return;
    setScannedSku(code);
    setLoading(true);
    try {
      const waveNo = await findWaveForSku(code);
      if (!waveNo) {
        toast.error("ไม่พบ SKU ใน Wave ที่ active", { description: code });
        return;
      }
      const body = {
        wave_no: waveNo,
        sku: code,
        operator_id: operatorId,
        device_id: deviceId,
        zone_id: zoneId,
      };
      const res: any = await api.scanSku(body);
      log(true, `POST /scan`, JSON.stringify(res).slice(0, 300));
      if (!res?.success) {
        toast.error(res?.message ?? "scan ล้มเหลว");
        return;
      }
      setResult(res as ScanResult);
      setStep("confirm");
      toast.success(`พบ ${res.total_locations} locations`);
    } catch (e: any) {
      log(false, `POST /scan`, e.message);
      toast.error("scan ล้มเหลว", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleScanned = (text: string) => {
    toast.success("สแกน SKU สำเร็จ", { description: text });
    void doScan(text);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void doScan(scannedSku);
  };

  const callConfirm = async () => {
    if (!result) return;
    setLoading(true);
    try {
      const body = {
        wave_no: result.wave_no,
        sku: result.sku,
        operator_id: operatorId,
        location_codes: result.locations.map((l) => l.location_code),
      };
      const res: any = await api.confirmScan(body);
      log(true, `POST /confirm/scan`, JSON.stringify(res).slice(0, 300));
      if (!res?.success) {
        toast.error(res?.message ?? "ยืนยันไม่สำเร็จ");
        return;
      }
      toast.success("ยืนยันการสแกนสำเร็จ");
      setStep("picking");
    } catch (e: any) {
      log(false, `POST /confirm/scan`, e.message);
      toast.error("ยืนยันไม่สำเร็จ", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const callPutConfirm = async (loc: LocationInfo) => {
    if (!result) return;
    setBusyLoc(loc.location_code);
    try {
      const body = {
        wave_no: result.wave_no,
        sku: result.sku,
        operator_id: operatorId,
        location_code: loc.location_code,
        qty: loc.qty_remaining,
      };
      const res: any = await api.putConfirm(body);
      log(true, `POST /put/confirm`, JSON.stringify(res).slice(0, 300));
      if (res?.success === false) {
        toast.error(res?.message ?? "ยืนยัน put ไม่สำเร็จ");
        return;
      }
      setPutDone((m) => ({ ...m, [loc.location_code]: true }));
      toast.success(`หยิบ ${loc.location_code} สำเร็จ`);
    } catch (e: any) {
      log(false, `POST /put/confirm`, e.message);
      toast.error("ยืนยัน put ไม่สำเร็จ", { description: e.message });
    } finally {
      setBusyLoc(null);
    }
  };

  const callFinish = async () => {
    if (!result) return;
    setLoading(true);
    try {
      const body = {
        wave_no: result.wave_no,
        sku: result.sku,
        operator_id: operatorId,
        location_codes: pendingLocs.map((l) => l.location_code),
      };
      const res: any = await api.confirmCancel(body);
      log(true, `POST /confirm/cancel`, JSON.stringify(res).slice(0, 300));
      if (res?.success === false) {
        toast.error(res?.message ?? "ปิดงานไม่สำเร็จ");
        return;
      }
      toast.success(
        pendingLocs.length === 0 ? "เสร็จสิ้นการสแกน" : `ยกเลิก ${pendingLocs.length} location`,
      );
      setStep("done");
    } catch (e: any) {
      log(false, `POST /confirm/cancel`, e.message);
      toast.error("ปิดงานไม่สำเร็จ", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("scan");
    setScannedSku("");
    setResult(null);
    setPutDone({});
    setScanError(null);
    setManualMode(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster position="top-center" richColors />
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <h1 className="text-xl font-semibold">PTL — ทดสอบ API หยิบสินค้า</h1>
          <p className="text-xs text-muted-foreground mt-0.5 break-all">
            Base: {API_BASE}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <Stepper step={step} />

        {step === "scan" && (
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">1. สแกน SKU</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Zone</Label>
                <div className="flex gap-2 mt-1">
                  {[1, 2].map((z) => (
                    <Button
                      key={z}
                      type="button"
                      size="sm"
                      variant={zoneId === z ? "default" : "outline"}
                      onClick={() => setZoneId(z)}
                      className="flex-1"
                    >
                      Zone {z}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Operator</Label>
                <Input
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="col-span-2">
                <Label>Device ID</Label>
                <Input
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            {!manualMode ? (
              <>
                <QrScanner onResult={handleScanned} onError={(e) => setScanError(e)} />
                {scanError && <p className="text-xs text-destructive">{scanError}</p>}
                <Button variant="outline" className="w-full" onClick={() => setManualMode(true)}>
                  พิมพ์ SKU แทน
                </Button>
              </>
            ) : (
              <form onSubmit={handleManualSubmit} className="space-y-3">
                <div>
                  <Label htmlFor="sku">SKU</Label>
                  <Input
                    id="sku"
                    value={scannedSku}
                    onChange={(e) => setScannedSku(e.target.value)}
                    placeholder="เช่น SKU-0001"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={!scannedSku.trim() || loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "สแกน"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setManualMode(false)}>
                    ใช้กล้อง
                  </Button>
                </div>
              </form>
            )}
          </Card>
        )}

        {step !== "scan" && result && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground">SKU → Wave</p>
                <p className="font-mono font-semibold">{result.sku}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {result.wave_no} · Zone {zoneId}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">รวมต้องหยิบอีก</p>
                <p className="text-2xl font-bold text-primary">{totalRemaining}</p>
              </div>
            </div>
            {result.sku_description && (
              <p className="text-sm text-muted-foreground">{result.sku_description}</p>
            )}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Locations ({result.total_locations})
              </p>
              <ul className="space-y-1">
                {result.locations.map((l) => (
                  <li
                    key={l.location_code}
                    className="flex items-center justify-between gap-2 text-sm rounded-md bg-muted px-3 py-2"
                  >
                    <div>
                      <p className="font-mono font-semibold">{l.location_code}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.branch_code}
                        {l.zone_code ? ` · ${l.zone_code}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="font-bold">{l.qty_remaining}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {l.qty_put}/{l.qty_required}
                        </p>
                      </div>
                      {step === "picking" &&
                        (putDone[l.location_code] ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                            <Check className="h-4 w-4" /> หยิบแล้ว
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => callPutConfirm(l)}
                            disabled={busyLoc === l.location_code}
                          >
                            {busyLoc === l.location_code ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              `หยิบ ${l.qty_remaining}`
                            )}
                          </Button>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {step === "confirm" && result && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">2. ยืนยันการสแกน</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              เรียก <code className="text-xs">POST /confirm/scan</code> ด้วย{" "}
              {result.locations.length} location code
            </p>
            <Button onClick={callConfirm} disabled={loading} className="w-full" size="lg">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "ยืนยันการสแกน"}
            </Button>
            <Button onClick={reset} variant="ghost" className="w-full" size="sm">
              ยกเลิก
            </Button>
          </Card>
        )}

        {step === "picking" && result && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">3. หยิบตามโลเคชั่น</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              กดปุ่ม "หยิบ" ที่แต่ละโลเคชั่นด้านบนเพื่อยืนยันตามจำนวนที่ต้องการ
              ({result.locations.length - pendingLocs.length}/{result.locations.length})
            </p>
            <Button
              onClick={callFinish}
              disabled={loading}
              className="w-full"
              size="lg"
              variant={allDone ? "default" : "destructive"}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : allDone ? (
                <>
                  <Flag className="h-4 w-4 mr-2" />
                  เสร็จสิ้นการสแกน
                </>
              ) : (
                `ยกเลิก ${pendingLocs.length} โลเคชั่นที่เหลือ`
              )}
            </Button>
          </Card>
        )}

        {step === "done" && (
          <Card className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-lg font-semibold">เสร็จสิ้น</h2>
            <p className="text-sm text-muted-foreground">
              ยืนยันสแกน SKU {result?.sku} ใน Wave {result?.wave_no}
            </p>
            <Button onClick={reset} className="w-full" size="lg">
              <RotateCcw className="h-4 w-4 mr-2" />
              สแกน SKU ถัดไป
            </Button>
          </Card>
        )}

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">API Log</h3>
            {logs.length > 0 && (
              <button
                onClick={() => setLogs([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ล้าง
              </button>
            )}
          </div>
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">ยังไม่มีการเรียก API</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-auto">
              {logs.map((l, i) => (
                <li
                  key={i}
                  className="text-xs border-l-2 pl-2 py-1"
                  style={{
                    borderColor: l.ok ? "var(--color-primary)" : "var(--color-destructive)",
                  }}
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-mono">{l.label}</span>
                    <span className="text-muted-foreground shrink-0">{l.time}</span>
                  </div>
                  {l.detail && (
                    <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground text-[10px]">
                      {l.detail}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "scan", label: "สแกน" },
    { key: "confirm", label: "ยืนยัน" },
    { key: "done", label: "เสร็จ" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex-1 flex items-center gap-1">
          <div
            className={
              "flex-1 text-center text-xs py-1.5 rounded-md font-medium " +
              (i <= idx
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground")
            }
          >
            {i + 1}. {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
