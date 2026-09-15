import { useEffect, useRef } from "react";
import styles from "./Calendar.module.css";

const calendarHourLines = Array.from({ length: 24 }, (_, index) => index + 1);

export function CalendarHourLines({
  onGeometryChange,
}: {
  onGeometryChange: (height: number, origin: number, devicePixelRatio: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reportGeometry = (bounds: DOMRect, devicePixelRatio: number) => {
      const deviceTop = bounds.top * devicePixelRatio;
      const origin = (deviceTop - Math.floor(deviceTop)) / devicePixelRatio;
      onGeometryChange(bounds.height, origin, devicePixelRatio);
      canvas.parentElement?.style.setProperty("--route-stroke", `${2 / devicePixelRatio}px`);
    };
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const devicePixelRatio = window.devicePixelRatio || 1;
      const deviceWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
      const deviceHeight = Math.max(1, Math.round(bounds.height * devicePixelRatio));
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
      reportGeometry(bounds, devicePixelRatio);

      const context = canvas.getContext("2d");
      if (!context) return;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, deviceWidth, deviceHeight);
      context.fillStyle = getComputedStyle(canvas).color;
      for (const hour of calendarHourLines) {
        const y = Math.min(deviceHeight - 1, Math.round((deviceHeight * hour) / 24));
        context.fillRect(0, y, deviceWidth, 1);
      }
    };
    const alignAfterScroll = () => {
      reportGeometry(canvas.getBoundingClientRect(), window.devicePixelRatio || 1);
    };

    const resizeObserver = new ResizeObserver(draw);
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const scroller = canvas.closest(`.${styles.scroller}`);
    resizeObserver.observe(canvas);
    colorScheme.addEventListener("change", draw);
    scroller?.addEventListener("scroll", alignAfterScroll, { passive: true });
    window.addEventListener("resize", draw);
    draw();
    return () => {
      resizeObserver.disconnect();
      colorScheme.removeEventListener("change", draw);
      scroller?.removeEventListener("scroll", alignAfterScroll);
      window.removeEventListener("resize", draw);
    };
  }, [onGeometryChange]);

  return <canvas ref={canvasRef} className={styles.hourLines} data-calendar-hour-lines />;
}
