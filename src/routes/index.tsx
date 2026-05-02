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
import { CheckCircle2, QrCode, PackageCheck, Flag, Loader2, RotateCcw, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

type Step = "scan" | "start" | "picking" | "done";
type LogEntry = { time: string; ok: boolean; label: string; detail?: string };

type MatchedSku = {
  waveNo: string;
  sku: string;
  remaining: number;
  raw: any;
};

function Index() {
  const [step, setStep] = useState<Step>("scan");
  const [waveNo, setWaveNo] = useState("");
  const [scannedSku, setScannedSku] = useState("");
  const [matched, setMatched] = useState<MatchedSku | null>(null);
  const [operatorId, setOperatorId] = useState("OP001");
  const [manualMode, setManualMode] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickCount, setPickCount] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const log = (ok: boolean, label: string, detail?: string) =>
    setLogs((l) => [
      { time: new Date().toLocaleTimeString(), ok, label, detail },
      ...l,
    ]);

  const lookupSku = async (sku: string) => {
    const code = sku.trim();
    if (!code) return;
    setScannedSku(code);
    setLoading(true);
    try {
      // 1) ดึง active waves
      const activeRes: any = await api.getActiveWaves();
      log(true, `GET /waves/active`, JSON.stringify(activeRes).slice(0, 200));
      const waves: any[] = Array.isArray(activeRes)
        ? activeRes
        : activeRes?.data ?? [];

      // 2) วนเช็คแต่ละ wave ว่ามี SKU นี้ใน detail หรือไม่
      let found: MatchedSku | null = null;
      for (const w of waves) {
        const wNo = w.wave_no ?? w.waveNo;
        if (!wNo) continue;
        try {
          const detail: any = await api.getWaveDetail(wNo);
          log(
            true,
            `GET /waves/${wNo}`,
            `checking sku ${code}`,
          );
          const skus: any[] =
            detail?.skus ?? detail?.sku_list ?? detail?.data?.skus ?? [];
          const hit = skus.find(
            (s) =>
              String(s.sku ?? s.sku_code ?? "").toUpperCase() ===
              code.toUpperCase(),
          );
          if (hit) {
            const remaining = Number(
              hit.remaining_qty ??
                hit.remaining ??
                (Number(hit.total_qty ?? 0) - Number(hit.put_qty ?? 0)),
            );
            found = { waveNo: wNo, sku: code, remaining, raw: hit };
            break;
          }
        } catch (err: any) {
          log(false, `GET /waves/${wNo}`, err.message);
        }
      }

      if (!found) {
        toast.error("ไม่พบ SKU ใน Wave ที่ active", { description: code });
        return;
      }
      if (found.remaining <= 0) {
        toast.error("SKU นี้ไม่มี remaining เหลือ", {
          description: `Wave ${found.waveNo}`,
        });
        setMatched(found);
        return;
      }

      setMatched(found);
      setWaveNo(found.waveNo);
      setStep("start");
      toast.success(`พบ SKU ใน ${found.waveNo}`, {
        description: `remaining ${found.remaining}`,
      });
    } catch (e: any) {
      log(false, `GET /waves/active`, e.message);
      toast.error("ดึง active waves ไม่สำเร็จ", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleScanned = (text: string) => {
    toast.success("สแกน SKU สำเร็จ", { description: text });
    void lookupSku(text);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void lookupSku(scannedSku);
  };

  const callStart = async () => {
    setLoading(true);
    try {
      const res = await api.startWave(waveNo, { operator_id: operatorId });
      log(true, `PUT /waves/${waveNo}/start`, JSON.stringify(res));
      toast.success("เริ่มหยิบแล้ว");
      setStep("picking");
    } catch (e: any) {
      log(false, `PUT /waves/${waveNo}/start`, e.message);
      toast.error("เริ่มหยิบไม่สำเร็จ", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const callConfirmPick = async () => {
    setLoading(true);
    try {
      const res = await api.getWaveProgress(waveNo);
      setPickCount((c) => c + 1);
      log(true, `GET /waves/${waveNo}/progress`, JSON.stringify(res).slice(0, 200));
      toast.success(`ยืนยันการหยิบ #${pickCount + 1}`);
    } catch (e: any) {
      log(false, `GET /waves/${waveNo}/progress`, e.message);
      toast.error("ยืนยันการหยิบล้มเหลว", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const callFinish = async () => {
    setLoading(true);
    try {
      const res = await api.getWaveDetail(waveNo);
      log(true, `GET /waves/${waveNo}`, JSON.stringify(res).slice(0, 200));
      toast.success("สิ้นสุดการหยิบ");
      setStep("done");
    } catch (e: any) {
      log(false, `GET /waves/${waveNo}`, e.message);
      toast.error("ดึงสรุปไม่สำเร็จ", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("scan");
    setWaveNo("");
    setScannedSku("");
    setMatched(null);
    setPickCount(0);
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
            <p className="text-xs text-muted-foreground">
              สแกนหมายเลข SKU เพื่อตรวจสอบว่ามีอยู่ใน Wave ที่ active หรือไม่
            </p>

            {!manualMode ? (
              <>
                <QrScanner
                  onResult={handleScanned}
                  onError={(e) => setScanError(e)}
                />
                {scanError && (
                  <p className="text-xs text-destructive">{scanError}</p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setManualMode(true)}
                >
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
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={!scannedSku.trim() || loading}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "ตรวจสอบ"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setManualMode(false)}
                  >
                    ใช้กล้อง
                  </Button>
                </div>
              </form>
            )}

            {matched && matched.remaining <= 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">
                    SKU {matched.sku} ไม่มี remaining
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Wave {matched.waveNo} · remaining {matched.remaining}
                  </p>
                </div>
              </div>
            )}
          </Card>
        )}

        {step !== "scan" && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground">SKU → Wave</p>
                <p className="font-mono font-semibold">{scannedSku}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {waveNo}
                  {matched && (
                    <> · remaining <span className="text-foreground font-semibold">{matched.remaining}</span></>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Operator</p>
                <Input
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  className="h-8 w-28 text-right"
                  disabled={step !== "start"}
                />
              </div>
            </div>
          </Card>
        )}

        {step === "start" && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">2. ยืนยันการเริ่มหยิบ</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              กดปุ่มเพื่อเรียก <code className="text-xs">PUT /waves/{waveNo}/start</code>
            </p>
            <Button onClick={callStart} disabled={loading} className="w-full" size="lg">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "เริ่มหยิบ"}
            </Button>
          </Card>
        )}

        {step === "picking" && (
          <>
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <PackageCheck className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">3. ยืนยันการหยิบ</h2>
              </div>
              <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                หยิบไปแล้ว: <span className="font-bold">{pickCount}</span> ครั้ง
              </div>
              <Button onClick={callConfirmPick} disabled={loading} className="w-full" size="lg">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "ยืนยันการหยิบ"}
              </Button>
            </Card>

            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">4. สิ้นสุดการหยิบ</h2>
              </div>
              <Button
                onClick={callFinish}
                disabled={loading}
                variant="secondary"
                className="w-full"
                size="lg"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "ยืนยันสิ้นสุด"}
              </Button>
            </Card>
          </>
        )}

        {step === "done" && (
          <Card className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-lg font-semibold">เสร็จสิ้น</h2>
            <p className="text-sm text-muted-foreground">
              Wave {waveNo} หยิบรวม {pickCount} ครั้ง
            </p>
            <Button onClick={reset} className="w-full" size="lg">
              <RotateCcw className="h-4 w-4 mr-2" />
              เริ่ม Wave ใหม่
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
                    borderColor: l.ok
                      ? "var(--color-primary)"
                      : "var(--color-destructive)",
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
    { key: "start", label: "เริ่ม" },
    { key: "picking", label: "หยิบ" },
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
