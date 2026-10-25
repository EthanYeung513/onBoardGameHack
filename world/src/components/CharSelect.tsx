import { useEffect, useRef, useState } from 'react';
import { COMPANY } from '../config';

const VARIANTS = 6;

export default function CharSelect({ name, onDone }: { name: string; onDone: (row: number) => void }) {
  const [row, setRow] = useState(0);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.src = `assets/p${row}.png`;
    img.onload = () => {
      const c = ref.current!;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      // idle-down frame = first frame of the sheet; scale 16x32 -> 128x256
      ctx.drawImage(img, 0, 0, 16, 32, 0, 0, 128, 256);
    };
  }, [row]);

  return (
    <div className="char-screen">
      <div className="sd-panel char-card">
        <h2>Who are you, {name}?</h2>
        <p className="sub">Pick your look — this is how {COMPANY.name} will see you in town.</p>
        <div className="char-picker">
          <button className="sd-btn char-arrow" onClick={() => setRow((row + VARIANTS - 1) % VARIANTS)}>‹</button>
          <canvas ref={ref} className="char-preview" width={128} height={192} />
          <button className="sd-btn char-arrow" onClick={() => setRow((row + 1) % VARIANTS)}>›</button>
        </div>
        <div className="char-label">{['Sam', 'Sebastian', 'Abigail', 'Emily', 'Maru', 'Alex'][row]}</div>
        <div className="char-opts">
          <button className="sd-btn" onClick={() => onDone(row)}>Start Day One</button>
        </div>
      </div>
    </div>
  );
}
