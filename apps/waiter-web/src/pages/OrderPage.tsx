import { useParams } from 'react-router-dom'

export function OrderPage() {
  const { tableId } = useParams<{ tableId: string }>()

  return (
    <div className="page">
      <h2>Bestellung — Tisch {tableId}</h2>
      <p>Bestellformular folgt in Kürze.</p>
    </div>
  )
}
