export default {
  id: 'sidebar-native-proof',
  activate(host) {
    let receipt = null;
    const mounts = new Set();
    const render = (container) => {
      container.replaceChildren();
      const title = document.createElement('h1');
      title.textContent = 'Native sidebar action proof';
      const result = document.createElement('p');
      result.dataset.sidebarProofCount = String(receipt?.invocationCount ?? 0);
      result.textContent = receipt
        ? `Gateway recorded ${receipt.invocationCount} authenticated native action`
        : 'Ready for native action';
      container.append(title, result);
    };
    const page = host.ui.registerPage({ id: 'proof', label: 'Native proof', mount(container) {
      mounts.add(container); render(container);
      return { dispose() { mounts.delete(container); } };
    } });
    let navigation; const register = () => host.ui.registerNavigation({
      id: 'proof', label: 'Native proof', page: { id: 'proof' }, defaultVisible: true,
      actions: [{ id: 'record', label: 'Record native proof', async run() {
        receipt = await host.request('sidebarproof.record', { marker: 'native-production-bridge', caseLabel: window.__authorityFixture.caseLabel });
        for (const container of mounts) render(container);
        host.navigation.openPage({ id: 'proof' });
      } }],
    });
    navigation = register();
    window.__authorityFixture = { caseLabel:'unset', status() { return host.request('sidebarproof.status',{}); }, retire() { navigation(); }, replace() { navigation(); navigation = register(); } };
    return () => { navigation(); page(); delete window.__authorityFixture; };
  },
};
