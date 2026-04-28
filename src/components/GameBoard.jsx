import { useEffect, useRef, useState } from 'react';
import { computeConnections } from '../game/gameEngine';
import { normalizeHistory } from '../utils/coordinateNormalization';

const P1_COLOR = '#dc3545';
const P2_COLOR = '#007bff';
const MIN_BOARD_MOBILE = 220;
const MIN_BOARD_DESKTOP = 180;
const MAX_BOARD_MOBILE = 430;
const MAX_BOARD_DESKTOP = 400;
const DESKTOP_BREAKPOINT = 900;

export default function GameBoard({ state, size, history, onCellClick, disabled }) {
  const wrapperRef = useRef(null);
  const measureRef = useRef(() => { });
  const [pixelSize, setPixelSize] = useState(MAX_BOARD_MOBILE);

  useEffect(() => {
    const measure = () => {
      if (!wrapperRef.current) return;
      const stage = wrapperRef.current.parentElement;
      const containerWidth = wrapperRef.current.clientWidth || stage?.clientWidth || 0;
      const width = Math.floor(containerWidth) - 2;
      const isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;
      const mobileTarget = Math.floor(window.innerWidth * 0.9);
      const maxBoard = isDesktop
        ? MAX_BOARD_DESKTOP
        : Math.min(MAX_BOARD_MOBILE, Math.max(MIN_BOARD_MOBILE, mobileTarget));
      const minBoard = isDesktop ? MIN_BOARD_DESKTOP : MIN_BOARD_MOBILE;

      let calculated;
      if (isDesktop) {
        // Keep desktop board stable: size from width only so the controls below remain visible.
        calculated = Math.min(maxBoard, Math.max(minBoard, width));
      } else {
        const wrapperRect = wrapperRef.current.getBoundingClientRect();
        const controlsHeight = stage?.querySelector('.sk-game-controls')?.getBoundingClientRect().height || 0;
        const mobileStatusHeight = stage?.querySelector('.sk-status-mobile')?.getBoundingClientRect().height || 0;
        const tabBarHeight = document.querySelector('ion-tab-bar')?.getBoundingClientRect().height || 0;
        const layoutReserve = 14;
        const bottomReserve = controlsHeight + mobileStatusHeight + tabBarHeight + layoutReserve;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const availableHeight = Math.max(
          minBoard,
          Math.floor(viewportHeight - wrapperRect.top - bottomReserve)
        );
        calculated = Math.min(maxBoard, Math.max(minBoard, Math.min(width, availableHeight)));
      }
      setPixelSize(calculated);
    };
    measureRef.current = measure;

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

  useEffect(() => {
    measureRef.current();
  }, [size]);

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
