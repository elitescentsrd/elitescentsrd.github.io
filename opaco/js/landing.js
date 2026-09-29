// Portada: estado de sesión en la cabecera y comparador "antes / después".
import { initHeader, $ } from './common.js';

initHeader();

const ba = $('#beforeAfter');
if (ba) {
  const range = ba.querySelector('input[type=range]');
  const set = v => ba.style.setProperty('--split', v + '%');
  range.addEventListener('input', () => set(range.value));
  set(range.value);
}
