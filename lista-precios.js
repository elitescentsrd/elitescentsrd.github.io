'use strict';
// Lista de precios imprimible: filtros de pantalla (solo disponibles, fotos, género) y botón para guardar en PDF.
(() => {
  const $ = s => document.querySelector(s), body = document.body;
  const only = $('#onlyAvailable'), photos = $('#showPhotos'), gender = $('#genderFilter');
  function apply() {
    body.classList.toggle('solo-disponibles', only.checked);
    body.classList.toggle('sin-fotos', !photos.checked);
    document.querySelectorAll('.group').forEach(group => {
      const visible = [...group.querySelectorAll('.item')].filter(item => !only.checked || item.dataset.status === 'disponible').length;
      group.hidden = (gender.value !== 'all' && group.dataset.gender !== gender.value) || visible === 0;
    });
  }
  if (!only || !photos || !gender) return;
  const params = new URLSearchParams(location.search);
  if (params.get('solo') === 'disponibles') only.checked = true;
  if (['hombre', 'mujer', 'unisex'].includes(params.get('genero'))) gender.value = params.get('genero');
  [only, photos, gender].forEach(el => el.addEventListener('change', apply));
  $('#printList')?.addEventListener('click', () => window.print());
  apply();
})();
