import { loadXlsxStyle } from './loadXlsxStyle'

/** Browser-safe XLSX download (array buffer → Blob, never writeFile/stream). */
export async function downloadXlsxWorkbook(workbook, filename) {
  const XLSX = await loadXlsxStyle()
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
