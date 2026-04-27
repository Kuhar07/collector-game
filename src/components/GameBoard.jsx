import { useEffect, useRef, useState } from 'react';
import { computeConnections } from '../game/gameEngine';
import { normalizeHistory } from '../utils/coordinateNormalization';

const P1_COLOR = '#dc3545';
const P2_COLOR = '#007bff';
const MAX_BOARD = 600;
const MIN_BOARD = 100;

export default function GameBoard({ state, size, history, onCellClick, disabled }) {
  const wrapperRef = useRef(null);
  const [pixelSize, setPixelSize] = useState(MAX_BOARD);

  useEffect(() => {
    const measure = () => {
      if (!wrapperRef.current) return;
      const stage = wrapperRef.current.parentElement;
      const containerWidth = stage?.clientWidth || wrapperRef.current.clientWidth;
      const width = Math.floor(containerWidth) - 2;

      const stageRect = stage?.getBoundingClientRect();
      const wrapperRect = wrapperRef.current.getBoundingClientRect();
      const stageBottom = stageRect?.bottom ?? window.innerHeight ?? 0;
      const controlsHeight = stage?.querySelector('.sk-game-controls')?.getBoundingClientRect().height || 0;
      const tabBarHeight = document.querySelector('ion-tab-bar')?.getBoundingClientRect().height || 0;
      const bottomReserve = controlsHeight + tabBarHeight + 4;
      const availableHeight = Math.max(MIN_BOARD, Math.floor(stageBottom - wrapperRect.top - bottomReserve));
      const calculated = Math.min(MAX_BOARD, Math.max(MIN_BOARD, Math.min(width, availableHeight)));
      setPixelSize(calculated);
    };

    // Initial measurement
    measure();

    // ResizeObserver for more reliable container-aware sizing
    const observer = new ResizeObserver(() => measure());
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }

    // Fallback to window resize for environments without ResizeObserver
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const cellPx = Math.floor(pixelSize / size);
  const totalPx = cellPx * size;
  const dotPx = Math.max(10, Math.floor(cellPx * 0.3));

  useEffect(() => {
    document.documentElement.style.setProperty('--dot-size', dotPx + 'px');
  }, [dotPx]);

  // Normalize incoming history to handle mixed formats (tuple, object, etc.)
  const historyForPlayer = (player) => {
    const raw = history?.[player] || [];
    return normalizeHistory(raw);
  };

  const lines1 = computeConnections(historyForPlayer(1));
  const lines2 = computeConnections(historyForPlayer(2));

  return (
    <div className="sk-grid-wrapper" ref={wrapperRef}>
      <div
        className="sk-grid"
        style={{
          width: totalPx,
          height: totalPx,
          gridTemplateColumns: `repeat(${size}, ${cellPx}px)`
        }}
      >
        {state.map((row, i) =>
          row.map((cell, j) => (
            <div
              key={`${i}-${j}`}
              className={`sk-cell${cell.eliminated ? ' eliminated' : ''}`}
              style={{ width: cellPx, height: cellPx }}
              onClick={() => !disabled && onCellClick(i, j)}
            >
              {cell.player && (
                <div
                  className="sk-dot"
                  style={{
                    backgroundColor: cell.player === 1 ? P1_COLOR : P2_COLOR,
                    width: dotPx,
                    height: dotPx
                  }}
                />
              )}
            </div>
          ))
        )}

        <svg
          className="sk-connections-svg"
          width={totalPx}
          height={totalPx}
          viewBox={`0 0 ${totalPx} ${totalPx}`}
        >
          {lines1.map(([[r1, c1], [r2, c2]], idx) => (
            <line
              key={`p1-${idx}`}
              x1={(c1 + 0.5) * cellPx}
              y1={(r1 + 0.5) * cellPx}
              x2={(c2 + 0.5) * cellPx}
              y2={(r2 + 0.5) * cellPx}
              stroke={P1_COLOR}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.6}
            />
          ))}
          {lines2.map(([[r1, c1], [r2, c2]], idx) => (
            <line
              key={`p2-${idx}`}
              x1={(c1 + 0.5) * cellPx}
              y1={(r1 + 0.5) * cellPx}
              x2={(c2 + 0.5) * cellPx}
              y2={(r2 + 0.5) * cellPx}
              stroke={P2_COLOR}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.6}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
