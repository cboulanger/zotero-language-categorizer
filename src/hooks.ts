import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { getScopedEligibleItems } from "./modules/scan";
import { openClassifyDialog } from "./modules/dialog/classify-dialog";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  Zotero.MenuManager.registerMenu({
    menuID: "zotero-lang-cat-tools-menu",
    pluginID: addon.data.config.addonID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "menuitem",
        l10nID: "zotero-lang-cat-menu-classify",
        onCommand: () => {
          const items = getScopedEligibleItems();
          openClassifyDialog(items);
        },
      },
    ],
  });

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-addon.ftl`);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  for (const win of Services.wm.getEnumerator("zotero-lang-cat:dialog")) {
    (win as Window).close();
  }
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
