const button = document.getElementById('admin-reset');
const status = document.getElementById('admin-reset-status');
const url = new URL(location.href);

if (url.searchParams.get('demo') === 'reset') {
  status.textContent = 'Démo réinitialisée.';
  url.searchParams.delete('demo');
  history.replaceState(null, '', url);
}

button.addEventListener('click', async () => {
  const message = 'Réinitialiser Max / WeMax (#124177) et TEST FACTU ?\n\n' +
    'Les saisies et validations réalisées sur ces deux PO seront remplacées par le jeu de départ. ' +
    'Max / WeMax repassera en brouillon et TEST FACTU retrouvera une facture avec 20 € d’écart.';
  if (!confirm(message)) return;
  button.disabled = true;
  status.textContent = 'Réinitialisation…';
  try {
    const response = await fetch('/admin/reset-demo', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'La réinitialisation a échoué.');
    window.dispatchEvent(new Event('cockpit-demo-reset'));
    sessionStorage.removeItem('cockpit-active-po');
    url.searchParams.set('demo', 'reset');
    location.replace(url);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
