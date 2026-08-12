const form = document.querySelector('#connector-form');
const status = document.querySelector('#status');
const mediaRoot = form.elements.namedItem('mediaRoot');
const pairingPassword = form.elements.namedItem('pairingPassword');
const linkAccount = document.querySelector('#link-account');

document.querySelector('#browse-folder').addEventListener('click', async () => {
  const folder = await window.__TAURI__.core.invoke('pick_media_folder');
  if (folder) mediaRoot.value = folder;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Saving your connector setup…';
  const config = Object.fromEntries(new FormData(form));
  try {
    await window.__TAURI__.core.invoke('save_connector_config', { config });
    localStorage.setItem('cleanflix.connector.mediaRoot', config.mediaRoot);
    await window.__TAURI__.core.invoke('start_connector');
    status.textContent = 'Saved securely. The connector is running and ready to pair.';
  } catch (error) { status.textContent = error; }
});

linkAccount.addEventListener('click', async () => {
  try {
    const linkUrl = await window.__TAURI__.core.invoke('get_cleanflix_link_url');
    await window.__TAURI__.opener.openUrl(linkUrl);
    status.textContent = 'Finish signing in with Cleanflix in your browser.';
  } catch (error) { status.textContent = error; }
});

const setup = await window.__TAURI__.core.invoke('get_connector_setup');
if (setup.mediaRoot) mediaRoot.value = setup.mediaRoot;
if (setup.passwordConfigured) {
  pairingPassword.placeholder = 'Password already set (enter only to change it)';
  status.textContent = 'Saved connector setup is running.';
}
