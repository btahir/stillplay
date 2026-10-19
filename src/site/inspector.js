/**
 * The local resource inspector: read bitmap resources from the player's own copy of a game
 * executable. The file is parsed in this tab (src/pe-resources.js) and never uploaded.
 */
import { escape } from './ui/dom.js';
import { openDialog } from './ui/dialog.js';
import { showToast } from './ui/toast.js';

const MAX_BYTES = 20 * 1024 * 1024;

export async function inspectFile(file, zone) {
  if (!file) return;
  if (file.size > MAX_BYTES) { showToast('Choose a game executable smaller than 20 MB.'); return; }
  const label = zone?.querySelector('strong');
  const idle = label?.textContent;
  if (label) label.textContent = 'Reading on this device…';
  try {
    const { inspectExecutable } = await import('../pe-resources.js');
    const result = await inspectExecutable(await file.arrayBuffer());
    const bitmaps = result.bitmaps || [];
    let objectUrl;
    openDialog({
      title: 'Your copy, on your computer',
      className: 'dialog-inspector',
      html: `<p><strong>${escape(file.name)}</strong> · ${escape(result.metadata?.machineName || 'PE executable')}</p>
        <p>${bitmaps.length} bitmap resource${bitmaps.length === 1 ? '' : 's'} found. No part of the file was uploaded.</p>
        <p class="hash">SHA-256<br>${escape(result.sha256)}</p>
        ${bitmaps.length ? `<label class="field">Preview a resource <select id="resource-select">${bitmaps.map((bitmap, index) => `<option value="${index}">Bitmap ${escape(bitmap.id)} · ${bitmap.width} × ${bitmap.height}</option>`).join('')}</select></label><p><img id="resource-preview" class="resource-preview" alt="Bitmap extracted locally from your file"></p>` : ''}
        <p class="notice">Resource extraction works locally. Frame order and resource IDs still need checking against the original game before these bitmaps could replace our artwork.</p>`,
      onOpen(dialog) {
        if (!bitmaps.length) return;
        const draw = (index) => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(new Blob([bitmaps[index].bmp], { type: 'image/bmp' }));
          dialog.querySelector('#resource-preview').src = objectUrl;
        };
        draw(0);
        dialog.querySelector('#resource-select').onchange = (event) => draw(Number(event.target.value));
      },
      onClose() { if (objectUrl) URL.revokeObjectURL(objectUrl); },
    });
  } catch (error) {
    showToast(error.message || 'This file could not be read as a game executable.');
  } finally {
    if (label) label.textContent = idle;
  }
}
