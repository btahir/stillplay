/** A single polite live region for short confirmations ("Result copied."). */
let timer;

export function showToast(text) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => toast.classList.remove('show'), 3200);
}
