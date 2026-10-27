export const $ = id => document.getElementById(id);
export async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || 'The extension is unavailable. Reload this page.');
  return result;
}
export function feedback(id, message, error = false) {
  const el = $(id); el.textContent = message; el.classList.toggle('error', error);
}
export function checkedLabel(time) {
  return time ? `Last successful check: ${new Date(time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})}` : 'No successful checks yet';
}
export async function busy(button, action, label = 'Working…') {
  const original = [...button.childNodes];
  button.disabled = true; button.textContent = label;
  try { return await action(); } finally { button.disabled = false; button.replaceChildren(...original); }
}
