export interface LayoutSaveHandle { createWritable(): Promise<{ write(blob: Blob): Promise<void>; close(): Promise<void> }> }
interface LayoutOpenHandle { getFile(): Promise<File> }
type PickerWindow = Window & {
  showSaveFilePicker?: (options: object) => Promise<LayoutSaveHandle>;
  showOpenFilePicker?: (options: object) => Promise<LayoutOpenHandle[]>;
};
// The native picker limits filter extensions to 16 characters; .electricallayout
// is longer. Use All files, retaining the full suggested filename and ZIP validation.
/** Request immediately in the click handler, before asynchronous ZIP preparation. */
export function chooseLayoutSave(fileName: string) {
  const picker = (window as PickerWindow).showSaveFilePicker;
  return picker ? picker.call(window, { suggestedName: fileName }) : null;
}
export function chooseLayoutOpen() {
  const picker = (window as PickerWindow).showOpenFilePicker;
  return picker ? picker.call(window, { multiple: false }).then(async handles => handles[0]?.getFile()) : null;
}
