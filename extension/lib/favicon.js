// Shared by the options preview and popup. The isolated content script uses the same drawing algorithm.
export function drawFavicon(canvas, {level, color, count = 0, showCount = true}) {
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, 64, 64);
  c.fillStyle = color;
  c.beginPath(); c.roundRect(2, 2, 60, 60, 16); c.fill();
  c.strokeStyle = '#ffffff'; c.fillStyle = '#ffffff'; c.lineWidth = 6; c.lineCap = 'round'; c.lineJoin = 'round';
  if (level === 'clear') { c.beginPath(); c.moveTo(18, 32); c.lineTo(28, 42); c.lineTo(46, 22); c.stroke(); }
  else if (['unknown', 'stale'].includes(level)) { c.font = 'bold 45px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 32, 35); }
  else if (level === 'paused') { c.fillRect(20, 19, 8, 26); c.fillRect(36, 19, 8, 26); }
  else if (showCount) { c.font = `bold ${count > 9 ? 29 : 42}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(count > 99 ? '99+' : String(count), 32, 35); }
  else { c.beginPath(); c.moveTo(32, 16); c.lineTo(32, 35); c.stroke(); c.beginPath(); c.arc(32, 47, 3.5, 0, Math.PI * 2); c.fill(); }
  return canvas.toDataURL('image/png');
}
