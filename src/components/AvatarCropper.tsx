import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const SIZE = 512;

/** Square crop with zoom + drag; outputs a 512×512 JPEG blob. */
export function AvatarCropper({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (b: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    const base = SIZE / Math.min(img.width, img.height);
    const s = base * zoom;
    const w = img.width * s, h = img.height * s;
    const maxX = Math.max(0, (w - SIZE) / 2), maxY = Math.max(0, (h - SIZE) / 2);
    const x = Math.max(-maxX, Math.min(maxX, off.x)), y = Math.max(-maxY, Math.min(maxY, off.y));
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, (SIZE - w) / 2 + x, (SIZE - h) / 2 + y, w, h);
  }, [img, zoom, off]);

  return (
    <div className="space-y-4">
      <canvas
        ref={canvas}
        width={SIZE}
        height={SIZE}
        className="mx-auto aspect-square w-64 touch-none rounded-full border border-glass-border"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const k = SIZE / 256;
          setOff((o) => ({ x: o.x + (e.clientX - drag.current!.x) * k, y: o.y + (e.clientY - drag.current!.y) * k }));
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
      />
      <Slider min={1} max={3} step={0.01} value={[zoom]} onValueChange={([z]) => setZoom(z ?? 1)} aria-label="Масштаб" />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>Отмена</Button>
        <Button className="flex-1 bg-gradient-primary text-primary-foreground" disabled={!img}
          onClick={() => canvas.current?.toBlob((b) => b && onDone(b), "image/jpeg", 0.9)}>
          Готово
        </Button>
      </div>
    </div>
  );
}
