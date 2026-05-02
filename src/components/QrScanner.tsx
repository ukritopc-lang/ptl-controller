import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

type Props = {
  onResult: (text: string) => void;
  onError?: (err: string) => void;
};

export function QrScanner({ onResult, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    const id = "qr-reader-" + Math.random().toString(36).slice(2);
    ref.current.id = id;

    const scanner = new Html5Qrcode(id, { verbose: false });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (stoppedRef.current) return;
          stoppedRef.current = true;
          scanner.stop().then(() => scanner.clear()).catch(() => {});
          onResult(decoded);
        },
        () => {},
      )
      .catch((e) => onError?.(String(e?.message ?? e)));

    return () => {
      stoppedRef.current = true;
      if (scanner.isScanning) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      }
    };
  }, [onResult, onError]);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border bg-black">
      <div ref={ref} className="w-full aspect-square" />
    </div>
  );
}