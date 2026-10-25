// Small pure helpers shared by the UI and non-hardware tests.
export function appendDelta(current, incoming, limit = 4000) {
  if (!incoming) return current;
  const next = String(incoming);
  if (next.startsWith(current)) return next.slice(-limit);
  return (current + next).slice(-limit);
}
export function shortCaption(text, limit = 200) {
  const value = String(text).trim();
  if (value.length <= limit) return value;
  const tail = value.slice(-limit);
  const boundary = tail.indexOf(' ');
  return '…' + (boundary >= 0 ? tail.slice(boundary + 1) : tail);
}
export function maySendMedia({ connected, providerReady, hidden, socketOpen, bufferedAmount = 0 }) {
  return Boolean(connected && providerReady && !hidden && socketOpen && bufferedAmount < 256 * 1024);
}
