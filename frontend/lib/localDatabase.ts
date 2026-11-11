let connection: Promise<IDBDatabase> | undefined;
let storageAccount: string | null | undefined;

export function bindLocalStorageAccount(account: string | null): boolean {
  if (storageAccount === undefined) storageAccount = account;
  return storageAccount === account;
}

export const usesGuestLocalStorage = () => !storageAccount;
export const matchesLocalStorageAccount = (account: string | null) => storageAccount === undefined || storageAccount === account;

export function localDatabase(): Promise<IDBDatabase> {
  if (storageAccount === undefined) storageAccount = null;
  return connection ??= openDatabase(storageAccount, () => { connection = undefined; });
}

// Open the authenticated destination for a guest handoff without rebinding the running editor.
export function openGuestHandoffDestination(account: string): Promise<IDBDatabase> {
  if (storageAccount !== null || !account) throw new Error("The guest workspace is no longer active.");
  return openDatabase(account);
}

function openDatabase(account: string | null, onClose?: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const name = account ? "freefloorplan3d:account:" + account : "freefloorplan3d";
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) for (const name of ["projects", "backups", "assets", "meta"]) db.createObjectStore(name);
      if (!db.objectStoreNames.contains("electricalAttachments")) db.createObjectStore("electricalAttachments");
    };
    let blocked = false;
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); onClose?.(); };
      resolve(request.result);
    };
    request.onerror = () => { if (!blocked) onClose?.(); reject(new Error("Local storage could not open. Check your browser storage settings.")); };
    request.onblocked = () => { blocked = true; onClose?.(); reject(new Error("Close other planner tabs to update local storage.")); };
  });
}
export function requestValue<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
export function completed(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new Error("Local save failed. Storage may be full; download a project backup.")); }); }
