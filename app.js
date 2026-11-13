import { normalizeApiBase, parseInterests, validatePassword, validId, formatDate, apiErrorMessage } from './utils.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
//const DEFAULT_API = 'http://localhost:4000/api/v1';
const DEFAULT_API = 'http://samiulenterprise.com:8787/api/v1';
let apiBase = DEFAULT_API;
try { apiBase = normalizeApiBase(localStorage.getItem('secure-notes.api') || DEFAULT_API); } catch { /* Storage can be disabled. */ }

const state = {
  token: '', user: null, sessionVersion: 0, expirationTimer: null,
  route: '', authorId: '', limit: 10, pages: { notes: 1, 'all-notes': 1, users: 1, interests: 1, posts: 1 },
  controller: null,
};
const adminRoutes = new Set(['all-notes', 'users', 'interests']);
const protectedRoutes = new Set(['notes', 'profile', ...adminRoutes]);
const routes = new Set(['login', 'posts', ...protectedRoutes]);

class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function action(label, callback, className = 'secondary small') {
  const button = el('button', label, className);
  button.type = 'button';
  button.addEventListener('click', () => void buttonAction(button, callback));
  return button;
}

function notify(message, error = false) {
  $('#notice-text').textContent = message;
  $('#notice').classList.toggle('error', error);
  $('#notice').hidden = false;
}

function isCancelled(error) { return error?.name === 'AbortError'; }

async function reportError(error) {
  if (isCancelled(error)) return;
  notify(error.message || 'Something went wrong. Please try again.', true);
  if (error.status === 403 && state.token) {
    try {
      const response = await api('/auth/me');
      state.user = response.data;
      updateAccount();
      if (adminRoutes.has(state.route) && state.user?.role !== 'ADMIN') go('notes');
    } catch { /* A 401 is handled centrally. Preserve the original error. */ }
  }
}

async function buttonAction(button, callback) {
  if (button.disabled) return;
  button.disabled = true;
  try { await callback(); } catch (error) { await reportError(error); }
  finally { button.disabled = false; }
}

function formAction(form, callback) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.dataset.busy === 'true' || !form.reportValidity()) return;
    const submit = form.querySelector('button[type="submit"]');
    const errorNode = form.querySelector('.form-error');
    if (errorNode) errorNode.hidden = true;
    form.dataset.busy = 'true';
    if (submit) submit.disabled = true;
    try { await callback(new FormData(form)); }
    catch (error) {
      if (!isCancelled(error)) {
        if (errorNode && form.closest('dialog')?.open) {
          errorNode.textContent = error.message;
          errorNode.hidden = false;
        } else await reportError(error);
      }
    } finally {
      delete form.dataset.busy;
      if (submit) submit.disabled = false;
    }
  });
}

