const form = document.querySelector('form[action="/login"]');
const email = form.elements.namedItem('email');
const password = form.elements.namedItem('password');
let previous = null;

function updateProfile(clearPassword) {
  const profile = form.elements.namedItem('role').value;
  const isMember = profile === 'member';
  if (email) {
    email.disabled = !isMember;
    email.required = isMember;
  }
  if (clearPassword && previous && profile !== previous) password.value = '';
  password.autocomplete = 'section-' + (profile || 'cockpit') + ' current-password';
  if (email) email.autocomplete = 'section-member username';
  previous = profile;
}

form.addEventListener('change', event => {
  if (event.target.name === 'role') updateProfile(true);
});
window.addEventListener('pageshow', () => updateProfile(false));
updateProfile(false);
