import { useEffect } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

// Mounts a live camera scanner into a div. Calls onResult(text) on a read,
// onError(err) if the camera can't start (e.g. permission denied).
export default function Scanner({ regionId, onResult, onError }) {
  useEffect(() => {
    const scanner = new Html5Qrcode(regionId, { verbose: false });
    let stopped = false;
    const formats = [
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
    ];
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 140 }, formatsToSupport: formats },
        (txt) => { if (!stopped) onResult(txt); },
        () => {}
      )
      .catch((err) => onError && onError(err));

    return () => {
      stopped = true;
      try {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      } catch (e) { /* already stopped */ }
    };
  }, []);

  return <div id={regionId} className="scan-region" />;
}