async function api(path, { method = 'GET', body, signal, auth = true } = {}) {
  if (auth && !state.token) throw new ApiError('Please sign in to continue.', 401);
  const version = state.sessionVersion;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(`${apiBase}${path}`, {
      method, headers, credentials: 'omit', cache: 'no-store', signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    if (version !== state.sessionVersion || signal?.aborted) throw new DOMException('Session changed', 'AbortError');
    let payload;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { throw new ApiError(`The API returned a non-JSON response (${response.status}). Check its URL and whether it uses HTTP or HTTPS.`, response.status); }
    }
    if (!response.ok) {
      if (response.status === 401 && auth) signOut('Your session expired or the account is unavailable. Please sign in again.');
      throw new ApiError(apiErrorMessage(payload, response.status), response.status);
    }
    return payload;
  } catch (error) {
    if (signal?.aborted || version !== state.sessionVersion) throw new DOMException('Request cancelled', 'AbortError');
    if (timedOut) throw new ApiError('The API took too long to respond. Please try again.');
    if (error instanceof TypeError) {
      const mixed = location.protocol === 'https:' && apiBase.startsWith('http:');
      throw new ApiError(mixed ? 'An HTTPS frontend cannot call an HTTP API. Use HTTPS for the API or run this frontend locally over HTTP.' : `Cannot reach the API. Check the server and API URL, and set backend CORS_ORIGIN=${location.origin}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function updateAccount() {
  const signedIn = Boolean(state.user && state.token);
  $$('[data-auth]').forEach(node => { node.hidden = !signedIn; });
  $$('[data-admin]').forEach(node => { node.hidden = !signedIn || state.user.role !== 'ADMIN'; });
  $('#login-link').hidden = signedIn;
  $('#logout-button').hidden = !signedIn;
  $('#account-label').textContent = signedIn ? `${state.user.name} · ${state.user.role === 'ADMIN' ? 'Admin' : 'User'}` : 'Not signed in';
}

function clearPrivateViews() {
  for (const id of ['notes-list', 'all-notes-list', 'users-list', 'interests-list', 'profile-details', 'detail-body']) $(`#${id}`).replaceChildren();
  for (const route of ['notes', 'all-notes', 'users', 'interests']) {
    $(`#${route}-pagination`).replaceChildren();
    $(`#${route}-summary`).textContent = '';
  }
  $('#detail-title').textContent = 'Details';
  for (const id of ['note-form', 'post-form', 'user-form']) {
    const form = $(`#${id}`);
    form.reset();
    const recordId = form.elements.namedItem('id');
    if (recordId) recordId.value = '';
  }
}

function signOut(message = 'You have signed out.') {
  state.controller?.abort();
  clearTimeout(state.expirationTimer);
  state.sessionVersion++;
  state.token = '';
  state.user = null;
  Object.keys(state.pages).forEach(key => { state.pages[key] = 1; });
  $$('dialog[open]').forEach(dialog => dialog.close());
  clearPrivateViews();
  $('#login-form').reset();
  updateAccount();
  go('login');
  notify(message);
}

function go(route) {
  if (location.hash === `#${route}`) void renderRoute();
  else location.hash = route;
}

async function renderRoute() {
  let route = location.hash.slice(1) || (state.user ? 'notes' : 'login');
  if (!routes.has(route)) route = state.user ? 'notes' : 'login';
  if (protectedRoutes.has(route) && !state.user) route = 'login';
  if (adminRoutes.has(route) && state.user?.role !== 'ADMIN') route = state.user ? 'notes' : 'login';
  if (route === 'login' && state.user) route = 'notes';
  if (location.hash !== `#${route}`) history.replaceState(null, '', `#${route}`);
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.route = route;
  $$('[data-view]').forEach(section => { section.hidden = section.dataset.view !== route; });
  $$('[data-route]').forEach(link => {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#page-size-label').hidden = !Object.hasOwn(state.pages, route);
  try {
    if (route === 'notes') await loadNotes(false, controller.signal);
    else if (route === 'all-notes') await loadNotes(true, controller.signal);
    else if (route === 'users') await loadUsers(controller.signal);
    else if (route === 'interests') await loadInterests(controller.signal);
    else if (route === 'profile') await loadProfile(controller.signal);
    else if (route === 'posts') await loadPosts(controller.signal);
  } catch (error) {
    if (!isCancelled(error) && !controller.signal.aborted) {
      const list = $(`#${route}-list`) || (route === 'profile' ? $('#profile-details') : null);
      if (list) list.replaceChildren(el('p', 'Could not load this view. Check the message above, then try again.', 'empty'));
      await reportError(error);
    }
  }
}

function loading(route, label) {
  $(`#${route}-list`).replaceChildren(el('p', label, 'loading'));
  $(`#${route}-pagination`).replaceChildren();
  const summary = $(`#${route}-summary`);
  if (summary) summary.textContent = 'Loading…';
}

async function fetchPage(path, route, signal, auth = true) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    const query = new URLSearchParams({ page: String(state.pages[route]), limit: String(state.limit) });
    response = await api(`${path}?${query}`, { signal, auth });
    if (!Array.isArray(response?.data) || !response.pagination) throw new ApiError('The API returned an unexpected list response.');
    const last = Math.max(1, response.pagination.totalPages);
    if (state.pages[route] <= last) break;
    state.pages[route] = last;
  }
  return response;
}

function pagination(route, info, noun) {
  const container = $(`#${route}-pagination`);
  container.replaceChildren();
  const summary = $(`#${route}-summary`);
  if (summary) summary.textContent = `${info.total} ${noun}`;
  if (!info.total) return;
  const previous = action('Previous', () => { state.pages[route]--; return renderRoute(); });
  previous.disabled = info.page <= 1;
  const next = action('Next', () => { state.pages[route]++; return renderRoute(); });
  next.disabled = !info.hasNext;
  container.append(previous, el('span', `Page ${info.page} of ${info.totalPages}`), next);
}

function openDialog(id, reset = true) {
  const dialog = $(`#${id}`);
  const form = dialog.querySelector('form');
  if (form?.dataset.busy === 'true') return false;
  if (reset && form) {
    form.reset();
    // Hidden input values reflect their attributes, so form.reset alone can retain
    // a previous edit ID and turn a later create into an update.
    const recordId = form.elements.namedItem('id');
    if (recordId) recordId.value = '';
  }
  const error = dialog.querySelector('.form-error');
  if (error) error.hidden = true;
  dialog.showModal();
  return true;
}

async function loadNotes(all, signal) {
  const route = all ? 'all-notes' : 'notes';
  loading(route, 'Loading notes…');
  const response = await fetchPage(all ? '/admin/notes' : '/notes', route, signal);
  const list = $(`#${route}-list`);
  list.replaceChildren();
  if (!response.data.length) list.append(el('p', all ? 'No notes have been created yet.' : 'No notes yet. Create your first note using the button above.', 'empty'));
  for (const note of response.data) {
    const card = el('article', undefined, 'card');
    card.append(el('p', formatDate(note.createdAt), 'card-meta'), el('h3', note.title));
    card.append(el('p', note.content.length > 240 ? `${note.content.slice(0, 240)}…` : note.content, 'card-content'));
    if (all) card.append(el('p', `Owner: ${note.ownerId}`, 'card-meta'));
    const actions = el('div', undefined, 'button-row');
    actions.append(action('Read', () => readNote(note._id)));
    if (!all) {
      actions.append(action('Edit', () => editNote(note._id)));
      actions.append(action('Delete', async () => {
        if (!confirm(`Delete “${note.title}”? This cannot be undone.`)) return;
        await api(`/notes/${note._id}`, { method: 'DELETE' });
        notify('Note deleted.');
        await renderRoute();
      }, 'danger small'));
    }
    card.append(actions);
    list.append(card);
  }
  pagination(route, response.pagination, 'notes');
}

async function readNote(id) {
  const { data } = await api(`/notes/${id}`);
  $('#detail-title').textContent = data.title;
  $('#detail-body').replaceChildren(el('p', `Updated ${formatDate(data.updatedAt)} · Owner ${data.ownerId}`, 'card-meta'), el('p', data.content, 'full-content'));
  openDialog('detail-dialog', false);
}

async function editNote(id) {
  const { data } = await api(`/notes/${id}`);
  if (!openDialog('note-dialog')) return;
  $('#note-dialog-title').textContent = 'Edit note';
  const form = $('#note-form');
  form.elements.id.value = data._id;
  form.elements.title.value = data.title;
  form.elements.content.value = data.content;
}

function profileDetails(user) {
  const dl = el('dl', undefined, 'detail-list');
  const values = [
    ['Name', user.name], ['Email', user.email], ['Role', user.role === 'ADMIN' ? 'Admin' : 'User'],
    ['User ID', user._id], ['Interests', user.interests?.join(', ') || 'None added'],
    ['Joined', formatDate(user.createdAt)],
  ];
  for (const [label, value] of values) dl.append(el('dt', label), el('dd', value));
  return dl;
}

async function loadProfile(signal) {
  $('#profile-details').replaceChildren(el('p', 'Loading your profile…', 'loading'));
  const response = await api('/auth/me', { signal });
  state.user = response.data;
  updateAccount();
  const buttons = el('div', undefined, 'button-row');
  buttons.classList.add('profile-actions');
  buttons.append(action('View my public posts', () => showAuthor(state.user._id)));
  $('#profile-details').replaceChildren(profileDetails(state.user), buttons);
}

async function loadUsers(signal) {
  loading('users', 'Loading users…');
  const response = await fetchPage('/users', 'users', signal);
  const list = $('#users-list');
  list.replaceChildren();
  if (!response.data.length) list.append(el('p', 'No users to display.', 'empty'));
  else {
    const table = el('table');
    const caption = el('caption', 'User accounts');
    caption.hidden = true;
    const head = el('thead');
    const headings = el('tr');
    for (const label of ['Account', 'Role', 'Interests', 'Actions']) {
      const th = el('th', label); th.scope = 'col'; headings.append(th);
    }
    head.append(headings);
    const body = el('tbody');
    for (const user of response.data) {
      const row = el('tr');
      const account = el('td');
      account.append(el('div', user.name, 'table-name'), el('div', user.email), el('small', user._id, 'card-meta'));
      const role = el('td');
      role.append(el('span', user.role === 'ADMIN' ? 'Admin' : 'User', `badge ${user.role === 'ADMIN' ? 'admin' : ''}`));
      const actions = el('td');
      const buttons = el('div', undefined, 'button-row');
      buttons.append(action('Details', () => userDetails(user._id)), action('Edit', () => editUser(user._id)), action('Posts', () => showAuthor(user._id)));
      buttons.append(action('Delete', async () => {
        if (!confirm(`Delete the account for ${user.name}? The backend will reject deletion if it owns content or is the final admin.`)) return;
        await api(`/users/${user._id}`, { method: 'DELETE' });
        if (user._id === state.user?._id) { signOut('Your account was deleted.'); return; }
        notify('User deleted.');
        await renderRoute();
      }, 'danger small'));
      actions.append(buttons);
      row.append(account, role, el('td', user.interests?.join(', ') || '—'), actions);
      body.append(row);
    }
    table.append(caption, head, body);
    list.append(table);
  }
  pagination('users', response.pagination, 'users');
}

async function userDetails(id) {
  const { data } = await api(`/users/${id}`);
  $('#detail-title').textContent = 'User details';
  $('#detail-body').replaceChildren(profileDetails(data));
  openDialog('detail-dialog', false);
}

async function editUser(id) {
  const { data } = await api(`/users/${id}`);
  if (!openDialog('user-dialog')) return;
  $('#user-dialog-title').textContent = 'Edit user';
  const form = $('#user-form');
  form.elements.id.value = data._id;
  form.elements.name.value = data.name;
  form.elements.email.value = data.email;
  form.elements.role.value = data.role;
  form.elements.interests.value = data.interests?.join(', ') || '';
  form.elements.password.required = false;
}

async function loadInterests(signal) {
  loading('interests', 'Loading interest groups…');
  const response = await fetchPage('/users/group-by-interests', 'interests', signal);
  const list = $('#interests-list');
  list.replaceChildren();
  if (!response.data.length) list.append(el('p', 'No interests yet. Add interests when creating or editing a user.', 'empty'));
  for (const group of response.data) {
    const card = el('article', undefined, 'card');
    card.append(el('h3', group.interest), el('p', `${group.totalUsers} users`, 'card-meta'));
    const members = el('ul', undefined, 'interest-members');
    for (const user of group.users || []) {
      const item = el('li');
      item.append(el('strong', user.name), el('span', user.email, 'card-meta'), action('View posts', () => showAuthor(user.userId)));
      members.append(item);
    }
    card.append(members);
    list.append(card);
  }
  pagination('interests', response.pagination, 'interest groups');
}

function showAuthor(id) {
  if (!validId(id)) throw new Error('Enter a valid 24-character user ID.');
  state.authorId = id;
  state.pages.posts = 1;
  $('#author-id').value = id;
  go('posts');
}

async function loadPosts(signal) {
  $('#author-id').value = state.authorId;
  if (!state.authorId) {
    $('#posts-heading').textContent = 'Choose an author';
    $('#posts-list').replaceChildren(el('p', 'Enter a user ID above to see their public posts.', 'empty'));
    $('#posts-pagination').replaceChildren();
    return;
  }
  loading('posts', 'Loading public posts…');
  const response = await fetchPage(`/users/${state.authorId}/posts`, 'posts', signal, false);
  $('#posts-heading').textContent = `Posts by ${response.user?.name || 'this user'}`;
  const list = $('#posts-list');
  list.replaceChildren();
  if (!response.data.length) list.append(el('p', 'This user has not published any posts.', 'empty'));
  for (const post of response.data) {
    const card = el('article', undefined, 'card');
    card.append(el('p', formatDate(post.createdAt), 'card-meta'), el('h3', post.title), el('p', post.content, 'full-content'));
    list.append(card);
  }
  pagination('posts', response.pagination, 'posts');
}

function switchAuth(register) {
  $('#login-form').hidden = register;
  $('#register-form').hidden = !register;
  $('#show-login').classList.toggle('secondary', register);
  $('#show-register').classList.toggle('secondary', !register);
  $('#show-login').setAttribute('aria-pressed', String(!register));
  $('#show-register').setAttribute('aria-pressed', String(register));
}

formAction($('#login-form'), async data => {
  const response = await api('/auth/login', { method: 'POST', auth: false, body: { email: data.get('email').trim(), password: data.get('password') } });
  if (!response?.data?.accessToken) throw new ApiError('The API did not return an access token.');
  state.sessionVersion++;
  state.token = response.data.accessToken;
  try {
    const profile = await api('/auth/me');
    state.user = profile.data;
    if (!state.user?._id) throw new ApiError('The API did not return a user profile.');
  } catch (error) { state.token = ''; state.user = null; updateAccount(); throw error; }
  clearTimeout(state.expirationTimer);
  state.expirationTimer = setTimeout(() => signOut('Your session expired. Please sign in again.'), (response.data.expiresIn || 900) * 1000);
  $('#login-form').reset();
  updateAccount();
  notify(`Welcome, ${state.user.name}.`);
  go('notes');
});

formAction($('#register-form'), async data => {
  const email = data.get('email').trim();
  await api('/auth/register', { method: 'POST', auth: false, body: {
    name: data.get('name').trim(), email, password: validatePassword(data.get('password')), interests: parseInterests(data.get('interests')),
  } });
  $('#register-form').reset();
  switchAuth(false);
  $('#login-form').elements.email.value = email;
  $('#login-form').elements.password.focus();
  notify('Account created. Sign in with your new credentials.');
});

formAction($('#note-form'), async data => {
  const id = data.get('id');
  await api(id ? `/notes/${id}` : '/notes', { method: id ? 'PATCH' : 'POST', body: { title: data.get('title').trim(), content: data.get('content') } });
  $('#note-dialog').close();
  $('#note-form').reset();
  if (!id) state.pages.notes = 1;
  notify(id ? 'Note updated.' : 'Note created.');
  go('notes');
});

formAction($('#post-form'), async data => {
  await api('/posts', { method: 'POST', body: { title: data.get('title').trim(), content: data.get('content') } });
  $('#post-dialog').close();
  $('#post-form').reset();
  notify('Your public post has been published.');
  showAuthor(state.user._id);
});

formAction($('#user-form'), async data => {
  const id = data.get('id');
  const password = data.get('password');
  const body = { name: data.get('name').trim(), email: data.get('email').trim(), role: data.get('role'), interests: parseInterests(data.get('interests')) };
  if (!id || password) body.password = validatePassword(password);
  await api(id ? `/users/${id}` : '/users', { method: id ? 'PATCH' : 'POST', body });
  $('#user-dialog').close();
  $('#user-form').reset();
  notify(id ? 'User updated.' : 'User created.');
  if (id === state.user?._id) {
    const profile = await api('/auth/me');
    state.user = profile.data;
    updateAccount();
  }
  if (!id) state.pages.users = 1;
  go(state.user?.role === 'ADMIN' ? 'users' : 'notes');
});

formAction($('#author-form'), async data => { showAuthor(data.get('authorId').trim()); });

formAction($('#connection-form'), async data => {
  const next = normalizeApiBase($('#api-base').value);
  if (next === apiBase) { notify('The API connection is unchanged.'); return; }
  signOut('API connection updated. Sign in to the selected server.');
  apiBase = next;
  try { localStorage.setItem('secure-notes.api', apiBase); } catch { /* Remain usable without persistent storage. */ }
  $('#api-base').value = apiBase;
  $('#connection-label').textContent = apiBase;
  $('#connection-result').textContent = '';
});

$('#connection-test').addEventListener('click', event => void buttonAction(event.currentTarget, async () => {
  const base = normalizeApiBase($('#api-base').value);
  const health = new URL(base); health.pathname = '/health';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  $('#connection-result').textContent = 'Checking…';
  try {
    const response = await fetch(health, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload?.data?.status !== 'ok') throw new Error('The server did not return the expected health response.');
    $('#connection-result').textContent = 'API is reachable. Health check passed.';
  } catch {
    $('#connection-result').textContent = `Connection failed. Check the URL, server, certificate, and CORS_ORIGIN=${location.origin}.`;
  } finally { clearTimeout(timeout); }
}));

$('#new-note').addEventListener('click', () => { if (openDialog('note-dialog')) $('#note-dialog-title').textContent = 'New note'; });
$('#new-post').addEventListener('click', () => openDialog('post-dialog'));
$('#new-user').addEventListener('click', () => {
  if (!openDialog('user-dialog')) return;
  $('#user-dialog-title').textContent = 'Add user';
  $('#user-form').elements.password.required = true;
});
$('#my-posts').addEventListener('click', () => showAuthor(state.user._id));
$('#logout-button').addEventListener('click', () => signOut());
$('#notice-dismiss').addEventListener('click', () => { $('#notice').hidden = true; });
$('#show-login').addEventListener('click', () => switchAuth(false));
$('#show-register').addEventListener('click', () => switchAuth(true));
$$('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
$$('[data-refresh]').forEach(button => button.addEventListener('click', () => void buttonAction(button, renderRoute)));
$('#page-size').addEventListener('change', () => {
  state.limit = Number($('#page-size').value);
  Object.keys(state.pages).forEach(key => { state.pages[key] = 1; });
  void renderRoute();
});
window.addEventListener('hashchange', () => void renderRoute());
$('#api-base').value = apiBase;
$('#connection-label').textContent = apiBase;
updateAccount();
void renderRoute();
