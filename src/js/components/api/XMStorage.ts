
declare const GM: any;
declare const GM_addValueChangeListener: any;
declare const GM_removeValueChangeListener: any;
declare const chrome: any;

export class XMStorage {

  /**
   * Entries that hold site-specific data: subscription lists, update timestamps, and notification caches.
   * The userscript storage is shared between every site the script runs on, so without scoping
   * a tag subscribed to on one site would also be tracked (by name) on the other.
   * Everything else - settings, themes, keybinds - is intentionally shared.
   */
  private static readonly scopedEntries = /^re621\.(Tag|Pool|Comment|Forum)Tracker(\.|$)/;

  /** Prefixes site-specific entries with the hostname of the current site */
  private static scope (name: string): string {
    if (!XMStorage.scopedEntries.test(name)) return name;
    return window.location.hostname.replace(/^www\./, "") + ":" + name;
  }

  /**
   * Saves the specified data to the storage
   * @param name Name of the data entry
   * @param value Data value
   */
  public static async setValue (name: string, value: any): Promise<boolean> {
    name = XMStorage.scope(name);
    return new Promise<boolean>(async (resolve) => {
      if (typeof GM === "undefined") {
        await new Promise<void>((resolve) => {
          chrome.storage.sync.set({ [name]: value }, () => { resolve(); });
        });
      } else await GM.setValue(name, value);
      resolve(true);
    });
  }

  /**
   * Returns the value with the specified name
   * If no such entry exists, returns the default value
   * @param name Name of the data entry
   * @param defaultValue Default value
   */
  public static async getValue (name: string, defaultValue: any): Promise<any> {
    const key = XMStorage.scope(name);
    let value = await XMStorage.rawGet(key);

    // Data saved before entries were scoped per-site is claimed by the first site that loads it
    if (value === undefined && key !== name) {
      const legacy = await XMStorage.rawGet(name);
      if (legacy !== undefined) {
        await XMStorage.setValue(name, legacy);
        await XMStorage.deleteLegacy(name);
        value = legacy;
      }
    }

    return value === undefined ? defaultValue : value;
  }

  /** Returns the value stored under the exact key, or undefined if there is none */
  private static async rawGet (key: string): Promise<any> {
    if (typeof GM === "undefined") {
      return new Promise((resolve) => {
        chrome.storage.sync.get(key, (result: any) => { resolve(result[key]); });
      });
    }
    return GM.getValue(key, undefined);
  }

  /** Removes the value stored under the exact (unscoped) key */
  private static async deleteLegacy (key: string): Promise<void> {
    if (typeof GM === "undefined") {
      return new Promise((resolve) => {
        chrome.storage.sync.remove(key, () => { resolve(); });
      });
    }
    await GM.deleteValue(key);
  }

  /**
   * Deletes the entry with the specified name from storage
   * @param name Name of the data entry
   */
  public static async deleteValue (name: string): Promise<void> {
    name = XMStorage.scope(name);
    return new Promise<void>(async (resolve) => {
      if (typeof GM === "undefined") {
        await new Promise<void>((resolve) => {
          chrome.storage.sync.set({ name: undefined }, () => {
            resolve();
          });
        });
      } else await GM.deleteValue(name);
      resolve();
    });
  }

  /**
   * Adds a change listener to the storage and returns the listener ID.
   * @param name string The name of the observed variable
   * @param callback function(name, oldValue, newValue, remote) {}
   *    **name**        _string_  The name of the observed variable
   *    **oldValue**    _any_     The old value of the variable (undefined if created)
   *    **newValue**    _any_     The new value of the variable (undefined if deleted)
   *    **remote**      _boolean_ true if modified in another tab or false for this script instance
   */
  public static addListener (name: string, callback: (name: string, oldValue: any, newValue: any, remote: boolean) => void): string {
    name = XMStorage.scope(name);
    if (typeof GM_addValueChangeListener === "undefined") {
      chrome.storage.onChanged.addListener(function (changes: ChromeStorageDataChange) {
        for (const key in changes) {
          if (key !== name) return;
          callback(key, changes[key].oldValue, changes[key].newValue, true);
        }
      });
    } else return GM_addValueChangeListener(name, callback);
  }

  /**
   * Removes a change listener by its ID.
   * @param listenerId string ID of the listener
   */
  public static removeListener (listenerId: string): void {
    if (typeof GM_removeValueChangeListener === "undefined") {
      return;
    } else GM_removeValueChangeListener(listenerId);
  }

}

type ChromeStorageDataChange = {
  [name: string]: {
    oldValue: any;
    newValue: any;
  };
};
