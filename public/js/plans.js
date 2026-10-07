// The state of a plan button on the pricing section. When this deployment has no PayPal plans configured
// (/api/health says subscriptions: false) the button says so instead of failing with a 502 when it is pressed.
export const NOT_CONFIGURED = 'Plans not configured on this deployment';

// health: the parsed /api/health, or null while unknown or unreachable (then the button behaves as before).
export const plansConfigured = (health) => health?.subscriptions !== false;

export function planButton({ label, mine = false, configured = true }) {
  if (mine) return { text: 'Current plan', disabled: true };
  if (!configured) return { text: NOT_CONFIGURED, disabled: true };
  return { text: label, disabled: false };
}
