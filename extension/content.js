(() => {
  if (window.top !== window || globalThis.__pagerDutySignal) return;
  globalThis.__pagerDutySignal = true;
  let render = null;
  let observer;
  let saved = [];
  const icon = document.createElement('link');
  icon.rel = 'icon'; icon.type = 'image/png'; icon.sizes = '64x64';
  icon.dataset.pagerdutySignal = 'true';
  let previous = '';

  function draw(data) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const c = canvas.getContext('2d');
    c.fillStyle = data.color;
    c.beginPath(); c.roundRect(2, 2, 60, 60, 16); c.fill();
    c.strokeStyle = '#ffffff'; c.fillStyle = '#ffffff'; c.lineWidth = 6; c.lineCap = 'round'; c.lineJoin = 'round';
    if (data.level === 'clear') { c.beginPath(); c.moveTo(18, 32); c.lineTo(28, 42); c.lineTo(46, 22); c.stroke(); }
    else if (['unknown', 'stale'].includes(data.level)) { c.font = 'bold 45px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 32, 35); }
    else if (data.showCount) { c.font = `bold ${data.count > 9 ? 29 : 42}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(data.count > 99 ? '99+' : String(data.count), 32, 35); }
    else { c.beginPath(); c.moveTo(32, 16); c.lineTo(32, 35); c.stroke(); c.beginPath(); c.arc(32, 47, 3.5, 0, Math.PI * 2); c.fill(); }
    return canvas.toDataURL('image/png');
  }

  function startObserving() {
    observer?.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel', 'type', 'sizes']});
  }

  function apply(next) {
    observer?.disconnect();
    render = next;
    if (!render) {
      icon.remove();
      for (const {node, parent, sibling} of saved) {
        if (!node.isConnected && parent.isConnected) parent.insertBefore(node, sibling?.parentNode === parent ? sibling : null);
      }
      saved = []; previous = '';
    } else {
      icon.rel = 'icon'; icon.type = 'image/png'; icon.sizes = '64x64'; icon.title = render.label;
      for (const node of document.querySelectorAll('link[rel~="icon" i]')) {
        if (node === icon) continue;
        saved.push({node, parent: node.parentNode, sibling: node.nextSibling});
        node.remove();
      }
      const signature = JSON.stringify(render);
      if (signature !== previous) { icon.href = draw(render); icon.setAttribute('data-signal-href', icon.href); previous = signature; }
      // Reassert our href too, if the app modified the managed link.
      if (icon.href !== icon.getAttribute('data-signal-href') && signature === previous) {
        icon.href = draw(render);
        icon.setAttribute('data-signal-href', icon.href);
      }
      if (!icon.isConnected) (document.head || document.documentElement).append(icon);
    }
    startObserving();
  }

  observer = new MutationObserver(records => {
    if (!render) return;
    if (records.some(r => r.type === 'attributes' ? r.target.tagName === 'LINK' :
      [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.tagName === 'LINK' || n.tagName === 'HEAD' || n.contains?.(icon) || n.querySelector?.('link[rel~="icon" i]'))))) apply(render);
  });
  startObserving();
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'RENDER') apply(message.render); });
  async function refresh() {
    try {
      const response = await chrome.runtime.sendMessage({type: 'TAB_STATUS'});
      if (response?.ok) apply(response.render);
    } catch { apply(null); clearInterval(timer); }
  }
  // This watchdog checks freshness, including after machine sleep, without making API requests.
  const timer = setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pageshow', refresh);
  refresh();
})();
