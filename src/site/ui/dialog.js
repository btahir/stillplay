/**
 * One shared modal dialog (#dialog in index.html). Games receive `showDialog(title, html, onOpen)`
 * through their mount options; the shell uses `openDialog` for richer layouts.
 */
let closeHandler = null;

function parts() {
  const dialog = document.querySelector('#dialog');
  return { dialog, title: dialog.querySelector('#dialog-title'), body: dialog.querySelector('#dialog-body') };
}

export function openDialog({ title, html, className = '', onOpen, onClose } = {}) {
  const { dialog, title: heading, body } = parts();
  closeHandler?.();
  closeHandler = onClose || null;
  heading.textContent = title;
  body.innerHTML = html;
  dialog.className = className;
  if (!dialog.open) dialog.showModal();
  // Native showModal focuses the close button; a dialog can name a better first stop.
  body.querySelector('[autofocus]')?.focus({ preventScroll: true });
  onOpen?.(dialog);
  return dialog;
}

export function showDialog(title, html, onOpen) {
  return openDialog({ title, html, onOpen });
}

export function closeDialog() {
  const { dialog } = parts();
  if (dialog.open) dialog.close();
}

export function setupDialog() {
  const { dialog } = parts();
  dialog.querySelector('#dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const handler = closeHandler;
    closeHandler = null;
    handler?.();
  });
  // Close when the backdrop (outside the dialog box) is clicked.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) dialog.close();
  });
}
