/** Presentation only: unknown counts must not be displayed as zero. */
export function formatUiCount(value:number|null|undefined,singular:string,plural=`${singular}s`,unknown="Not set"):string {
  return value==null||!Number.isFinite(value)?unknown:`${value.toLocaleString("en-GB")} ${value===1?singular:plural}`;
}
