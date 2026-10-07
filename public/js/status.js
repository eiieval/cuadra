// How an invoice status looks and what "open" means. One place for the ledger table, the grid, the chat cards and the
// widgets, so a status never changes colour or meaning from one view to another. Pure, no DOM.
export const BADGE = {
  PAID: 'badge badge-ok',
  MARKED_AS_PAID: 'badge badge-ok',
  OVERDUE: 'badge badge-bad',
  ERROR: 'badge badge-bad',
  CANCELLED: 'badge badge-mute',
  RECTIFIED: 'badge badge-mute',
  SENT: 'badge badge-warn',
  UNPAID: 'badge badge-warn',
  PARTIALLY_PAID: 'badge badge-warn',
};

// Open = still to be collected: not paid and not cancelled (overdue is open too).
export const OPEN = (status) => status !== 'PAID' && status !== 'CANCELLED' && status !== 'RECTIFIED';

export const statusWord = (status) => String(status).replace(/_/g, ' ');
