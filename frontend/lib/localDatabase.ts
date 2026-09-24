let connection: Promise<IDBDatabase> | undefined;
export function localDatabase(): Promise<IDBDatabase> {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("freefloorplan3d", 1);
    request.onupgradeneeded = () => { for (const name of ["projects", "backups", "assets", "meta"]) request.result.createObjectStore(name); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(new Error("Local storage could not open. Check your browser storage settings.")); };
    request.onblocked = () => { connection = undefined; reject(new Error("Close other planner tabs to update local storage.")); };
  });
}
export function requestValue<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
export function completed(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new Error("Local save failed. Storage may be full; download a project backup.")); }); }
