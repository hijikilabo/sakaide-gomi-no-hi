(function (global) {
  'use strict';

  // This view consumes only local, reviewed boundaries. Collection points may
  // eventually be a separate layer with their own sources and access rules.
  function createBoundaryMap(canvas, boundaries, onPin) {
    const ctx = canvas.getContext('2d');
    const {width, height} = canvas;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const {rings} of boundaries) {
      for (const [x, y] of rings[0]) {
        west = Math.min(west, x);
        east = Math.max(east, x);
        south = Math.min(south, y);
        north = Math.max(north, y);
      }
    }
    const baseScale = Math.min(width / Math.max(east - west, .001), height / Math.max(north - south, .001)) * .87;
    let center = [(west + east) / 2, (north + south) / 2];
    let zoom = 1, pin = null;
    const project = ([lon, lat]) => [width / 2 + (lon - center[0]) * baseScale * zoom,
      height / 2 - (lat - center[1]) * baseScale * zoom];
    const unproject = ([x, y]) => [center[0] + (x - width / 2) / (baseScale * zoom),
      center[1] - (y - height / 2) / (baseScale * zoom)];

    function draw() {
      ctx.fillStyle = '#e5f3fc';
      ctx.fillRect(0, 0, width, height);
      for (const {rings, district} of boundaries) {
        ctx.beginPath();
        for (const ring of rings) {
          ctx.moveTo(...project(ring[0]));
          for (const point of ring.slice(1)) ctx.lineTo(...project(point));
          ctx.closePath();
        }
        ctx.fillStyle = '#f6fcf4';
        ctx.strokeStyle = '#2775a4';
        ctx.lineWidth = 2;
        ctx.fill('evenodd');
        ctx.stroke();
        const ring = rings[0].slice(1);
        const midpoint = ring.reduce(([x, y], [lon, lat]) => [x + lon / ring.length, y + lat / ring.length], [0, 0]);
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#184972';
        ctx.fillText(district, ...project(midpoint));
      }
      ctx.strokeStyle = '#164979';
      ctx.beginPath();
      ctx.moveTo(width / 2 - 8, height / 2);
      ctx.lineTo(width / 2 + 8, height / 2);
      ctx.moveTo(width / 2, height / 2 - 8);
      ctx.lineTo(width / 2, height / 2 + 8);
      ctx.stroke();
      if (pin) {
        ctx.beginPath();
        ctx.arc(...project(pin), 10, 0, 2 * Math.PI);
        ctx.fillStyle = '#ab352d';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.stroke();
      }
    }

    function place(point) {
      pin = point;
      draw();
      onPin(point);
    }

    const pan = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]};
    const controller = new AbortController();
    const options = {signal: controller.signal};
    let drag;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = {x: event.clientX, y: event.clientY, center};
      canvas.setPointerCapture(event.pointerId);
    }, options);
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      const box = canvas.getBoundingClientRect();
      center = [drag.center[0] - (event.clientX - drag.x) * width / box.width / (baseScale * zoom),
        drag.center[1] + (event.clientY - drag.y) * height / box.height / (baseScale * zoom)];
      draw();
    }, options);
    canvas.addEventListener('pointerup', event => {
      if (!drag) return;
      const box = canvas.getBoundingClientRect();
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) {
        place(unproject([(event.clientX - box.left) * width / box.width,
          (event.clientY - box.top) * height / box.height]));
      }
      drag = null;
    }, options);
    canvas.addEventListener('pointercancel', () => { drag = null; }, options);
    canvas.addEventListener('keydown', event => {
      if (event.key === 'Enter') place(center);
      else if (Object.hasOwn(pan, event.key)) {
        center = pan[event.key].map((v, i) => center[i] + 70 * v / (baseScale * zoom));
        draw();
      } else return;
      event.preventDefault();
    }, options);
    draw();
    return {
      zoom(factor) { zoom = Math.max(1, Math.min(64, zoom * factor)); draw(); },
      locate(point) { center = point; zoom = Math.max(zoom, 4); place(point); },
      destroy() { controller.abort(); ctx.clearRect(0, 0, width, height); }
    };
  }

  global.createBoundaryMap = createBoundaryMap;
})(window);
