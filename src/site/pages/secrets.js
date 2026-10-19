/** /secrets and /secrets/<slug>. The articles and their demos live in src/secrets.js. */
import { secrets, renderSecret } from '../../secrets.js';
import { showToast } from '../ui/toast.js';
import { secretCard } from './home.js';

export function render(main, { slug }) {
  if (!slug) {
    main.innerHTML = `<section class="secrets-index wrap"><p class="eyebrow">Worth another look</p><h1>Small games.<br><em>Good secrets.</em></h1><p class="lede">The details that stayed with us, and the code you can poke at. Interactive notes from a reconstruction in progress.</p><div class="secrets-grid">${secrets.map(secretCard).join('')}</div></section>`;
    return null;
  }
  const secret = secrets.find((item) => item.slug === slug);
  document.title = secret ? `${secret.title.replace(/\.$/, '')} — Stillplay` : 'A secret for another day — Stillplay';
  let cleanup = null;
  let gone = false;
  renderSecret(slug, main, { showToast }).then((dispose) => {
    if (gone) dispose?.();
    else cleanup = dispose;
  }).catch((error) => console.error(error));
  return () => { gone = true; cleanup?.(); };
}
