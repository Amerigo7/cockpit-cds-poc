import * as D from '../dist/domain.js';

export function applyAction(store, who, action, args, cockpitId) {
  if (action === 'newCockpit') {
    if (!['laurent', 'jennifer'].includes(who)) throw Error('Action non disponible pour ce profil');
    const ref = typeof args[0] === 'string' ? args[0].trim().replace(/^#/, '').trim() : '';
    if (!ref || ref.length > 80) throw Error('Référence du PO obligatoire (80 caractères au maximum).');
    if (store.cockpits.some(c => c.poRef.toUpperCase() === ref.toUpperCase())) {
      throw Error('Ce PO dispose déjà d’un cockpit.');
    }
    const cockpit = D.newCockpit();
    const owner = args[1] ?? 'laurent';
    if (!['laurent', 'jennifer'].includes(owner)) throw Error('Sélectionnez un owner Accor.');
    cockpit.poRef = ref;
    cockpit.owner = D.ACTORS[owner];
    cockpit.coOwner = D.ACTORS[owner === 'laurent' ? 'jennifer' : 'laurent'];
    store.cockpits.push(cockpit);
    return cockpit;
  }
  const cockpit = store.cockpits.find(c => c.id === (cockpitId ?? store.activeId));
  if (!cockpit) throw Error('PO introuvable. Actualisez la page.');
  switch (action) {
    case 'definition': {
      const [input, activate] = args;
      // Keep operational history and the identity of the shared PO on the server.
      const fields = ['name', 'poRef', 'year', 'budget', 'start', 'end', 'reportMonth',
        'openingMonth', 'owner', 'coOwner', 'supplier', 'monthlyDays', 'rates', 'projects'];
      const definition = Object.fromEntries(fields.map(field => [field, input[field]]));
      if (definition.poRef !== cockpit.poRef) throw Error('La référence du PO partagé est fixe.');
      if (definition.owner !== cockpit.owner) throw Error('L’owner est défini à la création du PO.');
      return D.saveDefinition(cockpit, definition, who, activate === true);
    }
    case 'expense':
      return D.saveExpense(cockpit, args[0], args[1], who, args[2]);
    case 'createInvoice':
      return D.createInvoice(cockpit, args[0], who);
    case 'revise':
      return D.reviseExpense(cockpit, args[0], args[1], who);
    case 'editInvoice': {
      const invoice = D.editInvoice(cockpit, args[0], args[1], who);
      return args[2] ? D.sendInvoice(cockpit, args[0], who) : invoice;
    }
    case 'review':
      return (args[2] === 'return' ? D.returnInvoice : D.validateInvoice)(cockpit, args[0], args[1], who);
    default:
      throw Error('Action inconnue.');
  }
}
