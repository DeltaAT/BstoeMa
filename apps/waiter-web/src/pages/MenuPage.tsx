import { useParams } from 'react-router-dom'

export function MenuPage() {
  const { tableId } = useParams<{ tableId: string }>()

  return (
    <div className="page">
      <h2>Speisekarte — Tisch {tableId}</h2>
      <p>Speisekarten-Einträge folgen in Kürze.</p>
    </div>
  )
}
