export function normalizeApiBase(value) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS API URL without credentials, query parameters, or a fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/api/v1')) throw new Error('The API base URL must end with /api/v1.');
  return url.toString().replace(/\/$/, '');
}

export function parseInterests(value) {
  const interests = [...new Set(value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean))];
  if (interests.length > 30 || interests.some(item => item.length > 50)) throw new Error('Use up to 30 interests, with at most 50 characters each.');
  return interests;
}

export function validatePassword(value) {
  if (value.length < 12 || value.length > 72 || new TextEncoder().encode(value).length > 72) {
    throw new Error('Passwords must have at least 12 characters and at most 72 UTF-8 bytes.');
  }
  return value;
}

export function validId(value) { return /^[a-f\d]{24}$/i.test(value); }
export function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function apiErrorMessage(payload, status) {
  const message = typeof payload?.message === 'string' ? payload.message : `Request failed (${status}).`;
  const fields = Array.isArray(payload?.errors) ? payload.errors.map(error => `${error.path || 'Input'}: ${error.message}`).join('; ') : '';
  return fields ? `${message} ${fields}` : message;
}
