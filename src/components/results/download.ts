/** Save text as a file through a temporary object URL (prototype downloadFile). */
export function downloadFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Column/heading name: drops "Control · " and shortens "Processed · " to "FX · ". */
export const shortName = (name: string): string =>
  name.replace(/^Control · /, '').replace(/^Processed · /, 'FX · ')
