/** Unknown paths. */
import { icon } from '../ui/icons.js';

export function render(main) {
  main.innerHTML = `<article class="article"><p class="eyebrow">A small detour</p><h1>Nothing hiding here.</h1><p class="lede">There are still a few safe squares back home.</p><p><a class="text-link" href="/">Back to the games ${icon('arrow', { size: 12 })}</a></p></article>`;
}
